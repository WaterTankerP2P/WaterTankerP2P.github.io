/*
 * otp.js — email verification codes via EmailJS (free, client-side).
 *
 * A 6-digit code is generated, emailed to the user, and held in memory with a
 * 10-minute expiry for a single verification flow (signup / password reset).
 * This proves the person can receive mail at that address. No backend needed.
 */
(function (global) {
  'use strict';

  var EJS = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
  var loaded = false;
  var pending = null; // { code, email, exp }

  function cfg() { return global.AQUA_EMAILJS || {}; }

  function loadEmailJS(cb) {
    if (loaded && global.emailjs) { cb(true); return; }
    if (!cfg().publicKey) { cb(false); return; }
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; cb(false); } }, 8000);
    var s = document.createElement('script');
    s.src = EJS; s.async = true;
    s.onload = function () {
      if (done) return; done = true; clearTimeout(to);
      try { global.emailjs.init({ publicKey: cfg().publicKey }); loaded = true; cb(true); }
      catch (e) { cb(false); }
    };
    s.onerror = function () { if (done) return; done = true; clearTimeout(to); cb(false); };
    document.head.appendChild(s);
  }

  function gen() { return String(Math.floor(100000 + Math.random() * 900000)); }

  var AquaOTP = {
    enabled: function () { return !!cfg().publicKey; },

    // Generate + email a code to `email`. cb(err).
    request: function (email, extra, cb) {
      cb = cb || function () {};
      loadEmailJS(function (ok) {
        if (!ok) { cb(new Error('Email service unavailable')); return; }
        var code = gen();
        pending = { code: code, email: (email || '').toLowerCase(), exp: Date.now() + 10 * 60 * 1000 };
        var params = {
          to_email: email, email: email, user_email: email,
          otp_code: code, passcode: code, code: code,
          app_name: 'AquaDrive'
        };
        if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) params[k] = extra[k];
        global.emailjs.send(cfg().serviceId, cfg().templateId, params)
          .then(function () { cb(null); }, function (e) {
            pending = null;
            cb(new Error((e && (e.text || e.message)) || 'Could not send email'));
          });
      });
    },

    // Verify the entered code for `email`. Returns true on success (and clears).
    verify: function (email, code) {
      if (!pending) return false;
      if (Date.now() > pending.exp) { pending = null; return false; }
      if ((email || '').toLowerCase() !== pending.email) return false;
      if (String(code).trim() !== pending.code) return false;
      pending = null;
      return true;
    },

    clear: function () { pending = null; }
  };

  global.AquaOTP = AquaOTP;
})(window);
