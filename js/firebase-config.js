/*
 * firebase-config.js — paste your own Firebase project's config here to turn
 * on REAL cross-device mode (matching, chat, live tracking). Until you do, the
 * app runs in local mode (this browser only, with simulated drivers).
 *
 * How to fill this in (free, ~5 minutes — see README "Going live with Firebase"):
 *   1. https://console.firebase.google.com  →  Add project
 *   2. Build → Realtime Database → Create database (start in test or use the
 *      security rules from the README)
 *   3. Build → Authentication → Sign-in method → enable "Anonymous"
 *   4. Project settings → Your apps → Web app (</>)  → copy the config values
 *   5. Paste them below. (These web values are safe to expose publicly; access
 *      is controlled by Realtime Database security rules, not by hiding them.)
 *
 * IMPORTANT: databaseURL is required for Realtime Database.
 */
window.AQUA_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",      // e.g. https://YOUR-PROJECT-default-rtdb.firebaseio.com
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
