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
          global.firebase.auth().signInAnonymously()
            .then(function () { AquaCloud.ready = true; flush(true); })
            .catch(function (e) { console.warn('AquaCloud auth failed:', e && e.message); flush(false); });
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

    /* -------- drivers / reviews -------- */
    registerDriver: function (d) {
      db.ref('drivers/' + d.id).transaction(function (cur) {
        cur = cur || {};
        cur.id = d.id; cur.name = d.name; cur.phone = d.phone;
        cur.vehicle = d.vehicle; cur.capacityL = d.capacityL; cur.waterTypes = d.waterTypes;
        if (cur.ratingSum == null) cur.ratingSum = d.ratingSum || 0;
        if (cur.ratingCount == null) cur.ratingCount = d.ratingCount || 0;
        if (cur.completed == null) cur.completed = d.completed || 0;
        return cur;
      });
    },
    getDriver: function (id, cb) {
      db.ref('drivers/' + id).once('value').then(function (s) { cb(s.val()); }, function () { cb(null); });
    },
    addReview: function (review, cb) {
      db.ref('reviews').push(review);
      db.ref('drivers/' + review.driverId).transaction(function (cur) {
        cur = cur || { ratingSum: 0, ratingCount: 0 };
        cur.ratingSum = (cur.ratingSum || 0) + review.stars;
        cur.ratingCount = (cur.ratingCount || 0) + 1;
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
