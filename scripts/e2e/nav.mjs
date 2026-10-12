// Navigation and the driver's approximate location: the tab bar stays visible, the back arrow goes one screen back,
// the X cancels the planning, the pickup can be pinned on the map, and a driver whose phone gives only an APPROXIMATE
// location (accuracy of 3 km) can still go online and be seen by the rider. Takes about a minute.
import { boot, sleep, PICKUP } from "./harness.mjs";
import { tap, makeLog } from "./flow.mjs";

const h = await boot();
const log = makeLog();
let D, R, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["driver", D], ["rider", R]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    log("errors:", h.errors);
    throw e;
  }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');
try {
  ({ page: D } = await h.newContext("driver", PICKUP, {}, 3000)); // approximate: accurate to 3 km
  ({ page: R } = await h.newContext("rider", PICKUP));

  await step("a driver with an approximate location (3 km) can go online", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await D.getByText(/only accurate to|Approximate location/).first().waitFor({ timeout: 40000 }).catch(() => {});
    const go = D.getByRole("button", { name: "Go online" });
    await go.waitFor({ timeout: 40000 });
    for (let i = 0; i < 40 && (await go.isDisabled()); i++) await sleep(250);
    if (await go.isDisabled()) throw new Error("GO is disabled on an approximate fix");
    await go.click();
    await D.getByText("You're online").waitFor({ timeout: 15000 });
    await D.getByText(/Approximate location \(about 3\.0 km\)/).waitFor({ timeout: 10000 });
    if (!(await tabs(D).isVisible())) throw new Error("the driver's tab bar is hidden");
  });

  await step("the rider sees that driver online nearby", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByText(/1 driver online nearby/).waitFor({ timeout: 45000 });
  });

  await step("the tab bar is visible on the home screen and on the planning screen", async () => {
    await tabs(R).waitFor({ timeout: 20000 });
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await R.getByText("Plan your ride").waitFor();
    if (!(await tabs(R).isVisible())) throw new Error("the tab bar is hidden while planning");
  });

  await step("the back arrow goes one screen back (home), not into a loop", async () => {
    await tap(R.getByRole("button", { name: "Back" }));
    await R.getByText("Plan your ride").waitFor({ state: "detached", timeout: 5000 });
    await R.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 5000 });
  });

  await step("the X cancels the planning and shows the home screen", async () => {
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await R.getByLabel("Where to?").fill("Blue");
    await tap(R.getByRole("button", { name: "Cancel and go home" }));
    await R.getByText("Plan your ride").waitFor({ state: "detached", timeout: 5000 });
    await R.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 5000 });
  });

  await step("the rider pins the pickup on the map", async () => {
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await R.getByLabel("Pickup location").waitFor();
    await R.getByLabel("Pickup location").click();
    await tap(R.getByRole("button", { name: /Set pickup on the map/ }));
    await R.getByText("Pickup spot").waitFor({ timeout: 10000 });
    await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Confirm pickup" }));
    await R.getByText("Plan your ride").waitFor({ timeout: 10000 });
    const v = await R.getByLabel("Pickup location").inputValue();
    if (!/100 Main St/.test(v)) throw new Error("pickup is not the pinned spot: " + v);
    if (!(await tabs(R).isVisible())) throw new Error("the tab bar is hidden on the search screen");
  });

  await step("quote: back goes to search; search back goes home; X cancels from the quote; the Ride tab cancels too", async () => {
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await R.getByText("Standard fare", { exact: true }).waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Back" }));
    await R.getByText("Plan your ride").waitFor({ timeout: 5000 });
    await tap(R.getByRole("button", { name: "Back" }));
    await R.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 5000 });
    // again, to the quote, then X
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await R.getByText("Standard fare", { exact: true }).waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Cancel and go home" }));
    await R.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 5000 });
    // and the Ride tab while planning
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await R.getByText("Plan your ride").waitFor();
    await tap(tabs(R).getByText("Ride", { exact: true }));
    await R.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 5000 });
  });

  await step("dragging the map moves the pin and looks up the new address", async () => {
    // The sandbox has no Tailwind (CDN blocked): give the pin page just enough layout for a real map.
    await R.addStyleTag({ content: '.h-\\[100dvh\\]{height:100dvh}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}.min-h-0{min-height:0}.relative{position:relative}.absolute{position:absolute}.inset-0{top:0;left:0;right:0;bottom:0}.inset-x-0{left:0;right:0}.bottom-0{bottom:0}' });
    const lookups = [];
    R.on("request", (r) => { const u = r.url(); if (/photon\.komoot\.io\/reverse/.test(u)) lookups.push(new URL(u).searchParams.get("lat")); });
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await R.getByLabel("Pickup location").click();
    await tap(R.getByRole("button", { name: /Set pickup on the map/ }));
    await R.getByText("Pickup spot").waitFor({ timeout: 10000 });
    await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    const before = lookups[lookups.length - 1];
    const box = await R.getByLabel("Map: drag to move the pin").boundingBox();
    if (!box || box.height < 100) throw new Error("the map has no size: " + JSON.stringify(box));
    const x = box.x + box.width / 2, y = box.y + box.height / 3;
    await R.mouse.move(x, y); await R.mouse.down(); await R.mouse.move(x, y + 150, { steps: 8 }); await R.mouse.up();
    await R.getByText("Finding the address").waitFor({ timeout: 3000 }).catch(() => {});
    for (let i = 0; i < 40 && lookups[lookups.length - 1] === before; i++) await sleep(250);
    const after = lookups[lookups.length - 1];
    if (after === before) throw new Error("no new address lookup after the drag: " + lookups.join(","));
    if (!(Number(after) > Number(before))) throw new Error(`dragging the map down should move the pin north: ${before} -> ${after}`);
    log("     lookups:", lookups.join(", "));
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
