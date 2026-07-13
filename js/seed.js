/*
 * seed.js — first-run sample data (drivers + reviews) so the marketplace
 * feels alive on a fresh browser. Runs once, then persists in localStorage.
 */
(function (global) {
  'use strict';

  // Base coordinates (Karachi-ish) just to place drivers on the map.
  var BASE = { lat: 24.8607, lng: 67.0011 };

  function jitter(v, amt) { return v + (Math.random() - 0.5) * amt; }

  var SEED_DRIVERS = [
    { name: 'Bilal Hussain',  vehicle: 'Hino 3000 Gal Tanker', capacityL: 13600, waterTypes: ['Sweet', 'Bore', 'RO'], rating: 4.9, ratingCount: 214, completed: 980 },
    { name: 'Asif Mehmood',   vehicle: 'Mazda 2000 Gal Tanker', capacityL: 9000,  waterTypes: ['Sweet', 'Bore'],       rating: 4.7, ratingCount: 156, completed: 612 },
    { name: 'Rana Tariq',     vehicle: 'Shahzore 1000 Gal',     capacityL: 4500,  waterTypes: ['Bore', 'RO'],          rating: 4.8, ratingCount: 98,  completed: 430 },
    { name: 'Imran Khan',     vehicle: 'Hino 5000 Gal Tanker',  capacityL: 22700, waterTypes: ['Sweet', 'Bore', 'RO'], rating: 4.6, ratingCount: 77,  completed: 305 },
    { name: 'Saleem Akhtar',  vehicle: 'Mazda 2000 Gal Tanker', capacityL: 9000,  waterTypes: ['Sweet'],               rating: 4.5, ratingCount: 64,  completed: 240 },
    { name: 'Naveed Anwar',   vehicle: 'Shahzore 800 Gal',      capacityL: 3600,  waterTypes: ['Bore'],                rating: 4.9, ratingCount: 132, completed: 540 }
  ];

  var SAMPLE_REVIEWS = [
    { stars: 5, comment: 'On time and clean water. Recommended!' },
    { stars: 5, comment: 'Very polite driver, filled the tank quickly.' },
    { stars: 4, comment: 'Good service, slightly late but fine.' },
    { stars: 5, comment: 'Fair price, paid cash on delivery. Will book again.' }
  ];

  var SeedData = {
    run: function () {
      if (Store.isSeeded()) return;

      var drivers = SEED_DRIVERS.map(function (d, i) {
        return {
          id: Store.uid('drv'),
          name: d.name,
          phone: '+92 3' + (10 + i) + ' ' + (1000000 + Math.floor(Math.random() * 8999999)),
          vehicle: d.vehicle,
          capacityL: d.capacityL,
          waterTypes: d.waterTypes,
          // store rating as a running sum so new reviews fold in naturally
          ratingSum: Math.round(d.rating * d.ratingCount),
          ratingCount: d.ratingCount,
          completed: d.completed,
          lat: jitter(BASE.lat, 0.08),
          lng: jitter(BASE.lng, 0.08),
          isSeed: true
        };
      });

      Store.saveDrivers(drivers);

      // Attach a couple of human-readable reviews to the top drivers.
      var reviews = [];
      drivers.slice(0, 4).forEach(function (drv, i) {
        var s = SAMPLE_REVIEWS[i % SAMPLE_REVIEWS.length];
        reviews.push({
          id: Store.uid('rev'),
          driverId: drv.id,
          byName: ['Ahmed', 'Sara', 'Usman', 'Fatima'][i % 4],
          stars: s.stars,
          comment: s.comment,
          ts: Date.now() - (i + 1) * 86400000
        });
      });
      // Persist sample reviews without double-counting (ratingCount already set).
      try {
        localStorage.setItem(Store.KEYS.reviews, JSON.stringify(reviews));
      } catch (e) { /* ignore */ }

      Store.markSeeded();
    },

    BASE: BASE
  };

  global.SeedData = SeedData;
})(window);
