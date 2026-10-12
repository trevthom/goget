# Browser end-to-end runs

These scripts play whole rides in a headless browser: a **rider** and a **driver**, a small local Nostr **relay**
(`relay.mjs`), and a local Cashu **mint** that does the real blind-signature maths (`test/helpers/localmint.mjs`).
Outside services (address search, routing, the price feed, map tiles) are mocked.
They are slow (one to six minutes) and are **not** part of `npm test`.

```bash
npm i --no-save ws playwright        # extra tools, not saved in package.json
npx playwright install chromium      # or set PLAYWRIGHT_BROWSERS_PATH to an existing browser
node scripts/e2e/ride.mjs            # a standard-fare ride: fund, request, accept, 50 m arrival, codes, ticks, finish
FLAT=1 node scripts/e2e/ride.mjs     # the same with a flat price
node scripts/e2e/missed.mjs          # a wallet that runs dry: two missed payments, the driver finishes, refill, waiver and refund
node scripts/e2e/stop.mjs            # an extra stop turns a flat price into the driver's normal fare
```

Each run builds both apps first (set `E2E_NOBUILD=1` to reuse `dist/`). The runs print one line per step and exit with code 0 only
when every step passed and the pages raised no errors. `ride.mjs` and `missed.mjs` use the real clock, so a minute tick takes a real minute.

What they do **not** prove: behaviour against a public mint, a real Lightning wallet, a real phone's GPS, or Tailwind's styling.
