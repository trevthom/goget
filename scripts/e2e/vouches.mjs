// Vouches ("I know and trust this person") in both apps:
//   • Fran (a friend) vouches for Dina and for the rider, in ONE list: a vouch is for the person, in either role
//   • a stranger vouches for Sam; nobody the rider or Dina vouches for knows Sam, so Sam shows no badge at all
//   • Dina adds Fran in Account → Your vouches (driver app): the request card shows "1 of your vouches knows and trusts this person" for the rider
//   • the rider first sees no badge on the offers; an nsec typed into the field is refused; the rider adds Fran's npub
//     → Dina's offer shows the badge (Sam's does not); a tap on the badge names Fran; Remove takes the badge away at once
//   • the rider's own list reaches the relay as a kind 30102 event; there are no stars and no review box anywhere
// Takes about a minute. The pages are styled like the real app (Tailwind is built into the app CSS).
import { boot, sleep, PICKUP, metersNorth } from "./harness.mjs";
import { tap, makeLog, pinPickup, openFold } from "./flow.mjs";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const V = await import(`${REPO}/src/lib/vouches.js`);
const Keys = await import(`${REPO}/src/nostr/keys.js`);
const Ev = await import(`${REPO}/src/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${REPO}/src/nostr/eventKinds.js`);

const h = await boot();
const log = makeLog();
const dina = h.driver; // already seeded as "Dina Driver"
const sam = h.seedDriver(h.newKeys(), { name: "Sam Driver" });
const fran = h.newKeys(), stranger = h.newKeys();
const signedList = (kp, people) => {
  const ev = V.vouchEvent(people.map((p) => p.publicKey));
  return Ev.buildSignedEvent(ev.kind, ev.content, [...ev.tags, ["t", "nostrride"]], kp.sk);
};
h.relay.inject(Ev.buildSignedEvent(K.METADATA, { name: "Fran Friend", about: "NostrRide user", communication: [] }, [], fran.sk));
h.relay.inject(signedList(fran, [dina, h.rider])); // one list: Dina (as a driver) and the rider (as a rider)
h.relay.inject(signedList(stranger, [sam]));       // a stranger nobody here vouches for

const BADGE = /of your vouches (knows|know) and trust/;
let R, D, S, ok = false;
const step = async (name, fn) => {
  try { await fn(); log("ok  ", name); }
  catch (e) {
    log("FAIL", name, "-", e.message.split("\n").slice(0, 6).join(" | "));
    for (const [n, p] of [["rider", R], ["Dina", D], ["Sam", S]]) if (p) log(`${n} page text:`, (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600));
    log("errors:", h.errors);
    throw e;
  }
};
const snap = async (p, name) => { if (process.env.E2E_SHOTS) { await sleep(600); await p.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` }); } };
const tabs = (p) => p.locator('nav[aria-label="Main"]');
const goAccount = async (p) => { await tap(tabs(p).getByText("Account", { exact: true })); await openFold(p, "Your vouches"); await p.getByLabel("npub of a person you know and trust").waitFor({ timeout: 10000 }); };
const addVouch = async (p, who) => {
  await p.getByLabel("npub of a person you know and trust").fill(Keys.fullNpub(who.publicKey));
  await tap(addButton(p));
};
const badges = (p) => p.getByText(BADGE).count();
// The Account screen has other "Add" buttons: take the one in the "Your vouches" section.
const addButton = (p) => p.locator("section", { has: p.getByLabel("npub of a person you know and trust") }).getByRole("button", { name: "Add", exact: true });

try {
  const near = metersNorth(PICKUP, 25);
  R = (await h.newContext("rider", PICKUP)).page;
  D = (await h.newContext("dina", near)).page;
  S = (await h.newContext("sam", near)).page;

  await step("Dina and Sam go online", async () => {
    for (const [p, kp] of [[D, dina], [S, sam]]) {
      await h.login(p, kp, h.driverUrl); // drivers need a wallet to go online
      await p.getByRole("button", { name: "Go online" }).click({ timeout: 40000 });
      await p.getByText("You're online").waitFor({ timeout: 15000 });
    }
  });

  await step("Dina's Account has \"Your vouches\"; she adds Fran and Fran's name shows", async () => {
    await goAccount(D);
    await D.getByText("You do not vouch for anyone yet.").waitFor({ timeout: 5000 });
    await D.getByText(/Your list is public/).waitFor({ timeout: 5000 });
    await addVouch(D, fran);
    await D.getByRole("list", { name: "People you vouch for" }).getByText("Fran Friend").waitFor({ timeout: 20000 });
    // Remove works the moment a person is added: it waits for no relay.
    if (await D.getByRole("button", { name: /^Remove / }).first().isDisabled()) throw new Error("Remove must work right after Add");
    await snap(D, "driver-your-vouches");
    await tap(tabs(D).getByText("Drive", { exact: true }));
    await D.getByText("You're online").waitFor({ timeout: 10000 });
  });

  await step("the rider requests a ride", async () => {
    await h.login(R, h.rider, h.riderUrl, { wallet: false });
    await R.getByText(/2 drivers online nearby/).waitFor({ timeout: 60000 });
    await tap(R.getByRole("button", { name: /Where to\?/ }));
    await pinPickup(R);
    await R.getByLabel("Where to?").fill("Blue Grass");
    await R.getByRole("button", { name: /Blue Grass Airport/ }).first().click({ timeout: 10000 });
    await R.getByRole("button", { name: "Request ride", exact: true }).waitFor({ timeout: 15000 });
    await R.getByRole("button", { name: "Request ride", exact: true }).click({ timeout: 15000 });
    // Two drivers are nearby: the rider browses them and asks both from the list.
    await R.getByRole("heading", { name: "Choose a driver" }).waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Request Dina Driver" }));
    await R.getByText(/Waiting for a reply from Dina Driver/).waitFor({ timeout: 15000 });
    await tap(R.getByRole("button", { name: "Request Sam Driver" }));
    await R.getByText(/Waiting for a reply from .*Sam Driver/).waitFor({ timeout: 15000 });
  });

  await step("Dina's request card says 1 of her vouches knows and trusts the rider; Sam's card has no badge", async () => {
    await D.getByText("New ride request").waitFor({ timeout: 40000 });
    await S.getByText("New ride request").waitFor({ timeout: 40000 });
    await D.getByText("1 of your vouches knows and trusts this person").waitFor({ timeout: 20000 });
    await sleep(1500);
    if (await badges(S)) throw new Error("Sam has no vouches, but his card shows a badge");
    await snap(D, "driver-request-badge");
  });

  await step("both drivers accept; the rider sees two offers and NO badge yet", async () => {
    await tap(D.getByRole("button", { name: /^Accept/ }));
    await tap(S.getByRole("button", { name: /^Accept/ }));
    await R.getByText("Dina Driver").first().waitFor({ timeout: 40000 });
    await R.getByText("Sam Driver").first().waitFor({ timeout: 40000 });
    await sleep(1500);
    if (await badges(R)) throw new Error("the rider vouches for nobody, but a badge shows");
  });

  await step("an nsec is refused; the rider adds Fran's npub", async () => {
    await goAccount(R);
    await R.getByLabel("npub of a person you know and trust").fill(h.rider.nsec);
    await tap(addButton(R));
    await R.getByRole("alert").filter({ hasText: /SECRET key/ }).waitFor({ timeout: 5000 });
    await R.getByLabel("npub of a person you know and trust").fill("npub1notarealkey");
    await tap(addButton(R));
    await R.getByRole("alert").filter({ hasText: /not valid|not an npub/ }).waitFor({ timeout: 5000 });
    await addVouch(R, fran);
    await R.getByRole("list", { name: "People you vouch for" }).getByText("Fran Friend").waitFor({ timeout: 20000 });
    await snap(R, "rider-your-vouches");
  });

  await step("Dina's offer shows the badge; Sam's does not; a tap names Fran", async () => {
    await tap(tabs(R).getByText("Ride", { exact: true }));
    await R.getByText("Dina Driver").first().waitFor({ timeout: 15000 });
    await R.getByText("1 of your vouches knows and trusts this person").waitFor({ timeout: 20000 });
    if ((await badges(R)) !== 1) throw new Error("expected exactly one badge, found " + (await badges(R)));
    const card = R.locator("div", { has: R.getByText("Dina Driver") }).filter({ has: R.getByText(BADGE) }).last();
    if (await card.getByText("Sam Driver").count()) throw new Error("the badge sits on a card that also holds Sam");
    await tap(R.getByRole("button", { name: /of your vouches knows and trusts/ }));
    await R.getByText("Fran Friend", { exact: true }).first().waitFor({ timeout: 5000 });
    await snap(R, "rider-offer-badge");
  });

  await step("no stars and no review box anywhere on the rider's screens", async () => {
    const text = await R.locator("body").innerText();
    if (/★|review|Rate your|stars?\b/i.test(text)) throw new Error("rating wording on screen: " + text.replace(/\s+/g, " ").slice(0, 300));
  });

  await step("Remove takes the badge away at once", async () => {
    await goAccount(R);
    await tap(R.getByRole("button", { name: "Remove Fran Friend" }));
    await R.getByText("You do not vouch for anyone yet.").waitFor({ timeout: 10000 });
    await tap(tabs(R).getByText("Ride", { exact: true }));
    await R.getByText("Dina Driver").first().waitFor({ timeout: 15000 });
    await sleep(1000);
    if (await badges(R)) throw new Error("the badge is still there after Remove");
  });

  await step("the lists reached the relay: the rider's newest list is empty, Dina's holds Fran", async () => {
    const lists = h.relay.events.filter((e) => e.kind === K.VOUCH_LIST);
    const newest = (kp) => lists.filter((e) => e.pubkey === kp.publicKey).sort((a, b) => b.created_at - a.created_at)[0];
    const r = newest(h.rider), d = newest(dina);
    if (!r) throw new Error("no vouch list from the rider reached the relay");
    if (r.tags.some((t) => t[0] === "p")) throw new Error("the rider's newest list should be empty after Remove");
    if (!r.tags.some((t) => t[0] === "t" && t[1] === "nostrride")) throw new Error("the list lacks the app tag");
    if (!d?.tags.some((t) => t[0] === "p" && t[1] === fran.publicKey)) throw new Error("Dina's list lacks Fran");
  });

  for (const [n, p, role] of [["R", R, "rider"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (R):", u.length ? u.join(" ") : "none"); }
  for (const [n, p, role] of [["D", D, "driver"]]) { const u = await h.missingStyles(p, role); log("class names on screen with no CSS rule (D):", u.length ? u.join(" ") : "none"); }
  log("errors:", h.errors.length ? h.errors : "none");
  ok = !h.errors.length;
} catch { log("RUN FAILED"); } finally { await h.stop(); }
process.exit(ok ? 0 : 1);
