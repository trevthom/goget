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
node scripts/e2e/strike.mjs          # Strike (a stand-in server): link a key, pay from dollars and from Bitcoin, cash out as dollars and as Bitcoin
node scripts/e2e/nav.mjs             # tab bar always visible, back arrow, X to cancel, pin the pickup, driver online on an approximate (3 km) location
```

Each run builds both apps first (set `E2E_NOBUILD=1` to reuse `dist/`). The runs print one line per step and exit with code 0 only
when every step passed and the pages raised no errors. `ride.mjs` and `missed.mjs` use the real clock, so a minute tick takes a real minute.

What they do **not** prove: behaviour against a public mint, a real Lightning wallet, a real phone's GPS, or Tailwind's styling.

## Real styling (optional)
The app loads Tailwind from a CDN, which a sandbox cannot reach, so the pages are unstyled and a layout problem
(for example a bar hidden behind a sheet) cannot be seen. To see the real look, build the CSS once and point the runs at it:
```bash
mkdir /tmp/tw && cd /tmp/tw && npm init -y && npm i tailwindcss@3
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > in.css
echo 'module.exports = { content: ["/path/to/nostr-ride/src/**/*.{js,jsx}"] }' > tailwind.config.js
npx tailwindcss -c tailwind.config.js -i in.css -o out.css
node -e "const css=require('fs').readFileSync('out.css','utf8'); require('fs').writeFileSync('shim.js','(function(){var s=document.createElement(\"style\");s.textContent='+JSON.stringify(css)+';document.head.appendChild(s);})();')"
E2E_NOBUILD=1 E2E_TAILWIND=/tmp/tw/shim.js node scripts/e2e/nav.mjs
```
The harness answers the CDN request with that script. `page.screenshot()` then shows the screen as a person sees it.
