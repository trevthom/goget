import { boot, sleep, PICKUP, DEST, metersNorth } from "./harness.mjs";
import { tmpdir } from "node:os";
const SC = tmpdir(); // failure screenshots go here
const FLAT = process.env.FLAT === "1";
const h = await boot({ feePpk: 100 });
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

  await step("driver logs in and goes online", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await D.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
    await D.getByText("You're online").waitFor({ timeout: 15000 });
  });

  await step("rider logs in and adds funds with Lightning (ecash from the mint)", async () => {
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
    for (let i = 0; i < 40 && !(await R.getByLabel("Pickup location").inputValue()); i++) await sleep(250);
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
    log("     needed to start:", (await R.getByText("Needed to start").locator("..").innerText()).replace(/\s+/g, " "));
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

  await step("driver sees the summary; payments add up", async () => {
    await D.getByText("Ride finished").waitFor({ timeout: 30000 });
    await sleep(6000);
    const text = (await D.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     driver summary:", text);
    // A few seconds after the finish both screens must show the same fare and the same paid amount.
    const later = (await R.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     rider receipt, later:", later);
    const sats = (t) => [...t.matchAll(/([\d,]+) sats/g)].map((m) => m[1]);
    if (sats(text).slice(0, 2).join() !== sats(later).slice(0, 2).join()) throw new Error(`rider and driver disagree: ${sats(later)} vs ${sats(text)}`);
    await D.getByRole("button", { name: "Back to driving" }).click();
    await D.getByRole("button", { name: "Account" }).click();
    await D.getByText("Ecash wallet").waitFor();
    const w = (await D.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
    log("     driver wallet:", w.slice(0, 100));
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch (e) {
  log("RUN FAILED");
} finally {
  await h.stop();
}
process.exit(ok ? 0 : 1);
