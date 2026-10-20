// Shared set-up for the browser end-to-end runs (see README.md in this folder): a local relay, a local Cashu mint that does the
// real maths, the two production builds served by `vite preview`, and a headless browser with two contexts (rider, driver)
// whose outside services (geocoder, router, price feed, map tiles) are mocked. The pages are styled exactly as a person sees
// them: Tailwind is built into the app's own CSS file. Every class name that appears on screen during a run is collected, and
// h.missingStyles(page, role) lists the ones the built CSS has no rule for (a class name built from pieces is not found by
// Tailwind's scan, and would be unstyled).
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { startRelay } from "./relay.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const require = createRequire(import.meta.url);
export const { chromium } = require("playwright"); // install with: npm i --no-save ws playwright
const { startLocalMint } = await import(`${REPO}/test/helpers/localmint.mjs`);
const Keys = await import(`${REPO}/src/nostr/keys.js`);
const Ev = await import(`${REPO}/src/nostr/events.js`);
const Priv = await import(`${REPO}/src/lib/privacy.js`);
const { EVENT_KINDS: K } = await import(`${REPO}/src/nostr/eventKinds.js`);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const PICKUP = { lat: 38.0406, lng: -84.5037 };
export const DEST = { lat: 38.0365, lng: -84.6059 }; // about 5.6 miles west
export const metersNorth = (p, m) => ({ lat: p.lat + m / 111320, lng: p.lng });

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

// The production build, served by `vite preview` (the dev server adds fake demo riders).
export function startVite(mode, port) {
  const p = spawn(process.execPath, [`${REPO}/node_modules/vite/bin/vite.js`, "preview", "--mode", mode, "--port", String(port), "--strictPort"], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", () => {}); p.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  return p;
}
async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return; } catch { /* not yet */ } await sleep(500); }
  throw new Error("server did not start: " + url);
}

// apps: which of the builds to serve: "rider" (4173), "driver" (4174), "goget" (4175). The default is the two standalone apps.
export async function boot({ feePpk = 0, driverRates = null, apps = ["rider", "driver"] } = {}) {
  const relay = await startRelay();
  const mint = await startLocalMint({ feePpk });
  const rider = Keys.generateKeypair(), driver = Keys.generateKeypair();
  const PORTS = { rider: 4173, driver: 4174, goget: 4175 };
  if (!process.env.E2E_NOBUILD) {
    for (const app of apps) await new Promise((res, rej) => spawn(process.execPath, [`${REPO}/node_modules/vite/bin/vite.js`, "build", "--mode", app], { cwd: REPO, stdio: "ignore" }).on("exit", (c) => (c ? rej(new Error(app + " build failed")) : res())));
  }
  const servers = apps.map((app) => startVite(app, PORTS[app]));
  await Promise.all(apps.map((app) => waitHttp(`http://localhost:${PORTS[app]}/`)));
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const errors = [];

  // Seed a driver's profile (photo, vehicle, Lightning address; lud16: "" leaves it out) so the app lets them drive. More drivers: seedDriver(h.newKeys(), { name, gender }).
  const seedDriver = (kp, { name = "Dina Driver", gender, rates = driverRates, lud16 = "dina@example.com" } = {}) => {
    const sk = kp.sk, pk = kp.publicKey;
    relay.inject(Ev.buildSignedEvent(K.METADATA, {
      name, about: "NostrRide user", communication: [], picture: JPEG, ...(lud16 ? { lud16 } : {}), ...(gender ? { gender } : {}), ...(rates ? { rates } : {}),
      vehicle: Priv.sealVehicle({ year: "2020", make: "Toyota", model: "Prius", picture: JPEG, plateState: "KY", plateNumber: "ABC123" }, sk, pk),
    }, [], sk));
    return kp;
  };
  seedDriver(driver);

  async function newContext(name, pos, extraStorage = {}, accuracy = 10) {
    // E2E_VIEWPORT=360x640 runs the pages like a phone of that size (touch, device pixel ratio 2, the page's viewport meta honoured).
    const [vw, vh] = (process.env.E2E_VIEWPORT || "420x880").split("x").map(Number);
    const phone = process.env.E2E_VIEWPORT ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {};
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, ...phone, geolocation: { latitude: pos.lat, longitude: pos.lng, accuracy }, permissions: ["geolocation"] });
    await ctx.addInitScript(({ relayUrl, mintUrl, extra }) => {
      localStorage.setItem("nostrride_relays", JSON.stringify([relayUrl]));
      localStorage.setItem("nostrride_ecashMint", JSON.stringify(mintUrl));
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, JSON.stringify(v));
    }, { relayUrl: relay.url, mintUrl: mint.url, extra: extraStorage });
    // Outside services, mocked.
    await ctx.route(/photon\.komoot\.io\/reverse/, (r) => r.fulfill({ json: { features: [{ geometry: { coordinates: [PICKUP.lng, PICKUP.lat] }, properties: { housenumber: "100", street: "Main St", city: "Lexington", state: "Kentucky", district: "Downtown" } }] } }));
    await ctx.route(/photon\.komoot\.io\/api/, (r) => r.fulfill({ json: { features: [{ geometry: { coordinates: [DEST.lng, DEST.lat] }, properties: { name: "Blue Grass Airport", city: "Lexington", state: "Kentucky", district: "Airport" } }] } }));
    await ctx.route(/router\.project-osrm\.org/, (r) => {
      const pts = decodeURIComponent(new URL(r.request().url()).pathname.split("/driving/")[1]).split(";").map((p) => p.split(",").map(Number));
      let m = 0;
      for (let i = 1; i < pts.length; i++) m += Math.hypot((pts[i][0] - pts[i - 1][0]) * 88000, (pts[i][1] - pts[i - 1][1]) * 111000) * 1.3;
      r.fulfill({ json: { routes: [{ geometry: { type: "LineString", coordinates: pts }, distance: m, duration: m / 11 }] } });
    });
    // Remember every class name that is ever on screen (for h.missingStyles).
    await ctx.addInitScript(() => {
      const seen = (window.__seenClasses = new Set());
      const take = (el) => { const c = el.getAttribute && el.getAttribute("class"); if (c) for (const t of c.split(/\s+/)) if (t) seen.add(t); };
      const scan = (root) => { take(root); if (root.querySelectorAll) root.querySelectorAll("[class]").forEach(take); };
      new MutationObserver((ms) => { for (const m of ms) { if (m.type === "attributes") take(m.target); for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); } })
        .observe(document, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
      document.addEventListener("DOMContentLoaded", () => scan(document.documentElement));
    });
    await ctx.route(/api\.coingecko\.com/, (r) => r.fulfill({ json: { bitcoin: { usd: 100000, eur: 90000, gbp: 80000, jpy: 15000000 } } }));
    await ctx.route(/tile\.openstreetmap\.org|unpkg|fonts\.g/, (r) => r.request().url().includes("tile.openstreetmap") ? r.fulfill({ body: PNG, contentType: "image/png" }) : r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
    return { ctx, page };
  }

  // Nothing makes an ecash wallet by itself (Account → Ecash wallet → Create New Wallet), so by default a login of the two standalone apps also
  // creates one, through the screens, closes the write-down dialog and goes back to the first tab. `{ wallet: false }` leaves the device
  // without one. A GoGet login never does (the context picker comes first: goget.mjs creates the wallet where it is needed).
  async function createWallet(page, face) {
    const nav = page.locator('nav[aria-label="Main"]');
    await nav.waitFor({ timeout: 90000 });
    await nav.getByText("Account", { exact: true }).click();
    const fold = page.locator("section h2 button", { hasText: "Wallets" }).first();
    await fold.waitFor({ timeout: 15000 });
    if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click();
    await page.getByRole("button", { name: "Create New Wallet", exact: true }).click({ timeout: 15000 });
    await page.getByRole("button", { name: "Create wallet", exact: true }).click({ timeout: 15000 });
    await page.getByRole("dialog", { name: "Write down 12 words" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await nav.getByText(face === "drive" ? "Drive" : "Ride", { exact: true }).click();
  }

  async function login(page, who, appUrl, { wallet = true } = {}) {
    await page.goto(appUrl);
    await page.getByText("I have a key", { exact: true }).click({ timeout: 90000 });
    await page.getByPlaceholder("nsec1...").fill(who.nsec);
    const remember = page.getByLabel(/Remember me/);
    if (await remember.isChecked()) await remember.uncheck();
    await page.getByRole("button", { name: "Continue" }).click();
    if (wallet && !appUrl.includes(":4175")) await createWallet(page, appUrl.includes(":4174") ? "drive" : "ride");
  }

  const stop = async () => {
    await browser.close().catch(() => {});
    servers.forEach((p) => p.kill());
    await mint.close(); await relay.close();
  };
  // Class names seen on `page` that the built CSS of `role` has no rule for (marker classes such as "group" have none and are expected).
  const missingStyles = async (page, role = "rider") => {
    const dir = `${REPO}/dist/${role}/assets`;
    const css = fs.readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(`${dir}/${f}`, "utf8")).join("\n");
    const esc = (t) => t.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);
    const tokens = await page.evaluate(() => [...(window.__seenClasses || [])]);
    return tokens.filter((t) => !css.includes("." + esc(t)) && !/^(group|peer|nr-up)$/.test(t)).sort();
  };
  return { relay, mint, rider, driver, seedDriver, missingStyles, newKeys: () => Keys.generateKeypair(), browser, errors, newContext, login, createWallet, stop, riderUrl: "http://localhost:4173/", driverUrl: "http://localhost:4174/", gogetUrl: "http://localhost:4175/" };
}
