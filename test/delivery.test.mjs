// GoGet deliveries: CDL rules, requests, bids, accepting one bid (all others declined), stages, the pickup code, exact places,
// the two-part ecash payment, and who may write what.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const D = await import(`${R}/lib/delivery.js`);
const P = await import(`${R}/lib/deliveryPay.js`);
const C = await import(`${R}/lib/cdl.js`);
const B = await import(`${R}/lib/blocks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const MINT = "https://mint.test";
const user = (kp) => ({ sk: kp.sk, publicKey: kp.publicKey });
const as = (kp) => D.setDeliveryViewer(kp ? user(kp) : null); // whose eyes: every sealed read opens with the logged-in person's key
const ship = generateKeypair(), c1 = generateKeypair(), c2 = generateKeypair(), c3 = generateKeypair(), stranger = generateKeypair();
// Sign a built event ({kind, content, tags}) as `who` and put it in the cache, as a relay would deliver it.
let clock = Math.floor(Date.now() / 1000) - 1000;
const pub = ({ kind, content, tags }, who) => {
  const e = buildSignedEvent(kind, content, [...tags.filter((t) => !(t[0] === "t" && t[1] === "nostrride")), ["t", "nostrride"]], who.sk);
  relay._store(e);
  return e;
};
const place = (name, lat, lng) => ({ name, lat, lng, area: "Downtown" });
const form = (over = {}) => ({ type: "equipment", size: "oversize", note: "A pallet jack, 400 lb", pickup: place("12 Dock St", 38.0406, -84.5037), dropoff: place("99 Mill Rd", 38.1, -84.6), time: "ASAP", cdl: { required: false, endorsements: [] }, distanceMiles: 8.34, durationMin: 19, contact: "Ask for Sam, 555-0100", ...over });
const bid = (req, who, over = {}) => pub(D.bidEvent(req, user(who), { priceSats: 20000, etaMinutes: 30, note: "I have a lift gate", cdl: { has: false, endorsements: [] }, vehicle: "Box truck", mint: MINT, upfrontPct: 50, ...over }), who);
const latest = (req) => relay.query({ kinds: [K.DELIVERY_REQUEST], authors: [req.pubkey], "#d": [req.tags.find((t) => t[0] === "d")[1]] }).sort((a, b) => b.created_at - a.created_at || 0)[0];

// ── CDL ──
assert.deepEqual(C.normalizeCdl({ has: true, endorsements: ["h", "T", "zz", "H"] }), { has: true, endorsements: ["H", "T"] }, "known letters only, once each");
assert.deepEqual(C.normalizeCdl({ has: false, endorsements: ["H"] }), { has: false, endorsements: [] }, "endorsements need a CDL");
assert.deepEqual(C.normalizeCdl("junk"), { has: false, endorsements: [] });
assert.deepEqual(C.normalizeNeed({ endorsements: ["N"] }), { required: true, endorsements: ["N"] }, "an endorsement implies a CDL");
assert.deepEqual(C.normalizeNeed(null), { required: false, endorsements: [] });
assert.equal(C.meetsCdl(null, { required: false }), true, "no need: anyone");
assert.equal(C.meetsCdl({ has: false }, { required: true }), false, "a CDL is required");
assert.equal(C.meetsCdl({ has: true, endorsements: [] }, { required: true }), true);
assert.equal(C.meetsCdl({ has: true, endorsements: ["H"] }, { endorsements: ["H", "T"] }), false, "every endorsement must be held");
assert.equal(C.meetsCdl({ has: true, endorsements: ["H", "T", "N"] }, { endorsements: ["H", "T"] }), true);
assert.equal(C.meetsCdl({ has: true, endorsements: ["X"] }, { endorsements: ["H", "N"] }), true, "X covers hazmat and tank");
assert.equal(C.meetsCdl({ has: true, endorsements: ["X"] }, { endorsements: ["T"] }), false);
assert.equal(C.cdlText({ has: true, endorsements: ["T", "H"] }), "CDL · H, T");
assert.equal(C.cdlText({ has: false }), "");
assert.equal(C.needText({ endorsements: ["H"] }), "CDL required · H");

// ── A request: nothing readable on a relay; the invited couriers read the job; the exact places stay with the shipper ──
as(ship);
const reqEv = pub(D.requestEvent(user(ship), form({ cdl: { required: true, endorsements: ["T"] } }), [c1.publicKey, c2.publicKey, c3.publicKey]), ship);
{
  const wire = JSON.parse(reqEv.content);
  assert.deepEqual(Object.keys(wire).sort(), ["box", "sealed", "status", "v", "wraps"], "a relay sees a box, keys sealed to people, a status word: no detail");
  assert.deepEqual(Object.keys(wire.wraps).sort(), [ship.publicKey, c1.publicKey, c2.publicKey, c3.publicKey].sort(), "the shipper and each invited courier hold the job key");
  for (const secret of ["12 Dock St", "Ask for Sam", "Pallet jack", "equipment", "oversize", "Downtown", "ASAP", "distanceMiles", "38.04", "-84.5", "\"T\""]) assert.ok(!reqEv.content.includes(secret), `"${secret}" is not on the relay`);
  assert.deepEqual(reqEv.tags.filter((t) => t[0] === "p").map((t) => t[1]).sort(), [c1.publicKey, c2.publicKey, c3.publicKey].sort(), "who was invited is public metadata (so a courier's history finds it)");
}
const content = D.deliveryContent(reqEv);
assert.equal(content.pickup.approx, true, "the shipper reads the coarse pickup");
assert.equal(content.what.type, "equipment");
assert.equal(content.distanceMiles, 8.3);
assert.deepEqual(content.cdl, { required: true, endorsements: ["T"] });
assert.equal(content.sealed, JSON.parse(reqEv.content).sealed);
// The invited courier reads the job; a courier who was not invited reads nothing.
as(c1); assert.equal(D.deliveryContent(reqEv).what.note, "A pallet jack, 400 lb", "an invited courier opens the box"); assert.equal(D.isReadable(reqEv), true);
as(stranger); assert.equal(D.deliveryContent(reqEv).pickup, undefined, "someone who was not invited sees nothing"); assert.equal(D.isReadable(reqEv), false);
assert.equal(D.deliveryContent(reqEv).status, "requested", "only the status word is public");
as(null); assert.equal(D.isReadable(reqEv), false, "nobody logged in: nothing");
as(ship);
assert.deepEqual([...D.deliveryInvited(reqEv)].sort(), [c1.publicKey, c2.publicKey, c3.publicKey].sort());
assert.equal(D.deliveryStatus(reqEv), "requested");
assert.equal(D.deliveryCourier(reqEv), null);
const exactMine = D.exactDelivery(reqEv, user(ship));
assert.equal(exactMine.pickup.name, "12 Dock St");
assert.equal(exactMine.contact, "Ask for Sam, 555-0100");
assert.equal(D.exactDelivery(reqEv, user(c1)), null, "a courier sees the exact places only after being chosen");
assert.equal(D.exactDelivery(reqEv, user(stranger)), null);
// junk fields are cleaned
const odd = D.deliveryContent(pub(D.requestEvent(user(ship), form({ type: "<script>", size: "huge", time: "not a time" })), ship));
assert.equal(odd.what.type, "package"); assert.equal(odd.what.size, "medium"); assert.equal(odd.time, "ASAP");

// ── Expiry (and old public requests still read) ──
const t0 = Math.floor(Date.now() / 1000);
const plain = (content, ageSec, d) => { // an OLD request: public, not encrypted
  const e = buildSignedEvent(K.DELIVERY_REQUEST, content, [["d", d], ["t", "nostrride"]], ship.sk);
  e.created_at = t0 - ageSec; relay._store(e); return e;
};
const later = new Date(Date.now() + 3 * 86400000).toISOString();
assert.equal(D.isDeliveryExpired(plain({ time: "ASAP", pickup: { lat: 1, lng: 1 }, dropoff: { lat: 1, lng: 1 } }, 11 * 3600, "e1")), false, "an ASAP request lives 12 hours");
assert.equal(D.isDeliveryExpired(plain({ time: "ASAP" }, 13 * 3600, "e2")), true);
assert.equal(D.isDeliveryExpired(plain({ time: later }, 86400, "e3")), false, "a future delivery lives until 12 h after its time");
assert.equal(D.isScheduledDelivery(plain({ time: later }, 0, "e4")), true);
assert.equal(D.isScheduledDelivery(plain({ time: "ASAP" }, 0, "e5")), false);
assert.equal(D.deliveryContent(plain({ time: "ASAP", pickup: { name: "Old St", lat: 1, lng: 2 }, dropoff: { name: "Old Rd", lat: 3, lng: 4 }, what: { type: "package" } }, 0, "e6")).pickup.name, "Old St", "an old public request is read as it always was");
// An invitation (a newer version) does not restart the clock: a request is 12 h old from its FIRST post.
{
  const first = pub(D.requestEvent(user(ship), form()), ship);
  const old = JSON.parse(first.content);
  const aged = buildSignedEvent(K.DELIVERY_REQUEST, old, first.tags, ship.sk); aged.created_at = t0 - 13 * 3600; relay._store(aged);
  const fresh = D.inviteEvent(aged, user(ship), [c1.publicKey]);
  const newer = pub(fresh, ship);
  assert.equal(D.deliveryVersions(newer).length >= 2, true);
  assert.equal(D.isDeliveryExpired(newer), true, "the newest version carries the FIRST post's age");
  assert.equal(D.deliveryCreatedAt(newer), D.deliveryCreatedAt(aged));
}

// ── Bids ──
const b1 = bid(reqEv, c1, { cdl: { has: true, endorsements: ["T", "H"] }, priceSats: 25000, etaMinutes: 40 });
bid(reqEv, c2, { priceSats: 15000 }); // no CDL: does not meet the need
bid(reqEv, c3, { cdl: { has: true, endorsements: ["T"] }, priceSats: 18000, note: "x".repeat(900) });
bid(reqEv, ship, { priceSats: 1 }); // the shipper cannot bid on their own request
bid(reqEv, stranger, { priceSats: 0 }); // not a price
bid(reqEv, stranger, { mint: "http://evil.example" }); // not a usable mint address
bid(reqEv, stranger, { upfrontPct: 99 }); // not one of the choices
assert.equal(D.allBids(reqEv).length, 3, "three valid bids");
assert.equal(D.allBids(reqEv).find((b) => b.courier === c3.publicKey).note.length, D.MAX_NOTE, "a long note is cut");
let pend = D.pendingBids(reqEv);
assert.deepEqual(pend.map((b) => b.courier), [c3.publicKey, c1.publicKey], "the bid without the CDL is ignored; cheapest first");
assert.equal(pend[1].cdl.endorsements.join(), "H,T");
// a courier can change a bid: the newest one counts
bid(reqEv, c1, { cdl: { has: true, endorsements: ["T"] }, priceSats: 17000 });
assert.equal(D.allBids(reqEv).filter((b) => b.courier === c1.publicKey).length, 1);
pend = D.pendingBids(reqEv);
assert.equal(pend[0].priceSats, 17000, "the cheaper new bid leads");
assert.equal(pend[0].courier, c1.publicKey);
// blocked couriers do not show
assert.deepEqual(D.pendingBids(reqEv, { blocked: [{ pubkey: c1.publicKey }] }).map((b) => b.courier), [c3.publicKey]);
// the shipper's inbox lists requests with pending bids
assert.equal(D.bidInbox([reqEv], ship.publicKey).length, 1);
assert.equal(D.bidInbox([reqEv], stranger.publicKey).length, 0, "only the shipper's own requests");

// a courier can take a bid back
bid(reqEv, c3, { cdl: { has: true, endorsements: ["T"] }, priceSats: 18000 });
const mine3 = D.allBids(reqEv).find((b) => b.courier === c3.publicKey);
pub(D.withdrawBidEvent(reqEv, user(c3), mine3), c3);
assert.equal(D.allBids(reqEv).some((b) => b.courier === c3.publicKey), false, "a withdrawn bid is gone");
bid(reqEv, c3, { cdl: { has: true, endorsements: ["T"] }, priceSats: 18000 }); // and they may bid again
assert.equal(D.allBids(reqEv).some((b) => b.courier === c3.publicKey), true);

// ── The shipper turns one bid down; the request stays open ──
const bC3 = D.allBids(reqEv).find((b) => b.courier === c3.publicKey);
pub(D.declineBidEvent(reqEv, bC3), stranger); // anyone else's decline counts for nothing
assert.equal(D.bidState(reqEv, bC3), "pending");
pub(D.declineBidEvent(reqEv, bC3), ship);
assert.equal(D.bidState(reqEv, bC3), "declined");
assert.deepEqual(D.pendingBids(reqEv).map((b) => b.courier), [c1.publicKey]);
assert.equal(D.deliveryStatus(reqEv), "requested");

// ── Courier lists: the CDL need hides the request from a courier who does not meet it ──
const reqs = [reqEv];
const near = { lat: 38.04, lng: -84.5, radiusMiles: 25 };
const miles = (a, b) => (b ? Math.hypot((a.lat - b.lat) * 69, (a.lng - b.lng) * 54) : null);
const seen = (cdl, extra = {}) => { as(c2); return D.openRequestsFor(reqs, { me: c2.publicKey, cdl, near, distance: miles, ...extra }).length; };
assert.equal(seen({ has: false, endorsements: [] }), 0, "no CDL: the request is not shown");
assert.equal(seen({ has: true, endorsements: [] }), 0, "a CDL without the endorsement: not shown");
assert.equal(seen({ has: true, endorsements: ["T"] }), 1, "with the endorsement: shown");
assert.equal(seen({ has: true, endorsements: ["T"] }, { blocked: [{ pubkey: ship.publicKey }] }), 0, "a blocked shipper's request is hidden");
as(ship);
assert.equal(D.openRequestsFor(reqs, { me: ship.publicKey, cdl: { has: true, endorsements: ["T"] } }).length, 0, "not your own request");
as(c2);
assert.equal(D.openRequestsFor(reqs, { me: c2.publicKey, cdl: { has: true, endorsements: ["T"] }, near: { lat: 10, lng: 10, radiusMiles: 25 }, distance: miles }).length, 0, "too far away");
// hide tokens: the shipper blocked this courier
const hidingReq = pub(D.requestEvent(user(ship), form({ hide: B.hideList(ship.publicKey, [{ pubkey: c2.publicKey }]) }), [c2.publicKey, c3.publicKey]), ship);
assert.equal(D.openRequestsFor([hidingReq], { me: c2.publicKey, cdl: { has: false } }).length, 0, "a courier the shipper blocked does not see it");
as(c3);
assert.equal(D.openRequestsFor([hidingReq], { me: c3.publicKey, cdl: { has: false } }).length, 1);
as(c2);
const openReq = pub(D.requestEvent(user(ship), form(), [c2.publicKey]), ship);
assert.equal(D.openRequestsFor([openReq], { me: c2.publicKey, cdl: { has: false } }).length, 1, "no CDL need: every INVITED courier sees it");
as(c3);
assert.equal(D.openRequestsFor([openReq], { me: c3.publicKey, cdl: { has: false } }).length, 0, "a courier who was not invited never sees it");
as(c2);
const staleReq = buildSignedEvent(K.DELIVERY_REQUEST, { ...JSON.parse(openReq.content) }, [["d", "old"], ["t", "nostrride"]], ship.sk);
staleReq.created_at = t0 - 13 * 3600; relay._store(staleReq);
assert.equal(D.openRequestsFor([staleReq], { me: c2.publicKey, cdl: { has: false } }).length, 0, "an expired request is not shown");
as(ship);

// ── Accepting ONE bid declines all the others ──
const cur = D.allBids(reqEv).find((b) => b.courier === c1.publicKey);
const exact = D.exactDelivery(reqEv, user(ship));
// a stranger cannot accept or version someone else's request
const fake = D.acceptEvents(reqEv, user(stranger), cur, exact);
pub(fake[0], stranger); pub(fake[1], stranger);
assert.equal(D.deliveryCourier(reqEv), null, "only the shipper's own versions name a courier");
assert.equal(D.deliveryStatus(reqEv), "requested");
const [acc, ver] = D.acceptEvents(reqEv, user(ship), cur, exact);
pub(acc, ship); pub(ver, ship);
assert.equal(D.deliveryCourier(reqEv), c1.publicKey);
assert.equal(D.deliveryStatus(reqEv), "assigned");
const taken = D.acceptedBid(reqEv);
assert.equal(taken.courier, c1.publicKey); assert.equal(taken.priceSats, 17000);
assert.equal(D.bidState(reqEv, cur), "accepted");
for (const other of D.allBids(reqEv).filter((b) => b.courier !== c1.publicKey)) assert.equal(D.bidState(reqEv, other), "declined", "every other bid is declined at once");
assert.deepEqual(D.pendingBids(reqEv), [], "nothing is left to decide");
assert.equal(D.bidInbox([reqEv], ship.publicKey).length, 0);
// the chosen courier can now read the exact places and the contact; the others cannot
const exactCourier = D.exactDelivery(reqEv, user(c1));
assert.equal(exactCourier.pickup.name, "12 Dock St"); assert.equal(exactCourier.contact, "Ask for Sam, 555-0100");
assert.equal(D.exactDelivery(reqEv, user(c3)), null);
assert.deepEqual(D.jobsFor([reqEv], c1.publicKey).map((r) => r.id), [reqEv.id]);
assert.equal(D.jobsFor([reqEv], c3.publicKey).length, 0);
// a later bid from the courier cannot change the frozen terms
bid(reqEv, c1, { priceSats: 99999 });
assert.equal(D.acceptedBid(reqEv).priceSats, 17000, "the accepted bid is frozen");

// ── Money before the parcel moves: nothing is due ──
assert.equal(P.dueNow(reqEv), null);
assert.deepEqual(P.splitSats(17000, 50), { upfront: 8500, final: 8500 });
assert.deepEqual(P.splitSats(17001, 50), { upfront: 8501, final: 8500 });
assert.deepEqual(P.splitSats(100, 0), { upfront: 0, final: 100 });
assert.deepEqual(P.splitSats(100, 75), { upfront: 75, final: 25 });
assert.equal(P.neededToAccept({ priceSats: 17000 }), 17170, "the price plus 1 % for the mint's fee");
assert.equal(P.neededToAccept({ priceSats: 100 }), 105);

// ── The pickup code: the courier's phone and the shipper's phone work out the same four digits ──
const codeC = D.pickupCode(c1.sk, ship.publicKey, reqEv), codeS = D.pickupCode(ship.sk, c1.publicKey, reqEv);
assert.match(codeC, /^\d{4}$/); assert.equal(codeC, codeS);
assert.notEqual(D.pickupCode(c1.sk, ship.publicKey, openReq), codeC, "a different delivery has a different code");
assert.notEqual(D.pickupCode(c2.sk, ship.publicKey, reqEv), codeC, "and another courier cannot know it");

// ── Confirming the pickup: only the shipper counts; then the first payment is due ──
pub(D.confirmEvent(reqEv, c1.publicKey, "pickup", {}, user(stranger)), stranger);
pub(D.confirmEvent(reqEv, c1.publicKey, "pickup", {}, user(c1)), c1); // the courier cannot confirm their own pickup
assert.equal(D.deliveryStatus(reqEv), "assigned", "a confirmation from anyone but the shipper counts for nothing");
pub(D.confirmEvent(reqEv, c1.publicKey, "pickup", {}, user(ship)), ship);
assert.equal(D.deliveryStatus(reqEv), "in_transit");
let due = P.dueNow(reqEv);
assert.deepEqual([due.phase, due.amountSats, due.mint, due.courier], ["pickup", 8500, MINT, c1.publicKey]);
// the shipper pays; a payment from anyone else does not count
pub(P.payEvent(reqEv, c1.publicKey, user(stranger), { phase: "pickup", amountSats: 8500, mint: MINT, token: "cashuBfake" }), stranger);
assert.equal(P.sentSats(reqEv), 0);
const pay1 = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "pickup", amountSats: 8500, mint: MINT, token: "cashuBtoken1" }), ship);
assert.equal(P.sentSats(reqEv), 8500); assert.equal(P.paidSats(reqEv), 0, "paid = what the courier confirmed");
assert.equal(P.dueNow(reqEv), null, "never paid twice");
assert.equal(P.payToken(P.paysOf(reqEv)[0], reqEv, user(c1)), "cashuBtoken1", "the courier opens the token");
assert.equal(P.payToken(P.paysOf(reqEv)[0], reqEv, user(c3)), null, "nobody else can");
// a reply from a stranger counts for nothing; the courier's reply does
pub(P.payReplyEvent(reqEv, pay1, { ok: true, receivedSats: 8500 }, user(stranger)), stranger);
assert.equal(P.paidSats(reqEv), 0);
// a refused payment is due again
pub(P.payReplyEvent(reqEv, pay1, { ok: false, reason: "spent" }, user(c1)), c1);
assert.equal(P.paidSats(reqEv), 0); assert.equal(P.sentSats(reqEv), 0, "a refused payment was not sent");
due = P.dueNow(reqEv);
assert.equal(due.amountSats, 8500, "the same part is due again");
const pay1b = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "pickup", amountSats: 8500, mint: MINT, token: "cashuBtoken2" }), ship);
pub(P.payReplyEvent(reqEv, pay1b, { ok: true, receivedSats: 8499 }, user(c1)), c1);
assert.equal(P.paidSats(reqEv, "pickup"), 8500, "received 8,499 + 2 sats of slack, never more than the payment");
assert.equal(P.dueNow(reqEv), null);

// ── Delivered: the courier marks it; the shipper confirms; the rest is due ──
pub(D.stageEvent(reqEv, user(stranger), "delivered"), stranger);
assert.equal(D.deliveryStatus(reqEv), "in_transit", "only the courier can mark it delivered");
pub(D.stageEvent(reqEv, user(c1), "delivered", { photo: "data:image/jpeg;base64,AAAA", fix: { lat: 38.1004, lng: -84.6, accuracy: 12 } }), c1);
assert.equal(D.deliveryStatus(reqEv), "delivered");
{
  const pr = D.deliveryProof(reqEv, user(ship));
  assert.deepEqual([pr.photo, pr.gps, pr.verified], ["data:image/jpeg;base64,AAAA", true, true], "photo + a fix at the drop-off: verified");
  assert.ok(pr.distM >= 40 && pr.distM <= 50, "the shipper's app measures the distance itself: " + pr.distM);
  assert.equal(D.deliveryProof(reqEv, user(c1)).verified, true, "the courier can read their own proof");
  assert.deepEqual([D.deliveryProof(reqEv, user(stranger)).photo, D.deliveryProof(reqEv, user(stranger)).gps], [null, false], "anyone else gets nothing readable");
}
assert.equal(D.deliveryVerified(reqEv), null, "not confirmed yet");
assert.equal(P.dueNow(reqEv), null, "the rest is paid only when the shipper confirms");
assert.equal(D.deliveryPhoto(reqEv, user(ship)), "data:image/jpeg;base64,AAAA", "the photo is for the shipper");
assert.equal(D.deliveryPhoto(reqEv, user(stranger)), null);
assert.ok(!relay.query({ kinds: [K.DELIVERY_STAGE] }).some((e) => e.content.includes("AAAA")), "the photo is not in the public event");
pub(D.confirmEvent(reqEv, c1.publicKey, "problem", { ok: false, note: "dented" }, user(ship)), ship);
assert.equal(D.deliveryStatus(reqEv), "disputed", "a reported problem holds the final payment");
assert.equal(P.dueNow(reqEv), null);
pub(D.confirmEvent(reqEv, c1.publicKey, "delivered", { verified: "gps+photo" }, user(ship)), ship);
assert.equal(D.deliveryStatus(reqEv), "completed");
assert.equal(D.deliveryVerified(reqEv), "gps+photo", "the confirmation says how it was checked");
due = P.dueNow(reqEv);
assert.deepEqual([due.phase, due.amountSats], ["final", 8500]);
const pay2 = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "final", amountSats: 5000, mint: MINT, token: "cashuBpart" }), ship); // a short wallet pays what it can
assert.equal(P.dueNow(reqEv).amountSats, 3500, "the rest stays due");
pub(P.payReplyEvent(reqEv, pay2, { ok: true, receivedSats: 5000 }, user(c1)), c1);
const pay3 = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "final", amountSats: 3500, mint: MINT, token: "cashuBrest" }), ship);
pub(P.payReplyEvent(reqEv, pay3, { ok: true, receivedSats: 3500 }, user(c1)), c1);
assert.equal(P.dueNow(reqEv), null);
const money = P.moneyOf(reqEv);
assert.equal(money.priceSats, 17000); assert.ok(money.owedSats <= 2, "paid in full (a sat or two of mint fee slack): " + money.owedSats);
assert.deepEqual(D.deliveryCounts([reqEv], c1.publicKey), { carried: 1, sent: 0 });
assert.deepEqual(D.deliveryCounts([reqEv], ship.publicKey), { carried: 0, sent: 1 });
assert.equal(D.deliveryMiles([reqEv], c1.publicKey), 8.3, "the courier carried the route's miles");
assert.equal(D.deliveryMiles([reqEv], ship.publicKey), 0, "the shipper drove nobody");
const S = await import(`${R}/lib/stats.js`);
assert.deepEqual(S.personStats(c1.publicKey, [reqEv]), { rides: 0, drives: 0, carried: 1, sent: 0, miles: 8.3 }, "profile facts: deliveries carried + miles");
assert.equal(S.fmtMiles(8.34), "8.3 mi"); assert.equal(S.fmtMiles(1204.4), "1,204 mi"); assert.equal(S.fmtMiles(0), "0 mi");

// ── 0 % upfront: everything is paid at the end; the courier may withdraw before pickup and nothing is owed ──
const req2 = pub(D.requestEvent(user(ship), form()), ship);
const nb = bid(req2, c2, { priceSats: 4000, upfrontPct: 0 });
const bid2 = D.allBids(req2)[0];
const [acc2, ver2] = D.acceptEvents(req2, user(ship), bid2, D.exactDelivery(req2, user(ship)));
pub(acc2, ship); pub(ver2, ship);
pub(D.confirmEvent(req2, c2.publicKey, "pickup", {}, user(ship)), ship);
assert.equal(P.dueNow(req2), null, "with 0 % upfront nothing is due at pickup");
pub(D.stageEvent(req2, user(c2), "delivered"), c2);
pub(D.confirmEvent(req2, c2.publicKey, "delivered", {}, user(ship)), ship);
assert.deepEqual([P.dueNow(req2).phase, P.dueNow(req2).amountSats], ["final", 4000]);

const req3 = pub(D.requestEvent(user(ship), form()), ship);
bid(req3, c3, {});
const bid3 = D.allBids(req3)[0];
const [acc3, ver3] = D.acceptEvents(req3, user(ship), bid3, D.exactDelivery(req3, user(ship)));
pub(acc3, ship); pub(ver3, ship);
assert.equal(D.deliveryStatus(req3), "assigned");
pub(D.stageEvent(req3, user(c3), "withdrawn"), c3);
assert.equal(D.deliveryStatus(req3), "closed", "the courier backed out before the pickup: closed, nothing paid");
assert.equal(P.dueNow(req3), null);
// ...but not after the parcel changed hands
const req4 = pub(D.requestEvent(user(ship), form()), ship);
bid(req4, c3, {});
const [acc4, ver4] = D.acceptEvents(req4, user(ship), D.allBids(req4)[0], D.exactDelivery(req4, user(ship)));
pub(acc4, ship); pub(ver4, ship);
pub(D.confirmEvent(req4, c3.publicKey, "pickup", {}, user(ship)), ship);
pub(D.stageEvent(req4, user(c3), "withdrawn"), c3);
assert.equal(D.deliveryStatus(req4), "in_transit", "a courier cannot walk away with the parcel");

// ── Proof of delivery: GPS AND photo, or the shipper says they verified it outside of GoGet ──
const toDelivered = (fixOpts, photo) => {
  const r = pub(D.requestEvent(user(ship), form()), ship);
  bid(r, c2, {});
  const [a, v] = D.acceptEvents(r, user(ship), D.allBids(r)[0], D.exactDelivery(r, user(ship)));
  pub(a, ship); pub(v, ship);
  pub(D.confirmEvent(r, c2.publicKey, "pickup", {}, user(ship)), ship);
  pub(D.stageEvent(r, user(c2), "delivered", { photo, fix: fixOpts }), c2);
  return r;
};
const PIC = "data:image/jpeg;base64,BBBB";
const here = { lat: 38.1, lng: -84.6, accuracy: 20 };
let pr = D.deliveryProof(toDelivered(here, PIC), user(ship));
assert.equal(pr.verified, true);
pr = D.deliveryProof(toDelivered(here, ""), user(ship));
assert.deepEqual([pr.gps, !!pr.photo, pr.verified], [true, false, false], "no photo: not verified");
pr = D.deliveryProof(toDelivered(null, PIC), user(ship));
assert.deepEqual([pr.gps, !!pr.photo, pr.verified, pr.distM], [false, true, false, null], "no GPS fix: not verified");
pr = D.deliveryProof(toDelivered({ lat: 38.2, lng: -84.6, accuracy: 20 }, PIC), user(ship));
assert.deepEqual([pr.gps, pr.verified], [false, false], "a fix 7 miles away: not verified");
assert.ok(pr.distM > 10000);
pr = D.deliveryProof(toDelivered({ ...here, accuracy: 900 }, PIC), user(ship));
assert.equal(pr.gps, false, "a weak fix does not count");
pr = D.deliveryProof(toDelivered(here, "data:text/html;base64,PHNjcmlwdD4="), user(ship));
assert.equal(pr.photo, null, "only an image counts as the photo");
// the shipper can still confirm a delivery GoGet could not verify, saying so
const unsure = toDelivered(null, "");
pub(D.confirmEvent(unsure, c2.publicKey, "delivered", { verified: "outside" }, user(ship)), ship);
assert.equal(D.deliveryVerified(unsure), "outside");
assert.equal(D.deliveryStatus(unsure), "completed");
const junkWay = toDelivered(here, PIC);
pub(D.confirmEvent(junkWay, c2.publicKey, "delivered", { verified: "trust me" }, user(ship)), ship);
assert.equal(D.deliveryVerified(junkWay), null, "only the two known ways are read");
assert.ok(!relay.query({ kinds: [K.DELIVERY_STAGE] }).some((e) => e.content.includes("38.1") || e.content.includes("BBBB")), "neither the photo nor the position is public");

// ── A bid expires after 14 days ──
{
  assert.equal(D.BID_TTL_MS, 14 * 86400000);
  const rq = pub(D.requestEvent(user(ship), form({ time: new Date(Date.now() + 30 * 86400000).toISOString() })), ship); // a delivery 30 days ahead: the request outlives the bids
  const old = (who, price, ageDays) => {
    const b = D.bidEvent(rq, user(who), { priceSats: price, etaMinutes: 10, note: "", cdl: { has: false }, vehicle: "", mint: MINT, upfrontPct: 50 });
    const e = buildSignedEvent(b.kind, b.content, [...b.tags, ["t", "nostrride"]], who.sk);
    e.created_at = Math.floor(Date.now() / 1000) - Math.round(ageDays * 86400);
    relay._store(e);
    return e;
  };
  old(c1, 1000, 13); // 13 days old: still good
  old(c2, 2000, 14.5); // 14.5 days old: expired half a day ago
  const [fresh] = D.allBids(rq).filter((b) => b.courier === c1.publicKey);
  const [stale] = D.allBids(rq).filter((b) => b.courier === c2.publicKey);
  assert.equal(D.isBidExpired(fresh), false); assert.equal(D.isBidExpired(stale), true);
  assert.equal(D.bidState(rq, fresh), "pending"); assert.equal(D.bidState(rq, stale), "expired", "the request is open but the bid ran out");
  assert.deepEqual(D.pendingBids(rq).map((b) => b.courier), [c1.publicKey], "an expired bid cannot be picked");
  assert.equal(D.bidInbox([rq], ship.publicKey)[0].bids.length, 1);
  assert.throws(() => D.acceptEvents(rq, user(ship), stale, D.exactDelivery(rq, user(ship))), /expired/, "and cannot be accepted");
  assert.equal(D.waitingBidsFor([rq], c2.publicKey).length, 0, "it is not a waiting bid any more");
  const mineC2 = D.bidsOfCourier([rq], c2.publicKey);
  assert.equal(mineC2.length, 1, "but the courier still sees it, as expired, for a day after");
  assert.equal(mineC2[0].state, "expired");
  assert.ok(D.bidExpiresAt(fresh) - Date.now() < 2 * 86400000, "the 13-day-old bid has about a day left");
  // bidding again renews it
  bid(rq, c2, { priceSats: 2000 });
  assert.equal(D.bidState(rq, D.allBids(rq).find((b) => b.courier === c2.publicKey)), "pending", "a new bid starts a new 14 days");
  // a bid dated in the future would never run out: ignored
  const future = buildSignedEvent(K.DELIVERY_BID, { priceSats: 5, etaMinutes: 1, note: "", cdl: { has: false }, vehicle: "", mint: MINT, upfrontPct: 50 }, [["e", rq.id], ["p", ship.publicKey], ["d", "bid-x"], ["t", "nostrride"]], c3.sk);
  future.created_at = Math.floor(Date.now() / 1000) + 86400 * 365; relay._store(future);
  assert.equal(D.allBids(rq).some((b) => b.courier === c3.publicKey), false, "a bid from the future is not read");
  // the accepted bid is frozen: it does not expire once chosen
  const [a14, v14] = D.acceptEvents(rq, user(ship), fresh, D.exactDelivery(rq, user(ship)));
  pub(a14, ship); pub(v14, ship);
  assert.equal(D.bidState(rq, fresh), "accepted");
}

// ── The shipper can close a request nobody took ──
const req5 = pub(D.requestEvent(user(ship), form()), ship);
bid(req5, c2, {});
pub(D.versionEvent(req5, { status: "closed" }), ship);
assert.equal(D.deliveryStatus(req5), "closed");
assert.deepEqual(D.pendingBids(req5), []);
assert.equal(D.bidState(req5, D.allBids(req5)[0]), "closed");
// ── Everything about a job is sealed: what a relay (or another courier) can read ──
{
  const everything = [K.DELIVERY_REQUEST, K.DELIVERY_BID, K.DELIVERY_ACCEPT, K.DELIVERY_BID_DECLINE, K.DELIVERY_STAGE, K.DELIVERY_CONFIRM, K.DELIVERY_PAY, K.DELIVERY_PAY_REPLY];
  const wire = relay.query({ kinds: everything }).filter((e) => [reqEv.pubkey, c1.publicKey, c2.publicKey, c3.publicKey].includes(e.pubkey)).map((e) => e.content).join("\n");
  // Only the NEW sealed events carry these words; the old public requests built for the expiry test do not hold them.
  for (const secret of ["Pallet jack", "I have a lift gate", "Box truck", "cashuBtoken", "cashuBrest", "dented", "gps+photo", "AAAA", "BBBB", "Ask for Sam", "12 Dock St"]) assert.ok(!wire.includes(secret), `"${secret}" is on no relay`);
  for (const e of relay.query({ kinds: [K.DELIVERY_BID, K.DELIVERY_PAY, K.DELIVERY_PAY_REPLY, K.DELIVERY_CONFIRM] }).filter((x) => JSON.parse(x.content).v === 2)) {
    const c = JSON.parse(e.content);
    assert.equal(typeof c.sealed, "string", "a sealed body");
    for (const k of ["priceSats", "amountSats", "receivedSats", "mint", "token", "note", "verified", "etaMinutes", "cdl", "vehicle"]) assert.equal(c[k], undefined, `${k} is not public`);
  }
}
// A bid is readable by the courier who wrote it and the shipper: not by another courier.
{
  const mine = bid(reqEv, c1, { priceSats: 13579, note: "secret note" });
  as(ship); assert.equal(D.allBids(reqEv).find((b) => b.courier === c1.publicKey)?.priceSats, 13579, "the shipper reads the bid");
  as(c1); assert.equal(D.allBids(reqEv).find((b) => b.courier === c1.publicKey)?.priceSats, 13579, "the courier reads their own bid");
  as(c3); assert.deepEqual(D.allBids(reqEv).filter((b) => b.courier !== c3.publicKey), [], "another courier cannot read it (a competitor never sees the price); their own bid they can");
  as(stranger); assert.equal(D.allBids(reqEv).length, 0);
  as(null); assert.equal(D.allBids(reqEv).length, 0, "nobody logged in: nothing");
  assert.equal(mine.tags.some((t) => t[0] === "p" && t[1] === ship.publicKey), true, "who it is addressed to is public");
  as(ship);
}
// Payments, confirmations and the proof: the shipper and the courier read them; a third person does not.
{
  as(ship); assert.ok(P.paysOf(reqEv).length >= 3 && P.sentSats(reqEv) >= 17000);
  as(c1); assert.ok(P.paysOf(reqEv).length >= 3, "the courier reads the payments to them"); assert.equal(D.deliveryVerified(reqEv), "gps+photo");
  as(c3); assert.deepEqual(P.paysOf(reqEv), [], "another courier sees no payment"); assert.equal(P.sentSats(reqEv), 0); assert.equal(P.paidSats(reqEv), 0);
  assert.equal(D.deliveryVerified(reqEv), null, "nor how it was checked");
  assert.equal(D.deliveryStatus(reqEv), "completed", "but the status words are public: anyone can tell a job was completed");
  assert.equal(D.deliveryProof(reqEv, user(c3)).photo, null);
  as(ship);
}
// Counts on a profile need no key: they come from the public status words.
{
  as(stranger);
  const { latestVersions } = await import(`${R}/nostr/replaceable.js`);
  const everyRequest = latestVersions(relay.query({ kinds: [K.DELIVERY_REQUEST] })); // what the app keeps: the newest version of each
  assert.equal(D.deliveryCounts(everyRequest, c1.publicKey).carried, 1, "a stranger can count a courier's finished deliveries");
  assert.equal(D.deliveryMiles(everyRequest, c1.publicKey), 0, "but the route length is sealed: no miles for what they cannot read");
  as(ship);
}
// Inviting more couriers later: a new version with more wraps; the same set again does nothing; a stranger's request cannot be extended.
{
  const rq = pub(D.requestEvent(user(ship), form(), [c1.publicKey]), ship);
  assert.equal(D.inviteEvent(rq, user(ship), [c1.publicKey]), null, "already invited: nothing to add");
  assert.equal(D.inviteEvent(rq, user(stranger), [c2.publicKey]), null, "only the shipper can invite");
  const more = D.inviteEvent(rq, user(ship), [c2.publicKey, c2.publicKey, "nothex", ship.publicKey]);
  assert.deepEqual(Object.keys(more.content.wraps).sort(), [ship.publicKey, c1.publicKey, c2.publicKey].sort(), "the shipper and each courier, once; junk and the shipper's own key are not added again");
  assert.equal(more.content.box, JSON.parse(rq.content).box, "the same box and key: one job");
  pub(more, ship);
  as(c2); assert.equal(D.deliveryContent(rq).what.type, "equipment", "a courier invited LATER reads the job from the newer version");
  as(c1); assert.equal(D.deliveryContent(rq).what.type, "equipment", "and the first one still does");
  as(ship);
  assert.deepEqual([...D.deliveryInvited(rq)].sort(), [c1.publicKey, c2.publicKey].sort());
  // a status change keeps the box, the wraps and the places
  const closed = D.versionEvent(rq, { status: "closed" });
  assert.deepEqual(Object.keys(closed.content.wraps).sort(), [ship.publicKey, c1.publicKey, c2.publicKey].sort());
  assert.ok(closed.content.sealed && closed.content.box);
  assert.deepEqual(closed.tags.filter((t) => t[0] === "p").map((t) => t[1]).sort(), [c1.publicKey, c2.publicKey].sort());
  // an old public request cannot be invited to
  assert.equal(D.inviteEvent(plain({ time: "ASAP" }, 0, "e7"), user(ship), [c1.publicKey]), null);
  // the number of couriers per request is capped
  const crowd = Array.from({ length: 80 }, () => generateKeypair().publicKey);
  assert.equal(Object.keys(D.requestEvent(user(ship), form(), crowd).content.wraps).length, 1 + (await import(`${R}/lib/couriers.js`)).MAX_INVITES, "a request is sent to at most 50 couriers");
}

console.log("delivery tests ok");
