// GoGet, in a real browser: one app, four contexts, and a whole delivery.
//   • after login the person picks a context (Taxi Driver / Courier / Passenger / Shipping); the slogan "You go. We get." is on the first page
//   • Shipping: posts a delivery (type, size, note, pickup, drop-off, a CDL need with an endorsement) and a second one for LATER
//   • Courier: Account → Courier details (a CDL box with endorsements, what the courier drives); a courier without the CDL does NOT see the request
//   • two couriers bid (a price, minutes, notes, the CDL on the bid); the shipper's Bids tab shows a number and both bids
//   • accepting one bid declines the other; the shipper types the 4-digit code from the courier's phone; the pickup share is paid
//   • the courier marks it delivered near the drop-off (with a photo); the shipper confirms; the rest is paid; earnings show it
//   • each person switches context in Account (Passenger and Taxi Driver are the NostrRide rider and driver screens)
// Takes about two minutes.
import { boot, sleep, PICKUP, DEST, metersNorth } from "./harness.mjs";
import { tap, makeLog, openFold } from "./flow.mjs";

const h = await boot({ apps: ["goget"] });
const log = makeLog();
const pages = {};
let ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of Object.entries(pages)) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    log("errors:", h.errors);
    throw e;
  }
};
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const goTab = (p, name) => tap(tabs(p).getByText(name, { exact: true }));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

// Nothing makes an ecash wallet by itself: Account → Ecash wallet → Create New Wallet (a warning first, then the 12 words; the dialog is closed here).
async function makeWallet(P) {
  await openFold(P, "Ecash wallet");
  const create = P.getByRole("button", { name: "Create New Wallet", exact: true });
  await create.waitFor({ timeout: 15000 });
  await create.click();
  await P.getByRole("button", { name: "Create wallet", exact: true }).click({ timeout: 15000 });
  await P.getByRole("dialog", { name: "Write down 12 words" }).waitFor({ timeout: 20000 });
  await P.getByRole("button", { name: "Close", exact: true }).click();
}
async function ensureWallet(P) {
  await goTab(P, "Account");
  await makeWallet(P);
  await tabs(P).getByRole("button").first().click(); // back to the context's first tab
}
async function enter(name, kp, pos, context) {
  const c = await h.newContext(name, pos);
  pages[name] = c.page;
  await h.login(c.page, kp, h.gogetUrl);
  await c.page.getByRole("button", { name: context }).click({ timeout: 60000 });
  await ensureWallet(c.page);
  return c;
}
async function fund(P) {
  await goTab(P, "Account");
  await openFold(P, "Ecash wallet");
  if (await P.getByRole("button", { name: "Create New Wallet", exact: true }).count()) await makeWallet(P);
  await P.getByRole("button", { name: /Add funds/ }).first().click();
  await P.getByRole("button", { name: "Show invoice" }).click();
  for (let i = 0; i < 40 && ![...h.mint.quotes.values()].some((q) => q.state === "UNPAID"); i++) await sleep(250);
  for (const [k, q] of h.mint.quotes) if (q.state === "UNPAID") h.mint.payQuote(k);
  await P.getByText(/added/).waitFor({ timeout: 20000 });
  await P.getByRole("button", { name: "Done" }).click();
}
async function courierDetails(P, { cdl, endorsements, vehicle }) {
  await goTab(P, "Account");
  await openFold(P, "Courier details");
  if (cdl) {
    await P.getByLabel("I have a CDL").check();
    for (const e of endorsements) await P.getByRole("button", { name: new RegExp(`^${e} ·`) }).click();
  }
  await P.getByLabel("What you drive").fill(vehicle);
  await P.getByRole("button", { name: "Save courier details" }).click();
  await P.getByRole("button", { name: "Saved" }).waitFor({ timeout: 5000 });
}
async function bid(P, { price, eta = "20", note }) {
  await goTab(P, "Jobs");
  await P.getByRole("button", { name: /Equipment|equipment/ }).first().click({ timeout: 30000 });
  await P.getByLabel("Your price").fill(String(price));
  await P.getByLabel("Minutes until you can be at the pickup").fill(eta);
  await P.getByLabel("Notes for the shipper").fill(note);
  await P.getByRole("button", { name: "Send bid" }).click();
  await P.getByText(/Bid sent/).waitFor({ timeout: 15000 });
}

try {
  const alice = h.rider, bob = h.driver, carl = h.newKeys(), dan = h.newKeys();
  for (const [kp, name] of [[alice, "Alice Shipper"], [bob, "Bob Courier"], [carl, "Carl Courier"], [dan, "Dan Courier"]]) h.seedDriver(kp, { name, lud16: "" });
  let A, B, C, D, Bctx;

  await step("after login the picker offers four contexts and the slogan", async () => {
    const a = await h.newContext("alice", PICKUP);
    A = pages.alice = a.page;
    await h.login(A, alice, h.gogetUrl);
    await A.getByText("You go. We get.").first().waitFor({ timeout: 60000 });
    for (const t of ["Taxi Driver", "Courier", "Passenger", "Shipping"]) await A.getByRole("button", { name: t }).waitFor({ timeout: 5000 });
    await A.getByRole("button", { name: "Shipping" }).click();
    for (const t of ["Ship", "Bids", "Deliveries", "Account"]) await tabs(A).getByText(t, { exact: true }).waitFor({ timeout: 10000 });
    await fund(A);
  });

  await step("Shipping: Alice posts a delivery that needs a CDL with the T endorsement", async () => {
    await goTab(A, "Ship");
    await A.getByRole("button", { name: "Large equipment" }).click();
    await A.getByRole("group", { name: "Size" }).getByRole("button", { name: /^Large/ }).click();
    await A.getByLabel("About the delivery").fill("Pallet jack, 400 lb. Needs a lift gate.");
    await A.getByRole("button", { name: /^Pickup:/ }).click();
    await A.getByRole("button", { name: /Set pickup on the map/ }).click();
    await A.getByText("100 Main St, Lexington").first().waitFor({ timeout: 15000 });
    await A.getByRole("button", { name: "Confirm pickup" }).click();
    await A.getByLabel("Drop-off location").fill("Blue Grass");
    await A.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await A.getByRole("button", { name: /^Pickup: 100 Main St/ }).waitFor({ timeout: 5000 });
    await A.getByLabel("Courier must have a CDL").check();
    await A.getByRole("button", { name: /^T ·/ }).click();
    await A.getByLabel("Note for the chosen courier").fill("Ask for Sam at the dock");
    await A.getByRole("button", { name: "Post delivery request" }).click();
    await A.getByText("Waiting for bids").first().waitFor({ timeout: 20000 });
    const text = await A.locator("body").innerText();
    if (/Posted\. Couriers near you/.test(text) === false) log("     (the notice may have gone already)");
  });

  await step("Courier: a courier with no CDL does not see the request", async () => {
    const c = await enter("carl", carl, PICKUP, "Courier");
    C = c.page;
    await goTab(C, "Jobs");
    await C.getByText("No delivery requests right now").waitFor({ timeout: 40000 });
    await sleep(2500); // let the relays deliver: it must STAY hidden
    if (await C.getByRole("button", { name: /Equipment|equipment/ }).count()) throw new Error("a courier without the CDL sees the request");
  });

  await step("Courier: Bob sets the CDL box with endorsements; he sees the request", async () => {
    const b = await enter("bob", bob, PICKUP, "Courier");
    Bctx = b.ctx; B = b.page;
    await courierDetails(B, { cdl: true, endorsements: ["T", "H"], vehicle: "16 ft box truck" });
    await goTab(B, "Jobs");
    await B.getByRole("button", { name: /Equipment|equipment/ }).first().waitFor({ timeout: 40000 });
  });
  await step("Courier: Dan has the T endorsement only (and no tick on H); a courier with an endorsement missing would not see it", async () => {
    const d = await enter("dan", dan, PICKUP, "Courier");
    D = d.page;
    await courierDetails(D, { cdl: true, endorsements: ["T"], vehicle: "Cargo van" });
    await goTab(D, "Jobs");
    await D.getByRole("button", { name: /Equipment|equipment/ }).first().waitFor({ timeout: 40000 });
  });

  await step("both couriers bid, with notes; the CDL shows on the bids", async () => {
    await bid(D, { price: "1.50", eta: "45", note: "Van only, no lift gate" });
    await bid(B, { price: "2", eta: "20", note: "I have a lift gate and straps" });
    await goTab(B, "My jobs");
    await B.getByText("Waiting for the shipper").waitFor({ timeout: 10000 });
  });

  await step("Alice's Bids tab shows a number; both bids are there with the notes and the CDL; nothing has to be decided yet", async () => {
    await A.getByLabel("2 new").waitFor({ timeout: 40000 });
    await goTab(A, "Bids");
    await A.getByTestId("bid-card").nth(1).waitFor({ timeout: 10000 });
    const cards = await A.getByTestId("bid-card").allInnerTexts();
    if (cards.length !== 2) throw new Error("expected 2 bids, got " + cards.length);
    if (!/Van only, no lift gate/.test(cards[0]) || !/CDL · T/.test(cards[0])) throw new Error("the cheaper bid is first, with its note and CDL: " + cards[0].replace(/\s+/g, " "));
    if (!/lift gate and straps/.test(cards[1]) || !/CDL · H, T/.test(cards[1])) throw new Error("Bob's bid: " + cards[1].replace(/\s+/g, " "));
  });

  await step("accepting Bob's bid declines Dan's", async () => {
    await A.getByTestId("bid-card").filter({ hasText: "16 ft box truck" }).getByRole("button", { name: "Accept" }).click();
    await A.getByRole("button", { name: "Accept this bid" }).click();
    await A.getByText("No bids waiting").waitFor({ timeout: 20000 });
    await goTab(D, "My jobs");
    await D.getByText("Declined").first().waitFor({ timeout: 40000 });
    await goTab(B, "My jobs");
    await B.getByRole("button", { name: /Open delivery to/ }).waitFor({ timeout: 40000 });
  });

  let code = "";
  await step("Bob sees the exact places, the shipper's note and the pickup code; Alice types it and the first half is paid", async () => {
    await B.getByRole("button", { name: /Open delivery to/ }).click();
    await B.getByTestId("pickup-code").waitFor({ timeout: 15000 });
    code = (await B.getByTestId("pickup-code").innerText()).trim();
    if (!/^\d{4}$/.test(code)) throw new Error("not a 4-digit code: " + code);
    await B.getByText(/Ask for Sam at the dock/).waitFor({ timeout: 5000 });
    await B.getByText(/100 Main St/).first().waitFor({ timeout: 5000 });
    await goTab(A, "Deliveries");
    await A.getByRole("button", { name: /Courier on the way/ }).click();
    await A.getByLabel("Pickup code").fill(code === "0000" ? "1111" : "0000"); // a wrong code first
    await A.getByRole("button", { name: "Confirm handover" }).click();
    await A.getByText(/That code is not right/).waitFor({ timeout: 5000 });
    await A.getByLabel("Pickup code").fill(code);
    await A.getByRole("button", { name: "Confirm handover" }).click();
    await A.getByText(/is carrying it to the drop-off/).waitFor({ timeout: 20000 });
    for (let i = 0; i < 60; i++) {
      const t = (await B.getByText("Received so far").locator("..").innerText({ timeout: 2000 }).catch(() => "")).replace(/\s+/g, " ");
      if (/\$(1\.00|0\.99)/.test(t)) return;
      await sleep(500);
    }
    throw new Error("Bob did not receive the first half: " + (await B.getByText("Received so far").locator("..").innerText({ timeout: 2000 }).catch(() => "?")));
  });

  await step("Bob gets to the drop-off, adds a photo, marks it delivered; Alice sees the photo and confirms; the rest is paid", async () => {
    await B.getByText(/Take it to the drop-off/).waitFor({ timeout: 20000 });
    if (!(await B.getByRole("button", { name: "Mark delivered" }).isDisabled())) throw new Error("Mark delivered must be locked away from the drop-off");
    await Bctx.setGeolocation({ latitude: DEST.lat, longitude: DEST.lng, accuracy: 10 });
    for (let i = 0; i < 60 && (await B.getByRole("button", { name: "Mark delivered" }).isDisabled()); i++) await sleep(500);
    await B.getByLabel("Photo of the delivered parcel").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PNG });
    await B.getByAltText("Your photo").waitFor({ timeout: 10000 });
    await B.getByRole("button", { name: "Mark delivered" }).click();
    await B.getByRole("button", { name: "Yes, delivered" }).click();
    await A.getByAltText("Photo from the courier at the drop-off").waitFor({ timeout: 40000 });
    await A.getByRole("button", { name: /Parcel received/ }).click();
    await A.getByRole("button", { name: "Yes, pay the courier" }).click();
    await A.getByText("Delivered and paid").waitFor({ timeout: 20000 });
  });

  await step("Bob's earnings show the delivery paid in full (the pickup half and the rest)", async () => {
    await goTab(B, "Earnings");
    await B.getByText(/1 delivery/).waitFor({ timeout: 40000 });
    for (let i = 0; i < 60; i++) {
      const t = (await B.locator("body").innerText({ timeout: 2000 }).catch(() => "")).replace(/\s+/g, " ");
      if (/\$(2\.00|1\.99|1\.98)/.test(t)) return;
      await sleep(500);
    }
    throw new Error("Bob's earnings are not the full price: " + (await B.locator("body").innerText({ timeout: 2000 }).catch(() => "?")).replace(/\s+/g, " ").slice(0, 300));
  });

  await step("a second delivery for LATER, using a recent place; couriers without a CDL need can see it", async () => {
    await goTab(A, "Ship");
    await A.getByRole("button", { name: "Document" }).click();
    await A.getByRole("button", { name: /^Pickup:/ }).click();
    await A.getByRole("button", { name: /100 Main St/ }).first().click({ timeout: 10000 }); // a recent pickup, listed under the map button
    await A.getByLabel("Drop-off location").click();
    await A.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 }); // a recent drop-off
    await A.getByRole("button", { name: "Later" }).click();
    await A.getByLabel("Pickup date and time").waitFor({ timeout: 5000 });
    await A.getByRole("button", { name: "Post delivery request" }).click();
    await A.getByText(/Pickup .*\d/).first().waitFor({ timeout: 20000 });
    await goTab(C, "Jobs");
    await C.getByRole("button", { name: /Document|document/ }).first().waitFor({ timeout: 40000 });
  });

  await step("context switching: Alice becomes a Passenger, Bob a Taxi Driver; each screen is the NostrRide app", async () => {
    await goTab(A, "Account");
    await A.getByRole("button", { name: /Passenger/ }).click();
    await A.getByRole("button", { name: /Where to\?/ }).waitFor({ timeout: 20000 });
    for (const t of ["Ride", "Activity", "Account"]) await tabs(A).getByText(t, { exact: true }).waitFor({ timeout: 5000 });
    await goTab(B, "Account");
    await B.getByRole("button", { name: /Taxi Driver/ }).click();
    await B.getByRole("button", { name: "Go online" }).waitFor({ timeout: 20000 }); // Bob's profile is complete, so the driver app shows GO
    // and back: the choice is remembered after a reload
    await goTab(A, "Account");
    await A.getByRole("button", { name: /Shipping/ }).click();
    await tabs(A).getByText("Deliveries", { exact: true }).waitFor({ timeout: 10000 });
    await A.reload();
    await h.login(A, alice, h.gogetUrl);
    await tabs(A).getByText("Deliveries", { exact: true }).waitFor({ timeout: 60000 });
  });

  const unstyled = await h.missingStyles(A, "goget");
  log("class names on screen with no CSS rule:", unstyled.length ? unstyled.join(" ") : "none");
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
