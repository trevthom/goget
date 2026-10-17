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
    await openSheet(R); await openSheet(D);
    await D.getByText("Paid by the rider").waitFor();
    let paid = 0;
    for (let i = 0; i < 30; i++) { paid = await satsIn(D.getByText("Paid by the rider").locator("..")); if (paid) break; await sleep(500); }
    log("     driver sees paid:", paid, "sats");
    if (paid < 1400) throw new Error("the base rate (1,500) should be paid at the start: " + paid);
    log("     rider estimate:", (await R.getByRole("group", { name: "Estimated total fare" }).innerText()).replace(/\s+/g, " "));
  });
  let before;
  await step("Add stop / update fare: the rider sees an ESTIMATED change in the fare (dashed, ≈) before asking", async () => {
    if (await R.getByText("Add a stop or change the destination").count()) throw new Error("the old link text is still there");
    before = await satsIn(R.getByRole("group", { name: "Estimated total fare" }));
    await tap(R.getByText("Add stop / update fare", { exact: true }));
    await R.getByText(/You keep paying the driver's normal fare/).first().waitFor({ timeout: 5000 });
    // Back to the pickup as the NEW DESTINATION: a shorter way, so the fare goes DOWN (a negative estimate).
    await tap(R.getByRole("button", { name: "New destination" }));
    await R.getByRole("button", { name: "Your location" }).waitFor({ timeout: 15000 });
    for (let i = 0; i < 40 && (await R.getByRole("button", { name: "Your location" }).isDisabled()); i++) await sleep(250);
    await tap(R.getByRole("button", { name: "Your location" }));
    const chip = R.getByRole("status", { name: "Estimated change in fare" });
    await chip.waitFor({ timeout: 15000 });
    let text = "";
    for (let i = 0; i < 40; i++) { text = (await chip.innerText()).replace(/\s+/g, " "); if (/\$\d/.test(text)) break; await sleep(250); }
    log("     fare-change estimate:", text);
    if (!/≈\s*−\$\d/.test(text)) throw new Error("a shorter way must show an estimated DROP, like ≈ −$4.20: " + text);
    if (!/dashed/.test(await chip.evaluate((el) => getComputedStyle(el).borderTopStyle))) throw new Error("the estimate must have a dashed outline");
    await tap(R.getByRole("button", { name: "Ask my driver to go there" }));
  });
  await step("the driver sees the same estimate on the request, accepts; the rider's total is updated", async () => {
    await D.getByText("The rider asks for a new destination").waitFor({ timeout: 30000 });
    const dchip = D.getByRole("status", { name: "Estimated change in fare" });
    await dchip.waitFor({ timeout: 15000 });
    let dtext = "";
    for (let i = 0; i < 40; i++) { dtext = (await dchip.innerText()).replace(/\s+/g, " "); if (/\$\d/.test(dtext)) break; await sleep(250); }
    log("     driver sees the estimate:", dtext);
    if (!/≈\s*−\$\d/.test(dtext)) throw new Error("the driver must see the estimate too: " + dtext);
    log("     driver sees:", (await D.getByText(/If you accept, the rider keeps paying/).first().innerText()).slice(0, 120));
    await tap(D.getByRole("button", { name: "Accept", exact: true }));
    await R.getByText(/accepted the extra stop/).first().waitFor({ timeout: 30000 });
    const est = R.getByRole("group", { name: "Estimated total fare" });
    let t = "";
    for (let i = 0; i < 60; i++) { t = (await est.innerText()).replace(/\s+/g, " "); if (/from the new destination/.test(t)) break; await sleep(500); }
    log("     rider estimate now:", t);
    if (!/from the new destination ≈\s*−\$\d/.test(t)) throw new Error("the total must show the estimated change after the driver accepts: " + t);
    const after = await satsIn(est);
    if (!(after < before)) throw new Error(`the estimated total should go down for a shorter way: ${before} -> ${after}`);
    const dEst = (await D.getByRole("group", { name: "Estimated total fare" }).innerText()).replace(/\s+/g, " ");
    log("     driver estimate now:", dEst);
    if (!/from the new destination/.test(dEst)) throw new Error("the driver's total must show it too: " + dEst);
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
