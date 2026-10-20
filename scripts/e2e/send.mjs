// Sending ecash to another wallet, and "Automatically cash out at", in a real browser:
//   • a rider makes an ecash token (Send → Ecash token); "Take it back" returns the money when nobody has taken the token
//   • the driver adds that token ("Add ecash you were sent"): the money moved to a second wallet
//   • the driver sets "Automatically cash out at: $5": nothing happens below it; at $1 the app cashes out by itself, to the cash out location
//   • the rider pays a Lightning invoice, and a Lightning address with an amount, from the ecash; an invoice that is too big is refused
//   • the cash out location is NOT required to drive (a driver without one can still go online)
// Takes about a minute. The pages are styled like the real app (Tailwind is built into the app CSS).
import { boot, sleep, PICKUP, metersNorth } from "./harness.mjs";
import { tap, makeLog, openFold } from "./flow.mjs";
const { invoiceFor } = await import(new URL("../../test/helpers/localmint.mjs", import.meta.url).pathname);

const h = await boot();
const log = makeLog();
let R, D, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["rider", R], ["driver", D]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700));
    log("errors:", h.errors);
    throw e;
  }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const balanceText = async (p) => (await p.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
const balanceSats = async (p) => Number(((await balanceText(p)).match(/([\d,]+) sats/) || [0, "0"])[1].replace(/,/g, ""));
// A Lightning address "dina@example.com": its server hands out an invoice for the asked amount.
const lightningServer = async (ctx) => {
  await ctx.route(/example\.com\/\.well-known\/lnurlp\//, (r) => r.fulfill({ json: { tag: "payRequest", callback: "https://example.com/lnurlp/cb", minSendable: 1000, maxSendable: 100000000000 }, headers: { "access-control-allow-origin": "*" } }));
  await ctx.route(/example\.com\/lnurlp\/cb/, (r) => {
    const msat = Number(new URL(r.request().url()).searchParams.get("amount"));
    r.fulfill({ json: { pr: invoiceFor(Math.round(msat / 1000), "lnaddr") }, headers: { "access-control-allow-origin": "*" } });
  });
};
const modal = (p) => p.getByRole("dialog");
const waitMelted = async (n) => { for (let i = 0; i < 80 && h.mint.stats.melted.length < n; i++) await sleep(250); return h.mint.stats.melted.length >= n; };

try {
  const rc = await h.newContext("rider", PICKUP);
  const dc = await h.newContext("driver", metersNorth(PICKUP, 25));
  R = rc.page; D = dc.page;
  await lightningServer(rc.ctx); await lightningServer(dc.ctx);

  await step("the rider adds funds", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await tap(tabs(R).getByText("Account", { exact: true }));
    await openFold(R, "Wallets");
    if (!(await R.getByRole("button", { name: "Send", exact: true }).isDisabled())) throw new Error("Send should be switched off with an empty wallet");
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByRole("button", { name: "Show invoice" }).click();
    for (let i = 0; i < 40 && ![...h.mint.quotes.values()].some((q) => q.state === "UNPAID"); i++) await sleep(250);
    for (const [k, q] of h.mint.quotes) if (q.state === "UNPAID") h.mint.payQuote(k);
    await R.getByText(/added/).waitFor({ timeout: 20000 });
    await R.getByRole("button", { name: "Done" }).click();
    if ((await balanceSats(R)) !== 5000) throw new Error("expected 5,000 sats: " + (await balanceText(R)));
  });

  await step("a token nobody took can be taken back", async () => {
    await R.getByRole("button", { name: "Send", exact: true }).click();
    await R.getByLabel("Amount to send").fill("1");
    await modal(R).getByRole("button", { name: "Make token" }).click();
    await R.getByTestId("ecash-token").waitFor({ timeout: 15000 });
    if (!/^cashuB/.test(await R.getByTestId("ecash-token").innerText())) throw new Error("not a cashu token");
    await modal(R).getByRole("button", { name: "Take it back" }).click();
    await R.getByText(/Nobody had taken it/).waitFor({ timeout: 15000 });
    await modal(R).getByRole("button", { name: "Done" }).click();
    if ((await balanceSats(R)) !== 5000) throw new Error("the money did not come back: " + (await balanceText(R)));
  });

  let token = "";
  await step("the rider makes a $2 token for another wallet", async () => {
    await R.getByRole("button", { name: "Send", exact: true }).click();
    await R.getByLabel("Amount to send").fill("2");
    await modal(R).getByRole("button", { name: "Make token" }).click();
    await R.getByTestId("ecash-token").waitFor({ timeout: 15000 });
    token = (await R.getByTestId("ecash-token").innerText()).trim();
    await modal(R).getByRole("button", { name: "Done" }).click();
    const left = await balanceSats(R);
    if (left !== 3000) throw new Error("expected 3,000 sats left: " + left);
  });

  await step("the driver adds the token to a second wallet", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await tap(tabs(D).getByText("Account", { exact: true }));
    await openFold(D, "Wallets");
    await D.getByLabel("Ecash token").fill(token);
    await tap(D.getByRole("button", { name: "Add", exact: true }));
    await D.getByText(/^Added /).waitFor({ timeout: 20000 });
    if ((await balanceSats(D)) < 1990) throw new Error("the driver has no money: " + (await balanceText(D)));
  });

  await step("automatic cash out: nothing below the amount; at the amount the app cashes out by itself", async () => {
    const field = D.getByLabel("Automatically cash out at");
    await D.getByText(/Automatically cash out at: \$/).waitFor({ timeout: 5000 });
    await field.fill("5");
    await field.press("Enter");
    await D.getByText("Saved.").waitFor({ timeout: 5000 });
    await sleep(3500);
    if (h.mint.stats.melted.length) throw new Error("it cashed out below the amount");
    await field.fill("1");
    await field.press("Enter");
    if (!(await waitMelted(1))) throw new Error("no automatic cash out");
    await D.getByText(/^Cashed out /).first().waitFor({ timeout: 15000 });
    if ((await balanceSats(D)) > 60) throw new Error("the balance should be dust now: " + (await balanceText(D)));
    log("     melted:", h.mint.stats.melted.join(","));
  });

  await step("the setting is kept after a reload; an empty field turns it off", async () => {
    await D.reload();
    await h.login(D, h.driver, h.driverUrl, { wallet: false }); // the wallet is already on this phone
    await tap(tabs(D).getByText("Account", { exact: true }));
    await openFold(D, "Wallets");
    if ((await D.getByLabel("Automatically cash out at").inputValue()) !== "1") throw new Error("not kept");
    await D.getByLabel("Automatically cash out at").fill("");
    await D.getByLabel("Automatically cash out at").press("Enter");
    await D.getByText("Automatic cash out is off.").waitFor({ timeout: 5000 });
  });

  await step("the rider pays a Lightning invoice from the ecash", async () => {
    const before = h.mint.stats.melted.length;
    await R.getByRole("button", { name: "Send", exact: true }).click();
    await modal(R).getByRole("button", { name: "Lightning", exact: true }).click();
    await R.getByLabel("Lightning invoice or address").fill(invoiceFor(300, "other"));
    await modal(R).getByRole("button", { name: "Send", exact: true }).click();
    await R.getByText(/^Sent /).waitFor({ timeout: 20000 });
    if (h.mint.stats.melted.length !== before + 1 || h.mint.stats.melted.at(-1) !== 300) throw new Error("wrong payment: " + h.mint.stats.melted);
    await modal(R).getByRole("button", { name: "Done" }).click();
    if ((await balanceSats(R)) !== 2700) throw new Error("expected 2,700 sats: " + (await balanceText(R)));
  });

  await step("the rider pays a Lightning address with an amount; an invoice that is too big is refused", async () => {
    await R.getByRole("button", { name: "Send", exact: true }).click();
    await modal(R).getByRole("button", { name: "Lightning", exact: true }).click();
    await R.getByLabel("Lightning invoice or address").fill("dina@example.com");
    await R.getByLabel("Amount to send").fill("1");
    await modal(R).getByRole("button", { name: "Send", exact: true }).click();
    await R.getByText(/^Sent /).waitFor({ timeout: 20000 });
    if (h.mint.stats.melted.at(-1) !== 1000) throw new Error("wrong payment: " + h.mint.stats.melted);
    await modal(R).getByRole("button", { name: "Done" }).click();
    await R.getByRole("button", { name: "Send", exact: true }).click();
    await modal(R).getByRole("button", { name: "Lightning", exact: true }).click();
    await R.getByLabel("Lightning invoice or address").fill(invoiceFor(90000, "huge"));
    await modal(R).getByRole("button", { name: "Send", exact: true }).click();
    await R.getByText(/Not enough ecash/).waitFor({ timeout: 15000 });
    await modal(R).getByRole("button", { name: "Close" }).click();
  });

  await step("a driver with no cash out location can still go online", async () => {
    const kp = h.newKeys();
    h.seedDriver(kp, { name: "No Lightning", lud16: "" });
    const c = await h.newContext("driver2", metersNorth(PICKUP, 50));
    await h.login(c.page, kp, h.driverUrl);
    await c.page.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
    await c.page.getByText("You're online").waitFor({ timeout: 15000 });
    await tap(tabs(c.page).getByText("Account", { exact: true }));
    await openFold(c.page, "Wallets");
    if (await c.page.getByLabel("Cash out location (Lightning address)").inputValue()) throw new Error("this driver should have no cash out location");
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
