// Shared steps for the browser runs: log in, fund the rider's ecash wallet, request a ride, accept, confirm, arrive,
// the rider types the driver's 4-digit start code and the driver starts the trip. Returns the two pages and helpers.
import { sleep, PICKUP, metersNorth } from "./harness.mjs";

export const num = (s) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
// Without Tailwind (its CDN is unreachable in a sandbox) the layout is unstyled and scrolling into view can stall: click by event.
export const tap = (loc) => loc.dispatchEvent("click");
export const openSheet = async (p) => { const b = p.getByRole("button", { name: /drag up to open/ }); if (await b.count()) await b.first().click(); await sleep(400); };
export const satsIn = async (loc) => num(await loc.first().locator(":scope").getByText(/^[\d,]+ sats$/).first().innerText().catch(() => "0"));
// The Account screen's sections are folds (closed until tapped): open one by its title.
export const openFold = async (p, title) => {
  const b = p.locator("section h2 button", { hasText: title }).first();
  await b.waitFor({ timeout: 15000 });
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
};
export const geo = (c, p) => c.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 10 });

// The pickup is never filled in by the app: pin it on the map (the pin starts at the phone's position).
export async function pinPickup(R) {
  await R.getByLabel("Pickup location").click(); // the map button shows only for the active field
  await tap(R.getByRole("button", { name: /Set pickup on the map/ }));
  await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
  await tap(R.getByRole("button", { name: "Confirm pickup" }));
  await R.getByText("Plan your ride").waitFor({ timeout: 10000 });
}

export function makeLog() {
  const t0 = Date.now();
  return (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s]`, ...a);
}

// opts: { fundAmount: "11" | undefined, log, step }
export async function rideToRiding(h, opts = {}) {
  const log = opts.log || makeLog();
  const pages = {};
  const step = opts.step || (async (name, fn) => { await fn(); log("ok  ", name); });
  const dctx = (await h.newContext("driver", metersNorth(PICKUP, 25)));
  const rctx = (await h.newContext("rider", PICKUP));
  const D = dctx.page, R = rctx.page;
  Object.assign(pages, { D, R, dctx: dctx.ctx, rctx: rctx.ctx });
  await step("driver online; rider adds funds", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await D.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
    await D.getByText("You're online").waitFor({ timeout: 15000 });
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await openFold(R, "Wallets");
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    if (opts.fundAmount) await R.getByLabel("Amount to add").fill(opts.fundAmount);
    await R.getByRole("button", { name: "Show invoice" }).click();
    for (let i = 0; i < 40 && ![...h.mint.quotes.values()].some((q) => q.state === "UNPAID"); i++) await sleep(250);
    for (const [k, q] of h.mint.quotes) if (q.state === "UNPAID") h.mint.payQuote(k);
    await R.getByText(/added/).waitFor({ timeout: 20000 });
    await R.getByRole("button", { name: "Done" }).click();
  });
  await step("request, accept, choose, confirm", async () => {
    await R.locator('nav[aria-label="Main"]').getByText("Ride", { exact: true }).click();
    await R.getByRole("button", { name: /Where to\?/ }).click();
    await R.getByLabel("Pickup location").waitFor();
    await pinPickup(R);
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByText("Blue Grass Airport", { exact: false }).first().click({ timeout: 10000 });
    await R.getByRole("button", { name: /Request ride · / }).click({ timeout: 15000 });
    await D.getByText("New ride request").waitFor({ timeout: 40000 });
    await D.getByRole("button", { name: /^Accept/ }).click();
    await R.getByText(/can take you/).waitFor({ timeout: 40000 });
    await R.getByRole("button", { name: "Choose" }).click();
    await R.getByRole("button", { name: "Confirm driver" }).click({ timeout: 15000 });
  });
  await step("arrive, start code, start", async () => {
    await D.getByText(/Pick up/).first().waitFor({ timeout: 40000 });
    await openSheet(D);
    const btn = D.getByRole("button", { name: "I've arrived" });
    for (let i = 0; i < 40 && (await btn.isDisabled()); i++) await sleep(500);
    await btn.click();
    await R.locator("#start-code").waitFor({ state: "visible", timeout: 40000 }); // the code field is there at once: nothing to tap first
    if (await R.getByRole("button", { name: /It matches|Doesn't match/ }).count()) throw new Error("the rider must not have to confirm the car");
    const startCode = (await D.getByLabel(/The start code is/).getAttribute("aria-label", { timeout: 15000 })).match(/\d{4}/)[0];
    await R.locator("#start-code").fill(startCode);
    await R.getByRole("button", { name: "Confirm", exact: true }).click();
    await D.getByText(/Your rider typed the code/).waitFor({ timeout: 20000 });
    const start = D.getByRole("button", { name: "Start trip" });
    for (let i = 0; i < 20 && (await start.isDisabled()); i++) await sleep(300);
    await start.click();
    await D.getByText(/Drop off at/).first().waitFor({ timeout: 30000 });
    await openSheet(D);
    await openSheet(R);
  });
  return { ...pages, log, step };
}
