// Browsing drivers, in a real browser. One rider, three drivers:
//   Fiona (female, higher rates), Dan (male, lower rates), Cal (no gender set).
//   • the quote screen: no estimate near the top, drivers listed as "name · price" (no "app rates"), a "Request ride" button with no price,
//     the "Notify nearest driver immediately" box, "Female only" / "Male only" show only the drivers who declared that gender
//   • with more than one driver nearby "Request ride" opens the list (cheapest first); "See map" shows the prices next to the cars;
//     a tap on a price opens a card with "Request <name>"
//   • asking Dan sends the request to Dan ALONE; Dan declines; the rider is told and the list says "Declined"
//   • asking Fiona: she changes her rates before she accepts; the rider sees "Rates changed", and a popup stops the confirm until the rider
//     has read the new rates ("Choose a different driver" goes back; "Continue with the new rates" unlocks "Confirm driver")
//   • "Notify nearest driver immediately": the request goes to the nearest driver only, with no list
// Takes about two minutes.
import { boot, sleep, PICKUP, metersNorth } from "./harness.mjs";
import { tap, makeLog, pinPickup, openFold } from "./flow.mjs";

const h = await boot();
const log = makeLog();
const fiona = h.seedDriver(h.newKeys(), { name: "Fiona Driver", gender: "female", rates: { base: 2, perMile: 1.2, perMinute: 0.25 } });
const dan = h.seedDriver(h.newKeys(), { name: "Dan Driver", gender: "male", rates: { base: 1, perMile: 0.9, perMinute: 0.15 } });
const cal = h.seedDriver(h.newKeys(), { name: "Cal Driver", rates: { base: 1.5, perMile: 1, perMinute: 0.2 } });
let R, PF, PD, PC, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["rider", R], ["Fiona", PF], ["Dan", PD], ["Cal", PC]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    log("errors:", h.errors);
    throw e;
  }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const body = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const online = async (p, kp) => {
  await h.login(p, kp, h.driverUrl);
  await p.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
  await p.getByText("You're online").waitFor({ timeout: 15000 });
};
const quote = async () => {
  await tap(R.getByRole("button", { name: /Where to\?/ }));
  await pinPickup(R);
  await R.getByLabel("Where to?").fill("Blue Grass");
  await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
  await R.getByRole("button", { name: "Request ride", exact: true }).waitFor({ timeout: 15000 });
};
const noRequestFor = async (p, who) => {
  await sleep(5000);
  if (await p.getByText(/New ride request|Ride request/).count()) throw new Error(who + " got a request that was not sent to them");
};

try {
  // A car shows on the map at about 100 m accuracy, so the drivers stand well apart: Dan is the nearest, then Fiona, then Cal.
  R = (await h.newContext("rider", PICKUP)).page;
  PF = (await h.newContext("fiona", metersNorth(PICKUP, 800))).page;
  PD = (await h.newContext("dan", metersNorth(PICKUP, 300))).page;
  PC = (await h.newContext("cal", metersNorth(PICKUP, 1500))).page;

  await step("three drivers go online and the rider sees them", async () => {
    await Promise.all([online(PF, fiona), online(PD, dan), online(PC, cal)]);
    await h.login(R, h.rider, h.riderUrl);
    await R.getByText(/3 drivers online nearby/).waitFor({ timeout: 60000 });
  });

  await step("the quote: no estimate near the top, name · price chips, a plain Request ride button, the notify box", async () => {
    await quote();
    const t = await body(R);
    if (/Estimated|app rates|Driver's rates/.test(t)) throw new Error("the quote still shows an estimate or 'app rates': " + t.slice(0, 400));
    for (const name of ["Fiona Driver", "Dan Driver", "Cal Driver"]) {
      const chip = R.locator("li", { hasText: new RegExp(name + " · .*[\\d]") });
      if (!(await chip.count())) throw new Error("no 'name · price' chip for " + name);
    }
    const btn = await R.getByRole("button", { name: "Request ride", exact: true }).innerText();
    if (btn.trim() !== "Request ride") throw new Error("the button reads " + btn);
    await R.getByLabel("Notify nearest driver immediately").waitFor({ timeout: 3000 });
    if (await R.getByLabel("Notify nearest driver immediately").isChecked()) throw new Error("the box should start unticked");
  });

  await step("Female only / Male only show only the drivers who declared that gender", async () => {
    await tap(R.getByRole("button", { name: "Female only", exact: true }));
    await R.locator("li", { hasText: /Fiona Driver · / }).waitFor({ timeout: 5000 });
    for (const n of ["Dan Driver", "Cal Driver"]) if (await R.locator("li", { hasText: new RegExp(n) }).count()) throw new Error(n + " is shown to a rider who asked for Female only");
    await tap(R.getByRole("button", { name: "Male only", exact: true }));
    await R.locator("li", { hasText: /Dan Driver · / }).waitFor({ timeout: 5000 });
    for (const n of ["Fiona Driver", "Cal Driver"]) if (await R.locator("li", { hasText: new RegExp(n) }).count()) throw new Error(n + " is shown to a rider who asked for Male only");
    if (!(await R.getByRole("button", { name: "Male only", exact: true }).getAttribute("aria-pressed") === "true")) throw new Error("Male only is not marked");
    await tap(R.getByRole("button", { name: "No preference", exact: true }));
    await R.locator("li", { hasText: /Cal Driver · / }).waitFor({ timeout: 5000 });
  });

  await step("Notify nearest driver immediately: the request goes to the nearest driver (Dan) only, with no list to browse", async () => {
    await tap(R.getByLabel("Notify nearest driver immediately"));
    await tap(R.getByRole("button", { name: "Request ride", exact: true }));
    await R.getByText(/Waiting for a reply from Dan Driver/).waitFor({ timeout: 15000 });
    await PD.getByText("This rider chose you").waitFor({ timeout: 40000 });
    await noRequestFor(PF, "Fiona");
    await noRequestFor(PC, "Cal");
    // Close it and start again with the box unticked.
    await tap(R.getByRole("button", { name: "Close request" }).first());
    await tap(R.getByRole("button", { name: "Close request" }).last());
    await R.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 15000 });
    await quote();
    if (!(await R.getByLabel("Notify nearest driver immediately").isChecked())) throw new Error("the box keeps its setting");
    await tap(R.getByLabel("Notify nearest driver immediately"));
  });

  await step("Request ride with several drivers nearby opens the list, cheapest first; nothing was sent yet", async () => {
    await tap(R.getByRole("button", { name: "Request ride", exact: true }));
    await R.getByRole("heading", { name: "Choose a driver" }).waitFor({ timeout: 10000 });
    const rows = R.getByRole("list", { name: "Drivers nearby" }).locator("li");
    await rows.first().waitFor({ timeout: 5000 });
    if ((await rows.count()) !== 3) throw new Error("expected 3 drivers, saw " + (await rows.count()));
    const first = (await rows.first().innerText()).replace(/\s+/g, " ");
    if (!/Dan Driver/.test(first)) throw new Error("the cheapest driver (Dan) should be first: " + first);
    await noRequestFor(PF, "Fiona");
    await noRequestFor(PD, "Dan");
  });

  await step("See map: prices next to the drivers; a tap on a price opens a card with Request <name>", async () => {
    await tap(R.getByRole("button", { name: "See map" }));
    const pills = R.locator(".leaflet-marker-icon", { hasText: /\$\d/ });
    for (let i = 0; i < 20 && (await pills.count()) < 3; i++) await sleep(500);
    if ((await pills.count()) < 3) throw new Error("expected 3 price tags on the map, saw " + (await pills.count()));
    await R.locator(".leaflet-marker-icon").getByText(/^\$\d/).first().click(); // the tag inside the marker (the marker box itself has no size)
    await R.getByRole("group", { name: /^Request .*Driver/ }).waitFor({ timeout: 5000 });
    await tap(R.getByRole("button", { name: "Close", exact: true }));
    await tap(R.getByRole("button", { name: "See list" }));
  });

  await step("asking Dan sends the request to Dan alone", async () => {
    await tap(R.getByRole("button", { name: "Request Dan Driver" }));
    await R.getByText(/Waiting for a reply from Dan Driver/).waitFor({ timeout: 15000 });
    await PD.getByText("This rider chose you").waitFor({ timeout: 40000 });
    await noRequestFor(PF, "Fiona");
    await noRequestFor(PC, "Cal");
  });

  await step("Dan declines: the rider is told and the list says Declined", async () => {
    await tap(PD.getByRole("button", { name: "Decline" }));
    await R.getByText(/Dan Driver declined your ride request/).waitFor({ timeout: 40000 });
    await R.getByText("Declined", { exact: true }).waitFor({ timeout: 10000 });
    await R.getByRole("button", { name: "Request Fiona Driver" }).waitFor({ timeout: 5000 });
    if (await R.getByRole("button", { name: "Request Dan Driver" }).count()) throw new Error("a driver who declined can be asked again");
  });

  await step("asking Fiona; she raises her rates BEFORE she accepts", async () => {
    await tap(R.getByRole("button", { name: "Request Fiona Driver" }));
    await PF.getByText("This rider chose you").waitFor({ timeout: 40000 });
    await tap(tabs(PF).getByText("Account", { exact: true }));
    await openFold(PF, "Your rates");
    await PF.getByLabel("Base fare in USD").fill("9.00");
    await tap(PF.getByRole("button", { name: "Save my rates" }));
    await PF.getByRole("button", { name: "Saved" }).waitFor({ timeout: 5000 });
    await tap(tabs(PF).getByText("Drive", { exact: true }));
    await PF.getByText("This rider chose you").waitFor({ timeout: 15000 });
    await tap(PF.getByRole("button", { name: /^Accept/ }));
    await PF.getByText(/Waiting for/).waitFor({ timeout: 15000 });
  });

  await step("the rider sees Rates changed; a popup stops the confirm until the new rates are read", async () => {
    await R.getByText("Rates changed").waitFor({ timeout: 40000 });
    await tap(R.getByRole("button", { name: "Choose" }).first());
    await R.getByRole("dialog", { name: /Fiona Driver changed their rates/ }).waitFor({ timeout: 10000 });
    const t = await body(R);
    if (!/Before: \$2\.00 base/.test(t) || !/Now: \$9\.00 base/.test(t)) throw new Error("the popup does not show both rates: " + t.slice(0, 500));
    // Going back leaves the driver unconfirmed.
    await tap(R.getByRole("dialog").getByRole("button", { name: "Choose a different driver" }));
    await R.getByText("Rates changed").waitFor({ timeout: 10000 });
    // Choose again, read the new rates, continue: only then can the rider confirm.
    await tap(R.getByRole("button", { name: "Choose" }).first());
    await R.getByRole("dialog", { name: /changed their rates/ }).waitFor({ timeout: 10000 });
    // (Confirm driver is off while the popup is open: `ready` in ConfirmDriver includes "no rate change".)
    await tap(R.getByRole("button", { name: "Continue with the new rates" }));
    await R.getByRole("dialog", { name: /changed their rates/ }).waitFor({ state: "detached", timeout: 5000 });
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
