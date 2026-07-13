/*
 * sim.js — simulates nearby tanker drivers responding to a request with
 * price offers, like drivers bidding on a ride.
 *
 * This makes the marketplace usable for a single person on a static site:
 * you place a request, and a few drivers "respond" over a few seconds with
 * offers (some accept your price, some counter higher/lower).
 */
(function (global) {
  'use strict';

  function rand(min, max) { return Math.random() * (max - min) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Rough distance (km) for ETA flavour.
  function distanceKm(a, b) {
    if (!a || !b) return rand(2, 9);
    var dx = (a.lat - b.lat) * 111;
    var dy = (a.lng - b.lng) * 96;
    return Math.sqrt(dx * dx + dy * dy);
  }

  var Sim = {
    /*
     * Schedule simulated offers for a request.
     * onOffer(offer) is called for each incoming offer.
     * Returns a cancel() function.
     */
    runOffers: function (request, onOffer) {
      var drivers = Store.getDrivers().filter(function (d) { return d.isSeed; });

      // Match drivers who can carry the requested quantity & water type.
      var eligible = drivers.filter(function (d) {
        var typeOk = d.waterTypes.indexOf(request.waterType) !== -1;
        var capOk = d.capacityL >= request.liters;
        return typeOk && capOk;
      });
      if (eligible.length === 0) eligible = drivers; // fall back so user still sees offers

      // Sort by proximity, take 2-4.
      eligible.sort(function (a, b) {
        return distanceKm(a, request.location) - distanceKm(b, request.location);
      });
      var count = Math.min(eligible.length, 2 + Math.floor(Math.random() * 3));
      var chosen = eligible.slice(0, count);

      var timers = [];
      var cancelled = false;

      chosen.forEach(function (d, i) {
        var delay = 1200 + i * rand(1400, 2600);
        var t = setTimeout(function () {
          if (cancelled) return;
          var dist = distanceKm(d, request.location);
          // Offer logic: relative to the customer's named price.
          // Higher-rated drivers tend to ask a little more; closer drivers a little less.
          var ratingPremium = (Store.driverRating(d) - 4.5) * 0.06; // up to ~+2-3%
          var distPenalty = Math.min(dist, 12) * 0.012;
          var noise = rand(-0.08, 0.14);
          var factor = 1 + ratingPremium + distPenalty + noise;
          factor = Math.max(0.9, Math.min(1.35, factor));
          var price = Math.round((request.offerPrice * factor) / 10) * 10;

          var offer = {
            id: Store.uid('off'),
            driverId: d.id,
            driverName: d.name,
            vehicle: d.vehicle,
            capacityL: d.capacityL,
            rating: Store.driverRating(d),
            ratingCount: d.ratingCount,
            completed: d.completed,
            phone: d.phone,
            price: price,
            etaMin: Math.max(5, Math.round(dist * rand(2.2, 3.4))),
            distanceKm: Math.round(dist * 10) / 10,
            ts: Date.now()
          };
          onOffer(offer);
        }, delay);
        timers.push(t);
      });

      return function cancel() {
        cancelled = true;
        timers.forEach(clearTimeout);
      };
    },

    /*
     * After a driver is accepted, simulate a short greeting in chat so the
     * conversation feels two-sided for a solo demo user.
     */
    driverGreeting: function (offer) {
      return pick([
        'Assalam o Alaikum! I am on my way with the tanker. 🚛',
        'Hello! Heading to your location now. Please keep the gate open.',
        'On the way! Approx ' + offer.etaMin + ' min. Cash on delivery, right?',
        'Thanks for accepting. I will reach in about ' + offer.etaMin + ' minutes.'
      ]);
    },

    autoReply: function (text) {
      var t = (text || '').toLowerCase();
      if (t.indexOf('how long') !== -1 || t.indexOf('eta') !== -1 || t.indexOf('time') !== -1) {
        return 'Almost there, just a few minutes away. 👍';
      }
      if (t.indexOf('price') !== -1 || t.indexOf('cash') !== -1 || t.indexOf('pay') !== -1) {
        return 'Yes, cash on delivery is fine. Please keep it ready.';
      }
      if (t.indexOf('location') !== -1 || t.indexOf('where') !== -1 || t.indexOf('address') !== -1) {
        return 'I have your location pin, will call if I get lost.';
      }
      return pick([
        'Okay, noted! 👍',
        'Sure, no problem.',
        'Got it, see you soon.',
        'Alright!'
      ]);
    }
  };

  global.Sim = Sim;
})(window);
