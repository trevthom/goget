// Requests between one rider and four drivers:
//   D1  alerts OFF, female   → no pop-up; the Drive tab shows a count; "See nearby requests" lists the request
//   D2  alerts on            → BLOCKED by the rider: never sees the request, and the rider never sees D2's car
//   D3  alerts on            → has BLOCKED the rider: the rider never sees D3's car, D3 never sees the request
//   D4  alerts on            → normal
// With two drivers nearby the rider browses them and asks D1 and D4 from the list (the request goes to those two alone).
// Then: D1 offers, the rider sees "Female driver", says "No thanks", the request stays open, D4 offers and the rider can
// turn D4 down on the confirm screen too. Last: the rider logs out and the open request closes for the drivers.
// Takes about two minutes.
import { boot, sleep, PICKUP, metersNorth } from "./harness.mjs";
import { tap, makeLog, pinPickup, openFold } from "./flow.mjs";

const h = await boot();
const log = makeLog();
const d1 = h.seedDriver(h.newKeys(), { name: "Fiona Driver", gender: "female" });
const d2 = h.seedDriver(h.newKeys(), { name: "Blocked Bob" });
const d3 = h.seedDriver(h.newKeys(), { name: "Careful Carl" });
const d4 = h.seedDriver(h.newKeys(), { name: "Dan Driver" });
const block = (k, name) => ({ nostrride_blocked: [{ pubkey: k.publicKey, name, at: Date.now() }] });
let R, P1, P2, P3, P4, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["rider", R], ["D1", P1], ["D2", P2], ["D3", P3], ["D4", P4]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500));
    log("errors:", h.errors);
    throw e;
  }
};
// With E2E_SHOTS=/some/dir the run also saves screenshots of the new screens.
const snap = async (p, name) => { if (process.env.E2E_SHOTS) { await sleep(600); await p.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); } };
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const online = async (p, kp) => {
  await h.login(p, kp, h.driverUrl);
  await p.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
  await p.getByText("You're online").waitFor({ timeout: 15000 });
};
try {
  const near = metersNorth(PICKUP, 25);
  R = (await h.newContext("rider", PICKUP, block(d2, "Blocked Bob"))).page;
  P1 = (await h.newContext("d1", near)).page;
  P2 = (await h.newContext("d2", near)).page;
  P3 = (await h.newContext("d3", near, block(h.rider, "Rider"))).page; // D3 has blocked the rider
  P4 = (await h.newContext("d4", near)).page;

  await step("four drivers go online; D1 turns the new-request alerts off in Account", async () => {
    await Promise.all([online(P1, d1), online(P2, d2), online(P3, d3), online(P4, d4)]);
    await tap(tabs(P1).getByText("Account", { exact: true }));
    await openFold(P1, "Driving");
    const sw = P1.getByRole("switch", { name: "New request alerts" });
    await sw.waitFor({ timeout: 10000 });
    if ((await sw.getAttribute("aria-checked")) !== "true") throw new Error("alerts should start on");
    await tap(sw);
    if ((await sw.getAttribute("aria-checked")) !== "false") throw new Error("the switch did not turn off");
    await tap(tabs(P1).getByText("Drive", { exact: true }));
  });

  await step("the rider sees only the two drivers who have not blocked or been blocked (D1, D4)", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByText(/2 drivers online nearby/).waitFor({ timeout: 60000 });
    await sleep(3000);
    if (await R.getByText(/3 drivers online nearby|4 drivers online nearby/).count()) throw new Error("a blocked driver is on the rider's map");
  });

  await step("the rider requests a ride with a note for the driver", async () => {
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await pinPickup(R);
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await R.getByRole("button", { name: "Request ride", exact: true }).waitFor({ timeout: 15000 });
    await R.getByPlaceholder(/Note for the driver/).fill("Gate B, two bags");
    await R.getByRole("button", { name: "Request ride", exact: true }).click({ timeout: 15000 });
    // Two drivers are nearby: the rider browses them and asks D1, then D4, from the list.
    await R.getByRole("heading", { name: "Choose a driver" }).waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Request Fiona Driver" }));
    await R.getByText(/Waiting for a reply from Fiona Driver/).waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Request Dan Driver" }));
    await R.getByText(/Waiting for a reply from .*Dan Driver/).waitFor({ timeout: 15000 });
  });

  await step("D4 gets the pop-up card; D2 (blocked) and D3 (blocked the rider) see nothing", async () => {
    await P4.getByText("New ride request").waitFor({ timeout: 40000 });
    await sleep(6000);
    for (const [n, p] of [["D2", P2], ["D3", P3]]) {
      if (await p.getByText(/New ride request|Ride request/).count()) throw new Error(n + " sees the request");
      if (await p.getByRole("button", { name: /See nearby requests/ }).count()) throw new Error(n + " has a nearby-requests button");
      if (await tabs(p).getByLabel(/new$/).count()) throw new Error(n + " has a badge on the Drive tab");
    }
  });

  await step("D1 (alerts off): no pop-up, a count on the Drive tab, and \"See nearby requests\"", async () => {
    await P1.getByRole("button", { name: /See nearby requests \(1\)/ }).waitFor({ timeout: 40000 });
    if (await P1.getByText("New ride request").count()) throw new Error("the card popped up although alerts are off");
    await tabs(P1).getByLabel("1 new").waitFor({ timeout: 5000 });
    await snap(P1, "driver-online-alerts-off");
  });

  await step("the list shows pickup, dropoff, fare, time to the rider, trip distance, trip time and the note", async () => {
    await tap(P1.getByRole("button", { name: /See nearby requests/ }));
    await P1.getByText("Nearby requests").waitFor({ timeout: 5000 });
    const row = P1.getByRole("button", { name: /Request from .* to .*/ });
    await row.waitFor({ timeout: 5000 });
    const text = (await row.innerText()).replace(/\s+/g, " ");
    log("     row:", text);
    for (const want of [/Downtown, Lexington/, /Airport, Lexington/, /\$\d/, /\d+ min\s*to the rider/, /\d+\.\d mi\s*trip distance/, /\d+ min\s*trip drive time/, /Gate B, two bags/, /your fare, about/]) {
      if (!want.test(text)) throw new Error("the row lacks " + want + ": " + text);
    }
    await mustTabs(P1, "list");
    await snap(P1, "driver-list");
  });

  await step("D1 opens the request from the list and accepts it", async () => {
    await tap(P1.getByRole("button", { name: /Request from .* to .*/ }));
    await P1.getByText("Ride request").first().waitFor({ timeout: 5000 });
    await tap(P1.getByRole("button", { name: /^Accept/ }));
    await P1.getByText(/Waiting for/).waitFor({ timeout: 15000 });
  });

  await step("the rider sees D1's gender before choosing", async () => {
    await R.getByText("Female driver").first().waitFor({ timeout: 40000 });
    await R.getByText("Fiona Driver").first().waitFor({ timeout: 5000 });
    await snap(R, "rider-offers");
  });

  await step("\"No thanks\": the request stays open and D1 is told", async () => {
    await tap(R.getByRole("button", { name: "Turn down this driver" }));
    await R.getByText(/Waiting for a reply from Dan Driver/).waitFor({ timeout: 15000 });
    await P1.getByText(/chose not to ride with you/).first().waitFor({ timeout: 30000 });
    if (await P1.getByRole("button", { name: /See nearby requests/ }).count()) throw new Error("D1 still sees the request after being turned down");
    await R.getByText("You passed").waitFor({ timeout: 5000 });
    if (await R.getByRole("button", { name: "Request Fiona Driver" }).count()) throw new Error("the turned-down driver can be asked again from the rider's screen");
  });

  await step("another driver (D4) can still accept; the rider can turn D4 down on the confirm screen too", async () => {
    await tap(P4.getByRole("button", { name: /^Accept/ }));
    await R.getByText("Dan Driver").first().waitFor({ timeout: 40000 });
    if (await R.getByText(/Female driver|Male driver/).count()) throw new Error("a gender is shown for a driver who gave none");
    await tap(R.getByRole("button", { name: "Choose" }));
    await R.getByText("Confirm your driver").waitFor({ timeout: 10000 });
    await tabsMust(R);
    await snap(R, "rider-confirm");
    await tap(R.getByRole("button", { name: "Not this driver" }));
    await R.getByRole("heading", { name: "Choose a driver" }).waitFor({ timeout: 15000 });
    if (await R.getByRole("button", { name: "Request Dan Driver" }).count()) throw new Error("D4 can be asked again after being turned down");
    if ((await R.getByText("You passed").count()) !== 2) throw new Error("both turned-down drivers should read 'You passed'");
  });

  await step("logging out closes the request that is still waiting", async () => {
    // D4 was turned down, so use D1's list again after the rider asks again? Simpler: the rider's request is still open for D1-less drivers.
    // Make sure someone can see it first: D3/D2 cannot, D4 and D1 were declined, so check the request on the RIDER side, then log out.
    const wrapsBefore = h.relay.events.filter((e) => e.kind === 1059).length;
    await tap(tabs(R).getByText("Account", { exact: true }));
    await tap(R.getByRole("button", { name: /Log out/ }).first());
    await R.getByText(/Any ride request still waiting for a driver/).waitFor({ timeout: 5000 });
    await tap(R.getByRole("button", { name: "Log out" }).last());
    await R.getByText(/I have a key|Create account/).first().waitFor({ timeout: 15000 });
    // The closing events (a finish and a closed version) are sealed now: the relay shows only new gift wraps.
    let closed = false;
    for (let i = 0; i < 40 && !closed; i++) {
      closed = h.relay.events.filter((e) => e.kind === 1059).length >= wrapsBefore + 2;
      if (!closed) await sleep(250);
    }
    if (!closed) throw new Error("no closing wraps reached the relay when the rider logged out");
  });

  for (const [n, p, role] of [["R", R, "rider"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (R):", u.length ? u.join(" ") : "none"); }
  for (const [n, p, role] of [["P1", P1, "driver"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (P1):", u.length ? u.join(" ") : "none"); }
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);

async function mustTabs(p, where) { if (!(await tabs(p).isVisible())) throw new Error("the tab bar is hidden: " + where); }
async function tabsMust(p) { await mustTabs(p, "confirm screen"); }
