// The ecash recovery phrase and the Account folds, in a real browser:
//   • Account sections are closed until tapped; one that is opened stays open after a reload; a closed section keeps what was typed in it
//   • a rider adds funds: a warning at the top says the ecash is not protected; "Write down 12 words" shows the words, asks for three of them
//     back (a wrong word is refused), and then the warning goes away
//   • the 12 words never reach a relay (they are not in any event the apps published)
//   • the phone is "lost": a fresh browser (no saved data) logs in with the same key, the wallet is empty, the 12 words typed into
//     "Restore ecash" bring the balance back; a wrong phrase is refused with a reason
//   • the lost phone's own coins were swapped during the restore (the mint calls them spent)
// Takes about a minute. With E2E_TAILWIND set (see README.md) the pages are styled like the real app.
import { boot, sleep, PICKUP } from "./harness.mjs";
import { tap, makeLog, openFold } from "./flow.mjs";

const h = await boot();
const log = makeLog();
let R, R2, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["rider", R], ["rider (new phone)", R2]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700));
    log("errors:", h.errors);
    throw e;
  }
};
const snap = async (p, name) => { if (process.env.E2E_SHOTS) { await sleep(600); await p.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); } };
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const header = (p, title) => p.locator("section h2 button", { hasText: title }).first();
const balanceText = async (p) => (await p.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
let phrase = "";

try {
  R = (await h.newContext("rider", PICKUP)).page;

  await step("Account sections are closed at first; a tap opens and closes one; a closed section keeps what was typed", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await tap(tabs(R).getByText("Account", { exact: true }));
    await header(R, "Ecash wallet").waitFor({ timeout: 40000 });
    for (const t of ["Currency", "Ecash wallet", "Recovery phrase", "Your vouches", "Nostr relays"]) {
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
    await openFold(R, "Currency");
  });

  await step("an opened section stays open after a reload; the others stay closed", async () => {
    await R.reload(); // the key lives in memory only, so the person signs in again; what was open is remembered on the device
    await h.login(R, h.rider, h.riderUrl);
    await tap(tabs(R).getByText("Account", { exact: true }));
    await header(R, "Currency").waitFor({ timeout: 40000 });
    if ((await header(R, "Currency").getAttribute("aria-expanded")) !== "true") throw new Error("Currency should still be open");
    if ((await header(R, "Ecash wallet").getAttribute("aria-expanded")) !== "false") throw new Error("Ecash wallet should still be closed");
    await tap(header(R, "Currency"));
  });

  await step("the rider adds funds; a warning says the ecash is not protected", async () => {
    await openFold(R, "Ecash wallet");
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

  await step("the 12 words are shown; a wrong word is refused; the right words finish it", async () => {
    await tap(R.getByRole("button", { name: "Write down 12 words" }).first());
    const list = R.getByRole("list", { name: "Your 12 recovery words" });
    await list.waitFor({ timeout: 5000 });
    const words = (await list.locator("li span.font-mono").allInnerTexts()).map((w) => w.trim());
    if (words.length !== 12 || words.some((w) => !/^[a-z]+$/.test(w))) throw new Error("expected 12 words: " + words.join(" "));
    phrase = words.join(" ");
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

  await step("the phone is lost: a fresh browser has an empty wallet; a wrong phrase is refused; the right one brings the money back", async () => {
    R2 = (await h.newContext("rider on a new phone", PICKUP)).page;
    await h.login(R2, h.rider, h.riderUrl);
    await tap(tabs(R2).getByText("Account", { exact: true }));
    await openFold(R2, "Ecash wallet");
    await R2.getByText("Balance").first().waitFor({ timeout: 40000 });
    if (/5,000 sats/.test(await balanceText(R2))) throw new Error("the new phone should start empty");
    await openFold(R2, "Recovery phrase");
    await tap(R2.getByRole("button", { name: "Restore ecash from 12 words" }));
    const box = R2.getByLabel("Your 12 recovery words").last();
    await box.fill("hello world");
    await R2.getByText(/12 words\. You typed 2/).waitFor({ timeout: 5000 });
    if (!(await R2.getByRole("button", { name: "Look for my ecash" }).isDisabled())) throw new Error("a wrong phrase should not be searchable");
    const other = "half depart obvious quality work element tank gorilla view sugar picture humble";
    await box.fill(other);
    await tap(R2.getByRole("button", { name: "Look for my ecash" }));
    await R2.getByRole("list", { name: "Results" }).getByText(/nothing found/).waitFor({ timeout: 30000 });
    if (await R2.getByText("You wrote down your 12 words.").count()) throw new Error("a phrase that found nothing must not count as the wallet's phrase");
    await box.fill(phrase);
    await R2.getByText("These 12 words look right.").waitFor({ timeout: 5000 });
    await tap(R2.getByRole("button", { name: "Look for my ecash" }));
    await R2.getByRole("list", { name: "Results" }).getByText(/found .*added to your wallet/).waitFor({ timeout: 30000 });
    await snap(R2, "recovery-restored");
    if (!/5,000 sats/.test(await balanceText(R2))) throw new Error("expected 5,000 sats back: " + (await balanceText(R2)));
    if ((await box.inputValue()) !== "") throw new Error("the words should be cleared from the field after the search");
    await R2.getByText("You wrote down your 12 words.").waitFor({ timeout: 5000 });
  });

  await step("the lost phone's coins were swapped during the restore: it can no longer spend them", async () => {
    // The old page still holds the old coins. Ask it to swap them: the mint calls them spent, so the swap fails.
    await tap(R.getByRole("button", { name: "I lost a phone: swap my coins" }));
    await tap(R.getByRole("button", { name: "Swap them" }));
    await R.getByText(/Could not swap the ecash/).waitFor({ timeout: 30000 });
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
