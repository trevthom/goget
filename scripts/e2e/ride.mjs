import { boot, sleep, PICKUP, DEST, metersNorth } from "./harness.mjs";
import { pinPickup } from "./flow.mjs";
import { tmpdir } from "node:os";
const SC = tmpdir(); // failure screenshots go here
const FLAT = process.env.FLAT === "1";
const STRIKE_TIP = process.env.STRIKE_TIP === "1"; // after the ride the rider links Strike and tips the driver from it
const STRIKE_RAIL = process.env.STRIKE_RAIL === "1"; // the WHOLE ride is paid from the rider's Strike into the driver's Strike: no ecash, no mint
const DRIVER_KEY = "driver-key-bbbbbbbbbbbbbbbb";
const h = await boot({ feePpk: 100 });
let strike = null;
if (STRIKE_TIP || STRIKE_RAIL) strike = await (await import("../../test/helpers/localstrike.mjs")).startLocalStrike({ usdPerBtc: 100000 });
if (STRIKE_RAIL) strike.addAccount(DRIVER_KEY, { BTC: 0, USD: 0 });
// With E2E_SHOTS=/some/dir the Strike runs also save screenshots of the new screens.
const snap = async (p, name) => { if (process.env.E2E_SHOTS) { await sleep(600); await p.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); } };
const toStrike = (ctx) => ctx.route(/api\.strike\.me/, async (r) => { const u = new URL(r.request().url()); await r.fulfill({ response: await r.fetch({ url: strike.url + u.pathname + u.search }) }); });
let D, R, dctx, rctx;
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s]`, ...a);
async function step(name, fn) {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 8).join(" | "));
    for (const [n, p] of [["driver", D], ["rider", R]]) if (p) { await p.screenshot({ path: `${SC}/fail-${n}.png` }).catch(() => {}); log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700)); }
    log("errors:", h.errors);
    throw e;
  }
}
const openSheet = async (p) => { const b = p.getByRole("button", { name: /drag up to open/ }); if (await b.count()) await b.first().click(); await sleep(400); };
const num = (s) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
const satsIn = async (loc) => { const t = await loc.first().locator(":scope").getByText(/^[\d,]+ sats$/).first().innerText().catch(() => "0"); return num(t); };
const geo = (c, p) => c.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 10 });
let ok = false;
try {
  const dStart = metersNorth(PICKUP, 800);
  ({ ctx: dctx, page: D } = await h.newContext("driver", dStart));
  ({ ctx: rctx, page: R } = await h.newContext("rider", PICKUP));
  if (STRIKE_RAIL) { await toStrike(dctx); await toStrike(rctx); }
  if (STRIKE_TIP) {
    // api.strike.me goes to the stand-in Strike; the driver's Lightning address (dina@example.com) answers with an invoice for the tip.
    const { invoiceFor } = await import("../../test/helpers/localmint.mjs");
    await toStrike(rctx);
    const cors = { "access-control-allow-origin": "*" };
    await rctx.route(/example\.com\/\.well-known\/lnurlp\//, (r) => r.fulfill({ headers: cors, json: { tag: "payRequest", callback: "https://example.com/lnurl-cb", minSendable: 1000, maxSendable: 100000000000, commentAllowed: 0 } }));
    await rctx.route(/example\.com\/lnurl-cb/, (r) => r.fulfill({ headers: cors, json: { pr: invoiceFor(Number(new URL(r.request().url()).searchParams.get("amount")) / 1000, "tipinvoice") } }));
  }

  await step("driver logs in and goes online", async () => {
    await h.login(D, h.driver, h.driverUrl);
    if (STRIKE_RAIL) {
      // The driver links Strike and chooses to be paid in dollars, BEFORE going online: the offer carries it.
      await D.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
      await D.getByLabel("Strike API key").fill(DRIVER_KEY);
      await D.getByRole("button", { name: "Connect Strike" }).click();
      await D.getByText(/Strike is connected/).waitFor({ timeout: 15000 });
      await D.getByRole("radio", { name: /US dollars/ }).first().click();
      await snap(D, "driver-rail-account");
      await D.locator('nav[aria-label="Main"]').getByText("Drive", { exact: true }).click();
    }
    await D.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
    await D.getByText("You're online").waitFor({ timeout: 15000 });
  });

  if (STRIKE_RAIL) await step("rider links Strike (no ecash is loaded at all)", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await R.getByLabel("Strike API key").fill(strike.apiKey);
    await R.getByRole("button", { name: "Connect Strike" }).click();
    await R.getByText(/Strike is connected/).waitFor({ timeout: 15000 });
    await snap(R, "rider-rail-account");
  });

  if (!STRIKE_RAIL) await step("rider logs in and adds funds with Lightning (ecash from the mint)", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByRole("button", { name: "Show invoice" }).click();
    for (let i = 0; i < 40 && !h.mint.quotes.size; i++) await sleep(250);
    const [id] = [...h.mint.quotes.keys()];
    if (!id) throw new Error("no mint quote was made");
    h.mint.payQuote(id);
    await R.getByText(/added/).waitFor({ timeout: 20000 });
    await R.getByRole("button", { name: "Done" }).click();
    const bal = (await R.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
    log("     rider balance:", bal.slice(0, 80));
    if (!/5,000 sats/.test(bal)) throw new Error("expected 5,000 sats in the ecash wallet: " + bal);
  });

  await step("rider plans a trip and requests (" + (FLAT ? "flat price" : "standard fare") + ")", async () => {
    await R.locator('nav[aria-label="Main"]').getByText("Ride", { exact: true }).click();
    await R.getByRole("button", { name: /Where to\?/ }).click();
    await R.getByLabel("Where to?").waitFor();
    await R.getByLabel("Pickup location").waitFor();
    await pinPickup(R);
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByText("Blue Grass Airport", { exact: false }).first().click({ timeout: 10000 });
    await R.getByText("Standard fare", { exact: true }).waitFor({ timeout: 15000 });
    if (FLAT) await R.getByRole("button", { name: "Flat price" }).click();
    await R.getByRole("button", { name: /Request ride · / }).click({ timeout: 15000 });
    await R.getByText(/Finding your driver/).first().waitFor({ timeout: 15000 });
  });

  await step("driver gets the request and accepts", async () => {
    await D.getByText("New ride request").waitFor({ timeout: 40000 });
    log("     driver card:", (await D.getByText(/Your standard fare|Rider's flat price/).first().innerText()));
    await D.getByRole("button", { name: /^Accept/ }).click();
    await D.getByText(/Waiting for/).first().waitFor({ timeout: 15000 });
  });

  await step("rider chooses the driver and confirms (funds are enough)", async () => {
    await R.getByText(/can take you/).waitFor({ timeout: 40000 });
    const terms = await R.getByText(/Standard fare|Flat price/).first().innerText();
    log("     terms shown:", terms.replace(/\s+/g, " ").slice(0, 120));
    await R.getByRole("button", { name: "Choose" }).click();
    await R.getByText("Confirm your driver").first().waitFor();
    await snap(R, "rider-rail-confirm");
    log("     needed to start:", (await R.getByText("Needed to start").locator("..").innerText()).replace(/\s+/g, " "));
    if (STRIKE_RAIL && !/Your Strike account/.test(await R.locator("body").innerText())) throw new Error("the confirm screen should say the ride is paid from Strike");
    await R.getByRole("button", { name: "Confirm driver" }).click({ timeout: 15000 });
  });

  await step("driver: Arrived is locked until within 50 m", async () => {
    await D.getByText(/Pick up/).first().waitFor({ timeout: 40000 });
    await openSheet(D);
    const btn = D.getByRole("button", { name: "I've arrived" });
    await btn.waitFor();
    if (!(await btn.isDisabled())) throw new Error("the arrived button should be disabled 800 m away");
    log("     reason:", (await D.getByText(/You are \d+ m from the pickup/).first().innerText()));
    await geo(dctx, metersNorth(PICKUP, 30));
    for (let i = 0; i < 40 && (await btn.isDisabled()); i++) await sleep(500);
    if (await btn.isDisabled()) throw new Error("still disabled at 30 m");
    await btn.click();
  });

  let driverCode, riderCode;
  await step("rider checks the car; both type the other's 2-digit code", async () => {
    await R.getByText("Check before you get in").waitFor({ timeout: 40000 });
    await R.getByRole("button", { name: "It matches" }).click();
    const rLabel = await R.getByLabel(/Your code is/).getAttribute("aria-label", { timeout: 15000 });
    riderCode = rLabel.match(/\d\d/)[0];
    const dLabel = await D.getByLabel(/Your code is/).getAttribute("aria-label", { timeout: 15000 });
    driverCode = dLabel.match(/\d\d/)[0];
    log(`     rider code ${riderCode}, driver code ${driverCode}`);
    // A wrong code is refused.
    const wrong = String((Number(driverCode) + 1) % 100).padStart(2, "0");
    await R.locator("#driver-code").fill(wrong);
    await R.getByRole("button", { name: "Confirm", exact: true }).click();
    await R.getByText(/not the code on your driver/).waitFor({ timeout: 5000 });
    await R.locator("#driver-code").fill(driverCode);
    await R.getByRole("button", { name: "Confirm", exact: true }).click();
    await D.getByText("Your rider typed your code.").waitFor({ timeout: 20000 });
    const start = D.getByRole("button", { name: "Start trip" });
    if (!(await start.isDisabled())) throw new Error("Start trip must wait for the driver to type the rider's code");
    await D.locator("#rider-code").fill(riderCode);
    await D.getByRole("button", { name: "Confirm", exact: true }).click();
    for (let i = 0; i < 20 && (await start.isDisabled()); i++) await sleep(300);
    await start.click();
  });

  let startedAt;
  await step("the base rate is paid when the ride starts", async () => {
    startedAt = Date.now();
    await D.getByText(/Drop off at/).first().waitFor({ timeout: 30000 });
    await openSheet(D);
    await D.getByText("Paid by the rider").waitFor({ timeout: 30000 });
    let paid = 0;
    for (let i = 0; i < 40 && !paid; i++) { await sleep(500); paid = await satsIn(D.getByText("Paid by the rider").locator("..")); }
    log("     driver sees paid:", paid, "sats");
    if (paid < 1000) throw new Error("the base tick was not paid/confirmed: " + paid);
  });

  await step("drive ~1.2 miles for 70 s; a minute tick and a mile tick are paid", async () => {
    const steps = 22; const total = 1950; // metres
    for (let i = 1; i <= steps; i++) {
      const p = { lat: PICKUP.lat, lng: PICKUP.lng - (total * i / steps) / 88000 };
      await geo(dctx, p); await geo(rctx, p);
      await sleep(3200);
    }
    const left = 72000 - (Date.now() - startedAt);
    if (left > 0) await sleep(left);
    await sleep(8000);
    await openSheet(R);
    const rFare = await satsIn(R.getByText("Fare so far").locator(".."));
    const rPaid = await satsIn(R.getByText("Paid", { exact: true }).locator(".."));
    const dFare = await satsIn(D.getByText("Fare so far").locator(".."));
    const dPaid = await satsIn(D.getByText("Paid by the rider").locator(".."));
    log(`     rider: fare ${rFare} paid ${rPaid} | driver: fare ${dFare} paid ${dPaid}`);
    log("     rider meter:", (await R.getByText(/mi\b/).first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80));
    if (rFare <= 2300) throw new Error("a minute (and a mile) should be on the fare by now: " + rFare);
    if (dPaid < rPaid - 500) throw new Error("the driver should have confirmed almost all payments");
  });

  await step("rider finishes the ride (confirm dialog) and sees the receipt", async () => {
    await openSheet(R);
    await R.getByRole("button", { name: "Finish ride" }).first().click();
    await R.getByText("Finish this ride?").waitFor();
    await R.getByRole("button", { name: "Finish ride" }).last().click();
    await R.getByText("Ride finished").waitFor({ timeout: 20000 });
    const text = (await R.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     rider receipt:", text);
  });

  if (STRIKE_TIP) await step("rider links Strike and tips the driver from it (cost shown first)", async () => {
    await R.getByRole("button", { name: "Account" }).click();
    await R.getByLabel("Strike API key").fill(strike.apiKey);
    await R.getByRole("button", { name: "Connect Strike" }).click();
    await R.getByText(/Strike is connected/).waitFor({ timeout: 15000 });
    await R.locator('nav[aria-label="Main"]').getByRole("button", { name: "Ride" }).click();
    await R.getByRole("button", { name: /Leave a tip/ }).click({ timeout: 20000 });
    await R.getByRole("button", { name: "$2", exact: true }).click();
    await R.getByRole("button", { name: /with Strike/ }).click();
    await R.getByText(/Strike takes about/).waitFor({ timeout: 15000 });
    if (strike.stats.payments.length) throw new Error("a quote must not send money");
    await R.getByRole("button", { name: "Confirm and pay" }).click();
    await R.getByText(/Tip sent/).first().waitFor({ timeout: 25000 });
    const p = strike.stats.payments;
    if (p.length !== 1 || p[0].sats !== 2000 || p[0].source !== "BTC") throw new Error("Strike should have paid one 2,000 sat tip from Bitcoin: " + JSON.stringify(p));
    log("     Strike paid:", JSON.stringify(p[0]));
  });

  await step("driver sees the summary; payments add up", async () => {
    await D.getByText("Ride finished").waitFor({ timeout: 30000 });
    await sleep(STRIKE_RAIL ? 25000 : 6000); // Strike: the last payment goes request → invoice → payment → confirmation, a few seconds each
    const text = (await D.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     driver summary:", text);
    // A few seconds after the finish both screens must show the same fare and the same paid amount.
    const later = (await R.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     rider receipt, later:", later);
    const sats = (t) => [...t.replace(/\$\d[\d,]*\.\d\d\s*/g, "").matchAll(/([\d,]+) sats/g)].map((m) => m[1]); // drop the "$3.64" in front of "3,635 sats" (styling puts a space or none between them)
    if (sats(text).slice(0, 2).join() !== sats(later).slice(0, 2).join()) throw new Error(`rider and driver disagree: ${sats(later)} vs ${sats(text)}`);
    await D.getByRole("button", { name: "Back to driving" }).click();
    await D.getByRole("button", { name: "Account" }).click();
    await D.getByText("Ecash wallet").waitFor();
    const w = (await D.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
    log("     driver wallet:", w.slice(0, 100));
  });

  if (STRIKE_RAIL) await step("the money moved Strike → Strike: dollars to the driver, nothing through a mint", async () => {
    const dollars = strike.accounts.get(DRIVER_KEY).balances.USD;
    const pays = strike.stats.payments;
    log(`     driver's Strike: $${dollars.toFixed(2)} · rider paid ${pays.length} times from ${[...new Set(pays.map((p) => p.source))].join("/")} · sats ${pays.map((p) => p.sats).join("+")}`);
    if (pays.length < 3) throw new Error("expected a base, a minute and a mile payment at least: " + pays.length);
    if (!(dollars > 3)) throw new Error("the driver's Strike should hold the fare in dollars: " + dollars);
    const sum = pays.reduce((a, p) => a + p.sats, 0);
    if (Math.abs(dollars - (sum / 1e8) * 100000) > 0.05 * pays.length) throw new Error(`dollars and sats disagree: $${dollars} for ${sum} sats`);
    if (strike.accounts.get(DRIVER_KEY).balances.BTC !== 0) throw new Error("the driver chose dollars, so no bitcoin should have arrived");
    if (h.mint.quotes.size || h.mint.stats.melted.length) throw new Error("no mint should have been used at all");
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch (e) {
  log("RUN FAILED");
} finally {
  if (strike) await strike.close();
  await h.stop();
}
process.exit(ok ? 0 : 1);
