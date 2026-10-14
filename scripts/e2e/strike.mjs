// Strike in the browser: the RIDER links a Strike account and adds funds from the US dollar balance and then from the Bitcoin balance
// (the cost is shown, and nothing is sent until "Confirm and pay"); the DRIVER links Strike and cashes out into it as US dollars and
// then as Bitcoin. Strike is a stand-in server (test/helpers/localstrike.mjs); api.strike.me requests are routed to it.
// Run: node scripts/e2e/strike.mjs   (see README.md in this folder for the set-up)
import { boot, sleep } from "./harness.mjs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const { startLocalStrike } = await import(`${REPO}/test/helpers/localstrike.mjs`);
const SC = tmpdir();
const h = await boot();
const strike = await startLocalStrike({ usdPerBtc: 100000, balances: { BTC: 0.01, USD: 500 } });
// When Strike pays a mint's funding invoice, the mint sees it as paid.
strike.onPay = (invoice) => { for (const q of h.mint.quotes.values()) if (q.request === invoice) h.mint.payQuote(q.quote); };
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s]`, ...a);
let D, R;
async function step(name, fn) {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 8).join(" | "));
    for (const [n, p] of [["driver", D], ["rider", R]]) if (p) { await p.screenshot({ path: `${SC}/fail-strike-${n}.png` }).catch(() => {}); log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700)); }
    log("errors:", h.errors);
    throw e;
  }
}
const toStrike = (ctx) => ctx.route(/api\.strike\.me/, async (r) => {
  const u = new URL(r.request().url());
  await r.fulfill({ response: await r.fetch({ url: strike.url + u.pathname + u.search }) });
});
// With E2E_SHOTS=/some/dir the run also saves screenshots of the new screens.
const snap = async (p, name) => { if (process.env.E2E_SHOTS) { await sleep(600); await p.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); } };
const text = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function connect(P) {
  await P.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
  await P.getByLabel("Strike API key").fill(strike.apiKey);
  await P.getByRole("button", { name: "Connect Strike" }).click();
  await P.getByText(/Strike is connected/).waitFor({ timeout: 15000 });
}
// Add funds in the driver app by paying the mint's invoice by hand.
async function addFundsByInvoice(P) {
  const before = h.mint.quotes.size;
  await P.getByRole("button", { name: /Add funds/ }).first().click();
  await P.getByRole("button", { name: "Show invoice" }).click();
  for (let i = 0; i < 40 && h.mint.quotes.size === before; i++) await sleep(250);
  h.mint.payQuote([...h.mint.quotes.keys()].pop());
  await P.getByText(/added/).waitFor({ timeout: 20000 });
  await P.getByRole("button", { name: "Done" }).click();
}
let ok = false;
try {
  let pos = { lat: 38.0406, lng: -84.5037 };
  ({ page: R } = await h.newContext("rider", pos).then(async (c) => { await toStrike(c.ctx); return c; }));
  ({ page: D } = await h.newContext("driver", pos).then(async (c) => { await toStrike(c.ctx); return c; }));

  await step("rider: a wrong key is refused; the right key links Strike", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await R.getByLabel("Strike API key").fill("not-the-right-key-at-all");
    await R.getByRole("button", { name: "Connect Strike" }).click();
    await R.getByText(/did not accept this API key/).waitFor({ timeout: 15000 });
    await R.getByLabel("Strike API key").fill(strike.apiKey);
    await R.getByRole("button", { name: "Connect Strike" }).click();
    await R.getByText(/Strike is connected/).waitFor({ timeout: 15000 });
    const t = await text(R);
    expect(/Pay with/.test(t) && /US dollars/.test(t), "the rider should choose a balance: " + t.slice(0, 300));
    expect(/500\.00/.test(t) || /\$500/.test(t), "the dollar balance should show: " + t.slice(0, 400));
    await snap(R, "rider-strike-account");
  });

  await step("rider: pays from US dollars; the cost is shown first and nothing is sent until Confirm", async () => {
    await R.getByRole("radio", { name: /US dollars/ }).first().click();
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByRole("button", { name: /Pay with Strike/ }).click();
    await R.getByText(/Strike takes about/).waitFor({ timeout: 15000 });
    const t = await text(R);
    expect(/\$5\.03/.test(t), "5,000 sats at $100,000 plus the fee and spread is $5.03: " + t.slice(0, 400));
    await snap(R, "rider-strike-quote");
    await sleep(500);
    expect(strike.stats.payments.length === 0, "a quote must not send money");
    await R.getByRole("button", { name: "Confirm and pay" }).click();
    await R.getByText(/added/).waitFor({ timeout: 25000 });
    await R.getByRole("button", { name: "Done" }).click();
    expect(strike.stats.payments.length === 1 && strike.stats.payments[0].source === "USD", "Strike should have paid from dollars: " + JSON.stringify(strike.stats.payments));
    expect(/5,000 sats/.test(await text(R)), "5,000 sats of ecash should be in the wallet");
  });

  await step("rider: switches to the Bitcoin balance inside the payment panel", async () => {
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByRole("button", { name: /Pay with Strike/ }).click();
    await R.getByText(/Strike takes about/).waitFor({ timeout: 15000 });
    await R.getByRole("dialog").getByRole("radio", { name: /Bitcoin/ }).click();
    await R.getByText(/from your Bitcoin balance/).waitFor({ timeout: 15000 });
    await R.getByRole("button", { name: "Confirm and pay" }).click();
    await R.getByText(/added/).waitFor({ timeout: 25000 });
    await R.getByRole("button", { name: "Done" }).click();
    expect(strike.stats.payments.length === 2 && strike.stats.payments[1].source === "BTC", "the second payment should come from Bitcoin: " + JSON.stringify(strike.stats.payments));
    expect(/10,000 sats/.test(await text(R)), "10,000 sats of ecash should be in the wallet");
  });

  await step("rider: the key is saved only encrypted, and Strike is linked again after a reload and login", async () => {
    const stored = await R.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    expect(!stored.includes(strike.apiKey), "the API key must not be saved in the clear");
    expect(/nostrride_strike_/.test(stored), "an encrypted copy should be saved");
    await R.reload();
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await R.getByText(/Strike is connected/).waitFor({ timeout: 15000 });
    expect(/US dollars/.test(await text(R)), "the choice of balance should be remembered");
    await R.getByRole("button", { name: "Disconnect Strike" }).click();
    await R.getByLabel("Strike API key").waitFor({ timeout: 5000 });
    const after = await R.evaluate(() => JSON.stringify(Object.entries(localStorage)));
    expect(!/nostrride_strike_"?,?"?[A-Za-z0-9+/=]{20,}/.test(after.replace(/"nostrride_strike_[0-9a-f]+","null"/, "")), "Disconnect should erase the saved key");
  });

  await step("driver: links Strike and chooses to receive US dollars", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await connect(D);
    await D.getByRole("radio", { name: /US dollars/ }).first().click();
    expect((await D.getByRole("radio", { name: /US dollars/ }).first().getAttribute("aria-checked")) === "true", "US dollars should be chosen");
    await snap(D, "driver-strike-account");
  });

  await step("driver: cashes out into Strike as US dollars", async () => {
    await addFundsByInvoice(D);
    await D.getByRole("button", { name: "Cash out to Strike" }).first().click();
    await D.getByRole("dialog", { name: "Cash out to Strike?" }).waitFor({ timeout: 10000 });
    await snap(D, "driver-strike-cashout");
    const t = await text(D);
    expect(/about \$/.test(t), "the dialog should estimate the dollars: " + t.slice(0, 400));
    await D.getByRole("dialog").getByRole("button", { name: "Cash out", exact: true }).click();
    await D.getByText(/Strike received \$/).waitFor({ timeout: 30000 });
    const inv = strike.stats.invoices.at(-1);
    expect(inv.amount.currency === "USD", "the invoice should be in dollars: " + JSON.stringify(inv));
    expect(h.mint.stats.melted.length === 1, "the mint should have paid one invoice");
    log("     invoice:", JSON.stringify(inv.amount), "mint paid", h.mint.stats.melted[0], "sats");
  });

  await step("driver: switches to Bitcoin and cashes out again", async () => {
    await D.getByRole("radio", { name: /Bitcoin/ }).first().click();
    await addFundsByInvoice(D);
    await D.getByRole("button", { name: "Cash out to Strike" }).first().click();
    await D.getByRole("dialog", { name: "Cash out to Strike?" }).getByRole("button", { name: "Cash out", exact: true }).click();
    await D.getByText(/Strike received [\d,]+ sats/).waitFor({ timeout: 30000 });
    const inv = strike.stats.invoices.at(-1);
    expect(inv.amount.currency === "BTC", "the invoice should be in bitcoin: " + JSON.stringify(inv));
    expect(h.mint.stats.melted.length === 2 && Number(h.mint.stats.melted[1]) === Math.round(Number(inv.amount.amount) * 1e8), "the mint paid exactly what Strike asked for");
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch (e) {
  log("RUN FAILED");
} finally {
  await strike.close();
  await h.stop();
}
process.exit(ok ? 0 : 1);
