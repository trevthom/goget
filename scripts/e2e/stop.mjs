// An extra stop in the middle of a ride: the rider is told the fare keeps running at the driver's rates, the driver is told the
// same and accepts, and the rider is told it was accepted. (There are no flat prices: the fare is always the driver's rates.)
// Takes about a minute.
import { boot, sleep } from "./harness.mjs";
import { rideToRiding, satsIn, tap, openSheet, makeLog } from "./flow.mjs";

const h = await boot({ feePpk: 100 });
const log = makeLog();
let ctx = {}, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["driver", ctx.D], ["rider", ctx.R]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700));
    log("errors:", h.errors);
    throw e;
  }
};
try {
  ctx = await rideToRiding(h, { log, step: async (n, f) => { ctx.D = ctx.D; await step(n, f); } });
  const { D, R } = ctx;
  await step("the base rate is paid when the ride starts", async () => {
    await D.getByText("Paid by the rider").waitFor();
    let paid = 0;
    for (let i = 0; i < 30; i++) { paid = await satsIn(D.getByText("Paid by the rider").locator("..")); if (paid) break; await sleep(500); }
    log("     driver sees paid:", paid, "sats");
    if (paid < 1900) throw new Error("the base rate (2,000) should be paid at the start: " + paid);
    log("     rider label:", (await R.getByText(/estimate/).first().innerText()));
  });
  await step("the rider asks for a stop and is told the fare keeps running", async () => {
    await tap(R.getByText("Add a stop or change the destination"));
    await R.getByText(/You keep paying the driver's normal fare/).first().waitFor({ timeout: 5000 });
    await R.getByLabel("Place for the stop or destination").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await tap(R.getByRole("button", { name: "Ask my driver to go there" }));
  });
  await step("the driver accepts the stop; the rider is told", async () => {
    await D.getByText("The rider asks to add a stop").waitFor({ timeout: 30000 });
    log("     driver sees:", (await D.getByText(/If you accept, the rider keeps paying/).first().innerText()).slice(0, 120));
    await tap(D.getByRole("button", { name: "Accept", exact: true }));
    await R.getByText(/accepted the extra stop/).first().waitFor({ timeout: 30000 });
  });
  await step("the driver finishes; the rider sees the receipt", async () => {
    await tap(D.getByRole("button", { name: "Finish ride" }).first());
    await D.getByText("Finish this ride?").waitFor();
    await tap(D.getByRole("button", { name: "Finish ride" }).last());
    await R.getByText("Ride finished").waitFor({ timeout: 30000 });
    log("     rider receipt:", (await R.locator("dl").first().innerText()).replace(/\s+/g, " "));
  });
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
