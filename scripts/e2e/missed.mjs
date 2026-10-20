// A rider whose wallet runs dry: two missed payments, the driver finishes, the rider refills and pays the rest,
// the driver waives part of the fare and the money goes back. Takes about 6 minutes (the clock is real).
import { boot, sleep, PICKUP, metersNorth } from "./harness.mjs";
import { pinPickup, openFold } from "./flow.mjs";
import { tmpdir } from "node:os";
const SC = tmpdir(); // failure screenshots go here
const h = await boot({ feePpk: 100, driverRates: { base: 0.5, perMile: 0.5, perMinute: 5, currency: "USD" } });
let D, R, dctx, rctx;
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s]`, ...a);
async function step(name, fn) {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 8).join(" | "));
    for (const [n, p] of [["driver", D], ["rider", R]]) if (p) { await p.screenshot({ path: `${SC}/fail-${n}.png` }).catch(() => {}); log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 900)); }
    log("errors:", h.errors);
    throw e;
  }
}
const openSheet = async (p) => { const b = p.getByRole("button", { name: /drag up to open/ }); if (await b.count()) await b.first().click(); await sleep(400); };
// Without Tailwind (its CDN is unreachable in a sandbox) the layout is unstyled and scrolling into view can stall: click by event.
const tap = (loc) => loc.dispatchEvent("click");
const num = (s) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
const satsIn = async (loc) => num(await loc.first().locator(":scope").getByText(/^[\d,]+ sats$/).first().innerText().catch(() => "0"));
const geo = (c, p) => c.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 10 });
const pay = async (id) => { for (let i = 0; i < 40 && ![...h.mint.quotes.values()].some((q) => q.state === "UNPAID"); i++) await sleep(250); for (const [k, q] of h.mint.quotes) if (q.state === "UNPAID") h.mint.payQuote(k); };
let ok = false;
try {
  ({ ctx: dctx, page: D } = await h.newContext("driver", metersNorth(PICKUP, 25)));
  ({ ctx: rctx, page: R } = await h.newContext("rider", PICKUP));
  await step("driver online; rider funds exactly what the start needs ($11)", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await D.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
    await D.getByText("You're online").waitFor({ timeout: 15000 });
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await openFold(R, "Wallets");
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByLabel("Amount to add").fill("11");
    await R.getByRole("button", { name: "Show invoice" }).click();
    await pay();
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
    await R.getByRole("button", { name: "Request ride", exact: true }).click({ timeout: 15000 });
    await D.getByText("New ride request").waitFor({ timeout: 40000 });
    await D.getByRole("button", { name: /^Accept/ }).click();
    await R.getByText(/can take you/).waitFor({ timeout: 40000 });
    await R.getByRole("button", { name: "Choose" }).click();
    log("     needed:", (await R.getByText("Needed to start").locator("..").innerText()).replace(/\s+/g, " "));
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
  });
  const startedAt = Date.now();
  await step("wait for the wallet to run dry and for two missed payments (~4.5 minutes)", async () => {
    await D.getByText(/Drop off at/).first().waitFor({ timeout: 30000 });
    await openSheet(D);
    for (let i = 0; i < 400; i++) {
      if (await D.getByText(/Your rider missed \d+ payments/).count()) break;
      await sleep(1000);
      if (i % 30 === 29) {
        const paid = await satsIn(D.getByText("Paid by the rider").locator("..")), fare = await satsIn(D.getByText("Fare so far").locator(".."));
        log(`     ...driver: fare ${fare} paid ${paid}`);
      }
    }
    const card = await D.getByText(/Your rider missed \d+ payments/).first().innerText();
    log("     driver card:", card, "after", Math.round((Date.now() - startedAt) / 1000), "s");
    await openSheet(R);
    const warn = await R.getByText(/Your ecash wallet is short/).first().innerText();
    log("     rider warning:", warn);
  });
  await step("driver finishes the ride because of the missed payments", async () => {
    await tap(D.getByRole("button", { name: "Finish ride" }).first());
    await D.getByText("Finish the ride?").waitFor();
    await tap(D.getByRole("button", { name: "Finish ride" }).last());
    await D.getByText("Ride finished").waitFor({ timeout: 20000 });
    await sleep(3000);
    log("     driver summary:", (await D.locator("dl").first().innerText()).replace(/\s+/g, " "));
    await R.getByText("Ride finished").waitFor({ timeout: 20000 });
    log("     rider receipt:", (await R.locator("dl").first().innerText()).replace(/\s+/g, " "));
    await R.getByText(/You still owe/).first().waitFor({ timeout: 10000 });
  });
  let owedBefore;
  await step("rider refills the wallet; the app pays everything that was missed", async () => {
    owedBefore = await satsIn(D.getByText("Not paid yet").locator(".."));
    log("     driver: not paid yet:", owedBefore, "sats");
    await tap(R.getByRole("button", { name: /Add funds/ }).first());
    await R.getByLabel("Amount to add").fill("30");
    await R.getByRole("button", { name: "Show invoice" }).click();
    await pay();
    await R.getByText(/added/).waitFor({ timeout: 20000 });
    await tap(R.getByLabel("Add funds").getByRole("button", { name: "Done" }));
    await R.getByText("Paid in full").waitFor({ timeout: 30000 });
    for (let i = 0; i < 30 && (await D.getByText("Not paid yet").count()); i++) await sleep(1000);
    if (await D.getByText("Not paid yet").count()) throw new Error("the driver still sees an unpaid amount");
    log("     driver summary:", (await D.locator("dl").first().innerText()).replace(/\s+/g, " "));
    log("     rider receipt:", (await R.locator("dl").first().innerText()).replace(/\s+/g, " "));
  });
  await step("driver waives the whole fare; the money goes back to the rider", async () => {
    await tap(D.getByText("Waive part of the fare"));
    await tap(D.getByText("The whole fare"));
    await tap(D.getByRole("button", { name: /^Waive (?!part)/ }));
    await D.getByText(/You waived/).waitFor({ timeout: 20000 });
    await R.getByText(/waived part of the fare/).first().waitFor({ timeout: 30000 });
    log("     rider sees:", await R.getByText(/waived part of the fare/).first().innerText());
    await sleep(4000);
    await R.getByRole("button", { name: "Done" }).last().click();
    await R.locator('nav[aria-label="Main"]').getByText("Account", { exact: true }).click();
    await openFold(R, "Wallets");
    const bal = (await R.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
    log("     rider wallet now:", bal.slice(0, 90));
  });
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch (e) { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
