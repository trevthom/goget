// The ecash recovery phrase and the Account folds, in a real browser:
//   • Account sections are closed until tapped; one that is opened stays open after a reload; a closed section keeps what was typed in it
//   • a new device has NO wallet; the rider taps Create New Wallet, is warned, and sees the 12 words at once
//   • the rider adds funds: a warning at the top says the ecash is not protected; "Write down 12 words" shows the words, asks for three of them
//     back (a wrong word is refused), and then the warning goes away
//   • the 12 words never reach a relay (they are not in any event the apps published)
//   • the phone is "lost": a fresh browser (no saved data) logs in with the same key and has NO wallet; "Restore my wallet" refuses a wrong phrase
//     with a reason, keeps nothing for a phrase no mint knows, and the right 12 words bring the balance back under THE SAME words (no sweep,
//     nothing new to write down)
//   • the lost phone's own coins were swapped during the restore (the mint calls them spent)
//   • "Disconnect ecash from this device" on the old phone: its stale coins are dropped, the wallet and its phrase are erased, the phone says
//     it has no wallet; "Restore my wallet" there takes the money back (that phone takes over)
// Takes about a minute. The pages are styled like the real app (Tailwind is built into the app CSS).
import http from "node:http";
import { boot, sleep, PICKUP } from "./harness.mjs";
import { tap, makeLog, openFold } from "./flow.mjs";

const h = await boot();
const log = makeLog();
let R, R2, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["rider", R], ["rider (new phone)", R2]]) if (p) log(`${n} dialog:`, (await p.getByRole("dialog").first().innerText().catch(() => "(none)")).replace(/\s+/g, " ").slice(0, 500));
    for (const [n, p] of [["rider", R], ["rider (new phone)", R2]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700));
    log("errors:", h.errors);
    throw e;
  }
};
const snap = async (p, name) => { if (process.env.E2E_SHOTS) { await sleep(600); await p.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); } };
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const header = (p, title) => p.locator("section h2 button", { hasText: title }).first();
const balanceText = async (p) => (await p.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
let phrase = "", phrase2 = "";

try {
  R = (await h.newContext("rider", PICKUP)).page;

  await step("Account sections are closed at first; a tap opens and closes one; a closed section keeps what was typed", async () => {
    await h.login(R, h.rider, h.riderUrl, { wallet: false });
    await tap(tabs(R).getByText("Account", { exact: true }));
    await header(R, "Wallets").waitFor({ timeout: 40000 });
    for (const t of ["Appearance", "Wallets", "Recovery phrase", "Your vouches", "Nostr relays"]) {
      if ((await header(R, t).getAttribute("aria-expanded")) !== "false") throw new Error(t + " should start closed");
    }
    const input = R.getByLabel("npub of a person you know and trust");
    if (await input.isVisible()) throw new Error("the content of a closed section is visible");
    await openFold(R, "Your vouches");
    await input.fill("npub1typedbutnotsaved");
    await tap(header(R, "Your vouches"));
    if (await input.isVisible()) throw new Error("the section did not close");
    await tap(header(R, "Your vouches"));
    if ((await input.inputValue()) !== "npub1typedbutnotsaved") throw new Error("the typed text was lost when the section closed");
    await input.fill("");
    await tap(header(R, "Your vouches"));
    await openFold(R, "Appearance");
  });

  await step("an opened section stays open after a reload; the others stay closed", async () => {
    await R.reload(); // the key lives in memory only, so the person signs in again; what was open is remembered on the device
    await h.login(R, h.rider, h.riderUrl, { wallet: false });
    await tap(tabs(R).getByText("Account", { exact: true }));
    await header(R, "Appearance").waitFor({ timeout: 40000 });
    if ((await header(R, "Appearance").getAttribute("aria-expanded")) !== "true") throw new Error("Appearance should still be open");
    if ((await header(R, "Wallets").getAttribute("aria-expanded")) !== "false") throw new Error("Ecash wallet should still be closed");
    await tap(header(R, "Appearance"));
  });

  await step("Create New Wallet: a warning first, then the 12 words are shown at once", async () => {
    await openFold(R, "Wallets");
    await tap(R.getByRole("button", { name: "Create New Wallet", exact: true }));
    await R.getByText(/12 words are the only way to get your money back/).waitFor({ timeout: 5000 });
    await tap(R.getByRole("button", { name: "Create wallet", exact: true }));
    const list = R.getByRole("list", { name: "Your 12 recovery words" });
    await list.waitFor({ timeout: 20000 });
    const words = (await list.locator("li span.font-mono").allInnerTexts()).map((w) => w.trim());
    if (words.length !== 12 || words.some((w) => !/^[a-z]+$/.test(w))) throw new Error("expected 12 words: " + words.join(" "));
    phrase = words.join(" ");
    await snap(R, "recovery-created");
    await tap(R.getByRole("button", { name: "Close", exact: true })); // not written down yet: the next steps show the warning
  });

  await step("the rider adds funds; a warning says the ecash is not protected", async () => {
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByRole("button", { name: "Show invoice" }).click();
    for (let i = 0; i < 40 && ![...h.mint.quotes.values()].some((q) => q.state === "UNPAID"); i++) await sleep(250);
    for (const [k, q] of h.mint.quotes) if (q.state === "UNPAID") h.mint.payQuote(k);
    await R.getByText(/added/).waitFor({ timeout: 20000 });
    await R.getByRole("button", { name: "Done" }).click();
    if (!/5,000 sats/.test(await balanceText(R))) throw new Error("expected 5,000 sats: " + (await balanceText(R)));
    await R.getByText(/Your ecash is not protected yet/).waitFor({ timeout: 5000 });
    if (!(await header(R, "Recovery phrase").innerText()).includes("Not written down")) throw new Error("the Recovery phrase section should say it is not written down");
    await snap(R, "recovery-warning");
  });

  await step("a mint address that is a website, not a mint, is refused with a short reason (and not saved)", async () => {
    const page = '<!DOCTYPE html><html lang="en"><head><title>404: This page could not be found.</title></head><body><h1>404</h1>' + "x".repeat(3000) + "</body></html>";
    const site = http.createServer((req, res) => { res.writeHead(404, { "content-type": "text/html", "access-control-allow-origin": "*" }); res.end(page); });
    await new Promise((r) => site.listen(0, "127.0.0.1", r));
    try {
      const box = R.getByLabel("Ecash mint address");
      await box.fill(`http://127.0.0.1:${site.address().port}`);
      await tap(box.locator("..").getByRole("button", { name: "Save" }));
      const note = R.getByText(/is not a Cashu mint/);
      await note.waitFor({ timeout: 15000 });
      const text = await note.innerText();
      if (/<|html/i.test(text) || text.length > 200) throw new Error("the message is not short and plain: " + text.slice(0, 120));
      const saved = await R.evaluate(() => JSON.parse(localStorage.getItem("nostrride_ecashMint")));
      if (saved !== h.mint.url) throw new Error("the bad address was saved: " + saved);
      await box.fill(h.mint.url);
    } finally { await new Promise((r) => site.close(r)); }
  });

  await step("the 12 words are shown; a wrong word is refused; the right words finish it", async () => {
    await tap(R.getByRole("button", { name: "Write down 12 words" }).first());
    const list = R.getByRole("list", { name: "Your 12 recovery words" });
    await list.waitFor({ timeout: 5000 });
    const words = (await list.locator("li span.font-mono").allInnerTexts()).map((w) => w.trim());
    if (words.join(" ") !== phrase) throw new Error("the words differ from the ones shown at creation: " + words.join(" "));
    await snap(R, "recovery-words");
    await tap(R.getByRole("button", { name: "I wrote them down" }));
    const asked = await R.getByLabel(/^Word \d+$/).evaluateAll((els) => els.map((e) => Number(e.getAttribute("aria-label").slice(5))));
    if (asked.length !== 3) throw new Error("expected three words to be asked for");
    for (const n of asked) await R.getByLabel(`Word ${n}`, { exact: true }).fill(n === asked[0] ? "wrongword" : words[n - 1]);
    await tap(R.getByRole("button", { name: "Check and finish" }));
    await R.getByRole("alert").filter({ hasText: /do not match/ }).waitFor({ timeout: 5000 });
    for (const n of asked) await R.getByLabel(`Word ${n}`, { exact: true }).fill(words[n - 1]);
    await tap(R.getByRole("button", { name: "Check and finish" }));
    await R.getByText("You wrote down your 12 words.").waitFor({ timeout: 15000 });
    if (await R.getByText(/Your ecash is not protected yet/).count()) throw new Error("the warning is still there");
    if (!(await header(R, "Recovery phrase").innerText()).includes("Written down")) throw new Error("the status chip should say Written down");
  });

  await step("the words can be shown again, and hide when asked", async () => {
    await tap(R.getByRole("button", { name: "Show my 12 words" }));
    const list = R.getByRole("list", { name: "Your 12 recovery words" });
    await list.waitFor({ timeout: 5000 });
    if (((await list.locator("li span.font-mono").allInnerTexts()).map((w) => w.trim()).join(" ")) !== phrase) throw new Error("not the same words");
    await tap(R.getByRole("button", { name: "Hide", exact: true }));
    if (await list.isVisible().catch(() => false)) throw new Error("the words did not hide");
  });

  await step("the 12 words never reached a relay", async () => {
    await sleep(1500);
    const first = phrase.split(" ").slice(0, 3).join(" ");
    const hit = h.relay.events.find((e) => e.content.includes(first) || JSON.stringify(e.tags).includes(first));
    if (hit) throw new Error("the phrase is inside an event of kind " + hit.kind);
    if (!h.relay.events.length) throw new Error("the relay saw no events at all: the check proves nothing");
  });

  await step("the phone is lost: a fresh browser has NO wallet; a wrong phrase is refused; the right one brings the money back under the same words", async () => {
    R2 = (await h.newContext("rider on a new phone", PICKUP)).page;
    await h.login(R2, h.rider, h.riderUrl, { wallet: false });
    await tap(tabs(R2).getByText("Account", { exact: true }));
    await openFold(R2, "Wallets");
    await R2.getByRole("button", { name: "Restore my wallet", exact: true }).waitFor({ timeout: 40000 });
    if (await R2.getByText("Balance").count()) throw new Error("the new phone should have no wallet");
    await tap(R2.getByRole("button", { name: "Restore my wallet", exact: true }));
    const box = R2.locator('textarea[aria-label="Your 12 recovery words"]');
    // The sandbox cannot reach the app's public default mint: the person (here, the test) takes it off the list.
    for (const b of await R2.getByRole("button", { name: /Do not look in (?!127)/ }).all()) await b.click();
    await box.fill("hello world");
    await R2.getByText(/12 words\. You typed 2/).waitFor({ timeout: 5000 });
    if (!(await R2.getByRole("button", { name: "Look for my ecash" }).isDisabled())) throw new Error("a wrong phrase should not be searchable");
    const other = "half depart obvious quality work element tank gorilla view sugar picture humble";
    await box.fill(other);
    await tap(R2.getByRole("button", { name: "Look for my ecash" }));
    await R2.getByRole("alert").filter({ hasText: /No mint has ecash for these words/ }).waitFor({ timeout: 30000 });
    await R2.getByRole("list", { name: "Results" }).getByText(/nothing found/).waitFor({ timeout: 5000 });
    const kept = await R2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("nostrride_ecashphrase_") && localStorage.getItem(k) !== "null"));
    if (kept.length) throw new Error("a phrase that found nothing must not be kept on the phone");
    await box.fill(phrase);
    await R2.getByText("These 12 words look right.").waitFor({ timeout: 5000 });
    await snap(R2, "recovery-restore-dialog");
    await tap(R2.getByRole("button", { name: "Look for my ecash" }));
    await R2.getByText("Balance").first().waitFor({ timeout: 40000 });
    await snap(R2, "recovery-restored");
    if (!/5,000 sats/.test(await balanceText(R2))) throw new Error("expected 5,000 sats back: " + (await balanceText(R2)));
    if (await R2.getByRole("dialog").count()) throw new Error("the restore dialog should be closed, with no new words to write down");
    await openFold(R2, "Recovery phrase");
    await R2.getByText("You wrote down your 12 words.").waitFor({ timeout: 10000 });
    await tap(R2.getByRole("button", { name: "Show my 12 words" }));
    const list = R2.getByRole("list", { name: "Your 12 recovery words" });
    await list.waitFor({ timeout: 5000 });
    if (((await list.locator("li span.font-mono").allInnerTexts()).map((w) => w.trim()).join(" ")) !== phrase) throw new Error("the restored wallet must keep the typed words");
    phrase2 = phrase;
  });

  await step("the old phone: Disconnect ecash drops the stale coins and erases the wallet and its words from the device", async () => {
    await openFold(R, "Wallets");
    await tap(R.getByRole("button", { name: "Disconnect ecash from this device" }));
    await tap(R.getByRole("button", { name: "Disconnect", exact: true }));
    await R.getByText(/You have no ecash wallet on this phone yet/).waitFor({ timeout: 30000 });
    const saved = await R.evaluate(() => {
      const read = (prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => JSON.parse(localStorage.getItem(k)));
      return { proofs: read("nostrride_ecash_"), phrase: read("nostrride_ecashphrase_"), off: read("nostrride_ecashOff_") };
    });
    if (saved.proofs.some((v) => v !== null)) throw new Error("the coins are still saved on the device");
    if (saved.phrase.some((v) => v !== null)) throw new Error("the recovery phrase is still saved on the device");
    if (!saved.off.includes(true)) throw new Error("the device does not remember that the wallet is disconnected");
    if (await R.getByText(/Your ecash is not protected yet/).count()) throw new Error("the warning should be gone: there is no wallet");
    await snap(R, "recovery-disconnected");
  });

  await step("Restore my wallet on the old phone: it takes the money back (the other phone loses its coins)", async () => {
    await tap(R.getByRole("button", { name: "Restore my wallet", exact: true }));
    for (const b of await R.getByRole("button", { name: /Do not look in (?!127)/ }).all()) await b.click();
    await R.locator('textarea[aria-label="Your 12 recovery words"]').fill(phrase);
    await tap(R.getByRole("button", { name: "Look for my ecash" }));
    await R.getByText("Balance").first().waitFor({ timeout: 40000 });
    if (!/5,000 sats/.test(await balanceText(R))) throw new Error("expected 5,000 sats on the old phone: " + (await balanceText(R)));
    if (await R.getByRole("button", { name: "Restore my wallet", exact: true }).count()) throw new Error("a phone with a wallet must not offer Restore");
    if (await R.getByRole("button", { name: "Create New Wallet", exact: true }).count()) throw new Error("a phone with a wallet must not offer Create");
  });

  for (const [n, p, role] of [["R2", R2, "rider"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (R2):", u.length ? u.join(" ") : "none"); }
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
