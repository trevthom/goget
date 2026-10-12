// An extra stop turns a flat price into the driver's normal fare, counted from the start of the ride.
// The rider offers a flat price far below the driver's fare, so the jump is easy to see. Takes about a minute.
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
  ctx = await rideToRiding(h, { flatPrice: "7", log, step: async (n, f) => { ctx.D = ctx.D; await step(n, f); } });
  const { D, R } = ctx;
  let flatPaid;
  await step("a flat price of $7 is paid in small scaled ticks", async () => {
    await D.getByText("Paid by the rider").waitFor();
    for (let i = 0; i < 30; i++) { flatPaid = await satsIn(D.getByText("Paid by the rider").locator("..")); if (flatPaid) break; await sleep(500); }
    log("     driver sees paid:", flatPaid, "sats (the driver's own base rate is 2,000)");
    if (!(flatPaid > 300 && flatPaid < 1500)) throw new Error("expected a scaled base tick well under 2,000: " + flatPaid);
    log("     rider label:", (await R.getByText(/flat price|estimate/).first().innerText()));
  });
  await step("the rider asks for a stop and is told what it does to the price", async () => {
    await tap(R.getByText("Add a stop or change the destination"));
    await R.getByText(/turns a flat price into the driver's normal fare/).first().waitFor({ timeout: 5000 });
    await R.getByLabel("Place for the stop or destination").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await tap(R.getByRole("button", { name: "Ask my driver to go there" }));
  });
  await step("the driver accepts the stop; the fare becomes the normal fare from the start", async () => {
    await D.getByText("The rider asks to add a stop").waitFor({ timeout: 30000 });
    log("     driver sees:", (await D.getByText(/If you accept, the flat price becomes/).first().innerText()).slice(0, 120));
    await tap(D.getByRole("button", { name: "Accept", exact: true }));
    await R.getByText(/accepted the extra stop/).first().waitFor({ timeout: 30000 });
    let paid = flatPaid;
    for (let i = 0; i < 40 && paid <= 1800; i++) { await sleep(1000); paid = await satsIn(D.getByText("Paid by the rider").locator("..")); }
    log("     driver sees paid now:", paid, "sats");
    if (paid < 1900) throw new Error("the normal base rate (2,000) should be paid after the stop: " + paid);
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
