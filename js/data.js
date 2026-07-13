/*
 * data.js — DB facade that the app talks to.
 *
 * Picks the backend at runtime:
 *   - CLOUD mode  → Firebase (real cross-device matching/chat/tracking)
 *   - LOCAL mode  → localStorage + simulated drivers (default / offline)
 *
 * In cloud mode, incoming realtime data is mirrored into the local Store so the
 * existing (synchronous) rendering code keeps working unchanged. Writes go to
 * the cloud and echo back through the watchers.
 */
(function (global) {
  'use strict';

  function noop() {}

  // Mirror a cloud request (with offers) into the local Store for rendering,
  // and make sure each offering driver exists locally for profile views.
  function mirrorRequest(r) {
    if (!r) return;
    Store.upsertRequest(r);
    (r.offers || []).forEach(function (o) {
      if (!Store.getDriver(o.driverId)) {
        Store.upsertDriver({
          id: o.driverId, name: o.driverName, phone: o.phone, vehicle: o.vehicle,
          capacityL: o.capacityL, waterTypes: [], ratingSum: Math.round((o.rating || 0) * (o.ratingCount || 0)),
          ratingCount: o.ratingCount || 0, completed: o.completed || 0, isSeed: false
        });
      }
    });
  }

  var DB = {
    mode: 'local',
    isCloud: function () { return this.mode === 'cloud'; },

    init: function (cb) {
      cb = cb || noop;
      if (typeof AquaCloud !== 'undefined' && AquaCloud.enabled()) {
        AquaCloud.connect(function (ok) {
          DB.mode = ok ? 'cloud' : 'local';
          cb(DB.mode);
        });
      } else {
        DB.mode = 'local';
        cb('local');
      }
    },

    /* ---------------- requests / matching ---------------- */
    createRequest: function (req, cb) {
      cb = cb || noop;
      if (this.isCloud()) {
        Store.upsertRequest(req);        // local mirror for instant render
        AquaCloud.createRequest(req, cb);
      } else {
        Store.addRequest(req); cb(null);
      }
    },
    updateRequest: function (id, patch, cb) {
      cb = cb || noop;
      Store.updateRequest(id, patch);    // always keep local mirror current
      if (this.isCloud()) AquaCloud.updateRequest(id, patch, cb);
      else cb(null);
    },
    addOffer: function (reqId, offer, cb) {
      cb = cb || noop;
      if (this.isCloud()) {
        AquaCloud.addOffer(reqId, offer, cb);
      } else {
        var r = Store.getRequest(reqId);
        if (r) { r.offers = r.offers || []; r.offers.push(offer); Store.updateRequest(reqId, { offers: r.offers }); }
        cb(null);
      }
    },
    acceptOffer: function (reqId, offer, cb) {
      this.updateRequest(reqId, {
        status: 'accepted', driver: offer, finalPrice: offer.price, acceptedAt: Date.now()
      }, cb);
    },

    // Watchers return an unsubscribe function. In local mode they fire once
    // with current data and then no-op (local changes re-render directly).
    watchRequest: function (id, onChange) {
      if (this.isCloud()) {
        return AquaCloud.watchRequest(id, function (r) { mirrorRequest(r); onChange(r); });
      }
      onChange(Store.getRequest(id));
      return noop;
    },
    watchOpenRequests: function (onChange) {
      if (this.isCloud()) {
        return AquaCloud.watchOpenRequests(function (list) {
          list.forEach(mirrorRequest);
          onChange(list);
        });
      }
      onChange(Store.openRequests());
      return noop;
    },

    /* ---------------- chat ---------------- */
    sendChat: function (reqId, msg) {
      if (this.isCloud()) AquaCloud.sendChat(reqId, msg);
      else Store.addChatMessage(reqId, msg);
    },
    watchChat: function (reqId, onChange) {
      if (this.isCloud()) {
        return AquaCloud.watchChat(reqId, function (list) { Store.setChat(reqId, list); onChange(list); });
      }
      onChange(Store.getChat(reqId));
      return noop;
    },

    /* ---------------- live tracking ---------------- */
    pushLocation: function (reqId, loc) {
      if (this.isCloud()) AquaCloud.pushLocation(reqId, loc);
    },
    watchLocation: function (reqId, onChange) {
      if (this.isCloud()) return AquaCloud.watchLocation(reqId, onChange);
      return noop;
    },

    /* ---------------- drivers / reviews ---------------- */
    registerDriver: function (d) {
      Store.upsertDriver(d);
      if (this.isCloud()) AquaCloud.registerDriver(d);
    },
    getDriver: function (id, cb) {
      if (this.isCloud()) {
        AquaCloud.getDriver(id, function (d) {
          if (d) Store.upsertDriver(d);
          cb(d || Store.getDriver(id));
        });
      } else { cb(Store.getDriver(id)); }
    },
    addReview: function (review, cb) {
      cb = cb || noop;
      if (this.isCloud()) AquaCloud.addReview(review, cb);
      else { Store.addReview(review); cb(null); }
    },
    getReviewsForDriver: function (id, cb) {
      if (this.isCloud()) AquaCloud.getReviewsForDriver(id, cb);
      else cb(Store.reviewsForDriver(id));
    }
  };

  global.DB = DB;
})(window);
