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

// ── A request: coarse places in public, exact places sealed ──
const reqEv = pub(D.requestEvent(user(ship), form({ cdl: { required: true, endorsements: ["T"] } })), ship);
const content = JSON.parse(reqEv.content);
assert.equal(content.pickup.approx, true, "the public pickup is coarse");
assert.ok(!reqEv.content.includes("12 Dock St") && !reqEv.content.includes("Ask for Sam"), "the exact place and the contact are not public");
assert.equal(content.what.type, "equipment");
assert.equal(content.distanceMiles, 8.3);
assert.deepEqual(content.cdl, { required: true, endorsements: ["T"] });
assert.equal(D.deliveryStatus(reqEv), "requested");
assert.equal(D.deliveryCourier(reqEv), null);
const exactMine = D.exactDelivery(reqEv, user(ship));
assert.equal(exactMine.pickup.name, "12 Dock St");
assert.equal(exactMine.contact, "Ask for Sam, 555-0100");
assert.equal(D.exactDelivery(reqEv, user(c1)), null, "a courier sees the exact places only after being chosen");
assert.equal(D.exactDelivery(reqEv, user(stranger)), null);
// junk fields are cleaned
const odd = JSON.parse(pub(D.requestEvent(user(ship), form({ type: "<script>", size: "huge", time: "not a time" })), ship).content);
assert.equal(odd.what.type, "package"); assert.equal(odd.what.size, "medium"); assert.equal(odd.time, "ASAP");

// ── Expiry ──
const t0 = Math.floor(Date.now() / 1000);
assert.equal(D.isDeliveryExpired({ content: JSON.stringify({ time: "ASAP" }), created_at: t0 - 11 * 3600 }), false, "an ASAP request lives 12 hours");
assert.equal(D.isDeliveryExpired({ content: JSON.stringify({ time: "ASAP" }), created_at: t0 - 13 * 3600 }), true);
const later = new Date(Date.now() + 3 * 86400000).toISOString();
assert.equal(D.isDeliveryExpired({ content: JSON.stringify({ time: later }), created_at: t0 - 86400 }), false, "a future delivery lives until 12 h after its time");
assert.equal(D.isScheduledDelivery({ content: JSON.stringify({ time: later }) }), true);
assert.equal(D.isScheduledDelivery({ content: JSON.stringify({ time: "ASAP" }) }), false);

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
const seen = (cdl, extra = {}) => D.openRequestsFor(reqs, { me: c2.publicKey, cdl, near, distance: miles, ...extra }).length;
assert.equal(seen({ has: false, endorsements: [] }), 0, "no CDL: the request is not shown");
assert.equal(seen({ has: true, endorsements: [] }), 0, "a CDL without the endorsement: not shown");
assert.equal(seen({ has: true, endorsements: ["T"] }), 1, "with the endorsement: shown");
assert.equal(seen({ has: true, endorsements: ["T"] }, { blocked: [{ pubkey: ship.publicKey }] }), 0, "a blocked shipper's request is hidden");
assert.equal(D.openRequestsFor(reqs, { me: ship.publicKey, cdl: { has: true, endorsements: ["T"] } }).length, 0, "not your own request");
assert.equal(D.openRequestsFor(reqs, { me: c2.publicKey, cdl: { has: true, endorsements: ["T"] }, near: { lat: 10, lng: 10, radiusMiles: 25 }, distance: miles }).length, 0, "too far away");
// hide tokens: the shipper blocked this courier
const hidingReq = pub(D.requestEvent(user(ship), form({ hide: B.hideList(ship.publicKey, [{ pubkey: c2.publicKey }]) })), ship);
assert.equal(D.openRequestsFor([hidingReq], { me: c2.publicKey, cdl: { has: false } }).length, 0, "a courier the shipper blocked does not see it");
assert.equal(D.openRequestsFor([hidingReq], { me: c3.publicKey, cdl: { has: false } }).length, 1);
const openReq = pub(D.requestEvent(user(ship), form()), ship);
assert.equal(D.openRequestsFor([openReq], { me: c2.publicKey, cdl: { has: false } }).length, 1, "no CDL need: every courier sees it");
const staleReq = buildSignedEvent(K.DELIVERY_REQUEST, { ...JSON.parse(openReq.content) }, [["d", "old"], ["t", "nostrride"]], ship.sk);
staleReq.created_at = t0 - 13 * 3600; relay._store(staleReq);
assert.equal(D.openRequestsFor([staleReq], { me: c2.publicKey, cdl: { has: false } }).length, 0, "an expired request is not shown");

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
pub(D.confirmEvent(reqEv, c1.publicKey, "pickup"), stranger);
pub(D.confirmEvent(reqEv, c1.publicKey, "pickup"), c1); // the courier cannot confirm their own pickup
assert.equal(D.deliveryStatus(reqEv), "assigned", "a confirmation from anyone but the shipper counts for nothing");
pub(D.confirmEvent(reqEv, c1.publicKey, "pickup"), ship);
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
pub(P.payReplyEvent(reqEv, pay1, { ok: true, receivedSats: 8500 }), stranger);
assert.equal(P.paidSats(reqEv), 0);
// a refused payment is due again
pub(P.payReplyEvent(reqEv, pay1, { ok: false, reason: "spent" }), c1);
assert.equal(P.paidSats(reqEv), 0); assert.equal(P.sentSats(reqEv), 0, "a refused payment was not sent");
due = P.dueNow(reqEv);
assert.equal(due.amountSats, 8500, "the same part is due again");
const pay1b = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "pickup", amountSats: 8500, mint: MINT, token: "cashuBtoken2" }), ship);
pub(P.payReplyEvent(reqEv, pay1b, { ok: true, receivedSats: 8499 }), c1);
assert.equal(P.paidSats(reqEv, "pickup"), 8500, "received 8,499 + 2 sats of slack, never more than the payment");
assert.equal(P.dueNow(reqEv), null);

// ── Delivered: the courier marks it; the shipper confirms; the rest is due ──
pub(D.stageEvent(reqEv, user(stranger), "delivered"), stranger);
assert.equal(D.deliveryStatus(reqEv), "in_transit", "only the courier can mark it delivered");
pub(D.stageEvent(reqEv, user(c1), "delivered", { photo: "data:image/jpeg;base64,AAAA", distM: 42.4 }), c1);
assert.equal(D.deliveryStatus(reqEv), "delivered");
assert.equal(P.dueNow(reqEv), null, "the rest is paid only when the shipper confirms");
assert.equal(D.deliveryPhoto(reqEv, user(ship)), "data:image/jpeg;base64,AAAA", "the photo is for the shipper");
assert.equal(D.deliveryPhoto(reqEv, user(stranger)), null);
assert.ok(!relay.query({ kinds: [K.DELIVERY_STAGE] }).some((e) => e.content.includes("AAAA")), "the photo is not in the public event");
pub(D.confirmEvent(reqEv, c1.publicKey, "problem", { ok: false, note: "dented" }), ship);
assert.equal(D.deliveryStatus(reqEv), "disputed", "a reported problem holds the final payment");
assert.equal(P.dueNow(reqEv), null);
pub(D.confirmEvent(reqEv, c1.publicKey, "delivered"), ship);
assert.equal(D.deliveryStatus(reqEv), "completed");
due = P.dueNow(reqEv);
assert.deepEqual([due.phase, due.amountSats], ["final", 8500]);
const pay2 = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "final", amountSats: 5000, mint: MINT, token: "cashuBpart" }), ship); // a short wallet pays what it can
assert.equal(P.dueNow(reqEv).amountSats, 3500, "the rest stays due");
pub(P.payReplyEvent(reqEv, pay2, { ok: true, receivedSats: 5000 }), c1);
const pay3 = pub(P.payEvent(reqEv, c1.publicKey, user(ship), { phase: "final", amountSats: 3500, mint: MINT, token: "cashuBrest" }), ship);
pub(P.payReplyEvent(reqEv, pay3, { ok: true, receivedSats: 3500 }), c1);
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
pub(D.confirmEvent(req2, c2.publicKey, "pickup"), ship);
assert.equal(P.dueNow(req2), null, "with 0 % upfront nothing is due at pickup");
pub(D.stageEvent(req2, user(c2), "delivered"), c2);
pub(D.confirmEvent(req2, c2.publicKey, "delivered"), ship);
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
pub(D.confirmEvent(req4, c3.publicKey, "pickup"), ship);
pub(D.stageEvent(req4, user(c3), "withdrawn"), c3);
assert.equal(D.deliveryStatus(req4), "in_transit", "a courier cannot walk away with the parcel");

// ── The shipper can close a request nobody took ──
const req5 = pub(D.requestEvent(user(ship), form()), ship);
bid(req5, c2, {});
pub(D.versionEvent(req5, { status: "closed" }), ship);
assert.equal(D.deliveryStatus(req5), "closed");
assert.deepEqual(D.pendingBids(req5), []);
assert.equal(D.bidState(req5, D.allBids(req5)[0]), "closed");
console.log("delivery tests ok");
