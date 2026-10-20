// Dark mode and the password eye, in both apps:
//   • Account → Appearance → "Dark Mode (application)" is saved the moment it is flipped (no Save button) and applied at once
//   • "Dark Mode (map)" is a separate switch: the application's dark look leaves the map light, and a dark map leaves the screens alone
//   • a reload keeps it, and the page is dark BEFORE the app's own script runs (no white flash)
//   • the choice is per app/device: it is in this browser's storage ("nostrride_dark")
//   • the password field of "Remember me" and of the Unlock page has a Show / Hide button
// Takes about a minute.
import { boot, sleep, PICKUP } from "./harness.mjs";
import { makeLog, openFold } from "./flow.mjs";

const h = await boot();
const log = makeLog();
let ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) { log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | ")); log("errors:", h.errors); throw e; }
};
const isDark = (p) => p.evaluate(() => document.documentElement.classList.contains("dark"));
const isDarkMap = (p) => p.evaluate(() => document.documentElement.classList.contains("dark-map"));
const tileFilter = (p) => p.evaluate(() => { const t = document.querySelector(".leaflet-tile-pane"); return t ? getComputedStyle(t).filter : null; });
const saved = (p) => p.evaluate(() => localStorage.getItem("nostrride_dark"));
const bg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
try {
  for (const role of ["rider", "driver"]) {
    const { page: P } = await h.newContext(role, PICKUP);
    const url = role === "rider" ? h.riderUrl : h.driverUrl;
    await step(`${role}: the page starts light`, async () => {
      await P.goto(url);
      await P.getByText("I have a key", { exact: true }).waitFor({ timeout: 90000 });
      if (await isDark(P)) throw new Error("dark without being asked");
    });
    await step(`${role}: Dark Mode (application) saves and applies the moment it is flipped`, async () => {
      await h.login(P, role === "rider" ? h.rider : h.driver, url, { wallet: false });
      await P.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
      await openFold(P, "Appearance");
      const light = await bg(P);
      const sw = P.getByRole("switch", { name: "Dark Mode (application)" });
      if ((await sw.getAttribute("aria-checked")) !== "false") throw new Error("the switch should start off");
      await sw.click();
      if (!(await isDark(P))) throw new Error("not dark right after the click");
      if ((await saved(P)) !== "true") throw new Error("not saved: " + (await saved(P)));
      if ((await sw.getAttribute("aria-checked")) !== "true") throw new Error("the switch did not turn on");
      const dark = await bg(P);
      if (dark === light) throw new Error("the page color did not change: " + dark);
      log("     page color:", light, "->", dark);
      if (await isDarkMap(P)) throw new Error("the application's dark look must not turn the map dark");
    });
    await step(`${role}: Units is a switch like the dark ones (off = miles, on = kilometers) and saves at once`, async () => {
      await P.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
      await openFold(P, "Appearance");
      const u = P.getByRole("switch", { name: "Units (kilometers)" });
      if ((await u.getAttribute("aria-checked")) !== "false") throw new Error("Units should start on miles (switch off)");
      await u.click();
      if ((await u.getAttribute("aria-checked")) !== "true") throw new Error("the switch did not turn on");
      const kept = await P.evaluate(() => localStorage.getItem("nostrride_units"));
      if (!/km/.test(kept || "")) throw new Error("not saved as kilometers: " + kept);
      await u.click();
      if (!/mi/.test((await P.evaluate(() => localStorage.getItem("nostrride_units"))) || "")) throw new Error("back to miles was not saved");
    });
    await step(`${role}: Dark Mode (map) is its own switch and only darkens the map`, async () => {
      const first = role === "rider" ? "Ride" : "Drive";
      // The application is dark, the map is not: the tiles have no filter.
      await P.locator('nav[aria-label="Main"]').getByRole("button", { name: first }).click({ timeout: 40000 });
      await P.locator(".leaflet-tile-pane").first().waitFor({ state: "attached", timeout: 40000 });
      const lightMap = await tileFilter(P);
      if (lightMap && lightMap !== "none") throw new Error("the map is dark with only the application dark: " + lightMap);
      await P.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
      await openFold(P, "Appearance");
      const mapSw = P.getByRole("switch", { name: "Dark Mode (map)" });
      if ((await mapSw.getAttribute("aria-checked")) !== "false") throw new Error("the map switch should start off");
      const before = await bg(P);
      await mapSw.click();
      if (!(await isDarkMap(P))) throw new Error("the map did not turn dark");
      if ((await P.evaluate(() => localStorage.getItem("nostrride_darkMap"))) !== "true") throw new Error("the map choice was not saved");
      if (!(await isDark(P))) throw new Error("the application should stay dark");
      if ((await bg(P)) !== before) throw new Error("the map switch changed the screens");
      await P.locator('nav[aria-label="Main"]').getByRole("button", { name: first }).click({ timeout: 40000 });
      await P.locator(".leaflet-tile-pane").first().waitFor({ state: "attached", timeout: 40000 });
      const darkMap = await tileFilter(P);
      if (!darkMap || !darkMap.includes("invert")) throw new Error("the map tiles have no dark filter: " + darkMap);
      await P.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
    });
    await step(`${role}: a reload is dark before the app starts`, async () => {
      // Block the app's own bundle: only public/theme-init.js can have set the class.
      await P.route(/\/assets\/index-.*\.js/, (r) => r.abort());
      await P.reload();
      await sleep(500);
      if (!(await isDark(P))) throw new Error("the first-paint script did not set the dark look");
      if (!(await isDarkMap(P))) throw new Error("the first-paint script did not set the dark map");
      await P.unroute(/\/assets\/index-.*\.js/);
      await P.reload();
      await P.getByRole("button", { name: "Account" }).waitFor({ timeout: 40000 }).catch(() => {});
    });
    await step(`${role}: switching back to light saves too`, async () => {
      await h.login(P, role === "rider" ? h.rider : h.driver, url, { wallet: false }).catch(() => {});
      await P.getByRole("button", { name: "Account" }).click({ timeout: 40000 });
      await openFold(P, "Appearance");
      await P.getByRole("switch", { name: "Dark Mode (application)" }).click();
      if (await isDark(P)) throw new Error("still dark");
      if ((await saved(P)) !== "false") throw new Error("not saved: " + (await saved(P)));
      if (!(await isDarkMap(P))) throw new Error("a light application must leave the dark map alone");
      await P.getByRole("switch", { name: "Dark Mode (map)" }).click();
      if (await isDarkMap(P)) throw new Error("the map is still dark");
      if ((await P.evaluate(() => localStorage.getItem("nostrride_darkMap"))) !== "false") throw new Error("the map choice was not saved");
    });
    await P.context().close();
  }

  await step("the password eye: Remember me, then Unlock", async () => {
    const { page: P } = await h.newContext("rider", PICKUP);
    await P.goto(h.riderUrl);
    await P.getByText("I have a key", { exact: true }).click({ timeout: 90000 });
    await P.getByPlaceholder("nsec1...").fill(h.rider.nsec);
    const remember = P.getByLabel(/Remember me/);
    if (!(await remember.isChecked())) await remember.check();
    const pw = P.getByLabel("Password", { exact: true });
    await pw.fill("correct horse battery");
    if ((await pw.getAttribute("type")) !== "password") throw new Error("the password should start hidden");
    await P.getByRole("button", { name: "Show password" }).click();
    if ((await pw.getAttribute("type")) !== "text") throw new Error("Show password did not show it");
    if ((await pw.inputValue()) !== "correct horse battery") throw new Error("the typed text changed");
    await P.getByRole("button", { name: "Hide password" }).click();
    if ((await pw.getAttribute("type")) !== "password") throw new Error("Hide password did not hide it");
    await P.getByRole("button", { name: "Continue" }).click();
    await P.getByRole("button", { name: "Account" }).waitFor({ timeout: 40000 });
    // A reload shows the Unlock page for the saved account.
    await P.reload();
    await P.getByText(/Welcome back/).waitFor({ timeout: 40000 });
    const pw2 = P.getByLabel("Password", { exact: true });
    await pw2.fill("wrong words");
    if ((await pw2.getAttribute("type")) !== "password") throw new Error("Unlock: the password should start hidden");
    await P.getByRole("button", { name: "Show password" }).click();
    if ((await pw2.getAttribute("type")) !== "text") throw new Error("Unlock: Show password did not show it");
    await P.getByRole("button", { name: "Hide password" }).click();
    await pw2.fill("correct horse battery");
    await P.getByRole("button", { name: "Unlock" }).click();
    await P.getByRole("button", { name: "Account" }).waitFor({ timeout: 40000 });
    await P.context().close();
  });

  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
