/*
 * cloud.js — optional Firebase Realtime Database backend (AquaCloud).
 *
 * Loaded lazily so a missing/blocked CDN or an unconfigured project never
 * stalls the app. When `firebase-config.js` is filled in, this powers REAL
 * cross-device matching, chat and live tracking. Otherwise it stays dormant
 * and the app uses local mode (see data.js / store.js).
 *
 * Payment stays Cash-on-Delivery — no money flows through here.
 */
(function (global) {
  'use strict';

  var SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  var db = null;
  var auth = null;
  var _uid = null;
  var authCb = null;      // notified on later auth-state changes (login/logout)
  var connecting = false;
  var pending = [];

  function uid(p) { return (typeof Store !== 'undefined') ? Store.uid(p) : (p + '_' + Date.now() + Math.random().toString(36).slice(2, 7)); }

  function mapToArray(obj) {
    if (!obj) return [];
    return Object.keys(obj).map(function (k) {
      var v = obj[k];
      if (v && typeof v === 'object' && v.id == null) v.id = k;
      return v;
    });
  }

  // ---- lazy SDK loader (compat build = simple globals, no bundler) ----
  function inject(src, onload, onerror) {
    var s = document.createElement('script');
    s.src = src; s.async = true; s.onload = onload; s.onerror = onerror;
    document.head.appendChild(s);
  }
  function loadSdk(done) {
    if (global.firebase && global.firebase.database) { done(true); return; }
    var finished = false;
    var to = setTimeout(function () { if (!finished) { finished = true; done(false); } }, 7000);
    function fail() { if (finished) return; finished = true; clearTimeout(to); done(false); }
    inject(SDK + 'firebase-app-compat.js', function () {
      inject(SDK + 'firebase-auth-compat.js', function () {
        inject(SDK + 'firebase-database-compat.js', function () {
          if (finished) return; finished = true; clearTimeout(to); done(true);
        }, fail);
      }, fail);
    }, fail);
  }

  var AquaCloud = {
    ready: false,

    // Is a real Firebase project configured?
    enabled: function () {
      var c = global.AQUA_FIREBASE_CONFIG || {};
      return !!(c.apiKey && c.databaseURL && c.projectId);
    },

    // Connect once; cb(success). Safe to call repeatedly.
    connect: function (cb) {
      cb = cb || function () {};
      if (this.ready) { cb(true); return; }
      if (!this.enabled()) { cb(false); return; }
      pending.push(cb);
      if (connecting) return;
      connecting = true;

      loadSdk(function (ok) {
        if (!ok) return flush(false);
        try {
          global.firebase.initializeApp(global.AQUA_FIREBASE_CONFIG);
          db = global.firebase.database();
          auth = global.firebase.auth();
          var firstResolved = false;
          // Resolve connect() once the first auth state is known (persisted
          // sessions restore here), then keep notifying the app of changes.
          auth.onAuthStateChanged(function (u) {
            _uid = u ? u.uid : null;
            if (!firstResolved) { firstResolved = true; AquaCloud.ready = true; flush(true); }
            else if (authCb) { try { authCb(_uid); } catch (e) {} }
          });
        } catch (e) {
          console.warn('AquaCloud init failed:', e && e.message);
          flush(false);
        }
      });

      function flush(success) {
        connecting = false;
        var cbs = pending.slice(); pending.length = 0;
        cbs.forEach(function (fn) { try { fn(success); } catch (e) {} });
      }
    },

    /* -------- auth (email/password + guest) -------- */
    currentUid: function () { return _uid; },
    onAuth: function (cb) { authCb = cb; },
    signInGuest: function (cb) {
      auth.signInAnonymously().then(function (r) { cb(null, r.user.uid); }, function (e) { cb(e); });
    },
    register: function (email, pass, cb) {
      auth.createUserWithEmailAndPassword(email, pass).then(function (r) { cb(null, r.user.uid); }, function (e) { cb(e); });
    },
    login: function (email, pass, cb) {
      auth.signInWithEmailAndPassword(email, pass).then(function (r) { cb(null, r.user.uid); }, function (e) { cb(e); });
    },
    signOutUser: function (cb) {
      auth.signOut().then(function () { cb && cb(); }, function () { cb && cb(); });
    },
    saveProfile: function (uid, profile, cb) {
      db.ref('users/' + uid).set(profile).then(ok(cb), errcb(cb));
    },
    loadProfile: function (uid, cb) {
      db.ref('users/' + uid).once('value').then(function (s) { cb(s.val()); }, function () { cb(null); });
    },

    /* -------- requests / matching -------- */
    createRequest: function (req, cb) {
      var copy = Object.assign({}, req);
      delete copy.offers; // offers live as children
      db.ref('requests/' + req.id).set(copy).then(ok(cb), errcb(cb));
    },
    updateRequest: function (id, patch, cb) {
      db.ref('requests/' + id).update(patch).then(ok(cb), errcb(cb));
    },
    addOffer: function (reqId, offer, cb) {
      db.ref('requests/' + reqId + '/offers/' + offer.id).set(offer).then(ok(cb), errcb(cb));
    },
    watchRequest: function (id, onChange) {
      var ref = db.ref('requests/' + id);
      var h = ref.on('value', function (snap) {
        var v = snap.val();
        if (!v) { onChange(null); return; }
        v.id = id;
        v.offers = mapToArray(v.offers);
        onChange(v);
      });
      return function () { ref.off('value', h); };
    },
    watchOpenRequests: function (onChange) {
      var ref = db.ref('requests').orderByChild('status').equalTo('searching');
      var h = ref.on('value', function (snap) {
        var v = snap.val() || {};
        var list = Object.keys(v).map(function (k) {
          var r = v[k]; r.id = k; r.offers = mapToArray(r.offers); return r;
        });
        list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        onChange(list);
      });
      return function () { ref.off('value', h); };
    },

    /* -------- chat -------- */
    sendChat: function (reqId, msg) {
      db.ref('chats/' + reqId).push(msg);
    },
    watchChat: function (reqId, onChange) {
      var ref = db.ref('chats/' + reqId);
      var h = ref.on('value', function (snap) {
        var v = snap.val() || {};
        var list = Object.keys(v).map(function (k) { return v[k]; });
        list.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        onChange(list);
      });
      return function () { ref.off('value', h); };
    },

    /* -------- live tracking -------- */
    pushLocation: function (reqId, loc) {
      db.ref('tracking/' + reqId).set({ lat: loc.lat, lng: loc.lng, ts: Date.now() });
    },
    watchLocation: function (reqId, onChange) {
      var ref = db.ref('tracking/' + reqId);
      var h = ref.on('value', function (snap) { onChange(snap.val()); });
      return function () { ref.off('value', h); };
    },

    /* -------- drivers / reviews --------
     * Driver PROFILE lives at /drivers/{uid} (owner-writable only).
     * The rating AGGREGATE lives at /ratings/{uid} so reviewers (customers,
     * not the driver) can update it without touching the driver's profile. */
    registerDriver: function (d) {
      db.ref('drivers/' + d.id).update({
        id: d.id, name: d.name, phone: d.phone,
        vehicle: d.vehicle, capacityL: d.capacityL, waterTypes: d.waterTypes,
        completed: d.completed || 0
      });
    },
    getDriver: function (id, cb) {
      Promise.all([
        db.ref('drivers/' + id).once('value'),
        db.ref('ratings/' + id).once('value')
      ]).then(function (snaps) {
        var prof = snaps[0].val();
        var r = snaps[1].val() || {};
        if (!prof) { cb(null); return; }
        prof.ratingSum = r.sum || 0;
        prof.ratingCount = r.count || 0;
        cb(prof);
      }, function () { cb(null); });
    },
    addReview: function (review, cb) {
      db.ref('reviews').push(review);
      db.ref('ratings/' + review.driverId).transaction(function (cur) {
        cur = cur || { sum: 0, count: 0 };
        cur.sum = (cur.sum || 0) + review.stars;
        cur.count = (cur.count || 0) + 1;
        return cur;
      }).then(ok(cb), errcb(cb));
    },
    getReviewsForDriver: function (driverId, cb) {
      db.ref('reviews').once('value').then(function (snap) {
        var v = snap.val() || {};
        var list = Object.keys(v).map(function (k) { return v[k]; })
          .filter(function (r) { return r.driverId === driverId; });
        cb(list);
      }, function () { cb([]); });
    },

    uid: uid
  };

  function ok(cb) { return function () { if (cb) cb(null); }; }
  function errcb(cb) { return function (e) { console.warn('AquaCloud write failed:', e && e.message); if (cb) cb(e); }; }

  global.AquaCloud = AquaCloud;
})(window);
