# Browser end-to-end runs

These scripts play whole rides in a headless browser: a **rider** and a **driver**, a small local Nostr **relay**
(`relay.mjs`), and a local Cashu **mint** that does the real blind-signature maths (`test/helpers/localmint.mjs`).
Outside services (address search, routing, the price feed, map tiles) are mocked.
They are slow (one to six minutes) and are **not** part of `npm test`.

```bash
npm i --no-save ws playwright        # extra tools, not saved in package.json
npx playwright install chromium      # or set PLAYWRIGHT_BROWSERS_PATH to an existing browser
node scripts/e2e/ride.mjs            # a standard-fare ride: fund, request, accept, 150 m arrival, the 4-digit start code (typed by the rider), ticks, finish
node scripts/e2e/missed.mjs          # a wallet that runs dry: two missed payments, the driver finishes, refill, waiver and refund
node scripts/e2e/stop.mjs            # an extra stop mid-ride: the rider is told the fare keeps running, the driver accepts it
SHARE_CHECK=1 node scripts/e2e/ride.mjs   # the rider shares the trip: the shared position is the rider's phone (not the car's), one update every 6 s; a friend's page draws it
node scripts/e2e/vouches.mjs         # "Your vouches" in both apps: the badge on a request card and on an offer, one hop only, an nsec refused, Remove, the list on the relay; no stars
node scripts/e2e/nav.mjs             # tab bar always visible, back arrow, X to cancel, pin the pickup and the drop-off, driver online on an approximate (3 km) location
node scripts/e2e/recovery.mjs        # Account sections open and close (and are remembered); write down the 12 recovery words; Create New Wallet warns and shows them; a fresh browser (no wallet) restores the ecash from them under the same words; no phrase on any relay
node scripts/e2e/disconnect.mjs      # the ecash wallet disconnected from the device: a driver's GO is off and says why; Connect makes a new empty wallet
node scripts/e2e/goget.mjs         # GoGet: the context picker and slogan; Shipping posts a delivery needing a CDL endorsement; a courier without it does not see it; two bids, the Bids tab number, accepting one declines the other; the 4-digit pickup code; both halves of the ecash payment; a photo of the delivery; switching to Passenger and Taxi Driver
node scripts/e2e/send.mjs            # sending ecash (a token, a Lightning invoice or address) and "Automatically cash out at"
node scripts/e2e/appearance.mjs      # dark mode saves the moment it is flipped (both apps) and survives a reload without a white flash; the password eye on Remember me and Unlock
```

`E2E_VIEWPORT=360x640` runs the same scripts in a phone-sized browser (touch, 2x pixels, the page's viewport meta honoured); with `E2E_SHOTS=/some/dir` a script saves screenshots. Check a new screen at 320x568 and 360x640.

Each run builds the app(s) it needs first (GoGet's run serves only the GoGet build on port 4175) (set `E2E_NOBUILD=1` to reuse `dist/`). The runs print one line per step and exit with code 0 only
when every step passed and the pages raised no errors. `ride.mjs` and `missed.mjs` use the real clock, so a minute tick takes a real minute.

What they do **not** prove: behaviour against a public mint, a real Lightning wallet, a real phone's GPS, or Tailwind's styling.

## Styling
The pages are styled exactly as a person sees them: Tailwind is built into the app's own CSS (`src/tailwind.css`, `tailwind.config.js`), so no
script from another site is needed and nothing has to be mocked. `E2E_SHOTS=/some/dir node scripts/e2e/<script>.mjs` saves screenshots of the new screens.
The harness also remembers every class name that was on screen; `nav.mjs` prints the ones the built CSS has no rule for
(`h.missingStyles(page, role)`). A class name built from pieces (`"bg-" + color`) is not found by Tailwind's scan and would show up there.
The built pages carry a Content-Security-Policy (`csp.mjs`): a script from another site cannot run, so a policy violation shows as a console error and fails the run.
