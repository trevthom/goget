// The driver app with the ecash wallet disconnected from the device:
//   • a driver with a working wallet can go online (the baseline)
//   • after "Disconnect ecash from this device" the GO button is off and says why (nobody could pay this driver)
//   • "Connect ecash wallet" makes a new, empty wallet and GO works again
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

try {
  D = (await h.newContext("driver", metersNorth(PICKUP, 25))).page;

  await step("a driver with a working wallet can use GO", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await go(D).waitFor({ timeout: 40000 });
    await waitEnabled(go(D), true);
    if (await go(D).isDisabled()) throw new Error("GO should be on");
  });

  await step("Disconnect ecash from this device: GO is off and says why", async () => {
    await tap(tabs(D).getByText("Account", { exact: true }));
    await openFold(D, "Ecash wallet");
    await tap(D.getByRole("button", { name: "Disconnect ecash from this device" }));
    await tap(D.getByRole("button", { name: "Swap coins and disconnect" }));
    await D.getByText(/not connected on this device, so there is no ecash here/).waitFor({ timeout: 20000 });
    await tap(tabs(D).getByText("Drive", { exact: true }));
    await go(D).waitFor({ timeout: 10000 });
    if (!(await go(D).isDisabled())) throw new Error("GO should be off while the wallet is disconnected");
    await D.getByText(/ecash wallet is not connected on this device, so you cannot be paid/).waitFor({ timeout: 5000 });
  });

  await step("Connect ecash wallet: a new empty wallet, and GO works again", async () => {
    await tap(tabs(D).getByText("Account", { exact: true }));
    await openFold(D, "Ecash wallet");
    await tap(D.getByRole("button", { name: "Connect ecash wallet" }));
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
