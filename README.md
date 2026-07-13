# 💧 AquaDrive — Water Tanker on Demand

A **ride-hailing–style** web app for water tanker delivery. Customers **name their price**,
nearby tanker drivers send **offers**, the customer picks one, they **chat / call**,
and pay **cash on delivery (COD)**. After delivery, both sides leave a **star review**.

> **No backend. No database.** Everything is stored in the **browser's `localStorage`**,
> so it can be hosted for free on **GitHub Pages**.

---

## ✨ Features

| Ride-hailing feature | AquaDrive equivalent |
|---|---|
| Name your own fare | Customer sets the price for the water request |
| Drivers send offers / counter-offers | Nearby tanker drivers bid with their price + ETA |
| Pick a driver | Accept any offer from the list (sorted by price) |
| Cash payment | **Cash on delivery only** |
| In-app chat | Built-in chat module per trip |
| Call driver | Tap-to-call (uses the phone number) |
| Driver profiles & ratings | Profile modal with vehicle, capacity, rating & reviews |
| Two-way star reviews | Customer rates driver; driver rates customer back |
| Trip history | Saved in browser (`localStorage`, capped to keep it light) |
| Map / location | Leaflet + OpenStreetMap (no API key) |
| Address autocomplete | Free OSM geocoder (Photon) as you type — no API key |
| Current location | Auto-requested on open + manual 📍 button (reverse-geocoded) |
| Phone | Tap-to-call, masked number with **Show** toggle, and **Copy to clipboard** |
| Live tracking | Animated tanker marker moving toward you on the map* |

Plus a **Driver mode** (switch in Profile) where you can see open requests and send offers.

> \* **Live tracking is simulated.** On a static site there is no server to relay a
> driver's real GPS to the customer. Real cross-device tracking needs a realtime
> backend (e.g. Firebase) — see *Notes & limitations*.

### Maps & geocoding options

The app uses **free, no-API-key OpenStreetMap services**, so it costs nothing on
GitHub Pages:
- Tiles & map: **Leaflet + OpenStreetMap**
- Autocomplete + reverse geocoding: **Photon** (`js/geo.js`)

To use **Google Maps / Places Autocomplete** instead, swap the calls in `js/geo.js`
and the map in `js/app.js` for the Google JS API. Note Google Maps Platform
**requires an API key and a billing account (credit card)**, the key is publicly
visible in client-side code (restrict it by HTTP referrer to your Pages domain),
and usage is billed per request above the monthly free allowance.

---

## 🚀 Run locally

It's a static site — just open `index.html`, or serve the folder:

```bash
# any static server works, e.g.:
python -m http.server 8000
# then visit http://localhost:8000
```

> Tip: opening over `http://` (a server) is better than `file://` so the map tiles load.

---

## 🌐 Deploy to GitHub Pages

1. Create a new GitHub repository and push these files:
   ```bash
   git init
   git add .
   git commit -m "AquaDrive: water tanker on-demand app"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment**
   - **Source:** *Deploy from a branch*
   - **Branch:** `main` / `root`
3. Wait ~1 minute. Your app is live at
   `https://<you>.github.io/<repo>/`

The included `.nojekyll` file tells Pages to serve the files as-is.

---

## 🧪 Try the full marketplace (two sides)

Because there's no server, the app simulates nearby drivers responding with offers so a
single person gets the complete experience. To feel the **real peer-to-peer** flow:

1. Open the app in **two browser tabs** (same browser = shared `localStorage`).
2. Tab A: stay as **Customer**, place a request.
3. Tab B: go to **Profile → Driver mode**, find the open request, **send an offer**.
4. Tab A updates live and you can **accept**, **chat**, and **review**.

---

## 📁 Project structure

```
index.html              # app shell + PWA tags + service-worker registration
.nojekyll               # GitHub Pages: skip Jekyll
manifest.webmanifest    # PWA manifest (installable app)
sw.js                   # service worker (offline app shell)
icons/                  # app icons (192 / 512 / apple-touch)
css/styles.css          # app theme (lime + ink)
js/store.js             # localStorage data layer
js/seed.js              # first-run sample drivers + reviews (local mode)
js/sim.js               # simulated driver offers & chat replies (local mode)
js/geo.js               # free OSM address autocomplete + reverse geocoding
js/firebase-config.js   # paste your Firebase config here to enable cloud mode
js/cloud.js             # Firebase Realtime Database backend (lazy-loaded)
js/data.js              # DB facade: picks cloud vs local at runtime
js/app.js               # UI controller / screens / flow
```

---

## 📲 Install as an app (PWA)

No Play Store needed — it installs straight from the browser:

- **Android (Chrome):** open the site → menu **⋮ → Install app** / *Add to Home screen*.
- **iPhone (Safari):** **Share → Add to Home Screen**.
- **Desktop (Chrome/Edge):** an **Install** icon appears in the address bar.

It then opens full-screen with its own icon, and the app shell works offline
(thanks to `sw.js`). Requires HTTPS — GitHub Pages provides this automatically.

---

## ☁️ Going live with Firebase (real cross-device)

By default the app runs in **local mode** (this browser only, simulated drivers).
Fill in `js/firebase-config.js` to switch on **cloud mode**, where real customers
and drivers on **different devices** are matched, chat, and see **live tanker
tracking** — all on Firebase's **free Spark tier**. Payment stays **COD**.

1. Go to <https://console.firebase.google.com> → **Add project** (free).
2. **Build → Realtime Database → Create database.**
3. **Build → Authentication → Sign-in method → enable _Anonymous_.**
4. **Project settings → Your apps → Web (`</>`)** → copy the config and paste the
   values into [`js/firebase-config.js`](js/firebase-config.js)
   (these web values are safe to expose; access is controlled by the rules below).
5. In **Realtime Database → Rules**, paste:

   ```json
   {
     "rules": {
       "requests":  { ".read": "auth != null", ".indexOn": ["status"], "$id": { ".write": "auth != null" } },
       "chats":     { ".read": "auth != null", "$id": { ".write": "auth != null" } },
       "tracking":  { ".read": "auth != null", "$id": { ".write": "auth != null" } },
       "drivers":   { ".read": "auth != null", "$id": { ".write": "auth != null" } },
       "reviews":   { ".read": "auth != null", ".write": "auth != null" }
     }
   }
   ```

That's it — reload the app. The console logs `connected to Firebase (cloud mode)`.
If the config is empty or the connection fails, it silently falls back to local mode.

> **Try it across two devices:** open the live URL on your phone as **Customer**
> and on your laptop as **Driver** (Profile → Driver mode). Place a request on the
> phone; it appears on the laptop. Send an offer; accept it on the phone. The driver
> screen then shares live GPS and you'll see the 🚛 move on the customer's map.
>
> The free Spark tier (1 GB stored, 10 GB/month transfer, anonymous auth) is plenty
> for a small operation. The rules above require sign-in but let any signed-in user
> read/write — tighten them (per-owner writes, validation) before a real launch.

---

## ⚠️ Notes & limitations

- **Local mode** is a demo: no real auth/matching, data stays in the browser.
- **Cloud mode** adds real cross-device matching, chat and live tracking via
  Firebase. The starter security rules are permissive (any signed-in user) — tighten
  them before a real launch, and add a privacy policy (you collect location).
- Payment is **Cash on Delivery** only — no money is processed by the app.
- Clearing browser data (or **Profile → Clear all data**) resets local data.
- Local history is capped (most recent ~25 requests) to keep `localStorage` small.
