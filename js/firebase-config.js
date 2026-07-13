/*
 * firebase-config.js — Firebase project config for AquaDrive CLOUD mode
 * (real cross-device matching, chat, live tracking). Cash-on-Delivery only.
 *
 * These web config values are safe to expose publicly — access is controlled
 * by Realtime Database security rules + Firebase Auth, not by hiding these.
 *
 * For cloud mode to actually connect, the Firebase project must have:
 *   1. Realtime Database created          (done — databaseURL below)
 *   2. Authentication → Anonymous ENABLED (required for sign-in)
 *   3. Realtime Database security rules    (see README "Going live with Firebase")
 * If any are missing, the app safely falls back to local mode.
 */
window.AQUA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBmBBI9Bswr3IabUPLQ0ndUQcAL0WPsnaE",
  authDomain: "watertankerp2p.firebaseapp.com",
  databaseURL: "https://watertankerp2p-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "watertankerp2p",
  storageBucket: "watertankerp2p.firebasestorage.app",
  messagingSenderId: "100936882060",
  appId: "1:100936882060:web:c22724995d91d1c719a8a9"
};
