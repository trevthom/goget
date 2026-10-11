# NostrRide 🚗⚡

A decentralized ridesharing system built on **Nostr**. No central server, no
database: every ride is a set of signed Nostr events, and payments go straight
from rider to driver over **Lightning**.

It is **two separate apps** that find each other through Nostr relays:

| App | For | Looks like | Port |
|---|---|---|---|
| **Rider** (`apps/rider`) | people who need a ride | Uber / Lyft: "Where to?", fare, driver on the map | 5173 |
| **Driver** (`apps/driver`) | people who drive | Uber Driver: big GO button, request cards, earnings | 5174 |

Full documentation is in [`docs/index.md`](docs/index.md). This guide is written for someone with **no coding experience**. Follow it
top to bottom.

---

## 1. Run it on your computer

You need **Node.js** installed first. If you don't have it, download the
"LTS" version from https://nodejs.org and install it (click through).

Open a **Terminal** (Mac: "Terminal" · Windows: "PowerShell"), then run these
one at a time (press Enter after each):

```bash
cd path/to/nostr-ride      # go into the project folder
npm install                # download building blocks (one time, ~1 min)
npm run dev                # start BOTH apps
```

Then open **two browser windows** side by side:

- Rider app: http://localhost:5173/
- Driver app: http://localhost:5174/

To stop: `Ctrl + C`. To run only one app: `npm run dev:rider` or `npm run dev:driver`.

> **Needs internet** for styling (Tailwind loads from a CDN), fonts, the map, and the relays.
> No API keys or accounts required. While you run `npm run dev`, the driver app also
> shows a couple of fake demo requests (never in a production build).

---

## 2. Sign in (both apps)

On the first screen either:
- **Create account** — makes a fresh Nostr identity, then asks you to save your secret key, or
- **I have a key** — paste an existing `nsec1...` key.

These are **real Nostr keys**. With **Remember me** (on by default) your key is
saved on this device, encrypted with a password you choose, so a reload only asks for
that password. Use a different account in each app window to play both sides.

---

## 3. A ride, step by step

**Driver app** (once):
1. **Account** tab → add a **photo**, your **vehicle** (year, make, model, plate, and a photo of the car), a photo of your **driver's license** (encrypted; only you can open it) and a
   **Lightning address** (like `you@wallet.com`; riders pay you there).
2. **Drive** tab → tap the green **GO** button (allow location when asked).

**Rider app:**
1. **Where to?** → type a destination (pickup fills in from your GPS) → see the **typical fares of nearby drivers** and the suggested price → type
   **your offer** (any amount, in dollars and cents or sats) → **Request ride**. Optional: show female or male drivers first. (Pick **Schedule** to reserve a ride for later: it waits under *Activity → Upcoming*.)
2. Wait for **"Finding your driver…"**. Nearby online drivers are shown as cars on the map.

**Driver app:**
3. A **request card** pops up with the rider's offer, pickup distance and the rider's rating. Tap **Accept**, or **Ask for a different price** and type your counter. Set your own base, per-mile and per-minute rates under *Account → Your typical fare*; riders see them.

**Rider app:**
4. Pick a driver (counter-offers are marked; fastest first) → **pay the deposit** with your connected wallet, or scan the
   invoice with any Lightning wallet. The ride is confirmed when it is paid.
5. Watch the car come to you. The driver's exact position is end-to-end encrypted and only you can see it.

**Driver app:**
6. Follow the route to the pickup → **I've arrived** → **Start trip** → **Complete trip**.

**Rider app:**
7. Pay the **rest of the fare**, rate your driver, tap **Done**. The driver rates you too, and
   the trip shows up under *Earnings* (driver) and *Activity* (rider).

**Money:** the deposit (default 20%, the driver can change it) is paid when you choose a driver;
the rest after the trip. Both go straight to the driver's Lightning address. There is **no
escrow**, so the deposit is not refunded if you cancel after the driver is on the way.

**Wallet:** *Account* → paste a **real** Nostr Wallet Connect string (`nostr+walletconnect://...`)
from a wallet that supports NWC (Alby Hub, Coinos…) to pay in one tap. The app reads your real
balance from that wallet and never shows made-up numbers. Without one you can still pay any
invoice from another wallet.

---

## 3b. Safety, blocking and disputes

- **Safety button** (rider, during a trip): call emergency services, **share your trip** with a link a friend opens
  to follow your car live, **SOS**, or report a problem. Before you get in, the app asks you to check the plate,
  car and driver. Add trusted contacts in *Account*.
- **Block** a driver or rider from their profile or after a trip. Blocked people no longer show up for you.
- **Disputes:** every payment and confirmation is a signed record. The driver app checks payments against the
  driver's own Lightning server and can copy a **trip record** for whoever settles a dispute.
- **Offline:** the apps install to your home screen, open offline, and send queued updates when you are back online.
- **Background GPS** needs the native app in `native/` (see its README); a browser stops location when the screen sleeps.

## 4. Privacy, in short

- Public relays only see an **approximate area** (about 1 km) for pickup and dropoff.
  The exact addresses are encrypted: first to you, then to the driver you choose.
- Your **license plate** is encrypted and sent only to the rider you drive.
- A driver who is online shares an **approximate** location (about 100 m) publicly. During a ride the
  exact location goes only to the matched rider, encrypted.
- Your driver's license photo is encrypted to the driver's own key. Riders never see it.
- Ride requests, price offers and replies are public on the relays you use.
- Looking up your address from GPS sends your position (rounded to about 10 m) to the free Photon
  geocoder. Swap that service for your own before a real launch.

---

## 5. Where to change things

| I want to change... | Open this file |
|---|---|
| Suggested-price formula, offer limits, deposit %, request timers, demo data | `src/config/settings.js` |
| Default relay list | `src/config/relays.js` |
| Colors | `src/theme.js` (and Tailwind classes in the screens) |
| What a button looks like (everywhere) | `src/ui/Button.jsx` |
| The bottom sheet, tab bar, page layout | `src/ui/Layout.jsx` |
| The map (tiles, pins, cars) | `src/ui/MapView.jsx` |
| Your own map / search / route servers | `.env` (copy `env.example`) |
| A rider screen | `src/rider/screens/…` |
| A driver screen | `src/driver/screens/…` |
| Nostr event types | `src/nostr/eventKinds.js` |
| The map's starting city | `src/lib/locations.js` (first entry) |

Each file is small (under ~300 lines) and starts with a comment explaining it.

---

## 6. Build for the web

```bash
npm run build      # makes dist/rider and dist/driver
npm test           # runs the automated checks
```

Put each folder on any static host (they deploy separately, e.g. `ride.example.com` and
`drive.example.com`). Location needs `https://`. Browsers stop GPS when the tab is in the
background, so the driver app keeps the screen awake while online (where the browser allows it). A driver can go
online only with a good GPS fix (about 200 m or better), so a laptop's Wi-Fi position never shows up as a car.

**One repository per app.** `trevthom/nostr-ride-rider` and `trevthom/nostr-ride-driver` are generated
from this repository. Edit code here, then run `node scripts/export-apps.mjs --push`.

> **About the map services:** the app uses free public endpoints — OpenStreetMap map tiles, Photon (address search) and OSRM (driving routes). They are fine for development but
> rate-limited and not meant for heavy traffic. Before a real launch switch to paid or self-hosted
> ones (Mapbox, MapTiler, your own OSRM/Photon). The files: `src/lib/geocode.js`,
> `src/lib/routing.js`. Or set `VITE_TILE_URL`, `VITE_PHOTON_URL` and `VITE_OSRM_URL` in `.env` (see `env.example`).

---

## 7. Editing with Claude Code (recommended)

This repo includes a **`CLAUDE.md`** file — a dense map of the project that lets Claude Code
understand everything without reading every file. Open the folder with Claude Code and ask for
changes. It reads `CLAUDE.md` automatically.
