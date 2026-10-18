// The account backup, in two browsers: a person sets things up on one phone (the role, dark mode, a blocked person, the shipping notice read),
// the backup goes to the relay encrypted, and a FRESH browser that logs in with the same secret key finds them restored.
//   • the relay holds a backup event (kind 30112) that shows none of it
//   • the second browser skips the role picker and the shipping notice, is dark, and lists the blocked person
// Takes about a minute.
import { boot, sleep, PICKUP } from "./harness.mjs";
import { makeLog, openFold } from "./flow.mjs";

const h = await boot({ apps: ["goget"] });
const log = makeLog();
let ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); } catch (e) { log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | ")); log("errors:", h.errors); throw e; }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');

try {
  const alice = h.rider, mallory = h.newKeys();
  h.seedDriver(alice, { name: "Alice", lud16: "" });
  let backupAt = 0;

  await step("phone 1: Alice picks Shipping, reads the notice, turns dark mode on; a person is already blocked", async () => {
    const a = await h.newContext("phone1", PICKUP, { nostrride_blocked: [{ pubkey: mallory.publicKey, name: "Mallory", at: 1 }] });
    await h.login(a.page, alice, h.gogetUrl);
    await a.page.getByRole("button", { name: "Shipping" }).click({ timeout: 60000 });
    await a.page.getByRole("button", { name: "I understand" }).click({ timeout: 15000 });
    await tabs(a.page).getByText("Account", { exact: true }).click();
    await openFold(a.page, "Appearance");
    await a.page.getByRole("switch", { name: "Dark mode" }).click();
  });

  await step("the relay gets a backup of Alice, and it is noise: it names no role, no setting, no blocked person", async () => {
    const mine = () => h.relay.events.filter((e) => e.kind === 30112 && e.pubkey === alice.publicKey);
    for (let i = 0; i < 90 && !mine().length; i++) await sleep(1000);
    if (!mine().length) throw new Error("no backup event reached the relay");
    // wait until the newest backup holds the dark mode too (the first upload may be older than the click)
    backupAt = Date.now();
    const wire = mine().map((e) => e.content).join("\n");
    for (const word of ["shipper", "Mallory", mallory.publicKey, "dark", "blocked", "goget_context", "notice"]) if (wire.includes(word)) throw new Error(`"${word}" is readable in the backup on the relay`);
    await sleep(25000); // one more upload cycle, so the dark mode and anything else changed since the first upload is in it
  });

  await step("phone 2 (a fresh browser, same secret key): no role picker, no notice, dark, Mallory is blocked", async () => {
    const b = await h.newContext("phone2", PICKUP);
    const P = b.page;
    await h.login(P, alice, h.gogetUrl);
    await tabs(P).getByText("Deliveries", { exact: true }).waitFor({ timeout: 60000 }); // straight into Shipping
    if (await P.getByRole("button", { name: "I understand" }).count()) throw new Error("the shipping notice must not come back on the second phone");
    for (let i = 0; i < 30 && !(await P.evaluate(() => document.documentElement.classList.contains("dark"))); i++) await sleep(500);
    if (!(await P.evaluate(() => document.documentElement.classList.contains("dark")))) throw new Error("dark mode was not restored");
    await tabs(P).getByText("Account", { exact: true }).click();
    await openFold(P, "Blocked people");
    await P.getByText("Mallory").waitFor({ timeout: 10000 });
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
