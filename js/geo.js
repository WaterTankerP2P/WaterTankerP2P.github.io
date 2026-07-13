/*
 * geo.js — free address autocomplete + reverse geocoding.
 *
 * Uses OpenStreetMap-based services that need NO API key and allow browser
 * (CORS) requests, so the whole app stays free and GitHub Pages friendly:
 *   - Photon (https://photon.komoot.io) for typeahead + reverse
 *   - Nominatim as a reverse-geocode fallback
 *
 * To switch to Google Places instead, replace `suggest`/`reverse` with calls
 * to the Google Places Autocomplete / Geocoding APIs (needs an API key + a
 * billing account — see README).
 */
(function (global) {
  'use strict';

  var PHOTON = 'https://photon.komoot.io';
  var NOMINATIM = 'https://nominatim.openstreetmap.org';

  function labelFromPhoton(p) {
    // p = feature.properties
    var parts = [];
    var head = [p.name, p.housenumber ? (p.street ? p.street + ' ' + p.housenumber : p.housenumber) : p.street]
      .filter(Boolean);
    if (head.length) parts.push(head.join(' '));
    [p.district, p.city || p.town || p.village, p.state, p.country]
      .filter(Boolean)
      .forEach(function (x) { if (parts.indexOf(x) === -1) parts.push(x); });
    return parts.join(', ');
  }

  var Geo = {
    // Autocomplete. onResults receives [{ label, lat, lng }] (possibly []).
    suggest: function (query, onResults, signal) {
      var url = PHOTON + '/api/?limit=5&q=' + encodeURIComponent(query);
      fetch(url, { signal: signal })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          var list = (json.features || []).map(function (f) {
            return {
              label: labelFromPhoton(f.properties || {}) || 'Unnamed place',
              lat: f.geometry.coordinates[1],
              lng: f.geometry.coordinates[0]
            };
          }).filter(function (x) { return x.label; });
          onResults(list);
        })
        .catch(function (e) {
          if (e && e.name === 'AbortError') return;
          onResults([]); // graceful: field still works as free text
        });
    },

    // Reverse geocode coords -> a human address string ('' on failure).
    reverse: function (lat, lng, onResult) {
      fetch(PHOTON + '/reverse?lat=' + lat + '&lon=' + lng)
        .then(function (r) { return r.json(); })
        .then(function (json) {
          var f = (json.features || [])[0];
          onResult(f ? labelFromPhoton(f.properties || {}) : '');
        })
        .catch(function () {
          // fallback to Nominatim
          fetch(NOMINATIM + '/reverse?format=jsonv2&lat=' + lat + '&lon=' + lng)
            .then(function (r) { return r.json(); })
            .then(function (j) { onResult(j && j.display_name ? j.display_name : ''); })
            .catch(function () { onResult(''); });
        });
    }
  };

  global.Geo = Geo;
})(window);
