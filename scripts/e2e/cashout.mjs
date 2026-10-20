// Cash out, in the Ride face and with a changed profile, in a real browser:
//   • the Ride face has "Automatically cash out at" and a tap on Cash out (before, only the Drive face had the automatic one)
//   • saving the cash out location on this device pins it: the automatic cash out sends to it, and a tap on Cash out sends to it
//   • the same nsec on another phone changes the profile's address (what a leaked nsec could do): this phone keeps sending to the pinned
//     address, says so, pauses the automatic cash out, and no invoice is ever asked from the new address
//   • "No, put the old one back" restores the profile; a phone with no pin takes the profile's address by itself (nobody is asked) and a tap sends at once
//   • the Cash out button is always there; with no address it says where to set one
// Takes about two minutes.
import { boot, sleep, PICKUP } from "./harness.mjs";
import { tap, makeLog, openFold } from "./flow.mjs";
const { invoiceFor } = await import(new URL("../../test/helpers/localmint.mjs", import.meta.url).pathname);

const h = await boot();
const log = makeLog();
let A, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    if (A) log("phone A page text:", (await A.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 900));
    log("errors:", h.errors);
    throw e;
  }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const GOOD = "me@example.com", EVIL = "thief@evil.test";
const asked = { good: 0, evil: 0 };
// Two Lightning address servers. Every ask for an invoice is counted, so the test can prove the new address was never asked.
const lightningServers = async (ctx) => {
  for (const [host, key] of [["example.com", "good"], ["evil.test", "evil"]]) {
    await ctx.route(new RegExp(host.replace(".", "\\.") + "/\\.well-known/lnurlp/"), (r) => r.fulfill({ json: { tag: "payRequest", callback: `https://${host}/lnurlp/cb`, minSendable: 1000, maxSendable: 100000000000 }, headers: { "access-control-allow-origin": "*" } }));
    await ctx.route(new RegExp(host.replace(".", "\\.") + "/lnurlp/cb"), (r) => {
      asked[key]++;
      const msat = Number(new URL(r.request().url()).searchParams.get("amount"));
      r.fulfill({ json: { pr: invoiceFor(Math.round(msat / 1000), "lnaddr" + key) }, headers: { "access-control-allow-origin": "*" } });
    });
  }
};
const balanceText = async (p) => (await p.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
const balanceSats = async (p) => Number(((await balanceText(p)).match(/([\d,]+) sats/) || [0, "0"])[1].replace(/,/g, ""));
const waitMelted = async (n) => { for (let i = 0; i < 80 && h.mint.stats.melted.length < n; i++) await sleep(250); return h.mint.stats.melted.length >= n; };
const addFunds = async (P) => {
  await P.getByRole("button", { name: /Add funds/ }).first().click();
  await P.getByRole("button", { name: "Show invoice" }).click();
  for (let i = 0; i < 40 && ![...h.mint.quotes.values()].some((q) => q.state === "UNPAID"); i++) await sleep(250);
  for (const [k, q] of h.mint.quotes) if (q.state === "UNPAID") h.mint.payQuote(k);
  await P.getByText(/added/).waitFor({ timeout: 20000 });
  await P.getByRole("button", { name: "Done" }).click();
};
const wallets = async (P) => { await tap(tabs(P).getByText("Account", { exact: true })); await openFold(P, "Wallets"); };
const location = (P) => P.getByLabel("Cash out location (Lightning address)");

try {
  const ctxA = await h.newContext("rider", PICKUP);
  A = ctxA.page;
  await lightningServers(ctxA.ctx);

  await step("Ride face: the automatic cash out box is there, and it waits for a cash out location", async () => {
    await h.login(A, h.rider, h.riderUrl);
    await wallets(A);
    await addFunds(A);
    await A.getByText(/Automatically cash out at: \$/).waitFor({ timeout: 5000 });
    if (!(await A.getByLabel("Automatically cash out at").isDisabled())) throw new Error("the box should wait for a cash out location");
    // The button is always there. With no address it sends nothing and says where to set one.
    await A.getByRole("button", { name: "Cash out", exact: true }).click();
    await A.getByText("Set your cash out location (a Lightning address) below, then tap Cash out.").waitFor({ timeout: 5000 });
    if (h.mint.stats.melted.length) throw new Error("it cashed out with no address");
  });

  await step("saving the location pins it; the automatic cash out then sends to it", async () => {
    await location(A).fill(GOOD);
    await location(A).press("Enter");
    await A.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
    await A.getByText(`Cash outs from this device go to ${GOOD}.`).waitFor({ timeout: 5000 });
    const box = A.getByLabel("Automatically cash out at");
    if (await box.isDisabled()) throw new Error("the box should work now");
    await box.fill("1");
    await box.press("Enter");
    if (!(await waitMelted(1))) throw new Error("no automatic cash out in the Ride face");
    await A.getByText(/^Cashed out /).first().waitFor({ timeout: 15000 });
    if (asked.good < 1 || asked.evil) throw new Error("wrong server asked: " + JSON.stringify(asked));
    await box.fill(""); await box.press("Enter");
    await A.getByText("Automatic cash out is off.").waitFor({ timeout: 5000 });
  });

  await step("a tap on Cash out sends to the pinned address", async () => {
    await addFunds(A);
    const before = h.mint.stats.melted.length;
    await A.getByRole("button", { name: "Cash out", exact: true }).click();
    if (!(await waitMelted(before + 1))) throw new Error("the tap did not cash out");
    await A.getByText(new RegExp(`Sent .* to ${GOOD.replace(".", "\\.")}`)).waitFor({ timeout: 15000 });
  });

  await step("the automatic cash out is set to $1 while the balance is below it: nothing is sent", async () => {
    const before = h.mint.stats.melted.length;
    const box = A.getByLabel("Automatically cash out at");
    await box.fill("1"); await box.press("Enter");
    await sleep(3500);
    if (h.mint.stats.melted.length !== before) throw new Error("it cashed out below the amount");
  });

  // Another phone with the same nsec. It never confirmed any address.
  const ctxB = await h.newContext("rider-b", PICKUP);
  const B = ctxB.page;
  await lightningServers(ctxB.ctx);

  await step("another phone with the same key: it takes the profile's address by itself, nobody is asked", async () => {
    await h.login(B, h.rider, h.riderUrl, { wallet: false });
    await wallets(B);
    for (let i = 0; i < 40 && (await location(B).inputValue()) !== GOOD; i++) await sleep(500);
    await B.getByText(`Cash outs from this device go to ${GOOD}.`).waitFor({ timeout: 5000 });
    if (await B.getByText("Yes, it is mine").count()) throw new Error("the person must not be asked to confirm an address");
  });

  await step("the other phone changes the address (what a leaked nsec could do)", async () => {
    await location(B).fill(EVIL);
    await location(B).press("Enter");
    await B.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
  });

  await step("phone A keeps the pinned address, says the profile changed, and pauses the automatic cash out", async () => {
    // The app looks at its own profile when it comes back to the front (and every 5 minutes).
    for (let i = 0; i < 30; i++) {
      await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      if (await A.getByText("was changed outside this device").count()) break;
      await sleep(1000);
    }
    await A.getByText("was changed outside this device").first().waitFor({ timeout: 5000 });
    const before = h.mint.stats.melted.length;
    await addFunds(A); // the balance is now above the amount: with a changed address nothing may be sent
    await A.getByText("Open Account → Wallets to decide.").waitFor({ timeout: 10000 });
    await sleep(4000);
    if (h.mint.stats.melted.length !== before) throw new Error("the automatic cash out ran with a changed address");
    if (asked.evil) throw new Error("an invoice was asked from the new address");
  });

  await step("a tap on Cash out on phone A still goes to the pinned address", async () => {
    const before = h.mint.stats.melted.length;
    await A.getByRole("button", { name: "Cash out", exact: true }).click();
    if (!(await waitMelted(before + 1))) throw new Error("the tap did not cash out");
    if (asked.evil) throw new Error("an invoice was asked from the new address");
  });

  await step("No, put the old one back: the profile is restored and the box works again", async () => {
    await A.getByRole("button", { name: "No, put the old one back" }).click();
    await A.getByText(`Cash outs from this device go to ${GOOD}.`).waitFor({ timeout: 15000 });
    for (let i = 0; i < 30 && (await location(A).inputValue()) !== GOOD; i++) await sleep(500);
    if ((await location(A).inputValue()) !== GOOD) throw new Error("the profile still says " + (await location(A).inputValue()));
  });

  const ctxC = await h.newContext("rider-c", PICKUP);
  const C = ctxC.page;
  await lightningServers(ctxC.ctx);
  await step("a phone with no pin takes the profile's address; no question, no button to press", async () => {
    await h.login(C, h.rider, h.riderUrl, { wallet: false });
    await wallets(C);
    for (let i = 0; i < 40 && (await location(C).inputValue()) !== GOOD; i++) await sleep(500);
    await C.getByText(`Cash outs from this device go to ${GOOD}.`).waitFor({ timeout: 5000 });
    if (await C.getByText("Yes, it is mine").count()) throw new Error("the person must not be asked to confirm an address");
  });

  await step("a phone that has the wallet but forgot the pin: a tap sends at once, with no dialog", async () => {
    await addFunds(A);
    const pk16 = await A.evaluate(() => Object.keys(localStorage).find((k) => k.startsWith("nostrride_cashoutTo_")));
    await A.evaluate((k) => localStorage.removeItem(k), pk16); // this phone forgets the address (a new phone would never have had it)
    await A.reload();
    await h.login(A, h.rider, h.riderUrl, { wallet: false });
    await wallets(A);
    for (let i = 0; i < 40 && (await location(A).inputValue()) !== GOOD; i++) await sleep(500);
    await A.getByText(`Cash outs from this device go to ${GOOD}.`).waitFor({ timeout: 5000 });
    const before = h.mint.stats.melted.length;
    await A.getByRole("button", { name: "Cash out", exact: true }).click();
    if (await A.getByText("Cash out to this address?").count()) throw new Error("a tap must not ask to confirm the address");
    if (!(await waitMelted(before + 1))) throw new Error("the tap did not send");
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
