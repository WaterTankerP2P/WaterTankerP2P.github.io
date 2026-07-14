/*
 * app.js — AquaDrive UI controller.
 * "Name your price" marketplace for water tanker delivery.
 * Pure client side: state in localStorage, no server.
 */
(function (global) {
  'use strict';

  // ---------- module state ----------
  var state = {
    booting: true,        // true until the backend (local/cloud) is decided
    cloudReady: false,    // Firebase connected & auth state known
    cloudFailed: false,   // cloud was configured but couldn't connect
    tab: 'home',          // home | activity | profile
    activeRequestId: null, // request currently being tracked (customer)
    cancelOffers: null,    // cancel fn for the offer simulation (local mode)
    map: null,
    mapMarker: null,
    pickedLocation: null,  // { lat, lng, address }
    askedLocation: false,
    trackTimer: null,      // live-tracking animation (local mode)
    trackTruck: null,      // Leaflet marker for the driver (cloud + local)
    lastDriverLoc: null,   // last real driver location (cloud mode)
    // cloud realtime watch handles
    cw: null,              // customer watch { reqId, unsubs:[] }
    dw: null,              // driver open-requests watch
    driverOpen: [],        // open requests list (cloud, driver view)
    bidWatch: {},          // reqId -> unsub, to detect acceptance of my bids
    driverTrip: null,      // request id the driver is actively delivering
    geoWatchId: null       // navigator.geolocation.watchPosition id (driver)
  };

  var WATER_TYPES = [
    { key: 'Sweet', label: 'Sweet (Drinking)', rate: 1.2 },
    { key: 'Bore', label: 'Bore (General use)', rate: 0.8 },
    { key: 'RO', label: 'RO (Filtered)', rate: 1.5 }
  ];

  var QTY_PRESETS = [1000, 2000, 3600, 4500, 9000];

  // ---------- tiny helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { return 'Rs ' + Math.round(n).toLocaleString('en-PK'); }
  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }
  function clock(ts) {
    var d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  function stars(rating) {
    var full = Math.round(rating);
    var out = '';
    for (var i = 1; i <= 5; i++) out += '<span class="star ' + (i <= full ? 'on' : '') + '">★</span>';
    return '<span class="stars">' + out + '</span>';
  }
  function suggestedPrice(liters, typeKey) {
    var t = WATER_TYPES.filter(function (x) { return x.key === typeKey; })[0] || WATER_TYPES[0];
    var base = liters * t.rate;
    return Math.round((base + 150) / 50) * 50; // +service, round to 50
  }

  // ===================================================================
  // RENDER
  // ===================================================================
  function render() {
    stopTracking(); // any live-tracking animation is restarted by the en-route screen
    if (state.booting) { renderSplash(); return; }
    var user = Store.getUser();
    if (!user) { renderOnboarding(); return; }

    el('topbar').classList.remove('hidden');
    el('bottomnav').classList.remove('hidden');
    el('role-pill').textContent = user.role === 'driver' ? 'Driver mode' : 'Customer';
    el('role-pill').className = 'role-pill ' + user.role;

    // driver actively delivering a trip (cloud mode) overrides everything
    if (state.tab === 'home' && user.role === 'driver' && state.driverTrip) {
      var trip = Store.getRequest(state.driverTrip);
      if (trip && trip.status === 'accepted') { renderDriverTrip(trip); syncNav(); return; }
      stopDriverTrip();
    }

    // active tracked request overrides the home tab for customers
    if (state.tab === 'home' && user.role === 'customer' && state.activeRequestId) {
      var req = Store.getRequest(state.activeRequestId);
      if (req && (req.status === 'searching' || req.status === 'accepted')) {
        renderTracking(req);
        syncNav();
        return;
      }
      state.activeRequestId = null;
    }

    if (state.tab === 'home') {
      user.role === 'driver' ? renderDriverHome() : renderCustomerHome();
    } else if (state.tab === 'activity') {
      renderActivity();
    } else if (state.tab === 'profile') {
      renderProfile();
    }
    syncNav();
  }

  function syncNav() {
    var btns = document.querySelectorAll('#bottomnav .nav-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.tab === state.tab);
    }
  }

  function setView(html) { el('view').innerHTML = html; }

  // ---------------- SPLASH ----------------
  function renderSplash() {
    el('topbar').classList.add('hidden');
    el('bottomnav').classList.add('hidden');
    setView(
      '<div class="onboard splash">' +
        '<div class="brand-big"><span class="logo-drop">💧</span><h1>AquaDrive</h1>' +
          '<p class="tag">Connecting…</p><div class="radar" style="margin-top:24px"></div></div>' +
      '</div>'
    );
  }

  // ---------------- ONBOARDING ----------------
  function renderOnboarding() {
    // Show the account screen optimistically as soon as we know a Firebase
    // project is configured — don't wait for the connection to finish.
    var cloudy = (typeof AquaCloud !== 'undefined' && AquaCloud.enabled() && !state.cloudFailed);
    if (cloudy) { renderAuthScreen(); return; }
    renderLocalOnboarding();
  }

  // Local mode (no Firebase reachable): lightweight name/phone/role, no accounts.
  function renderLocalOnboarding() {
    el('topbar').classList.add('hidden');
    el('bottomnav').classList.add('hidden');
    setView(
      '<div class="onboard">' +
        '<div class="brand-big"><span class="logo-drop">💧</span><h1>AquaDrive</h1>' +
          '<p class="tag">Name your price for water delivery</p></div>' +
        '<div class="card">' +
          roleGridHtml('customer') +
          '<label>Your name</label>' +
          '<input id="ob-name" type="text" placeholder="e.g. Umair Ahmed" autocomplete="name" />' +
          '<label>Phone number</label>' +
          '<input id="ob-phone" type="tel" placeholder="e.g. +92 300 1234567" autocomplete="tel" />' +
          '<div id="lo-driver" style="display:none">' + driverFieldsHtml() + '</div>' +
          '<button id="ob-go" class="btn-primary block">Get started</button>' +
          '<p class="fineprint">Cash on delivery only · Offline mode (this device)</p>' +
        '</div>' +
      '</div>'
    );
    var role = wireRoleGrid(function (r) {
      var d = el('lo-driver'); if (d) d.style.display = (r === 'driver') ? '' : 'none';
    });
    el('ob-go').addEventListener('click', function () {
      var name = el('ob-name').value.trim();
      var phone = el('ob-phone').value.trim();
      if (!name) { toast('Please enter your name'); return; }
      if (!phone) { toast('Please enter your phone number'); return; }
      var user = { id: Store.uid('usr'), name: name, phone: phone, role: role(), createdAt: Date.now() };
      addDriverFieldsTo(user);
      Store.saveUser(user);
      if (user.role === 'driver') ensureSelfDriver(user);
      state.tab = 'home';
      render();
    });
  }

  // Cloud mode: real email + password accounts, separate per role.
  function renderAuthScreen() {
    el('topbar').classList.add('hidden');
    el('bottomnav').classList.add('hidden');
    var mode = 'register'; // register | login
    setView(
      '<div class="onboard">' +
        '<div class="brand-big"><span class="logo-drop">💧</span><h1>AquaDrive</h1>' +
          '<p class="tag">Name your price for water delivery</p></div>' +
        '<div class="card">' +
          '<div class="switch-roles auth-tabs">' +
            '<button class="seg on" data-mode="register">Create account</button>' +
            '<button class="seg" data-mode="login">Sign in</button>' +
          '</div>' +
          '<div id="auth-role">' + roleGridHtml('customer') + '</div>' +
          '<div id="auth-fields"></div>' +
          '<label class="remember"><input type="checkbox" id="au-remember" checked /> <span>Remember me on this device</span></label>' +
          '<button id="auth-go" class="btn-primary block">Create account</button>' +
          '<p class="fineprint"><a href="#" id="forgot-link">Forgot password?</a></p>' +
          '<p id="auth-note" class="fineprint">Cash on delivery only · Synced across devices</p>' +
        '</div>' +
      '</div>'
    );

    var getRole = wireRoleGrid(function () { renderAuthFields(); });

    document.querySelectorAll('.auth-tabs .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.auth-tabs .seg').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        mode = b.dataset.mode;
        el('auth-role').style.display = (mode === 'login') ? 'none' : '';
        el('forgot-link').parentNode.style.display = (mode === 'login') ? '' : 'none';
        el('auth-go').textContent = mode === 'register' ? 'Create account' : 'Sign in';
        renderAuthFields();
      });
    });

    function renderAuthFields() {
      var role = getRole();
      var html = '';
      if (mode === 'register') {
        html += '<label>Your name</label><input id="au-name" type="text" placeholder="e.g. Umair Ahmed" autocomplete="name" />' +
                '<label>Phone number</label><input id="au-phone" type="tel" placeholder="e.g. +92 300 1234567" autocomplete="tel" />';
        if (role === 'driver') html += driverFieldsHtml();
      }
      html += '<label>Email</label><input id="au-email" type="email" placeholder="you@example.com" autocomplete="email" />' +
              '<label>Password</label><input id="au-pass" type="password" placeholder="' +
              (mode === 'register' ? '8+ letters and numbers' : 'Your password') + '" autocomplete="' +
              (mode === 'register' ? 'new-password' : 'current-password') + '" />';
      if (mode === 'register') html += '<p class="pw-hint">Use at least 8 characters with both letters and numbers.</p>';
      el('auth-fields').innerHTML = html;
    }
    renderAuthFields();
    el('forgot-link').parentNode.style.display = 'none';

    el('forgot-link').addEventListener('click', function (e) { e.preventDefault(); doForgotPassword(); });

    el('auth-go').addEventListener('click', function () {
      if (!state.cloudReady) { toast('Connecting to server… try again in a moment'); return; }
      var role = getRole();
      var btn = el('auth-go');
      var remember = el('au-remember').checked;

      function fail(msg) { btn.disabled = false; toast(msg); }

      if (mode === 'login') {
        var email = (el('au-email').value || '').trim();
        var pass = el('au-pass').value || '';
        if (!email || !pass) return fail('Enter email and password');
        btn.disabled = true;
        DB.login(email, pass, remember, function (err, uid) {
          if (err) return fail(authErr(err));
          DB.loadProfile(uid, function (p) {
            if (!p) return fail('No profile found — try Create account');
            Store.saveUser(p); state.tab = 'home'; render();
          });
        });
        return;
      }

      // register
      var name = (el('au-name').value || '').trim();
      var phone = (el('au-phone').value || '').trim();
      var em = (el('au-email').value || '').trim();
      var pw = el('au-pass').value || '';
      if (!name) return fail('Please enter your name');
      if (!phone) return fail('Please enter your phone number');
      if (!/^\S+@\S+\.\S+$/.test(em)) return fail('Enter a valid email');
      if (!passwordValid(pw)) return fail('Password needs 8+ characters with letters and numbers');

      var extra = { name: name, phone: phone, account: true, email: em };
      if (role === 'driver') {
        extra.vehicle = (el('au-vehicle') && el('au-vehicle').value.trim()) || 'My tanker';
        extra.capacityL = parseInt(el('au-capacity') && el('au-capacity').value, 10) || 9000;
        extra.kyc = 'unsubmitted';
      }

      // Verify the email with a 6-digit code before creating the account.
      if (AquaOTP.enabled()) {
        btn.disabled = true; btn.textContent = 'Sending code…';
        AquaOTP.request(em, { user_name: name }, function (err) {
          btn.disabled = false; btn.textContent = 'Create account';
          if (err) { toast('Could not send the code — check the email and try again'); return; }
          renderOtpVerify(em, function () {
            createAccount(em, pw, remember, role, extra);
          });
        });
      } else {
        createAccount(em, pw, remember, role, extra);
      }
    });
  }

  function passwordValid(pw) {
    return typeof pw === 'string' && pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
  }

  function createAccount(email, pass, remember, role, extra) {
    DB.register(email, pass, remember, function (err, uid) {
      if (err) { toast(authErr(err)); renderAuthScreen(); return; }
      var user = Object.assign({ id: uid, role: role, createdAt: Date.now() }, extra);
      DB.saveProfile(uid, user);
      Store.saveUser(user);
      if (user.role === 'driver') ensureSelfDriver(user);
      state.tab = 'home';
      render(); // drivers land on the home screen with the "verify CNIC" banner
      toast(role === 'driver' ? 'Account created — verify your CNIC to accept jobs' : 'Welcome to AquaDrive!');
    });
  }

  // 6-digit email verification screen
  function renderOtpVerify(email, onVerified) {
    setView(
      '<div class="onboard">' +
        '<div class="brand-big"><span class="logo-drop">✉️</span><h1>Verify email</h1>' +
          '<p class="tag">We sent a 6-digit code to<br>' + esc(email) + '</p></div>' +
        '<div class="card">' +
          '<label>Enter code</label>' +
          '<input id="otp-input" type="text" inputmode="numeric" maxlength="6" placeholder="______" class="otp-box" />' +
          '<button id="otp-verify" class="btn-primary block">Verify & continue</button>' +
          '<p class="fineprint"><a href="#" id="otp-resend">Resend code</a> · <a href="#" id="otp-back">Back</a></p>' +
        '</div>' +
      '</div>'
    );
    el('otp-input').focus();
    el('otp-verify').addEventListener('click', function () {
      var code = (el('otp-input').value || '').trim();
      if (AquaOTP.verify(email, code)) { onVerified(); }
      else { toast('Incorrect or expired code'); }
    });
    el('otp-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') el('otp-verify').click(); });
    el('otp-resend').addEventListener('click', function (e) {
      e.preventDefault();
      AquaOTP.request(email, {}, function (err) { toast(err ? 'Could not resend' : 'New code sent'); });
    });
    el('otp-back').addEventListener('click', function (e) { e.preventDefault(); AquaOTP.clear(); renderAuthScreen(); });
  }

  // Forgot password → verify email by code, then Firebase's secure reset link.
  function doForgotPassword() {
    var email = (el('au-email') && el('au-email').value || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Type your email above first, then tap Forgot password'); return; }
    if (!AquaOTP.enabled()) { sendReset(email); return; }
    toast('Sending code…');
    AquaOTP.request(email, {}, function (err) {
      if (err) { toast('Could not send code'); return; }
      renderOtpVerify(email, function () { sendReset(email); });
    });
    function sendReset(em) {
      DB.sendReset(em, function (e2) {
        if (e2) { toast(authErr(e2)); renderAuthScreen(); return; }
        renderAuthScreen();
        toast('Verified! Check your email for a link to set a new password.');
      });
    }
  }

  function authErr(e) {
    var c = (e && e.code) || '';
    if (c === 'auth/operation-not-allowed') return 'Email sign-in is not enabled in Firebase yet';
    if (c === 'auth/email-already-in-use') return 'That email already has an account — use Sign in';
    if (c === 'auth/invalid-email') return 'That email looks invalid';
    if (c === 'auth/weak-password') return 'Password must be at least 6 characters';
    if (c === 'auth/wrong-password' || c === 'auth/invalid-credential') return 'Wrong email or password';
    if (c === 'auth/user-not-found') return 'No account with that email';
    if (c === 'auth/network-request-failed') return 'Network error — check your connection';
    return (e && e.message) || 'Something went wrong';
  }

  // shared role selector + driver fields
  function roleGridHtml(sel) {
    return '<label>I want to use AquaDrive as</label>' +
      '<div class="role-grid">' +
        '<button type="button" class="role-card' + (sel === 'customer' ? ' selected' : '') + '" data-role="customer">' +
          '<span class="role-ico">🏠</span><b>Customer</b><small>I need water delivered</small></button>' +
        '<button type="button" class="role-card' + (sel === 'driver' ? ' selected' : '') + '" data-role="driver">' +
          '<span class="role-ico">🚛</span><b>Tanker Driver</b><small>I deliver water</small></button>' +
      '</div>';
  }
  function wireRoleGrid(onChange) {
    var role = 'customer';
    document.querySelectorAll('.role-card').forEach(function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('.role-card').forEach(function (x) { x.classList.remove('selected'); });
        c.classList.add('selected');
        role = c.dataset.role;
        onChange && onChange(role);
      });
    });
    return function () { return role; };
  }
  function driverFieldsHtml() {
    return '<div class="driver-fields">' +
      '<label>Tanker / vehicle</label><input id="au-vehicle" type="text" placeholder="e.g. Hino 3000 Gal Tanker" />' +
      '<label>Capacity (litres)</label><input id="au-capacity" type="number" min="500" step="100" value="9000" />' +
      '</div>';
  }
  function addDriverFieldsTo(user) {
    if (user.role !== 'driver') return;
    var v = el('au-vehicle');
    var cap = el('au-capacity');
    user.vehicle = (v && v.value.trim()) || 'My tanker';
    user.capacityL = parseInt(cap && cap.value, 10) || 9000;
  }

  // ---------------- DRIVER KYC (CNIC) ----------------
  function cnicDigits(s) { return String(s || '').replace(/\D/g, ''); }
  function cnicValid(s) { return cnicDigits(s).length === 13; }
  function formatCnic(s) {
    var d = cnicDigits(s).slice(0, 13);
    if (d.length > 12) return d.slice(0, 5) + '-' + d.slice(5, 12) + '-' + d.slice(12);
    if (d.length > 5) return d.slice(0, 5) + '-' + d.slice(5);
    return d;
  }

  // Resize + compress an image File to a small JPEG data-URL (keeps the
  // Realtime DB light; no paid Storage needed). cb(dataUrl).
  function compressImage(file, maxDim, quality, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var scale = Math.min(1, maxDim / Math.max(w, h));
        var cw = Math.round(w * scale), ch = Math.round(h * scale);
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        cb(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  // Best-effort OCR (Tesseract.js, loaded on demand). cb(textDigits).
  var tessLoaded = false;
  function ocrDigits(dataUrl, cb) {
    function run() {
      try {
        global.Tesseract.recognize(dataUrl, 'eng')
          .then(function (r) { cb(cnicDigits(r.data.text)); })
          .catch(function () { cb(null); });
      } catch (e) { cb(null); }
    }
    if (tessLoaded && global.Tesseract) { run(); return; }
    var to = setTimeout(function () { cb(null); }, 20000);
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.async = true;
    s.onload = function () { clearTimeout(to); tessLoaded = true; run(); };
    s.onerror = function () { clearTimeout(to); cb(null); };
    document.head.appendChild(s);
  }

  // Driver identity-verification screen (front + back CNIC photos).
  function startKyc(user) {
    el('topbar').classList.remove('hidden');
    el('bottomnav').classList.remove('hidden');
    setView(
      '<div class="screen list-screen">' +
        '<h2 class="screen-title">Driver verification</h2>' +
        '<div class="card">' +
          '<p class="muted small">To accept jobs you must verify your CNIC. Your photos are stored privately and reviewed by our team.</p>' +
          '<label>CNIC number</label>' +
          '<input id="kyc-cnic" type="text" inputmode="numeric" placeholder="xxxxx-xxxxxxx-x" maxlength="15" />' +
          '<label>CNIC front photo</label>' +
          '<input id="kyc-front" type="file" accept="image/*" capture="environment" />' +
          '<label>CNIC back photo</label>' +
          '<input id="kyc-back" type="file" accept="image/*" capture="environment" />' +
          '<p id="kyc-status" class="pw-hint"></p>' +
          '<button id="kyc-submit" class="btn-primary block">Submit for verification</button>' +
          '<button id="kyc-later" class="link-btn block">Skip for now</button>' +
        '</div>' +
      '</div>'
    );
    el('kyc-cnic').addEventListener('input', function () { el('kyc-cnic').value = formatCnic(el('kyc-cnic').value); });
    el('kyc-later').addEventListener('click', function () { render(); });
    el('kyc-submit').addEventListener('click', function () { submitKyc(user); });
  }

  function submitKyc(user) {
    var cnic = el('kyc-cnic').value;
    var front = el('kyc-front').files[0];
    var back = el('kyc-back').files[0];
    if (!cnicValid(cnic)) { toast('Enter a valid 13-digit CNIC number'); return; }
    if (!front || !back) { toast('Upload both front and back photos'); return; }
    var statusEl = el('kyc-status');
    var btn = el('kyc-submit'); btn.disabled = true;
    statusEl.textContent = 'Processing images…';

    compressImage(front, 1000, 0.55, function (frontData) {
      compressImage(back, 1000, 0.55, function (backData) {
        if (!frontData || !backData) { btn.disabled = false; toast('Could not read the images'); return; }
        statusEl.textContent = 'Reading CNIC (best effort)…';
        // Best-effort OCR check that the typed number appears on the front image.
        ocrDigits(frontData, function (digits) {
          var typed = cnicDigits(cnic);
          var ocrMatched = !!(digits && digits.indexOf(typed) !== -1);
          var kyc = {
            uid: user.id, name: user.name, phone: user.phone,
            cnic: cnic, front: frontData, back: backData,
            ocrMatched: ocrMatched, status: 'pending', ts: Date.now()
          };
          DB.saveKyc(user.id, kyc, function (err) {
            btn.disabled = false;
            if (err) { toast('Could not save — check your rules are published'); return; }
            user.kyc = 'pending'; Store.saveUser(user); DB.saveProfile(user.id, user);
            state.tab = 'home'; render();
            toast(ocrMatched ? 'Submitted — CNIC number matched ✓ (pending admin approval)'
                             : 'Submitted for manual review (photo unclear for auto-check)');
          });
        });
      });
    });
  }

  // A driver reads their own /kyc status (the admin can't write their profile).
  function refreshDriverKyc(cb) {
    var u = Store.getUser();
    if (!DB.isCloud() || !u || u.role !== 'driver') { cb && cb(); return; }
    DB.loadKyc(u.id, function (k) {
      if (k && k.status && k.status !== u.kyc) {
        u.kyc = k.status; Store.saveUser(u); DB.saveProfile(u.id, u);
      }
      cb && cb();
    });
  }

  // ---------------- ADMIN: review driver CNICs ----------------
  function renderAdmin() {
    setView('<div class="screen list-screen"><h2 class="screen-title">Driver verification — admin</h2>' +
      '<div id="admin-list"><p class="muted">Loading…</p></div></div>');
    DB.listKyc(function (list) {
      var box = el('admin-list');
      if (!box) return;
      if (!list) { box.innerHTML = '<p class="muted">You are not an admin, or rules are not published.</p>'; return; }
      if (!list.length) { box.innerHTML = '<div class="empty"><span class="empty-ico">📋</span><p>No submissions yet.</p></div>'; return; }
      list.sort(function (a, b) { return (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1); });
      box.innerHTML = list.map(function (k) {
        var badge = { pending: 'st searching', verified: 'st done', rejected: 'st cancelled' }[k.status] || 'st';
        return '<div class="kyc-card">' +
          '<div class="hist-top"><b>' + esc(k.name || '(driver)') + '</b><span class="' + badge + '">' + esc(k.status) + '</span></div>' +
          '<div class="muted small">CNIC ' + esc(k.cnic || '—') + ' · ' + (k.ocrMatched ? 'auto-match ✓' : 'auto-match ✗') + ' · ' + esc(k.phone || '') + '</div>' +
          '<div class="kyc-imgs">' +
            (k.front ? '<img src="' + k.front + '" alt="front" />' : '') +
            (k.back ? '<img src="' + k.back + '" alt="back" />' : '') +
          '</div>' +
          (k.status === 'pending' ?
            '<div class="pb-actions"><button class="pill-btn call" data-approve="' + k.uid + '">✓ Approve</button>' +
            '<button class="pill-btn" data-reject="' + k.uid + '">✕ Reject</button></div>' : '') +
        '</div>';
      }).join('');
      box.querySelectorAll('[data-approve]').forEach(function (b) {
        b.addEventListener('click', function () { DB.setKycStatus(b.dataset.approve, 'verified', function () { toast('Approved'); renderAdmin(); }); });
      });
      box.querySelectorAll('[data-reject]').forEach(function (b) {
        b.addEventListener('click', function () { DB.setKycStatus(b.dataset.reject, 'rejected', function () { toast('Rejected'); renderAdmin(); }); });
      });
    });
  }

  // ---------------- CUSTOMER: NEW REQUEST ----------------
  function renderCustomerHome() {
    var typeOptions = WATER_TYPES.map(function (t) {
      return '<option value="' + t.key + '">' + esc(t.label) + '</option>';
    }).join('');

    var qtyChips = QTY_PRESETS.map(function (q) {
      return '<button class="chip qty-chip" data-qty="' + q + '">' + q.toLocaleString() + ' L</button>';
    }).join('');

    setView(
      '<div class="screen">' +
        '<div id="map" class="map"></div>' +
        '<div class="sheet">' +
          '<h2 class="sheet-title">Request a water tanker</h2>' +

          '<label class="fld">Delivery location</label>' +
          '<div class="loc-wrap">' +
            '<div class="loc-row">' +
              '<input id="rq-address" type="text" autocomplete="off" placeholder="Start typing your address…" />' +
              '<button id="rq-gps" class="icon-btn" title="Use my current location">📍</button>' +
            '</div>' +
            '<div id="addr-suggest" class="suggest-list hidden"></div>' +
          '</div>' +

          '<label class="fld">Water type</label>' +
          '<select id="rq-type">' + typeOptions + '</select>' +

          '<label class="fld">Quantity</label>' +
          '<div class="chips">' + qtyChips + '</div>' +
          '<input id="rq-liters" type="number" min="200" step="100" placeholder="Litres" value="2000" />' +

          '<label class="fld">Your offer price <small id="rq-suggest" class="suggest"></small></label>' +
          '<div class="price-row">' +
            '<span class="rs">Rs</span>' +
            '<input id="rq-price" type="number" min="50" step="10" placeholder="Your price" />' +
            '<span class="cod-badge">COD</span>' +
          '</div>' +
          '<p class="hint">💡 Set your own fare. Nearby drivers send offers and you pick the one you like.</p>' +

          '<button id="rq-submit" class="btn-primary block">Find tankers</button>' +
        '</div>' +
      '</div>'
    );

    // wire quantity chips
    document.querySelectorAll('.qty-chip').forEach(function (c) {
      c.addEventListener('click', function () {
        el('rq-liters').value = c.dataset.qty;
        refreshSuggest();
      });
    });
    el('rq-liters').addEventListener('input', refreshSuggest);
    el('rq-type').addEventListener('change', refreshSuggest);
    el('rq-gps').addEventListener('click', function () { useMyLocation(true); });
    el('rq-submit').addEventListener('click', submitRequest);

    refreshSuggest();
    initAutocomplete();
    initMap();

    // On first open, proactively ask for the user's current location
    // (works on both desktop and mobile browsers over HTTPS / localhost).
    if (!state.askedLocation) {
      state.askedLocation = true;
      useMyLocation(false);
    }
  }

  // ---------- address autocomplete (free, OSM-based) ----------
  var acAbort = null, acTimer = null;
  function initAutocomplete() {
    var input = el('rq-address');
    var box = el('addr-suggest');
    if (!input || !box) return;

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (state.pickedLocation) state.pickedLocation.address = input.value;
      clearTimeout(acTimer);
      if (q.length < 3) { hideSuggest(); return; }
      acTimer = setTimeout(function () { runSuggest(q); }, 350); // debounce
    });
    input.addEventListener('blur', function () { setTimeout(hideSuggest, 180); });
    input.addEventListener('focus', function () {
      if (box.children.length) box.classList.remove('hidden');
    });
  }

  function runSuggest(q) {
    var box = el('addr-suggest');
    if (!box) return;
    if (acAbort) { try { acAbort.abort(); } catch (e) {} }
    acAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    Geo.suggest(q, function (list) {
      var liveBox = el('addr-suggest');
      if (!liveBox) return;
      if (!list.length) { hideSuggest(); return; }
      liveBox.innerHTML = list.map(function (s, i) {
        return '<button class="suggest-item" data-i="' + i + '">' +
          '<span class="si-pin">📍</span><span class="si-text">' + esc(s.label) + '</span></button>';
      }).join('');
      liveBox.classList.remove('hidden');
      var btns = liveBox.querySelectorAll('.suggest-item');
      btns.forEach(function (b) {
        b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus before blur
        b.addEventListener('click', function () {
          var s = list[parseInt(b.dataset.i, 10)];
          el('rq-address').value = s.label;
          setPin(s.lat, s.lng);
          if (state.map) state.map.setView([s.lat, s.lng], 15);
          hideSuggest();
        });
      });
    }, acAbort ? acAbort.signal : undefined);
  }

  function hideSuggest() {
    var box = el('addr-suggest');
    if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
  }

  function refreshSuggest() {
    var liters = parseInt(el('rq-liters').value, 10) || 0;
    var type = el('rq-type').value;
    var s = suggestedPrice(liters, type);
    el('rq-suggest').textContent = 'Suggested: ' + money(s);
    var priceInput = el('rq-price');
    if (!priceInput.value || priceInput.dataset.auto === '1') {
      priceInput.value = s;
      priceInput.dataset.auto = '1';
    }
    priceInput.addEventListener('input', function () { priceInput.dataset.auto = '0'; }, { once: true });
  }

  var leafletState = 'none'; // none | loading | ready | failed

  // Load Leaflet from CDN lazily. If it's blocked/offline, time out and fall
  // back to a plain address input — the app never blocks on the network.
  function ensureLeaflet(cb) {
    if (typeof L !== 'undefined') { cb(true); return; }
    if (leafletState === 'failed') { cb(false); return; }

    if (!document.getElementById('leaflet-css')) {
      var link = document.createElement('link');
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    var done = false;
    var to = setTimeout(function () {
      if (done) return; done = true; leafletState = 'failed'; cb(false);
    }, 3500);
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = function () { if (done) return; done = true; clearTimeout(to); leafletState = 'ready'; cb(true); };
    s.onerror = function () { if (done) return; done = true; clearTimeout(to); leafletState = 'failed'; cb(false); };
    document.body.appendChild(s);
    leafletState = 'loading';
  }

  function showMapFallback(mapEl) {
    mapEl.classList.add('map-fallback');
    mapEl.innerHTML = '<div class="map-fallback-msg">🗺️ Map unavailable — just type your address above.</div>';
    if (!state.pickedLocation) {
      state.pickedLocation = { lat: SeedData.BASE.lat, lng: SeedData.BASE.lng, address: '' };
    }
  }

  function initMap() {
    var mapEl = el('map');
    if (!mapEl) return;
    // Show a usable fallback immediately, then upgrade to a real map if Leaflet loads.
    showMapFallback(mapEl);
    ensureLeaflet(function (ok) {
      if (!ok) return; // keep the fallback
      var live = el('map');
      if (!live || live.dataset.built === '1') return; // navigated away / already built
      live.classList.remove('map-fallback');
      live.innerHTML = '';
      buildLeafletMap(live);
    });
  }

  function buildLeafletMap(mapEl) {
    mapEl.dataset.built = '1';
    var center = state.pickedLocation || SeedData.BASE;
    var map = L.map('map', { zoomControl: false }).setView([center.lat, center.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap', maxZoom: 19
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    var marker = L.marker([center.lat, center.lng], { draggable: true }).addTo(map);
    state.map = map; state.mapMarker = marker;
    state.pickedLocation = { lat: center.lat, lng: center.lng, address: '' };

    map.on('click', function (e) { setPin(e.latlng.lat, e.latlng.lng); });
    marker.on('dragend', function () {
      var p = marker.getLatLng();
      setPin(p.lat, p.lng);
    });
    setTimeout(function () { map.invalidateSize(); }, 250);
  }

  function setPin(lat, lng) {
    state.pickedLocation = { lat: lat, lng: lng, address: (el('rq-address') || {}).value || '' };
    if (state.mapMarker) state.mapMarker.setLatLng([lat, lng]);
  }

  // interactive = true when the user tapped the 📍 button (show error toasts);
  // false when auto-requested on open (stay quiet if denied).
  function useMyLocation(interactive) {
    if (!navigator.geolocation) { if (interactive) toast('Geolocation not supported'); return; }
    if (interactive) toast('Locating…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      setPin(lat, lng);
      if (state.map) state.map.setView([lat, lng], 16);
      // fill the address field from the coordinates (free reverse geocoding)
      Geo.reverse(lat, lng, function (addr) {
        var input = el('rq-address');
        if (addr && input && !input.value.trim()) {
          input.value = addr;
          if (state.pickedLocation) state.pickedLocation.address = addr;
        }
      });
    }, function (err) {
      if (interactive) {
        toast(err && err.code === 1 ? 'Location permission denied' : 'Could not get location');
      }
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  function submitRequest() {
    var user = Store.getUser();
    var liters = parseInt(el('rq-liters').value, 10) || 0;
    var price = parseInt(el('rq-price').value, 10) || 0;
    var type = el('rq-type').value;
    var address = el('rq-address').value.trim();
    var loc = state.pickedLocation || { lat: SeedData.BASE.lat, lng: SeedData.BASE.lng };
    loc.address = address;

    if (liters < 200) { toast('Enter a valid quantity (min 200 L)'); return; }
    if (price < 50) { toast('Enter a valid offer price'); return; }
    if (!address) { toast('Please add a delivery address'); return; }

    var req = {
      id: Store.uid('req'),
      customerId: user.id,
      customerName: user.name,
      customerPhone: user.phone,
      location: loc,
      liters: liters,
      waterType: type,
      offerPrice: price,
      status: 'searching',
      offers: [],
      driver: null,
      finalPrice: null,
      createdAt: Date.now()
    };
    DB.createRequest(req);
    state.activeRequestId = req.id;

    if (DB.isCloud()) {
      // real drivers (other devices) will send offers; watch for them
      startCustomerWatch(req.id);
    } else {
      // local mode: simulate nearby drivers responding with offers
      if (state.cancelOffers) state.cancelOffers();
      state.cancelOffers = Sim.runOffers(req, function (offer) {
        DB.addOffer(req.id, offer);
        if (state.activeRequestId === req.id && state.tab === 'home') render();
      });
    }

    render();
  }

  // ---------- cloud realtime watchers (customer) ----------
  function startCustomerWatch(reqId) {
    if (!DB.isCloud()) return;
    if (state.cw && state.cw.reqId === reqId) return;
    stopCustomerWatch();
    state.cw = { reqId: reqId, unsubs: [] };
    state.cw.unsubs.push(DB.watchRequest(reqId, function (r) {
      if (!r) return;
      if (state.activeRequestId === reqId && state.tab === 'home') render();
    }));
    state.cw.unsubs.push(DB.watchChat(reqId, function () {
      if (state.activeRequestId === reqId) renderChatLog(reqId);
    }));
    state.cw.unsubs.push(DB.watchLocation(reqId, function (loc) {
      if (loc) { state.lastDriverLoc = loc; updateDriverMarker(loc); }
    }));
  }
  function stopCustomerWatch() {
    if (state.cw) {
      state.cw.unsubs.forEach(function (u) { try { u(); } catch (e) {} });
      state.cw = null;
    }
  }

  // ---------------- CUSTOMER: TRACKING / OFFERS ----------------
  function renderTracking(req) {
    startCustomerWatch(req.id); // no-op in local mode / if already watching
    if (req.status === 'searching') {
      renderSearching(req);
    } else if (req.status === 'accepted') {
      renderEnRoute(req);
    }
  }

  function renderSearching(req) {
    var offers = (req.offers || []).slice().sort(function (a, b) { return a.price - b.price; });
    var offersHtml;
    if (offers.length === 0) {
      offersHtml = '<div class="searching-box"><div class="radar"></div>' +
        '<p>Looking for tankers near you…</p><small>Your offer: ' + money(req.offerPrice) + ' · ' +
        req.liters.toLocaleString() + ' L ' + esc(req.waterType) + '</small></div>';
    } else {
      offersHtml = '<div class="offers-head"><b>' + offers.length + ' offer' + (offers.length > 1 ? 's' : '') +
        '</b><span class="muted">Your price: ' + money(req.offerPrice) + '</span></div>' +
        offers.map(offerCard).join('');
    }

    setView(
      '<div class="screen track">' +
        '<div class="track-top">' +
          '<button class="link-btn" id="cancel-req">✕ Cancel request</button>' +
          '<span class="pill-cod">Cash on delivery</span>' +
        '</div>' +
        '<div class="track-body">' + offersHtml + '</div>' +
      '</div>'
    );

    el('cancel-req').addEventListener('click', function () {
      if (state.cancelOffers) { state.cancelOffers(); state.cancelOffers = null; }
      DB.updateRequest(req.id, { status: 'cancelled' });
      stopCustomerWatch();
      state.activeRequestId = null;
      toast('Request cancelled');
      render();
    });
    document.querySelectorAll('[data-accept]').forEach(function (b) {
      b.addEventListener('click', function () { acceptOffer(req.id, b.dataset.accept); });
    });
    document.querySelectorAll('[data-profile]').forEach(function (b) {
      b.addEventListener('click', function () { showDriverProfile(b.dataset.profile); });
    });
  }

  function offerCard(o) {
    return '<div class="offer-card">' +
      '<div class="offer-main">' +
        '<div class="avatar">' + esc(o.driverName.charAt(0)) + '</div>' +
        '<div class="offer-info">' +
          '<div class="offer-name">' + esc(o.driverName) +
            ' <button class="mini-link" data-profile="' + o.driverId + '">view</button></div>' +
          '<div class="offer-sub">' + stars(o.rating) + ' <span class="muted">' + o.rating.toFixed(1) +
            ' · ' + o.completed + ' trips</span></div>' +
          '<div class="offer-sub muted">🚛 ' + esc(o.vehicle) + '</div>' +
          '<div class="offer-sub muted">~' + o.etaMin + ' min · ' + o.distanceKm + ' km away</div>' +
        '</div>' +
        '<div class="offer-price"><b>' + money(o.price) + '</b><small>COD</small></div>' +
      '</div>' +
      '<button class="btn-primary block" data-accept="' + o.id + '">Accept ' + money(o.price) + '</button>' +
    '</div>';
  }

  function acceptOffer(reqId, offerId) {
    var req = Store.getRequest(reqId);
    if (!req) return;
    var offer = (req.offers || []).filter(function (o) { return o.id === offerId; })[0];
    if (!offer) return;
    if (state.cancelOffers) { state.cancelOffers(); state.cancelOffers = null; }

    DB.acceptOffer(reqId, offer);

    if (DB.isCloud()) {
      // real driver greeting/chat arrives over the wire; just ensure watchers
      startCustomerWatch(reqId);
    } else {
      // local mode: simulate a driver greeting for a two-sided feel
      Store.addChatMessage(reqId, {
        from: 'driver', by: 'driver-sim', name: offer.driverName,
        text: Sim.driverGreeting(offer), ts: Date.now()
      });
    }

    toast('Offer accepted! Driver on the way.');
    render();
  }

  function renderEnRoute(req) {
    var d = req.driver;
    var chat = Store.getChat(req.id);
    setView(
      '<div class="screen enroute">' +
        '<div class="enroute-banner">' +
          '<div class="pulse-dot"></div>' +
          '<div><b>Driver on the way</b><small id="eta-line">Arriving in ~' + d.etaMin + ' min · ' + d.distanceKm + ' km</small></div>' +
        '</div>' +

        '<div id="track-map" class="track-map"></div>' +

        '<div class="driver-bar">' +
          '<div class="avatar lg">' + esc(d.driverName.charAt(0)) + '</div>' +
          '<div class="db-info">' +
            '<div class="offer-name">' + esc(d.driverName) + '</div>' +
            '<div class="offer-sub">' + stars(d.rating) + ' <span class="muted">' + d.rating.toFixed(1) + '</span></div>' +
            '<div class="offer-sub muted">🚛 ' + esc(d.vehicle) + '</div>' +
          '</div>' +
          '<div class="db-actions">' +
            '<a class="round-btn call" href="tel:' + esc(d.phone) + '" title="Call">📞</a>' +
          '</div>' +
        '</div>' +

        phoneBlockHtml(d.phone, 'Driver phone') +

        '<div class="trip-summary">' +
          '<div><span class="muted">Quantity</span><b>' + req.liters.toLocaleString() + ' L ' + esc(req.waterType) + '</b></div>' +
          '<div><span class="muted">Agreed price</span><b>' + money(req.finalPrice) + ' <span class="cod-badge">COD</span></b></div>' +
        '</div>' +

        '<div class="chat" id="chat">' +
          '<div class="chat-head">💬 Chat with ' + esc(d.driverName.split(' ')[0]) + '</div>' +
          '<div class="chat-log" id="chat-log">' + chat.map(chatBubble).join('') + '</div>' +
          '<div class="chat-input">' +
            '<input id="chat-text" type="text" placeholder="Type a message…" />' +
            '<button id="chat-send" class="btn-send">Send</button>' +
          '</div>' +
        '</div>' +

        '<div class="enroute-actions">' +
          '<button id="mark-delivered" class="btn-primary block">✓ Water delivered — pay cash</button>' +
          '<button id="cancel-enroute" class="link-btn danger">Cancel</button>' +
        '</div>' +
      '</div>'
    );

    var log = el('chat-log');
    if (log) log.scrollTop = log.scrollHeight;

    el('chat-send').addEventListener('click', function () { sendChat(req.id, 'customer'); });
    el('chat-text').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(req.id, 'customer'); });
    wirePhoneBlock();

    el('mark-delivered').addEventListener('click', function () { stopTracking(); openReview(req.id); });
    el('cancel-enroute').addEventListener('click', function () {
      stopTracking();
      DB.updateRequest(req.id, { status: 'cancelled' });
      stopCustomerWatch();
      state.activeRequestId = null;
      toast('Trip cancelled');
      render();
    });

    initTrackMap(req);
  }

  // Reusable phone widget (masked number + Call / Show / Copy).
  function phoneBlockHtml(phone, label) {
    return '<div class="phone-block">' +
      '<div class="pb-row"><span class="muted">' + esc(label) + '</span>' +
        '<span class="pb-num" id="pb-num" data-full="' + esc(phone) + '">' + esc(maskPhone(phone)) + '</span></div>' +
      '<div class="pb-actions">' +
        '<a class="pill-btn call" href="tel:' + esc(phone) + '">📞 Call</a>' +
        '<button class="pill-btn" id="pb-show">👁️ Show number</button>' +
        '<button class="pill-btn" id="pb-copy">📋 Copy</button>' +
      '</div></div>';
  }
  function wirePhoneBlock() {
    var show = el('pb-show');
    if (!show) return;
    show.addEventListener('click', function () {
      var span = el('pb-num');
      var showing = span.dataset.showing === '1';
      span.textContent = showing ? maskPhone(span.dataset.full) : span.dataset.full;
      span.dataset.showing = showing ? '0' : '1';
      show.textContent = showing ? '👁️ Show number' : '🙈 Hide number';
    });
    el('pb-copy').addEventListener('click', function () {
      copyToClipboard(el('pb-num').dataset.full, 'Number copied to clipboard');
    });
  }

  function maskPhone(p) {
    // keep only the last 3 digits visible, mask all other digits
    p = String(p || '');
    var total = (p.match(/\d/g) || []).length;
    var seen = 0;
    return p.replace(/\d/g, function (d) {
      seen++;
      return (total - seen) >= 3 ? '•' : d;
    });
  }

  function copyToClipboard(text, okMsg) {
    function ok() { toast(okMsg || 'Copied'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else { fallback(); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); ok();
      } catch (e) { toast('Copy failed — number is ' + text); }
    }
  }

  // ---------- simulated live tracking on a small map ----------
  function stopTracking() {
    if (state.trackTimer) { clearInterval(state.trackTimer); state.trackTimer = null; }
  }

  function initTrackMap(req) {
    stopTracking();
    ensureLeaflet(function (ok) {
      var mapEl = el('track-map');
      if (!mapEl) return;
      if (!ok) {
        mapEl.classList.add('map-fallback');
        mapEl.innerHTML = '<div class="map-fallback-msg">🚛 Live map unavailable offline.</div>';
        return;
      }
      if (mapEl.dataset.built === '1') return;
      mapEl.dataset.built = '1';

      var dest = req.location || SeedData.BASE;
      var map = L.map('track-map', { zoomControl: false, attributionControl: false }).setView([dest.lat, dest.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      var homeIcon = L.divIcon({ className: 'map-emoji', html: '🏠', iconSize: [30, 30], iconAnchor: [15, 15] });
      var truckIcon = L.divIcon({ className: 'map-emoji', html: '🚛', iconSize: [32, 32], iconAnchor: [16, 16] });
      L.marker([dest.lat, dest.lng], { icon: homeIcon }).addTo(map);

      // pick a start point ~distanceKm away in a random direction
      var bearing = Math.random() * Math.PI * 2;
      var km = Math.max(1.5, req.driver.distanceKm || 4);
      var cur = {
        lat: dest.lat + (km / 111) * Math.cos(bearing),
        lng: dest.lng + (km / (111 * Math.cos(dest.lat * Math.PI / 180))) * Math.sin(bearing)
      };
      // start the truck at the last known real location (cloud) or the random point
      if (state.lastDriverLoc) cur = { lat: state.lastDriverLoc.lat, lng: state.lastDriverLoc.lng };
      var truck = L.marker([cur.lat, cur.lng], { icon: truckIcon }).addTo(map);
      var line = L.polyline([[cur.lat, cur.lng], [dest.lat, dest.lng]],
        { color: '#131414', weight: 3, opacity: .5, dashArray: '6 8' }).addTo(map);
      map.fitBounds([[cur.lat, cur.lng], [dest.lat, dest.lng]], { padding: [36, 36] });
      setTimeout(function () { map.invalidateSize(); }, 250);

      // expose the truck so cloud location updates can move it
      state.trackTruck = truck;
      state.trackLine = line;
      state.trackDest = dest;
      state.trackMap = map;

      if (DB.isCloud()) {
        // REAL tracking: the driver's device streams its GPS; the watcher
        // (set up in startCustomerWatch) calls updateDriverMarker().
        var etaEl0 = el('eta-line');
        if (etaEl0) etaEl0.textContent = state.lastDriverLoc ? 'Live tracking · driver moving' : 'Waiting for driver location…';
        if (state.lastDriverLoc) updateDriverMarker(state.lastDriverLoc);
        return;
      }

      // LOCAL mode: animate the truck toward the customer (simulated tracking)
      var totalEta = req.driver.etaMin || 12;
      var steps = 32, i = 0;
      state.trackTimer = setInterval(function () {
        i++;
        cur = { lat: cur.lat + (dest.lat - cur.lat) * 0.13, lng: cur.lng + (dest.lng - cur.lng) * 0.13 };
        truck.setLatLng([cur.lat, cur.lng]);
        line.setLatLngs([[cur.lat, cur.lng], [dest.lat, dest.lng]]);
        var remain = Math.max(0, Math.round(totalEta * (1 - i / steps)));
        var etaEl = el('eta-line');
        if (i >= steps) {
          stopTracking();
          truck.setLatLng([dest.lat, dest.lng]);
          if (etaEl) etaEl.textContent = 'Driver has arrived 🎉';
        } else if (etaEl) {
          etaEl.textContent = 'Arriving in ~' + remain + ' min · live tracking';
        }
      }, 800);
    });
  }

  // Move the truck marker to a real driver location (cloud mode).
  function updateDriverMarker(loc) {
    if (!state.trackTruck || !loc) return;
    try {
      state.trackTruck.setLatLng([loc.lat, loc.lng]);
      if (state.trackLine && state.trackDest) {
        state.trackLine.setLatLngs([[loc.lat, loc.lng], [state.trackDest.lat, state.trackDest.lng]]);
      }
      var etaEl = el('eta-line');
      if (etaEl) etaEl.textContent = 'Live tracking · driver moving 🚛';
    } catch (e) { /* map may have been torn down */ }
  }

  function chatBubble(m) {
    var me = Store.getUser();
    // "mine" = sent by this user (works on both customer and driver screens)
    var mine = m.by ? (me && m.by === me.id) : (m.from === 'customer');
    return '<div class="bubble-row ' + (mine ? 'mine' : 'theirs') + '">' +
      '<div class="bubble">' + esc(m.text) + '<span class="b-time">' + clock(m.ts) + '</span></div></div>';
  }

  // role = 'customer' | 'driver' — who is sending from this screen
  function sendChat(reqId, role) {
    role = role || 'customer';
    var input = el('chat-text');
    var text = input.value.trim();
    if (!text) return;
    var me = Store.getUser();
    DB.sendChat(reqId, { from: role, by: me.id, name: me.name, text: text, ts: Date.now() });
    input.value = '';

    if (DB.isCloud()) {
      renderChatLog(reqId); // optimistic; the watcher will reconcile
      return;
    }

    renderChatLog(reqId);
    // local mode only: simulate the other side replying shortly
    if (role === 'customer') {
      setTimeout(function () {
        var cur = Store.getRequest(reqId);
        if (!cur || cur.status !== 'accepted') return;
        Store.addChatMessage(reqId, {
          from: 'driver', by: 'driver-sim', name: cur.driver.driverName,
          text: Sim.autoReply(text), ts: Date.now()
        });
        if (state.activeRequestId === reqId) renderChatLog(reqId);
      }, 1200 + Math.random() * 1200);
    }
  }

  function renderChatLog(reqId) {
    var log = el('chat-log');
    if (!log) return;
    var chat = Store.getChat(reqId);
    log.innerHTML = chat.map(chatBubble).join('');
    log.scrollTop = log.scrollHeight;
  }

  // ---------------- REVIEW (two-way ratings) ----------------
  function openReview(reqId) {
    var req = Store.getRequest(reqId);
    if (!req || !req.driver) return;
    var d = req.driver;
    openModal(
      '<div class="review">' +
        '<div class="avatar xl">' + esc(d.driverName.charAt(0)) + '</div>' +
        '<h2>Rate your trip</h2>' +
        '<p class="muted">How was ' + esc(d.driverName) + '?</p>' +
        '<div class="rate-stars" id="rate-stars">' +
          [1,2,3,4,5].map(function (n) { return '<span class="rate-star" data-n="' + n + '">★</span>'; }).join('') +
        '</div>' +
        '<textarea id="rv-comment" placeholder="Add a comment (optional)"></textarea>' +
        '<div class="paid-row"><span>Amount paid (cash)</span><b>' + money(req.finalPrice) + '</b></div>' +
        '<button id="rv-submit" class="btn-primary block">Submit review</button>' +
        '<button id="rv-skip" class="link-btn">Skip</button>' +
      '</div>'
    );

    var chosen = 5;
    var starsEls = document.querySelectorAll('#rate-stars .rate-star');
    function paint(n) { starsEls.forEach(function (s) { s.classList.toggle('on', parseInt(s.dataset.n, 10) <= n); }); }
    paint(5);
    starsEls.forEach(function (s) {
      s.addEventListener('mouseenter', function () { paint(parseInt(s.dataset.n, 10)); });
      s.addEventListener('click', function () { chosen = parseInt(s.dataset.n, 10); paint(chosen); });
    });
    document.querySelector('#rate-stars').addEventListener('mouseleave', function () { paint(chosen); });

    el('rv-submit').addEventListener('click', function () {
      DB.addReview({
        id: Store.uid('rev'),
        driverId: d.driverId,
        requestId: reqId,
        byName: Store.getUser().name,
        stars: chosen,
        comment: el('rv-comment').value.trim(),
        ts: Date.now()
      });
      finishTrip(reqId, chosen);
    });
    el('rv-skip').addEventListener('click', function () { finishTrip(reqId, null); });
  }

  function finishTrip(reqId, myStars) {
    // the driver rating the customer back (ratings are two-way)
    var driverGaveYou = 5;
    DB.updateRequest(reqId, {
      status: 'completed',
      completedAt: Date.now(),
      customerRatingForDriver: myStars,
      driverRatingForCustomer: driverGaveYou
    });
    stopCustomerWatch();
    closeModal();
    state.activeRequestId = null;
    state.tab = 'activity';
    render();
    toast('Trip complete · Driver rated you ' + driverGaveYou + '★');
  }

  // ---------------- DRIVER MODE ----------------
  // Driver id == the user's id (== Firebase UID in cloud mode), so that
  // ownership security rules (offer.driverId === auth.uid) hold.
  function myDriverId() { return Store.getUser().id; }
  function myOfferOn(r) {
    var id = myDriverId();
    return (r.offers || []).some(function (o) { return o.driverId === id; });
  }
  function ensureSelfDriver(user) {
    var drv = Store.getDriver(user.id);
    if (!drv) {
      drv = {
        id: user.id, name: user.name, phone: user.phone,
        vehicle: user.vehicle || 'My tanker', capacityL: user.capacityL || 9000,
        waterTypes: ['Sweet', 'Bore', 'RO'],
        ratingSum: 0, ratingCount: 0, completed: 0, isSeed: false
      };
      DB.registerDriver(drv);
    }
    return drv;
  }

  function renderDriverHome() {
    var user = Store.getUser();
    var open = DB.isCloud() ? (state.driverOpen || []) : Store.openRequests();
    // In cloud mode, don't show your own request (you're a different real user).
    // In local solo demo, allow it so one browser can play both sides.
    if (DB.isCloud()) open = open.filter(function (r) { return r.customerId !== user.id; });

    var list;
    if (open.length === 0) {
      list = '<div class="empty"><span class="empty-ico">📭</span><p>No open requests right now.</p>' +
        '<small>When customers place water requests, they show up here for you to bid on.</small></div>';
    } else {
      list = open.map(function (r) {
        var bid = myOfferOn(r)
          ? '<div class="muted small">✓ You sent an offer — waiting for the customer.</div>' : '';
        return '<div class="job-card">' +
          '<div class="job-top"><b>' + r.liters.toLocaleString() + ' L · ' + esc(r.waterType) + '</b>' +
            '<span class="muted">' + timeAgo(r.createdAt) + '</span></div>' +
          '<div class="job-loc muted">📍 ' + esc(r.location.address || 'Pinned on map') + '</div>' +
          '<div class="job-row"><span class="muted">Customer offer</span><b>' + money(r.offerPrice) + ' <span class="cod-badge">COD</span></b></div>' +
          '<div class="bid-row">' +
            '<span class="rs">Rs</span>' +
            '<input type="number" class="bid-input" id="bid-' + r.id + '" value="' + r.offerPrice + '" step="10" />' +
            '<button class="btn-primary" data-bid="' + r.id + '">' + (myOfferOn(r) ? 'Update' : 'Send offer') + '</button>' +
          '</div>' + bid +
        '</div>';
      }).join('');
    }

    var tip = DB.isCloud()
      ? 'Live: requests from customers on any device appear here. Send your price; if accepted you\'ll get a delivery screen with live location sharing.'
      : 'Tip: open this app in another browser tab as a Customer to see your offers arrive in real time.';

    // CNIC verification banner (drivers must be verified to bid)
    var verifyBanner = '';
    if (DB.isCloud() && (user.kyc || 'unsubmitted') !== 'verified') {
      var msg = { unsubmitted: 'Verify your CNIC to start accepting jobs.', pending: 'CNIC submitted — waiting for admin approval.', rejected: 'CNIC was rejected — please resubmit.' }[user.kyc || 'unsubmitted'];
      verifyBanner = '<div class="verify-banner"><div><b>🛡️ Verification ' + esc(user.kyc || 'required') + '</b><small>' + esc(msg) + '</small></div>' +
        (user.kyc !== 'pending' ? '<button id="kyc-go" class="ib-install">Verify</button>' : '') + '</div>';
    }

    setView(
      '<div class="screen driver-home">' +
        verifyBanner +
        '<div class="dh-head"><h2>Open requests</h2>' +
          '<span class="muted">Send your price — customer picks (COD)' + (DB.isCloud() ? ' · live' : '') + '</span></div>' +
        list +
        '<p class="hint">' + tip + '</p>' +
      '</div>'
    );

    if (el('kyc-go')) el('kyc-go').addEventListener('click', function () { startKyc(user); });
    document.querySelectorAll('[data-bid]').forEach(function (b) {
      b.addEventListener('click', function () { sendDriverBid(b.dataset.bid); });
    });

    startDriverWatch();
  }

  function sendDriverBid(reqId) {
    var user = Store.getUser();
    // Cloud drivers must be CNIC-verified before bidding.
    if (DB.isCloud() && (user.kyc || 'unsubmitted') !== 'verified') {
      toast('Please complete CNIC verification before sending offers');
      startKyc(user); return;
    }
    var req = Store.getRequest(reqId);
    if (!req || req.status !== 'searching') { toast('Request no longer open'); render(); return; }
    var price = parseInt(el('bid-' + reqId).value, 10) || req.offerPrice;

    var drv = ensureSelfDriver(user);
    DB.registerDriver(drv);

    var offer = {
      id: Store.uid('off'),
      driverId: drv.id, driverName: drv.name, vehicle: drv.vehicle, capacityL: drv.capacityL,
      rating: Store.driverRating(drv) || 5, ratingCount: drv.ratingCount, completed: drv.completed,
      phone: drv.phone, price: price, etaMin: 15, distanceKm: 3, ts: Date.now(),
      acceptedByUser: user.id
    };
    DB.addOffer(reqId, offer);
    if (DB.isCloud()) watchMyBid(reqId);
    toast('Offer sent: ' + money(price));
    render();
  }

  // ---------- driver realtime watchers (cloud) ----------
  function startDriverWatch() {
    if (!DB.isCloud() || state.dw) return;
    state.dw = DB.watchOpenRequests(function (list) {
      state.driverOpen = list;
      list.forEach(function (r) { if (myOfferOn(r)) watchMyBid(r.id); });
      var u = Store.getUser();
      if (state.tab === 'home' && u && u.role === 'driver' && !state.driverTrip) render();
    });
  }
  function stopDriverWatch() {
    if (state.dw) { try { state.dw(); } catch (e) {} state.dw = null; }
  }
  function clearBidWatch(reqId) {
    if (state.bidWatch[reqId]) { try { state.bidWatch[reqId](); } catch (e) {} delete state.bidWatch[reqId]; }
  }
  function watchMyBid(reqId) {
    if (!DB.isCloud() || state.bidWatch[reqId]) return;
    state.bidWatch[reqId] = DB.watchRequest(reqId, function (r) {
      if (!r) { clearBidWatch(reqId); return; }
      var mine = myDriverId();
      // our active trip got completed/cancelled by the customer
      if (state.driverTrip === reqId && (r.status === 'completed' || r.status === 'cancelled')) {
        toast(r.status === 'completed' ? 'Customer marked delivered ✓ — collect cash' : 'Trip cancelled');
        stopDriverTrip(); render(); return;
      }
      if (r.status === 'accepted' && r.driver && r.driver.driverId === mine) {
        enterDriverTrip(r);
      } else if (r.status === 'accepted' && r.driver && r.driver.driverId !== mine) {
        clearBidWatch(reqId); // taken by another driver
      } else if (r.status === 'cancelled' || r.status === 'completed') {
        clearBidWatch(reqId);
      }
    });
  }

  function enterDriverTrip(r) {
    if (state.driverTrip === r.id) return;
    state.driverTrip = r.id;
    Object.keys(state.bidWatch).forEach(function (id) { if (id !== r.id) clearBidWatch(id); });
    state.tripUnsubs = state.tripUnsubs || [];
    state.tripUnsubs.push(DB.watchChat(r.id, function () { if (state.driverTrip === r.id) renderChatLog(r.id); }));
    startLocationSharing(r.id);
    state.tab = 'home';
    toast('Your offer was accepted! Start the delivery 🚛');
    render();
  }
  function stopDriverTrip() {
    stopLocationSharing();
    if (state.tripUnsubs) { state.tripUnsubs.forEach(function (u) { try { u(); } catch (e) {} }); state.tripUnsubs = []; }
    state.driverTrip = null;
  }
  function startLocationSharing(reqId) {
    stopLocationSharing();
    if (!navigator.geolocation) return;
    state.geoWatchId = navigator.geolocation.watchPosition(function (pos) {
      DB.pushLocation(reqId, { lat: pos.coords.latitude, lng: pos.coords.longitude });
    }, function () {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
  }
  function stopLocationSharing() {
    if (state.geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.geoWatchId);
      state.geoWatchId = null;
    }
  }

  // Driver's active delivery screen (cloud mode)
  function renderDriverTrip(r) {
    var c = { name: r.customerName, phone: r.customerPhone };
    var chat = Store.getChat(r.id);
    var navUrl = 'https://www.google.com/maps/dir/?api=1&destination=' +
      (r.location ? (r.location.lat + ',' + r.location.lng) : '');
    setView(
      '<div class="screen enroute">' +
        '<div class="enroute-banner"><div class="pulse-dot"></div>' +
          '<div><b>You\'re delivering</b><small id="eta-line">📍 Sharing your live location with ' + esc(c.name) + '</small></div></div>' +

        '<div class="trip-summary">' +
          '<div><span class="muted">Customer</span><b>' + esc(c.name) + '</b></div>' +
          '<div><span class="muted">Deliver to</span><b>' + esc(r.location.address || 'Pinned on map') + '</b></div>' +
          '<div><span class="muted">Quantity</span><b>' + r.liters.toLocaleString() + ' L ' + esc(r.waterType) + '</b></div>' +
          '<div><span class="muted">Collect (cash)</span><b>' + money(r.finalPrice) + ' <span class="cod-badge">COD</span></b></div>' +
        '</div>' +

        phoneBlockHtml(c.phone, 'Customer phone') +

        '<div style="padding:12px 16px"><a class="btn-secondary block" href="' + navUrl + '" target="_blank" rel="noopener">🧭 Navigate to customer</a></div>' +

        '<div class="chat" id="chat">' +
          '<div class="chat-head">💬 Chat with ' + esc(c.name.split(' ')[0]) + '</div>' +
          '<div class="chat-log" id="chat-log">' + chat.map(chatBubble).join('') + '</div>' +
          '<div class="chat-input">' +
            '<input id="chat-text" type="text" placeholder="Type a message…" />' +
            '<button id="chat-send" class="btn-send">Send</button>' +
          '</div>' +
        '</div>' +

        '<div class="enroute-actions">' +
          '<button id="trip-done" class="btn-primary block">✓ Delivered — cash collected</button>' +
        '</div>' +
      '</div>'
    );

    var log = el('chat-log');
    if (log) log.scrollTop = log.scrollHeight;
    wirePhoneBlock();
    el('chat-send').addEventListener('click', function () { sendChat(r.id, 'driver'); });
    el('chat-text').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendChat(r.id, 'driver'); });
    el('trip-done').addEventListener('click', function () {
      DB.updateRequest(r.id, { status: 'completed', completedAt: Date.now() });
      stopDriverTrip();
      toast('Delivery complete 🎉');
      render();
    });
  }

  // ---------------- ACTIVITY / HISTORY ----------------
  function renderActivity() {
    var user = Store.getUser();
    var mine = Store.myRequests(user.id).slice().reverse();
    var rows;
    if (mine.length === 0) {
      rows = '<div class="empty"><span class="empty-ico">🕘</span><p>No trips yet.</p>' +
        '<small>Your water requests will appear here (saved in this browser).</small></div>';
    } else {
      rows = mine.map(function (r) {
        var badge = {
          searching: '<span class="st searching">Searching</span>',
          accepted: '<span class="st accepted">In progress</span>',
          completed: '<span class="st done">Completed</span>',
          cancelled: '<span class="st cancelled">Cancelled</span>'
        }[r.status] || '';
        var driverLine = r.driver ? ('🚛 ' + esc(r.driver.driverName)) : 'No driver';
        var price = r.finalPrice || r.offerPrice;
        var resume = (r.status === 'searching' || r.status === 'accepted')
          ? '<button class="mini-link" data-resume="' + r.id + '">resume</button>' : '';
        var rated = (r.status === 'completed' && r.customerRatingForDriver)
          ? '<span class="muted">You rated ' + stars(r.customerRatingForDriver) + '</span>' : '';
        return '<div class="hist-card">' +
          '<div class="hist-top"><b>' + r.liters.toLocaleString() + ' L · ' + esc(r.waterType) + '</b>' + badge + '</div>' +
          '<div class="muted small">' + driverLine + ' · ' + timeAgo(r.createdAt) + '</div>' +
          '<div class="hist-bot"><span>' + money(price) + ' <span class="cod-badge">COD</span></span>' + resume + ' ' + rated + '</div>' +
        '</div>';
      }).join('');
    }
    setView('<div class="screen list-screen"><h2 class="screen-title">Your activity</h2>' + rows + '</div>');

    document.querySelectorAll('[data-resume]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.activeRequestId = b.dataset.resume;
        state.tab = 'home';
        var r = Store.getRequest(b.dataset.resume);
        // if still searching and no live sim, restart it
        if (r && r.status === 'searching' && !state.cancelOffers) {
          state.cancelOffers = Sim.runOffers(r, function (offer) {
            var current = Store.getRequest(r.id);
            if (!current || current.status !== 'searching') return;
            current.offers.push(offer);
            Store.updateRequest(r.id, { offers: current.offers });
            if (state.activeRequestId === r.id) render();
          });
        }
        render();
      });
    });
  }

  // ---------------- PROFILE ----------------
  function renderProfile() {
    var user = Store.getUser();
    var myReviews = [];
    // If user has acted as a driver, surface their received reviews.
    var selfDrv = Store.getDriver(user.id);
    if (selfDrv) myReviews = Store.reviewsForDriver(selfDrv.id);

    var acctLine = DB.isCloud() ? esc(user.email || 'Account') : 'Offline (this device)';
    var canInstall = !isStandalone();

    var kycCard = '';
    if (DB.isCloud() && user.role === 'driver') {
      var ks = user.kyc || 'unsubmitted';
      var kycLabel = { unsubmitted: 'Not submitted', pending: 'Pending review', verified: 'Verified ✓', rejected: 'Rejected — please resubmit' }[ks] || ks;
      var kycClass = { verified: 'st done', pending: 'st searching', rejected: 'st cancelled' }[ks] || 'st';
      kycCard = '<div class="card">' +
        '<div class="row-between"><span>CNIC verification</span><span class="' + kycClass + '">' + kycLabel + '</span></div>' +
        (ks !== 'verified' ? '<button id="kyc-open" class="btn-secondary block">' + (ks === 'pending' ? 'Update CNIC documents' : 'Verify your CNIC') + '</button>' : '') +
        '</div>';
    }

    setView(
      '<div class="screen list-screen profile">' +
        '<div class="prof-head">' +
          '<div class="avatar xl">' + esc(user.name.charAt(0)) + '</div>' +
          '<h2>' + esc(user.name) + '</h2>' +
          '<p class="muted">' + esc(user.phone) + '</p>' +
          (selfDrv && selfDrv.ratingCount ? '<p>' + stars(Store.driverRating(selfDrv)) + ' ' + Store.driverRating(selfDrv).toFixed(1) + ' (' + selfDrv.ratingCount + ')</p>' : '') +
        '</div>' +

        '<div class="card">' +
          '<div class="row-between"><span>Mode</span>' +
            '<div class="switch-roles">' +
              '<button class="seg ' + (user.role === 'customer' ? 'on' : '') + '" data-setrole="customer">Customer</button>' +
              '<button class="seg ' + (user.role === 'driver' ? 'on' : '') + '" data-setrole="driver">Driver</button>' +
            '</div>' +
          '</div>' +
          '<div class="row-between"><span>Account</span><b>' + acctLine + '</b></div>' +
          '<div class="row-between"><span>Payment</span><b>Cash on delivery</b></div>' +
          '<div class="row-between"><span>Sync</span><b>' + (DB.isCloud() ? 'Live (cross-device)' : 'Offline') + '</b></div>' +
        '</div>' +

        kycCard +
        '<div id="admin-card"></div>' +

        (myReviews.length ? ('<h3 class="screen-title">Reviews about you</h3>' +
          myReviews.map(reviewRow).join('')) : '') +

        '<div class="card">' +
          (canInstall ? '<button id="install-app" class="btn-secondary block">📲 Install app</button>' : '') +
          (DB.isCloud() ? '<button id="sign-out" class="btn-secondary block">Sign out</button>' : '<button id="edit-prof" class="btn-secondary block">Edit name / phone</button>') +
          '<button id="reset-data" class="btn-danger block">Clear local data</button>' +
        '</div>' +
        '<p class="fineprint center">AquaDrive · Cash on delivery</p>' +
      '</div>'
    );

    document.querySelectorAll('[data-setrole]').forEach(function (b) {
      b.addEventListener('click', function () {
        user.role = b.dataset.setrole;
        Store.saveUser(user);
        if (DB.isCloud()) DB.saveProfile(user.id, user);
        if (user.role === 'driver') ensureSelfDriver(user);
        // tear down any active realtime watches when changing role
        stopCustomerWatch(); stopDriverWatch(); stopDriverTrip();
        Object.keys(state.bidWatch).forEach(clearBidWatch);
        state.tab = 'home';
        state.activeRequestId = null;
        render();
        if (user.role === 'driver') refreshDriverKyc(function () { render(); });
        toast('Switched to ' + user.role + ' mode');
      });
    });
    if (el('kyc-open')) el('kyc-open').addEventListener('click', function () { startKyc(user); });

    // Admin review link — only appears if this account can read the KYC list.
    if (DB.isCloud()) {
      DB.amIAdmin(function (isAdmin) {
        var card = el('admin-card');
        if (!card || !isAdmin) return;
        card.innerHTML = '<div class="card"><button id="admin-open" class="btn-secondary block">🛡️ Review driver CNICs (admin)</button></div>';
        el('admin-open').addEventListener('click', renderAdmin);
      });
    }

    if (el('install-app')) el('install-app').addEventListener('click', triggerInstall);
    if (el('sign-out')) el('sign-out').addEventListener('click', function () {
      stopCustomerWatch(); stopDriverWatch(); stopDriverTrip();
      Object.keys(state.bidWatch).forEach(clearBidWatch);
      Store.clearUser();
      DB.signOut(function () { state.tab = 'home'; state.activeRequestId = null; render(); toast('Signed out'); });
    });
    if (el('edit-prof')) el('edit-prof').addEventListener('click', function () {
      Store.clearUser();
      renderOnboarding();
    });
    el('reset-data').addEventListener('click', function () {
      if (confirm('Clear all AquaDrive data on this device? This cannot be undone.')) {
        Store.resetAll();
        location.reload();
      }
    });
  }

  function reviewRow(rv) {
    return '<div class="rev-row"><div class="rev-top"><b>' + esc(rv.byName) + '</b>' + stars(rv.stars) + '</div>' +
      (rv.comment ? '<p class="muted">' + esc(rv.comment) + '</p>' : '') +
      '<small class="muted">' + timeAgo(rv.ts) + '</small></div>';
  }

  // ---------------- DRIVER PROFILE MODAL ----------------
  function showDriverProfile(driverId) {
    var d = Store.getDriver(driverId);
    if (!d) return;
    var rating = Store.driverRating(d);
    openModal(
      '<div class="drv-profile">' +
        '<div class="avatar xl">' + esc(d.name.charAt(0)) + '</div>' +
        '<h2>' + esc(d.name) + '</h2>' +
        '<p>' + stars(rating) + ' <b>' + rating.toFixed(1) + '</b> <span class="muted">(' + (d.ratingCount || 0) + ' ratings · ' + (d.completed || 0) + ' trips)</span></p>' +
        '<div class="drv-facts">' +
          '<div><span class="muted">Vehicle</span><b>' + esc(d.vehicle) + '</b></div>' +
          '<div><span class="muted">Capacity</span><b>' + (d.capacityL || 0).toLocaleString() + ' L</b></div>' +
          '<div><span class="muted">Water</span><b>' + ((d.waterTypes || []).join(', ') || '—') + '</b></div>' +
          '<div><span class="muted">Phone</span><b>' + esc(d.phone) + '</b></div>' +
        '</div>' +
        '<h3 class="screen-title">Recent reviews</h3>' +
        '<div id="drv-reviews"><p class="muted">Loading…</p></div>' +
        '<button class="btn-secondary block close-modal">Close</button>' +
      '</div>'
    );
    document.querySelectorAll('.close-modal').forEach(function (b) { b.addEventListener('click', closeModal); });

    // reviews may live in the cloud — fetch (works in both modes)
    DB.getReviewsForDriver(driverId, function (revs) {
      var box = el('drv-reviews');
      if (!box) return; // modal closed
      box.innerHTML = (revs && revs.length)
        ? revs.slice(-5).reverse().map(reviewRow).join('')
        : '<p class="muted">No written reviews yet.</p>';
    });
  }

  // ---------------- MODAL + TOAST ----------------
  function openModal(html) {
    var root = el('modal-root');
    root.innerHTML = '<div class="modal-backdrop"><div class="modal">' + html + '</div></div>';
    root.classList.remove('hidden');
    root.querySelector('.modal-backdrop').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });
  }
  function closeModal() {
    el('modal-root').classList.add('hidden');
    el('modal-root').innerHTML = '';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  // ---------------- cross-tab sync ----------------
  function onStorage(e) {
    if (!e.key) return;
    if (e.key === Store.KEYS.requests || e.key === Store.KEYS.chats) {
      render();
    }
  }

  // ===================================================================
  // INIT
  // ===================================================================
  // ---------------- PWA install ----------------
  var deferredPrompt = null;
  var installDismissed = false;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!installDismissed && !isStandalone()) el('install-banner').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      el('install-banner').classList.add('hidden');
      toast('AquaDrive installed 🎉');
    });
  }
  function triggerInstall() {
    if (deferredPrompt) {
      el('install-banner').classList.add('hidden');
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
    } else if (isIOS()) {
      openModal('<div class="review"><div class="avatar xl">📲</div><h2>Install AquaDrive</h2>' +
        '<p class="muted">In Safari, tap the <b>Share</b> button, then <b>“Add to Home Screen”</b>.</p>' +
        '<button class="btn-secondary block close-modal">Got it</button></div>');
      document.querySelectorAll('.close-modal').forEach(function (b) { b.addEventListener('click', closeModal); });
    } else if (isStandalone()) {
      toast('Already installed ✓');
    } else {
      toast('Use your browser menu → Install / Add to Home screen');
    }
  }

  // resolve the cloud user from the persisted Firebase session
  function resolveCloudUser(done) {
    var uid = DB.currentUid();
    if (!uid) { Store.clearUser(); done(); return; }   // not signed in → auth screen
    var u = Store.getUser();
    if (u && u.id === uid) { done(); return; }          // cached profile matches session
    DB.loadProfile(uid, function (p) {
      if (p) Store.saveUser(p); else Store.clearUser();  // signed in but no profile → onboarding
      done();
    });
  }

  function init() {
    SeedData.run();
    setupInstallPrompt();

    // bottom nav
    document.querySelectorAll('#bottomnav .nav-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.dataset.tab;
        render();
      });
    });
    el('brand-link').addEventListener('click', function () { state.tab = 'home'; render(); });
    el('install-btn').addEventListener('click', triggerInstall);
    el('install-dismiss').addEventListener('click', function () {
      el('install-banner').classList.add('hidden'); installDismissed = true;
    });

    window.addEventListener('storage', onStorage);

    // Boot the UI immediately — don't block on Firebase. A returning user
    // (cached profile) sees the app instantly; Firebase connects in the
    // background and reconciles the session when ready.
    state.booting = false;
    render();

    DB.init(function (mode) {
      if (mode === 'cloud') {
        state.cloudReady = true;
        console.info('AquaDrive: connected to Firebase (cloud mode)');
        // react to later auth changes (e.g. sign-out)
        DB.onAuth(function () {
          resolveCloudUser(function () {
            stopCustomerWatch(); stopDriverWatch(); stopDriverTrip();
            state.activeRequestId = null;
            render();
          });
        });
        resolveCloudUser(function () {
          var u = Store.getUser();
          if (u && u.role === 'driver' && state.tab === 'home') startDriverWatch();
          render();
          if (u && u.role === 'driver') refreshDriverKyc(function () { render(); });
        });
      } else {
        // cloud was configured but couldn't connect → fall back to local
        state.cloudFailed = (typeof AquaCloud !== 'undefined' && AquaCloud.enabled());
        render();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.AquaApp = { render: render };
})(window);
