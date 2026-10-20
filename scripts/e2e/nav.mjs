// Navigation, the pickup, and the driver's approximate location:
//   • the tab bar is visible on every rider screen (home, search, pin, quote, finding a driver)
//   • the pickup is NEVER filled in by the app; the search page shows "Set pickup on the map" and a hint about business names
//   • the back arrow goes one screen back; Cancel / X cancel the planning and show the home screen
//   • the pickup can be pinned (drag the map under the pin) or typed (a business name)
//   • the DROP-OFF can be pinned on the map too ("Set drop-off on the map"); with both places set the quote opens
//   • the search page shows no button and no choice until a field is active; then the map button of THAT field comes first, with that field's 3 most recent places below it
//   • a driver whose phone gives only an APPROXIMATE location (accuracy 3 km) can go online and be seen by the rider
// Takes about a minute. The pages are styled like the real app (Tailwind is built into the app CSS).
import { boot, sleep, PICKUP } from "./harness.mjs";
import { tap, makeLog, pinPickup } from "./flow.mjs";

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
const mustSeeTabs = async (p, where) => { if (!(await tabs(p).isVisible())) throw new Error("the tab bar is hidden: " + where); };
const home = (p) => p.getByRole("button", { name: /Where to\?/ });
const openSearch = async () => { await tap(home(R)); await R.getByText("Plan your ride").waitFor({ timeout: 10000 }); };
const toQuote = async () => {
  await R.getByLabel("Where to?").fill("Blue Grass");
  await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
  await R.getByRole("button", { name: "Request ride", exact: true }).waitFor({ timeout: 15000 });
};
try {
  ({ page: D } = await h.newContext("driver", PICKUP, {}, 3000)); // approximate: accurate to 3 km
  ({ page: R } = await h.newContext("rider", PICKUP));

  await step("a driver with an approximate location (3 km) can go online", async () => {
    await h.login(D, h.driver, h.driverUrl);
    const go = D.getByRole("button", { name: "Go online" });
    await go.waitFor({ timeout: 40000 });
    for (let i = 0; i < 40 && (await go.isDisabled()); i++) await sleep(250);
    if (await go.isDisabled()) throw new Error("GO is disabled on an approximate fix");
    await go.click();
    await D.getByText("You're online").waitFor({ timeout: 15000 });
    await D.getByText(/Approximate location \(about 3\.0 km\)/).waitFor({ timeout: 10000 });
    await mustSeeTabs(D, "driver home");
  });

  await step("the rider sees that driver online nearby", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByText(/1 driver online nearby/).waitFor({ timeout: 45000 });
    await mustSeeTabs(R, "rider home");
  });

  await step("the pickup is not filled in; the pin button and the business-name hint are visible at once", async () => {
    await openSearch();
    await sleep(2500); // long enough for the GPS address to arrive, which used to fill the pickup
    const v = await R.getByLabel("Pickup location").inputValue();
    if (v) throw new Error("the pickup was filled in by the app: " + v);
    await R.getByRole("button", { name: /Set pickup on the map/ }).waitFor({ timeout: 3000 });
    await R.getByText(/Not sure of the address\? Try entering the name of a business/).waitFor({ timeout: 3000 });
    await mustSeeTabs(R, "search");
  });

  await step("Back and Cancel both return to the home screen", async () => {
    await tap(R.getByRole("button", { name: "Back" }));
    await home(R).waitFor({ timeout: 5000 });
    await mustSeeTabs(R, "home after back");
    await openSearch();
    await R.getByLabel("Where to?").fill("Blue");
    await tap(R.getByRole("button", { name: "Cancel", exact: true }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch();
    if (await R.getByLabel("Where to?").inputValue()) throw new Error("Cancel kept the old destination");
    await tap(R.getByRole("button", { name: "Back" }));
    await home(R).waitFor({ timeout: 5000 });
  });

  await step("a business name works as the pickup", async () => {
    await openSearch();
    await R.getByLabel("Pickup location").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    const v = await R.getByLabel("Pickup location").inputValue();
    if (!/Blue Grass Airport/.test(v)) throw new Error("typed pickup not set: " + v);
    await tap(R.getByRole("button", { name: "Cancel", exact: true }));
    await home(R).waitFor({ timeout: 5000 });
  });

  await step("the rider pins the pickup on the map; the pin page has Back and Close", async () => {
    await openSearch();
    await R.getByLabel("Pickup location").click();
    await tap(R.getByRole("button", { name: /Set pickup on the map/ }));
    await R.getByText("Pickup spot").waitFor({ timeout: 10000 });
    await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    await mustSeeTabs(R, "pin picker");
    await tap(R.getByRole("button", { name: "Close and go home" }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch();
    await pinPickup(R);
    const v = await R.getByLabel("Pickup location").inputValue();
    if (!/100 Main St/.test(v)) throw new Error("pickup is not the pinned spot: " + v);
    await mustSeeTabs(R, "search after pin");
  });

  await step("the rider pins the drop-off on the map too; Back keeps the pickup; confirming opens the quote", async () => {
    await tap(R.getByRole("button", { name: "Back" }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch();
    await pinPickup(R);
    await R.getByRole("button", { name: /Set drop-off on the map/ }).waitFor({ timeout: 3000 });
    await tap(R.getByRole("button", { name: /Set drop-off on the map/ }));
    await R.getByText("Drop-off spot").waitFor({ timeout: 10000 });
    await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    await R.getByRole("button", { name: "Close and go home" }).waitFor({ timeout: 3000 });
    await mustSeeTabs(R, "drop-off pin picker");
    await tap(R.getByRole("button", { name: "Back" }));
    await R.getByText("Plan your ride").waitFor({ timeout: 5000 });
    if (!/100 Main St/.test(await R.getByLabel("Pickup location").inputValue())) throw new Error("Back from the drop-off pin lost the pickup");
    if (await R.getByLabel("Where to?").inputValue()) throw new Error("Back from the drop-off pin must not set a drop-off");
    await tap(R.getByRole("button", { name: /Set drop-off on the map/ }));
    await R.getByText("Drop-off spot").waitFor({ timeout: 10000 });
    await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Confirm drop-off" }));
    await R.getByRole("button", { name: "Request ride", exact: true }).waitFor({ timeout: 15000 });
    await mustSeeTabs(R, "quote after a pinned drop-off");
    await tap(R.getByRole("button", { name: "Edit" }).first());
    await R.getByText("Plan your ride").waitFor({ timeout: 5000 });
    if (!/100 Main St/.test(await R.getByLabel("Where to?").inputValue())) throw new Error("the pinned drop-off is not in the Where to? field");
    await tap(R.getByRole("button", { name: "Back" }));
    await tap(R.getByRole("button", { name: "Close and go home" }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch(); await pinPickup(R); // leave the search page open with the pickup set, as the next step expects
  });

  await step("quote: tab bar, Back, the Cancel button and the X; search Back goes home", async () => {
    await toQuote();
    await mustSeeTabs(R, "quote");
    await R.getByRole("button", { name: "Cancel", exact: true }).waitFor({ timeout: 3000 });
    await tap(R.getByRole("button", { name: "Back" }));
    await R.getByText("Plan your ride").waitFor({ timeout: 5000 });
    await tap(R.getByRole("button", { name: "Back" }));
    await home(R).waitFor({ timeout: 5000 });
    // to the quote again, then each way out
    await openSearch(); await toQuote();
    await tap(R.getByRole("button", { name: "Close and go home" }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch(); await pinPickup(R); await toQuote();
    await tap(R.getByRole("button", { name: "Cancel", exact: true }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch();
    await tap(tabs(R).getByText("Ride", { exact: true }));
    await home(R).waitFor({ timeout: 5000 });
  });

  await step("the tab bar stays visible while a request waits for a driver", async () => {
    await openSearch(); await pinPickup(R); await toQuote();
    await R.getByRole("button", { name: "Request ride", exact: true }).click({ timeout: 15000 });
    await R.getByText("Finding your driver").first().waitFor({ timeout: 15000 });
    await mustSeeTabs(R, "finding your driver");
    await R.getByRole("button", { name: "Close request" }).waitFor({ timeout: 3000 });
  });

  await step("dragging the map moves the pin and looks up the new address", async () => {
    await tap(R.getByRole("button", { name: "Close request" }));
    await tap(R.getByRole("button", { name: "Close request" }).last()); // the confirmation
    await home(R).waitFor({ timeout: 15000 });
    const lookups = [];
    R.on("request", (r) => { const u = r.url(); if (/photon\.komoot\.io\/reverse/.test(u)) lookups.push(new URL(u).searchParams.get("lat")); });
    await openSearch();
    await R.getByLabel("Pickup location").click();
    await tap(R.getByRole("button", { name: /Set pickup on the map/ }));
    await R.getByText("Pickup spot").waitFor({ timeout: 10000 });
    await R.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    const before = lookups[lookups.length - 1];
    const box = await R.getByLabel("Map: drag to move the pin").boundingBox();
    if (!box || box.height < 100) throw new Error("the map has no size: " + JSON.stringify(box));
    const x = box.x + box.width / 2, y = box.y + box.height / 3;
    await R.mouse.move(x, y); await R.mouse.down(); await R.mouse.move(x, y + 150, { steps: 8 }); await R.mouse.up();
    for (let i = 0; i < 40 && lookups[lookups.length - 1] === before; i++) await sleep(250);
    const after = lookups[lookups.length - 1];
    if (after === before) throw new Error("no new address lookup after the drag: " + lookups.join(","));
    if (!(Number(after) > Number(before))) throw new Error(`dragging the map down should move the pin north: ${before} -> ${after}`);
    log("     lookups:", lookups.join(", "));
  });

  await step("search page: nothing but the two fields until one is active; then that field's map button first, its recent places below", async () => {
    await tap(R.getByRole("button", { name: "Close and go home" }));
    await home(R).waitFor({ timeout: 5000 });
    await openSearch();
    await R.getByRole("button", { name: /Set pickup on the map/ }).waitFor({ timeout: 3000 }); // the cursor starts in the pickup field
    if (await R.getByRole("button", { name: /Set drop-off on the map/ }).count()) throw new Error("the drop-off map button shows while the pickup field is active");
    const recent = R.getByRole("button", { name: /100 Main St/ });
    await recent.first().waitFor({ timeout: 5000 });
    if ((await recent.count()) > 3) throw new Error("more than 3 recent places: " + (await recent.count()));
    // the order on the page: the map button, then the recent places
    const order = await R.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.replace(/\s+/g, " ").trim()).filter((t) => /Set pickup on the map|100 Main St/.test(t)).slice(0, 2));
    if (!/Set pickup on the map/.test(order[0] || "") || !/100 Main St/.test(order[1] || "")) throw new Error("wrong order: " + JSON.stringify(order));
    // the drop-off field: its own button
    await R.getByLabel("Where to?").click();
    await R.getByRole("button", { name: /Set drop-off on the map/ }).waitFor({ timeout: 3000 });
    if (await R.getByRole("button", { name: /Set pickup on the map/ }).count()) throw new Error("the pickup map button shows while the drop-off field is active");
    // no cursor in either field: no button, no choice
    await R.evaluate(() => document.activeElement?.blur());
    await sleep(500);
    for (const re of [/Set pickup on the map/, /Set drop-off on the map/, /100 Main St/, /Your location|Locating/, /^Done$/]) {
      if (await R.getByRole("button", { name: re }).count()) throw new Error("a button shows with no active field: " + re);
    }
    await R.getByLabel("Pickup location").click();
    await R.getByRole("button", { name: /Set pickup on the map/ }).waitFor({ timeout: 3000 });
  });

  const unstyled = await h.missingStyles(R, "rider");
  log("class names on screen with no CSS rule:", unstyled.length ? unstyled.join(" ") : "none");
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
