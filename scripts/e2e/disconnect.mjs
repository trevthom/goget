// The Drive face and the ecash wallet:
//   • a new driver has no wallet: GO is off and says why, with a button that opens Account → Wallets
//   • Create New Wallet (from there) and GO works
//   • after "Disconnect ecash from this device" the GO button is off again and says why (nobody could pay this driver)
//   • Create New Wallet again makes a new, empty wallet and GO works again
// Takes about 30 seconds.
import { boot, sleep, PICKUP, metersNorth } from "./harness.mjs";
import { tap, makeLog, openFold } from "./flow.mjs";

const h = await boot();
const log = makeLog();
let D, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    if (D) log("driver page text:", (await D.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    log("errors:", h.errors);
    throw e;
  }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const go = (p) => p.getByRole("button", { name: "Go online" });
const waitEnabled = async (loc, want) => { for (let i = 0; i < 60 && (await loc.isDisabled()) === want; i++) await sleep(250); };
const createWallet = async (p) => {
  await tap(p.getByRole("button", { name: "Create New Wallet", exact: true }));
  await tap(p.getByRole("button", { name: "Create wallet", exact: true }));
  await p.getByRole("dialog", { name: "Write down 12 words" }).waitFor({ timeout: 20000 });
  await tap(p.getByRole("button", { name: "Close", exact: true }));
};

try {
  D = (await h.newContext("driver", metersNorth(PICKUP, 25))).page;

  await step("a new driver has no wallet: GO is off, says why, and the button opens Wallets", async () => {
    await h.login(D, h.driver, h.driverUrl, { wallet: false });
    await go(D).waitFor({ timeout: 40000 });
    if (!(await go(D).isDisabled())) throw new Error("GO should be off without a wallet");
    await D.getByText(/You have no ecash wallet on this phone, so you cannot be paid/).waitFor({ timeout: 5000 });
    await tap(D.getByRole("button", { name: "Set up my wallet" }));
    await D.getByRole("button", { name: "Create New Wallet", exact: true }).waitFor({ timeout: 10000 }); // the Wallets section is open
  });

  await step("Create New Wallet: the 12 words show at once, and GO works", async () => {
    await createWallet(D);
    await tap(tabs(D).getByText("Drive", { exact: true }));
    await go(D).waitFor({ timeout: 10000 });
    await waitEnabled(go(D), true);
    if (await go(D).isDisabled()) throw new Error("GO should be on");
  });

  await step("Disconnect ecash from this device: GO is off and says why", async () => {
    await tap(tabs(D).getByText("Account", { exact: true }));
    await openFold(D, "Wallets");
    await tap(D.getByRole("button", { name: "Disconnect ecash from this device" }));
    await tap(D.getByRole("button", { name: "Disconnect", exact: true }));
    await D.getByText(/You have no ecash wallet on this phone yet/).waitFor({ timeout: 20000 });
    await tap(tabs(D).getByText("Drive", { exact: true }));
    await go(D).waitFor({ timeout: 10000 });
    if (!(await go(D).isDisabled())) throw new Error("GO should be off while there is no wallet");
    await D.getByText(/no ecash wallet on this phone, so you cannot be paid/).waitFor({ timeout: 5000 });
  });

  await step("Create New Wallet again: a new empty wallet, and GO works again", async () => {
    await tap(tabs(D).getByText("Account", { exact: true }));
    await openFold(D, "Wallets");
    await createWallet(D);
    await D.getByText("Balance").first().waitFor({ timeout: 20000 });
    await tap(tabs(D).getByText("Drive", { exact: true }));
    await waitEnabled(go(D), true);
    if (await go(D).isDisabled()) throw new Error("GO should be on again");
    await go(D).click();
    await D.getByText("You're online").waitFor({ timeout: 15000 });
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
