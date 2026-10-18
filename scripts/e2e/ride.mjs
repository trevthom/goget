import { boot, sleep, PICKUP, DEST, metersNorth } from "./harness.mjs";
import { pinPickup, openFold } from "./flow.mjs";
import { tmpdir } from "node:os";
const SC = tmpdir(); // failure screenshots go here
const SHARE_CHECK = process.env.SHARE_CHECK === "1"; // the rider shares the trip; the shared position must be the RIDER's phone, every ~6 s
const h = await boot({ feePpk: 100 });
let D, R, dctx, rctx;
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s]`, ...a);
async function step(name, fn) {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 8).join(" | "));
    for (const [n, p] of [["driver", D], ["rider", R]]) if (p) { await p.screenshot({ path: `${SC}/fail-${n}.png` }).catch(() => {}); log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 700)); }
    log("errors:", h.errors);
    throw e;
  }
}
const openSheet = async (p) => { const b = p.getByRole("button", { name: /drag up to open/ }); if (await b.count()) await b.first().click(); await sleep(400); };
const num = (s) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
const satsIn = async (loc) => { const t = await loc.first().locator(":scope").getByText(/^[\d,]+ sats$/).first().innerText().catch(() => "0"); return num(t); };
const geo = (c, p) => c.setGeolocation({ latitude: p.lat, longitude: p.lng, accuracy: 10 });
let ok = false;
try {
  const dStart = metersNorth(PICKUP, 800);
  ({ ctx: dctx, page: D } = await h.newContext("driver", dStart));
  ({ ctx: rctx, page: R } = await h.newContext("rider", PICKUP));

  await step("driver logs in and goes online", async () => {
    await h.login(D, h.driver, h.driverUrl);
    await D.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
    await D.getByText("You're online").waitFor({ timeout: 15000 });
  });

  await step("rider logs in and adds funds with Lightning (ecash from the mint)", async () => {
    await h.login(R, h.rider, h.riderUrl);
    await R.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    await openFold(R, "Ecash wallet");
    await R.getByRole("button", { name: /Add funds/ }).first().click();
    await R.getByRole("button", { name: "Show invoice" }).click();
    for (let i = 0; i < 40 && !h.mint.quotes.size; i++) await sleep(250);
    const [id] = [...h.mint.quotes.keys()];
    if (!id) throw new Error("no mint quote was made");
    h.mint.payQuote(id);
    await R.getByText(/added/).waitFor({ timeout: 20000 });
    await R.getByRole("button", { name: "Done" }).click();
    const bal = (await R.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
    log("     rider balance:", bal.slice(0, 80));
    if (!/5,000 sats/.test(bal)) throw new Error("expected 5,000 sats in the ecash wallet: " + bal);
  });

  await step("rider plans a trip and requests (standard fare)", async () => {
    await R.locator('nav[aria-label="Main"]').getByText("Ride", { exact: true }).click();
    await R.getByRole("button", { name: /Where to\?/ }).click();
    await R.getByLabel("Where to?").waitFor();
    await R.getByLabel("Pickup location").waitFor();
    await pinPickup(R);
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByText("Blue Grass Airport", { exact: false }).first().click({ timeout: 10000 });
    await R.getByRole("button", { name: /Request ride · / }).click({ timeout: 15000 });
    await R.getByText(/Finding your driver/).first().waitFor({ timeout: 15000 });
  });

  await step("driver gets the request and accepts", async () => {
    await D.getByText("New ride request").waitFor({ timeout: 40000 });
    log("     driver card:", (await D.getByText(/Your standard fare/).first().innerText()));
    await D.getByRole("button", { name: /^Accept/ }).click();
    await D.getByText(/Waiting for/).first().waitFor({ timeout: 15000 });
  });

  await step("rider chooses the driver and confirms (funds are enough)", async () => {
    await R.getByText(/can take you/).waitFor({ timeout: 40000 });
    const terms = await R.getByText(/Standard fare/).first().innerText();
    log("     terms shown:", terms.replace(/\s+/g, " ").slice(0, 120));
    await R.getByRole("button", { name: "Choose" }).click();
    await R.getByText("Confirm your driver").first().waitFor();
    log("     needed to start:", (await R.getByText("Needed to start").locator("..").innerText()).replace(/\s+/g, " "));
    await R.getByRole("button", { name: "Confirm driver" }).click({ timeout: 15000 });
  });

  if (SHARE_CHECK) await step("shared trip: the position is the rider's own phone (not the car's), sent every ~6 s", async () => {
    const Sh = await import("../../src/nostr/share.js");
    await openSheet(R);
    await R.getByRole("button", { name: /Safety/ }).first().click({ timeout: 15000 });
    await R.getByRole("button", { name: "Start sharing" }).click();
    const text = await R.locator("p.font-mono").first().innerText({ timeout: 10000 });
    const token = Sh.parseShareHash(new URL(text.trim()).hash)?.token;
    if (!token) throw new Error("no share link on the Safety sheet: " + text);
    const seen = []; // [{ id, at (ms when we saw it), p (the decrypted payload) }]
    const t1 = Date.now() + 26000;
    while (Date.now() < t1) {
      const ev = h.relay.events.filter((e) => e.kind === 30091).sort((a, b) => b.created_at - a.created_at)[0];
      if (ev && !seen.some((x) => x.id === ev.id)) { const p = Sh.openShare(token, JSON.parse(ev.content).sealed); if (p) seen.push({ id: ev.id, at: Date.now(), p }); }
      await sleep(250);
    }
    log("     updates seen:", seen.length, "gaps (s):", seen.slice(1).map((x, i) => ((x.at - seen[i].at) / 1000).toFixed(1)).join(" "));
    const last = seen.at(-1)?.p;
    if (!last) throw new Error("no shared update reached the relay");
    if (last.who !== "rider") throw new Error("the update should say whose position it is: " + JSON.stringify(last));
    if (Math.abs(last.lat - PICKUP.lat) > 0.0005 || Math.abs(last.lng - PICKUP.lng) > 0.0005) throw new Error(`the shared position is not the rider's phone (${last.lat}, ${last.lng}); the rider is at ${PICKUP.lat}, ${PICKUP.lng}`);
    if (!last.carPos || Math.abs(last.carPos.lat - metersNorth(PICKUP, 800).lat) > 0.002) throw new Error("the car should still be shown, 800 m away: " + JSON.stringify(last.carPos));
    if (Math.abs(last.lat - last.carPos.lat) < 0.003) throw new Error("rider and car positions are the same: the test cannot tell them apart");
    if (seen.length < 3) throw new Error("expected an update about every 6 s, saw " + seen.length);
    const gaps = seen.slice(1).map((x, i) => x.at - seen[i].at);
    if (Math.min(...gaps) < 4000) throw new Error("updates came faster than the 6 s pace: " + gaps.join(","));
    if (Math.max(...gaps) > 9000) throw new Error("an update was late (more than 9 s): " + gaps.join(","));
    // A friend opens the link: the page shows the rider, says so, and draws a blue dot.
    const { page: F } = await h.newContext("friend", PICKUP);
    await F.goto(new URL("track.html", h.riderUrl).href + new URL(text.trim()).hash);
    await F.getByText(/is on a trip/).waitFor({ timeout: 20000 });
    await F.getByText(/The blue dot is .*own phone/).waitFor({ timeout: 10000 });
    if (!(await F.locator(".nr-me, .leaflet-marker-icon").count())) throw new Error("the friend's map has no marker");
    if (process.env.E2E_SHOTS) { await sleep(600); await F.screenshot({ path: `${process.env.E2E_SHOTS}/friend-view.png` }); }
    await R.getByRole("button", { name: "Close" }).click();
  });

  await step("driver: Arrived is locked until within 150 m", async () => {
    await D.getByText(/Pick up/).first().waitFor({ timeout: 40000 });
    await openSheet(D);
    const btn = D.getByRole("button", { name: "I've arrived" });
    await btn.waitFor();
    if (!(await btn.isDisabled())) throw new Error("the arrived button should be disabled 800 m away");
    log("     reason:", (await D.getByText(/You are \d+ m from the pickup/).first().innerText()));
    await geo(dctx, metersNorth(PICKUP, 200));
    await D.getByText(/You are 2\d\d m from the pickup. Get within 150 m/).first().waitFor({ timeout: 20000 });
    if (!(await btn.isDisabled())) throw new Error("the arrived button should still be disabled 200 m away");
    await geo(dctx, metersNorth(PICKUP, 120));
    for (let i = 0; i < 40 && (await btn.isDisabled()); i++) await sleep(500);
    if (await btn.isDisabled()) throw new Error("still disabled at 120 m");
    await btn.click();
  });

  let startCode;
  await step("the rider checks the car by eye (no button) and types the driver's 4-digit start code", async () => {
    await R.locator("#start-code").waitFor({ state: "visible", timeout: 40000 }); // the code field is there at once: nothing to tap first
    if (await R.getByRole("button", { name: /It matches|Doesn't match/ }).count()) throw new Error("the rider must not have to confirm the car");
    if (await R.getByLabel(/The start code is/).count()) throw new Error("the rider's phone must not show the code");
    const dLabel = await D.getByLabel(/The start code is/).getAttribute("aria-label", { timeout: 15000 });
    startCode = dLabel.match(/\d{4}/)[0];
    log(`     the start code on the driver's phone: ${startCode}`);
    const start = D.getByRole("button", { name: "Start trip" });
    if (!(await start.isDisabled())) throw new Error("Start trip must wait for the rider to type the code");
    // A wrong code is refused.
    const wrong = String((Number(startCode) + 1) % 10000).padStart(4, "0");
    await R.locator("#start-code").fill(wrong);
    // All four digits must be visible in the field (a squeezed field once showed only two).
    const room = await R.locator("#start-code").evaluate((el) => ({ box: el.getBoundingClientRect().width, need: el.scrollWidth, have: el.clientWidth }));
    if (room.need > room.have || room.box < 120) throw new Error(`the start code field is too narrow: ${JSON.stringify(room)}`);
    await R.getByRole("button", { name: "Confirm", exact: true }).click();
    await R.getByText(/not the 4-digit code on your driver/).waitFor({ timeout: 5000 });
    if (!(await start.isDisabled())) throw new Error("a wrong code must not unlock Start trip");
    await R.locator("#start-code").fill(startCode);
    await R.getByRole("button", { name: "Confirm", exact: true }).click();
    await D.getByText(/Your rider typed the code/).waitFor({ timeout: 20000 });
    if (await D.locator("input[inputmode=numeric]").count()) throw new Error("the driver must not have to type anything");
    for (let i = 0; i < 20 && (await start.isDisabled()); i++) await sleep(300);
    await start.click();
  });

  let startedAt;
  await step("the base rate is paid when the ride starts", async () => {
    startedAt = Date.now();
    await D.getByText(/Drop off at/).first().waitFor({ timeout: 30000 });
    await openSheet(D);
    await D.getByText("Paid by the rider").waitFor({ timeout: 30000 });
    let paid = 0;
    for (let i = 0; i < 40 && !paid; i++) { await sleep(500); paid = await satsIn(D.getByText("Paid by the rider").locator("..")); }
    log("     driver sees paid:", paid, "sats");
    if (paid < 1000) throw new Error("the base tick was not paid/confirmed: " + paid);
  });

  await step("drive ~1.2 miles for 70 s; a minute tick and a mile tick are paid", async () => {
    const steps = 22; const total = 1950; // metres
    for (let i = 1; i <= steps; i++) {
      const p = { lat: PICKUP.lat, lng: PICKUP.lng - (total * i / steps) / 88000 };
      await geo(dctx, p); await geo(rctx, p);
      await sleep(3200);
    }
    const left = 72000 - (Date.now() - startedAt);
    if (left > 0) await sleep(left);
    await sleep(8000);
    await openSheet(R);
    const rFare = await satsIn(R.getByText("Fare so far").locator(".."));
    const rPaid = await satsIn(R.getByText("Paid", { exact: true }).locator(".."));
    const dFare = await satsIn(D.getByText("Fare so far").locator(".."));
    const dPaid = await satsIn(D.getByText("Paid by the rider").locator(".."));
    log(`     rider: fare ${rFare} paid ${rPaid} | driver: fare ${dFare} paid ${dPaid}`);
    log("     rider meter:", (await R.getByText(/mi\b/).first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 80));
    if (rFare <= 1800) throw new Error("a minute (and a mile) should be on the fare by now: " + rFare);
    if (dPaid < rPaid - 500) throw new Error("the driver should have confirmed almost all payments");
    // The four "Paid so far" lines on both screens: the base, the miles and the minutes paid until now.
    const lines = async (P) => (await P.getByRole("group", { name: "Paid so far" }).innerText()).replace(/\s+/g, " ").trim();
    const rLines = await lines(R), dLines = await lines(D);
    log("     rider lines:", rLines);
    log("     driver lines:", dLines);
    for (const t of [rLines, dLines]) {
      if (!/^Paid so far: Base rate: \$1\.50 Miles: [1-9]\d* \(\$\d+\.\d\d\) Minutes: [1-9]\d* \(\$\d+\.\d\d\)$/.test(t)) throw new Error("the Paid so far lines are wrong: " + t);
    }
  });

  await step("the trip card: live ecash balance (red at $5 or less), the estimate below Paid, the trip clock with seconds", async () => {
    // 1. The rider's ecash balance sits above "Fare so far", is live, and is red at $5.00 or less (this wallet started with $5.00).
    const bal = R.getByRole("status", { name: "Your ecash balance" });
    await bal.waitFor({ timeout: 10000 });
    const balText = (await bal.innerText()).replace(/\s+/g, " ");
    const balSats = await satsIn(bal);
    log("     rider balance row:", balText);
    const yBal = (await bal.boundingBox()).y, yFare = (await R.getByText("Fare so far").boundingBox()).y;
    if (!(yBal < yFare)) throw new Error("the balance must be above Fare so far");
    const color = await bal.getByText("Your ecash").evaluate((el) => getComputedStyle(el).color);
    if (color !== "rgb(220, 38, 38)") throw new Error("a balance of $5 or less must be red: " + color + " (" + balText + ")");
    if (!(balSats > 0 && balSats < 5000)) throw new Error("the balance should have dropped below the $5.00 it started with after the ticks: " + balSats);
    const before = balSats;
    await sleep(65000); // a minute tick falls due: the balance moves by itself
    const after = await satsIn(R.getByRole("status", { name: "Your ecash balance" }));
    if (!(after < before)) throw new Error(`the balance did not move on its own: ${before} -> ${after}`);
    log(`     the balance moved live: ${before} -> ${after} sats`);
    // 2. The estimate is a dashed "≈" row BELOW Paid on both screens, and the old one at the bottom of the sheet is gone.
    for (const [who, P, paidLabel] of [["rider", R, "Paid"], ["driver", D, "Paid by the rider"]]) {
      const est = P.getByRole("group", { name: "Estimated total fare" });
      await est.waitFor({ timeout: 10000 });
      const t = (await est.innerText()).replace(/\s+/g, " ");
      if (!/Estimated total ≈\s*\$\d/.test(t)) throw new Error(`${who}: the estimate must read "Estimated total ≈ $…": ` + t);
      const paidY = (await P.getByText(paidLabel, { exact: true }).boundingBox()).y, estY = (await est.boundingBox()).y;
      if (!(estY > paidY)) throw new Error(`${who}: the estimate must be below ${paidLabel}`);
      if (!/dashed/.test(await est.evaluate((el) => getComputedStyle(el).borderTopStyle))) throw new Error(`${who}: the estimate must have a dashed outline`);
      if (await P.getByText("estimate", { exact: true }).count()) throw new Error(`${who}: the old "estimate" at the bottom of the sheet must be gone`);
      log(`     ${who} estimate:`, t);
    }
    // 3. "Trip so far" counts the seconds, on both screens, and moves.
    for (const [who, P] of [["rider", R], ["driver", D]]) {
      const read = async () => (await P.getByRole("group", { name: "Trip meter" }).innerText()).replace(/\s+/g, " ");
      const t1 = await read();
      if (!/Trip so far [\d.]+ mi · (\d+ h \d\d min \d\d s|\d+ min \d\d s|\d+ s)/i.test(t1)) throw new Error(`${who}: "Trip so far" must show seconds: ` + t1);
      await sleep(2500);
      const t2 = await read();
      if (t1 === t2) throw new Error(`${who}: the trip clock did not move: ` + t2);
      log(`     ${who} trip clock:`, t1, "->", t2);
    }
  });

  await step("rider finishes the ride (confirm dialog) and sees the receipt", async () => {
    await openSheet(R);
    await R.getByRole("button", { name: "Finish ride" }).first().click();
    await R.getByText("Finish this ride?").waitFor();
    await R.getByRole("button", { name: "Finish ride" }).last().click();
    await R.getByText("Ride finished").waitFor({ timeout: 20000 });
    const text = (await R.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     rider receipt:", text);
  });

  await step("driver sees the summary; payments add up", async () => {
    await D.getByText("Ride finished").waitFor({ timeout: 30000 });
    await sleep(6000);
    const text = (await D.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     driver summary:", text);
    // A few seconds after the finish both screens must show the same fare and the same paid amount.
    const later = (await R.locator("dl").first().innerText()).replace(/\s+/g, " ");
    log("     rider receipt, later:", later);
    const sats = (t) => [...t.replace(/\$\d[\d,]*\.\d\d\s*/g, "").matchAll(/([\d,]+) sats/g)].map((m) => m[1]); // drop the "$3.64" in front of "3,635 sats" (styling puts a space or none between them)
    if (sats(text).slice(0, 2).join() !== sats(later).slice(0, 2).join()) throw new Error(`rider and driver disagree: ${sats(later)} vs ${sats(text)}`);
    await D.getByRole("button", { name: "Back to driving" }).click();
    await D.getByRole("button", { name: "Account" }).click();
    await openFold(D, "Ecash wallet");
    const w = (await D.getByText("Balance").first().locator("..").innerText()).replace(/\s+/g, " ");
    log("     driver wallet:", w.slice(0, 100));
  });

  await step("the relay holds no readable job event: only gift wraps (kind 1059)", async () => {
    const sealed = new Set([30078, 30079, 30080, 30081, 30084, 30085, 30086, 30087, 30093, 30094, 30095, 30096, 30097, 30098, 30099, 30100, 30101, 30103, 30104, 30105, 30106, 30107, 30108, 30109, 30110]);
    const leaked = h.relay.events.filter((e) => sealed.has(e.kind));
    const wraps = h.relay.events.filter((e) => e.kind === 1059);
    if (leaked.length) throw new Error(`relay holds ${leaked.length} readable job events (kinds ${[...new Set(leaked.map((e) => e.kind))]})`);
    if (wraps.length < 10) throw new Error(`only ${wraps.length} wraps on the relay`);
    log("     wraps on the relay:", wraps.length);
  });

  for (const [n, p, role] of [["R", R, "rider"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (R):", u.length ? u.join(" ") : "none"); }
  for (const [n, p, role] of [["D", D, "driver"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (D):", u.length ? u.join(" ") : "none"); }
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch (e) {
  log("RUN FAILED");
} finally {
  await h.stop();
}
process.exit(ok ? 0 : 1);
