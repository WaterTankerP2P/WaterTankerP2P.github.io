/*
 * store.js — localStorage data layer for AquaDrive
 * No backend / no database. Everything lives in the browser.
 * GitHub Pages friendly: pure client-side persistence.
 */
(function (global) {
  'use strict';

  var KEYS = {
    user: 'aqua_user',
    requests: 'aqua_requests',
    drivers: 'aqua_drivers',
    chats: 'aqua_chats',
    reviews: 'aqua_reviews',
    seeded: 'aqua_seeded_v1'
  };

  // Keep browser storage small: cap historical requests.
  var MAX_HISTORY = 25;

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('store.read failed for', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('store.write failed for', key, e);
      return false;
    }
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  var Store = {
    KEYS: KEYS,
    uid: uid,

    /* ---------------- USER / PROFILE ---------------- */
    getUser: function () {
      return read(KEYS.user, null);
    },
    saveUser: function (user) {
      write(KEYS.user, user);
      return user;
    },
    clearUser: function () {
      localStorage.removeItem(KEYS.user);
    },

    /* ---------------- DRIVERS ---------------- */
    getDrivers: function () {
      return read(KEYS.drivers, []);
    },
    saveDrivers: function (drivers) {
      write(KEYS.drivers, drivers);
    },
    getDriver: function (id) {
      var all = this.getDrivers();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) return all[i];
      }
      return null;
    },
    upsertDriver: function (driver) {
      var all = this.getDrivers();
      var idx = -1;
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === driver.id) { idx = i; break; }
      }
      if (idx >= 0) all[idx] = driver; else all.push(driver);
      this.saveDrivers(all);
      return driver;
    },
    driverRating: function (driver) {
      if (!driver || !driver.ratingCount) return 0;
      return driver.ratingSum / driver.ratingCount;
    },

    /* ---------------- REQUESTS ---------------- */
    getRequests: function () {
      return read(KEYS.requests, []);
    },
    saveRequests: function (list) {
      // Trim history to keep localStorage lean.
      if (list.length > MAX_HISTORY) {
        // Keep all non-final first, then most recent finals up to cap.
        list = list.slice(-MAX_HISTORY);
      }
      write(KEYS.requests, list);
    },
    getRequest: function (id) {
      var all = this.getRequests();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) return all[i];
      }
      return null;
    },
    addRequest: function (req) {
      var all = this.getRequests();
      all.push(req);
      this.saveRequests(all);
      return req;
    },
    updateRequest: function (id, patch) {
      var all = this.getRequests();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === id) {
          all[i] = Object.assign({}, all[i], patch);
          this.saveRequests(all);
          return all[i];
        }
      }
      return null;
    },
    /* Insert or replace a whole request (used to mirror cloud data locally) */
    upsertRequest: function (req) {
      var all = this.getRequests();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === req.id) { all[i] = req; this.saveRequests(all); return req; }
      }
      all.push(req);
      this.saveRequests(all);
      return req;
    },
    /* Requests created by the current user (customer side) */
    myRequests: function (userId) {
      return this.getRequests().filter(function (r) { return r.customerId === userId; });
    },
    /* Open requests visible to drivers (anyone's, still searching) */
    openRequests: function () {
      return this.getRequests().filter(function (r) { return r.status === 'searching'; });
    },

    /* ---------------- CHAT ---------------- */
    getChat: function (requestId) {
      var all = read(KEYS.chats, {});
      return all[requestId] || [];
    },
    addChatMessage: function (requestId, msg) {
      var all = read(KEYS.chats, {});
      if (!all[requestId]) all[requestId] = [];
      all[requestId].push(msg);
      write(KEYS.chats, all);
      return msg;
    },
    /* Replace the whole chat log for a request (used to mirror cloud data) */
    setChat: function (requestId, list) {
      var all = read(KEYS.chats, {});
      all[requestId] = list || [];
      write(KEYS.chats, all);
    },

    /* ---------------- REVIEWS ---------------- */
    getReviews: function () {
      return read(KEYS.reviews, []);
    },
    reviewsForDriver: function (driverId) {
      return this.getReviews().filter(function (rv) { return rv.driverId === driverId; });
    },
    addReview: function (review) {
      var all = this.getReviews();
      all.push(review);
      write(KEYS.reviews, all);

      // Roll the rating into the driver aggregate.
      var driver = this.getDriver(review.driverId);
      if (driver) {
        driver.ratingSum = (driver.ratingSum || 0) + review.stars;
        driver.ratingCount = (driver.ratingCount || 0) + 1;
        this.upsertDriver(driver);
      }
      return review;
    },

    /* ---------------- SEED / RESET ---------------- */
    isSeeded: function () {
      return read(KEYS.seeded, false) === true;
    },
    markSeeded: function () {
      write(KEYS.seeded, true);
    },
    resetAll: function () {
      Object.keys(KEYS).forEach(function (k) {
        localStorage.removeItem(KEYS[k]);
      });
    }
  };

  global.Store = Store;
})(window);
