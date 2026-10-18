// ════════════════════════════════════════════════════════════
//  DELIVERY — GoGet's parcel deliveries: the signed trail and the rules that read it. (Money is in lib/deliveryPay.js.)
//  Same ideas as lib/rides.js: nothing is kept in memory, every screen derives its state from events, and anyone can sign an event,
//  so every read checks WHO wrote it.
//
//  The flow
//    Shipper   DELIVERY_REQUEST 30103  what, size, coarse pickup/drop-off (exact places sealed to the shipper), when (ASAP or a time),
//                                      CDL need, route distance. Later versions (same d-tag) say `assigned` (+ courierPubkey, bidId) or `closed`.
//    Courier   DELIVERY_BID 30104      price (sats), minutes to the pickup, notes, CDL statement, vehicle, mint, share paid at pickup.
//    Shipper   DELIVERY_ACCEPT 30105   takes ONE bid (exact places sealed to that courier). Every other bid is thereby declined.
//              DELIVERY_BID_DECLINE    turns one bid down; the request stays open.
//    Shipper   DELIVERY_CONFIRM 30108  phase "pickup": the shipper typed the 4-digit code shown on the courier's phone (the parcel changed
//                                      hands) → the part due at pickup is paid.  "delivered": the parcel arrived → the rest is paid.  "problem".
//    Courier   DELIVERY_STAGE 30107    "delivered" (+ the PROOF sealed to the shipper: a photo and a signed GPS fix near the drop-off) or
//                                      "withdrawn" (before pickup).  The shipper's "delivered" confirmation says how it was checked:
//                                      "gps+photo" (the proof held up) or "outside" (the shipper verified it outside of GoGet).
//  Status (deliveryStatus): requested → assigned → in_transit → delivered → completed;  disputed (the shipper reported a problem);  closed
//  (the shipper closed it, or the courier withdrew before pickup: nothing was paid).  A request nobody took expires (deliveryExpiryMs).
//  A BID expires 14 days after it was signed (BID_TTL_MS): the shipper can no longer pick it and the courier sees "Expired" and may bid
//  again (a new bid is a new signature, so it starts a new 14 days). The bid the shipper accepted is frozen and never expires.
//
//  PRIVACY: nothing about a job is readable on a relay (lib/jobseal.js). A request holds an encrypted `box` (the job) and `wraps` (the job key
//  sealed to the shipper and to each INVITED courier); bids, confirmations (note, how it was checked), payments (amount, mint, token) and the
//  proof are sealed to the other party. Public: the kinds, who wrote them, who they are addressed to (`p`/`e` tags), when, how big, and the
//  status words ("requested", "assigned", "closed"; the stage and phase names in the d-tags). Readers below open what the LOGGED-IN person may
//  open (setDeliveryViewer): the shipper reads everything of their own jobs, a courier what was sealed to them. Old public events still read.
//
//  Trust rules: versions of a request = same author + d-tag; only the shipper authors versions, so the courier they name is trustworthy.
//  A bid counts from anyone except the shipper; an accept, a decline, a confirm and a payment only from the shipper; a stage and a payment
//  reply only from the assigned courier. A bid whose CDL statement does not meet the request is ignored.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS as K } from "../nostr/eventKinds.js";
import { latestVersions } from "../nostr/replaceable.js";
import { seal, unseal, publicPlace } from "./privacy.js";
import { normalizeCdl, normalizeNeed, meetsCdl } from "./cdl.js";
import { isMintUrl } from "./mints.js";
import { startCode } from "./startcode.js";
import { hidesMe } from "./blocks.js";
import { haversineDistance } from "./geo.js";
import { newJobKey, sealBox, openBox, wrapKey, unwrapKey } from "./jobseal.js";
import { MAX_INVITES } from "./couriers.js";

const HOUR = 3600000;
export const DELIVERY_TTL_MS = 12 * HOUR; // an ASAP request lives 12 h; a timed one until 12 h after its pickup time
export const BID_TTL_MS = 14 * 24 * HOUR; // a bid is good for 14 days; after that the courier must bid again
export const MAX_NOTE = 500;
export const UPFRONT_CHOICES = [0, 25, 50, 75]; // % of the price paid when the parcel is handed over
export const DEFAULT_UPFRONT = 50;
export const DELIVERED_NEAR_M = 300; // "Delivered" needs a good GPS fix this close to the drop-off
export const PROOF_FIX_MAX_ACCURACY_M = 200; // the proof's GPS fix must be a good one (lib/gps.js GOOD_FIX_METERS)
export const PROOF_FIX_MAX_AGE_MS = 10 * 60000; // ...and taken within 10 minutes before the "delivered" marker
export const VERIFIED_HOW = ["gps+photo", "outside"]; // how the shipper checked a delivery

export const DELIVERY_TYPES = [
  { id: "document", label: "Document" },
  { id: "package", label: "Package" },
  { id: "equipment", label: "Large equipment" },
  { id: "other", label: "Something else" },
];
export const DELIVERY_SIZES = [
  { id: "small", label: "Small", hint: "fits in a bag" },
  { id: "medium", label: "Medium", hint: "a box, fits in a car" },
  { id: "large", label: "Large", hint: "needs a van or a truck" },
  { id: "oversize", label: "Oversize / heavy", hint: "needs a flatbed, a trailer or equipment" },
];
const TYPE_IDS = new Set(DELIVERY_TYPES.map((t) => t.id));
const SIZE_IDS = new Set(DELIVERY_SIZES.map((t) => t.id));
export const typeLabel = (id) => DELIVERY_TYPES.find((t) => t.id === id)?.label || "Parcel";
export const sizeLabel = (id) => DELIVERY_SIZES.find((t) => t.id === id)?.label || "";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const dtagOf = (e) => (e.tags.find((t) => t[0] === "d") || [])[1];
const etagOf = (e) => (e.tags.find((t) => t[0] === "e") || [])[1];
const str = (v, max = 200) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");
const isHex = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const intIn = (v, lo, hi) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const place = (p) => (p && typeof p.lat === "number" && typeof p.lng === "number" ? { name: str(p.name), lat: p.lat, lng: p.lng } : null);

// Whose eyes are these? Every read of a sealed event needs the reader's key, so the logged-in person is set once (AppContext, at login) instead of
// being passed through every screen. Switching person clears what was worked out for the last one.
let viewer = null; // { sk, publicKey } | null
export function setDeliveryViewer(user) {
  viewer = user?.sk && user?.publicKey ? { sk: user.sk, publicKey: user.publicKey } : null;
  memo.clear(); memoVersion = -1;
}
export const getDeliveryViewer = () => viewer;
// The OTHER person of a pair, for a sealed message between the shipper and the chosen courier: null when the viewer is neither.
export function otherParty(request, courier = deliveryCourier(request)) {
  if (!viewer) return null;
  if (viewer.publicKey === request.pubkey) return courier || null;
  return courier && viewer.publicKey === courier ? request.pubkey : null;
}

// Results are cached until the event cache changes (relay.version), as in lib/rides.js.
const memo = new Map();
let memoVersion = -1;
function cached(key, fn) {
  if (relay.version !== memoVersion) { memo.clear(); memoVersion = relay.version; }
  const k = (viewer ? viewer.publicKey : "-") + "|" + key; // what a person may read is theirs alone
  if (!memo.has(k)) memo.set(k, fn());
  return memo.get(k);
}

// ── The request and its versions ──
export const deliveryKey = (request) => `${request.pubkey}:${dtagOf(request)}`;
// The request as THIS person can read it: the job (what, places, time, CDL need…) opened from the box when they hold a wrap, plus the public
// status words. An old request that is plainly public reads as it always did. A request this person cannot open has no `pickup`/`dropoff`.
export function deliveryContent(request) {
  return cached("c:" + request.id, () => {
    const c = parse(request) || {};
    if (c.v !== 2) return c;
    const job = openJob(request);
    return { ...(job || {}), v: 2, status: c.status, ...(c.courierPubkey && { courierPubkey: c.courierPubkey }), ...(c.bidId && { bidId: c.bidId }), sealed: c.sealed };
  });
}
// The job key, if the viewer holds a wrap (any version of the request, newest first), else null.
function jobKey(request) {
  if (!viewer) return null;
  for (const v of deliveryVersions(request)) {
    const wrap = parse(v)?.wraps?.[viewer.publicKey];
    if (typeof wrap === "string") { const k = unwrapKey(viewer.sk, request.pubkey, wrap); if (k) return k; }
  }
  return null;
}
function openJob(request) {
  const key = jobKey(request);
  if (!key) return null;
  const box = deliveryVersions(request).map((v) => parse(v)?.box).find((b) => typeof b === "string");
  return openBox(key, box);
}
// Who the shipper's app invited (they hold a wrap): a Set of pubkeys, the shipper left out.
export const deliveryInvited = (request) => new Set(Object.keys(parse(deliveryVersions(request)[0] || request)?.wraps || {}).filter((pk) => pk !== request.pubkey));
// A request is the shipper's own, an invited courier's, or old and public: can this person read it?
export const isReadable = (request) => !!deliveryContent(request).pickup;
// When it was FIRST posted (the newest version may be an invitation or a status change, and must not restart the clock).
export const deliveryCreatedAt = (request) => Math.min(request.created_at, ...deliveryVersions(request).map((e) => e.created_at));

// Every version of one request (same author + d-tag), newest first.
export function deliveryVersions(request) {
  return cached("v:" + request.id, () => {
    const d = dtagOf(request);
    const found = d ? relay.query({ kinds: [K.DELIVERY_REQUEST], authors: [request.pubkey], "#d": [d] }) : [];
    if (!found.some((e) => e.id === request.id)) found.push(request);
    return found.reverse().sort((a, b) => b.created_at - a.created_at);
  }).slice();
}
const idsOf = (request) => new Set(deliveryVersions(request).map((e) => e.id));
const onRequest = (e, ids) => ids.has(etagOf(e));

// The courier the shipper chose (only the shipper can author a version, so this is trustworthy), or null.
export function deliveryCourier(request) {
  const c = deliveryVersions(request).map((e) => parse(e)?.courierPubkey).find(isHex);
  return c || null;
}
export const deliveryNeed = (request) => normalizeNeed(deliveryContent(request).cdl);

export function deliveryExpiryMs(content, createdAtSec) {
  if (content?.time && content.time !== "ASAP") {
    const t = Date.parse(content.time);
    if (!isNaN(t)) return t + DELIVERY_TTL_MS;
  }
  return createdAtSec * 1000 + DELIVERY_TTL_MS;
}
export const isDeliveryExpired = (request, now = Date.now()) => now > deliveryExpiryMs(deliveryContent(request), deliveryCreatedAt(request));

// A future delivery (more than 30 minutes away).
export function isScheduledDelivery(request, now = Date.now()) {
  const time = deliveryContent(request).time;
  if (!time || time === "ASAP") return false;
  const t = Date.parse(time);
  return !isNaN(t) && t - now > 30 * 60000;
}

// ── Bids ──
// One valid bid from an event, or null. Whatever a courier signs is checked: numbers, the mint address, the CDL statement.
export function readBid(e, shipper) {
  let c = parse(e);
  if (!c || e.pubkey === shipper) return null;
  if (c.v === 2) { // sealed between the courier and the shipper: only those two can read it
    if (!viewer) return null;
    const other = viewer.publicKey === shipper ? e.pubkey : viewer.publicKey === e.pubkey ? shipper : null;
    c = other ? unseal(viewer.sk, other, c.sealed) : null;
    if (!c || typeof c !== "object") return null;
  }
  if (e.created_at * 1000 > Date.now() + 10 * 60000) return null; // a bid dated in the future would never run out
  const priceSats = intIn(c.priceSats, 1, 1e9);
  const upfrontPct = c.upfrontPct == null ? DEFAULT_UPFRONT : UPFRONT_CHOICES.includes(c.upfrontPct) ? c.upfrontPct : null;
  if (!priceSats || upfrontPct == null || !isMintUrl(c.mint)) return null;
  return {
    id: e.id, event: e, courier: e.pubkey, priceSats, upfrontPct, mint: c.mint,
    etaMinutes: intIn(c.etaMinutes, 0, 20160) ?? 0, note: str(c.note, MAX_NOTE), vehicle: str(c.vehicle, 80), cdl: normalizeCdl(c.cdl),
    at: e.created_at * 1000, withdrawn: c.withdrawn === true,
  };
}

// The newest valid bid of each courier on this request, newest first.
export function allBids(request) {
  return cached("bids:" + request.id, () => {
    const ids = idsOf(request);
    const newest = new Map();
    relay.query({ kinds: [K.DELIVERY_BID], "#e": [...ids] })
      .filter((e) => onRequest(e, ids))
      .map((e) => readBid(e, request.pubkey))
      .filter(Boolean)
      .forEach((b) => { const cur = newest.get(b.courier); if (!cur || b.event.created_at >= cur.event.created_at) newest.set(b.courier, b); });
    // A courier who took their bid back (their newest one says so) has no bid.
    return [...newest.values()].filter((b) => !b.withdrawn).sort((a, b) => b.at - a.at);
  }).slice();
}

// The bids the shipper turned down one by one: Set of bid ids. Only the shipper's declines count.
export function declinedBidIds(request) {
  const ids = idsOf(request);
  const out = new Set();
  relay.query({ kinds: [K.DELIVERY_BID_DECLINE], authors: [request.pubkey], "#e": [...ids] }).forEach((e) => {
    const bidId = parse(e)?.bidId;
    if (onRequest(e, ids) && typeof bidId === "string") out.add(bidId);
  });
  return out;
}

// The bid the shipper accepted (its price, mint and share paid at pickup are FROZEN by it), or null.
export function acceptedBid(request) {
  const bidId = deliveryVersions(request).map((e) => parse(e)?.bidId).find((x) => typeof x === "string");
  const courier = deliveryCourier(request);
  if (!bidId || !courier) return null;
  const ev = relay.query({ kinds: [K.DELIVERY_BID], ids: [bidId] })[0];
  const bid = ev && ev.pubkey === courier ? readBid(ev, request.pubkey) : null;
  return bid;
}

// Has this bid run out (14 days after it was signed)? An accepted bid is frozen and is not asked.
export const bidExpiresAt = (bid) => bid.at + BID_TTL_MS;
export const isBidExpired = (bid, now = Date.now()) => now > bidExpiresAt(bid);

// "pending" | "accepted" | "declined" | "closed" | "expired" for one bid of this request ("expired" = the request ran out, or the bid did).
export function bidState(request, bid) {
  const status = deliveryStatus(request);
  const accepted = acceptedBid(request);
  if (accepted && accepted.id === bid.id) return "accepted";
  if (deliveryCourier(request)) return "declined"; // another bid was taken: every other bid is declined at once
  if (status === "closed") return "closed";
  if (isDeliveryExpired(request)) return "expired";
  if (declinedBidIds(request).has(bid.id)) return "declined";
  if (isBidExpired(bid)) return "expired";
  return "pending";
}

// The bids the shipper can still pick: pending, meeting the CDL need, not from a blocked person. Cheapest first, then the nearest.
export function pendingBids(request, { blocked = [] } = {}) {
  if (deliveryStatus(request) !== "requested" || isDeliveryExpired(request)) return [];
  const need = deliveryNeed(request);
  const declined = declinedBidIds(request);
  const hidden = new Set(blocked.map((b) => b.pubkey));
  return allBids(request)
    .filter((b) => !declined.has(b.id) && !hidden.has(b.courier) && !isBidExpired(b) && meetsCdl(b.cdl, need))
    .sort((a, b) => a.priceSats - b.priceSats || a.etaMinutes - b.etaMinutes || a.at - b.at);
}

// ── Stages and confirmations ──
// The courier's markers by stage: Map(stage → { at, c, event }). Only the assigned courier counts; the earliest of each stage wins.
export function stagesOf(request) {
  return cached("st:" + request.id, () => {
    const courier = deliveryCourier(request), out = new Map();
    if (!courier) return out;
    const ids = idsOf(request);
    relay.query({ kinds: [K.DELIVERY_STAGE], authors: [courier], "#e": [...ids] })
      .filter((e) => onRequest(e, ids))
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((e) => {
        const c = parse(e);
        if (!c || !["delivered", "withdrawn"].includes(c.stage) || out.has(c.stage)) return;
        out.set(c.stage, { at: e.created_at * 1000, c, event: e });
      });
    return out;
  });
}

// The shipper's confirmations by phase: Map(phase → { at, c, event }). Only the shipper counts; for each phase the earliest counts.
export function confirmsOf(request) {
  return cached("cf:" + request.id, () => {
    const ids = idsOf(request), out = new Map();
    relay.query({ kinds: [K.DELIVERY_CONFIRM], authors: [request.pubkey], "#e": [...ids] })
      .filter((e) => onRequest(e, ids))
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((e) => {
        let c = parse(e);
        if (!c || !["pickup", "delivered", "problem"].includes(c.phase) || c.ok !== true && c.phase !== "problem" || out.has(c.phase)) return;
        if (c.v === 2) { // the note and how it was checked are sealed between the shipper and the courier
          const other = otherParty(request);
          const inner = other ? unseal(viewer.sk, other, c.sealed) : null;
          c = { ...c, ...(inner && typeof inner === "object" ? { note: inner.note, verified: inner.verified } : {}) };
        }
        out.set(c.phase, { at: e.created_at * 1000, c, event: e });
      });
    return out;
  });
}

// How the shipper checked the delivery when they confirmed it: "gps+photo" | "outside" | null (not confirmed, or an older confirmation).
export function deliveryVerified(request) {
  const v = confirmsOf(request).get("delivered")?.c?.verified;
  return VERIFIED_HOW.includes(v) ? v : null;
}

// requested | assigned | in_transit | delivered | completed | disputed | closed
export function deliveryStatus(request) {
  return cached("s:" + request.id, () => {
    const newest = deliveryVersions(request)[0] || request;
    if (parse(newest)?.status === "closed") return "closed";
    const courier = deliveryCourier(request);
    if (!courier) return "requested";
    const stages = stagesOf(request), confirms = confirmsOf(request);
    if (stages.has("withdrawn") && !confirms.has("pickup")) return "closed"; // the courier backed out before the parcel changed hands
    if (!confirms.has("pickup")) return "assigned";
    if (confirms.has("delivered")) return "completed";
    if (!stages.has("delivered")) return "in_transit";
    return confirms.has("problem") ? "disputed" : "delivered";
  });
}
export const isRunning = (status) => ["assigned", "in_transit", "delivered", "disputed"].includes(status);

// ── The pickup code (the courier's phone shows it, the shipper types it when the parcel is handed over) ──
export const pickupCode = (sk, otherPubkey, request) => startCode(sk, otherPubkey, "delivery|" + deliveryKey(request));

// ── The exact places: the shipper's own copy, or the one sealed to the chosen courier ──
export function exactDelivery(request, user) {
  const c = parse(request);
  if (!c || !user) return null;
  let trip = null;
  if (request.pubkey === user.publicKey) trip = unseal(user.sk, user.publicKey, c.sealed);
  else {
    const ids = [...idsOf(request)];
    const accept = relay.query({ kinds: [K.DELIVERY_ACCEPT], authors: [request.pubkey], "#p": [user.publicKey], "#e": ids }).sort((a, b) => b.created_at - a.created_at)[0];
    const sealed = accept && parse(accept)?.sealed;
    if (sealed) trip = unseal(user.sk, request.pubkey, sealed);
  }
  const pickup = place(trip?.pickup), dropoff = place(trip?.dropoff);
  return pickup && dropoff ? { pickup, dropoff, contact: str(trip?.contact, 200) } : null;
}

// The places to SHOW this person: the exact ones when they may read them (the shipper, the chosen courier), else the public coarse ones.
export function placesOf(request, user) {
  const ex = exactDelivery(request, user);
  if (ex) return { pickup: ex.pickup, dropoff: ex.dropoff, exact: true, contact: ex.contact };
  const c = deliveryContent(request);
  return { pickup: place(c.pickup) || { name: "Approximate area", lat: 0, lng: 0 }, dropoff: place(c.dropoff) || { name: "Approximate area", lat: 0, lng: 0 }, exact: false, contact: "" };
}

// ── Lists for the screens ──
// The requests a courier may see: open (not taken, not expired), not their own, not from someone they blocked or who blocked
// them, and meeting their CDL. `near` = { lat, lng, radiusMiles } narrows by the coarse pickup (null = no filter).
export function openRequestsFor(requests, { me, cdl, blocked = [], near = null, now = Date.now(), distance = null } = {}) {
  const hidden = new Set(blocked.map((b) => b.pubkey));
  return requests
    .filter((r) => r.pubkey !== me && !hidden.has(r.pubkey) && isReadable(r)) // a request this courier was not invited to has nothing to show
    .filter((r) => deliveryStatus(r) === "requested" && !isDeliveryExpired(r, now))
    .filter((r) => !hidesMe(deliveryContent(r).hide, r.pubkey, me))
    .filter((r) => meetsCdl(cdl, deliveryNeed(r)))
    .map((r) => ({ request: r, miles: near && distance ? distance(near, deliveryContent(r).pickup) : null }))
    .filter((x) => !near || x.miles == null || x.miles <= near.radiusMiles)
    .sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9) || b.request.created_at - a.request.created_at);
}

// The deliveries a courier has been given and has not finished: assigned / in transit / delivered, newest first.
export function jobsFor(requests, me) {
  return requests.filter((r) => deliveryCourier(r) === me && isRunning(deliveryStatus(r))).sort((a, b) => b.created_at - a.created_at);
}
// The courier's bids still waiting: [{ request, bid }], newest first (requests the courier bid on and nobody took yet).
export function waitingBidsFor(requests, me) {
  const out = [];
  for (const r of requests) {
    if (r.pubkey === me || deliveryStatus(r) !== "requested" || isDeliveryExpired(r)) continue;
    const bid = allBids(r).find((b) => b.courier === me);
    if (bid && bidState(r, bid) === "pending") out.push({ request: r, bid });
  }
  return out.sort((a, b) => b.bid.at - a.bid.at);
}
// Every bid this courier made that is still worth showing: [{ request, bid, state }], newest first. A bid on a request that closed
// or expired more than a day ago is left out.
export function bidsOfCourier(requests, me, now = Date.now()) {
  const out = [];
  for (const r of requests) {
    if (r.pubkey === me) continue;
    const bid = allBids(r).find((b) => b.courier === me);
    if (!bid) continue;
    const state = bidState(r, bid);
    // A finished bid stays on the list for a day: after it was signed, or (a bid that ran out) after it expired.
    if (state !== "pending" && state !== "accepted" && now - (state === "expired" && !isDeliveryExpired(r, now) ? bidExpiresAt(bid) : bid.at) > 86400000) continue;
    out.push({ request: r, bid, state });
  }
  return out.sort((a, b) => b.bid.at - a.bid.at);
}
// The shipper's own deliveries, newest first.
export const deliveriesOf = (requests, me) => requests.filter((r) => r.pubkey === me).sort((a, b) => b.created_at - a.created_at);
// Pending bids on the shipper's open requests: [{ request, bids }] — the "Bids" screen and its badge.
export function bidInbox(requests, me, { blocked = [] } = {}) {
  return deliveriesOf(requests, me).map((request) => ({ request, bids: pendingBids(request, { blocked }) })).filter((x) => x.bids.length);
}

// Plain counts for a profile: deliveries a person carried and sent that were completed.
export function deliveryCounts(requests, pubkey) {
  let carried = 0, sent = 0;
  for (const r of requests) {
    if (deliveryStatus(r) !== "completed") continue;
    if (r.pubkey === pubkey) sent++;
    if (deliveryCourier(r) === pubkey) carried++;
  }
  return { carried, sent };
}

// Miles a courier carried parcels: the route distance of each completed delivery they were given (no meter runs on a delivery, so
// this is the route the request published). Only deliveries this device can read are counted.
export function deliveryMiles(requests, pubkey) {
  let miles = 0;
  for (const r of requests) {
    if (deliveryCourier(r) !== pubkey || deliveryStatus(r) !== "completed") continue;
    miles += Number(deliveryContent(r).distanceMiles) || 0;
  }
  return Math.round(miles * 10) / 10;
}

// ── Building events (the caller publishes them with useApp().publish) ──
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// The tags of a request version: its id, the app label, and a `p` for each invited courier (so a courier's own history query finds it).
const requestTags = (id, wraps, shipper) => [["d", id], ["t", "delivery"], ...Object.keys(wraps || {}).filter((pk) => pk !== shipper).map((pk) => ["p", pk])];

// A new request. `form`: { type, size, note, pickup, dropoff (exact places with `area` names), time, cdl, distanceMiles, durationMin, contact?, hide? }.
// `invited` = the couriers to send it to (pubkeys; lib/couriers.js eligibleCouriers). The job is encrypted with a fresh job key; the key is sealed to
// the shipper and to each invited courier. The exact places and the contact note are sealed to the shipper alone.
export function requestEvent(user, form, invited = []) {
  const id = newId();
  const need = normalizeNeed(form.cdl);
  const job = {
    what: { type: TYPE_IDS.has(form.type) ? form.type : "package", size: SIZE_IDS.has(form.size) ? form.size : "medium", note: str(form.note, MAX_NOTE) },
    pickup: publicPlace(form.pickup), dropoff: publicPlace(form.dropoff),
    time: form.time && form.time !== "ASAP" && !isNaN(Date.parse(form.time)) ? new Date(form.time).toISOString() : "ASAP",
    cdl: need,
    distanceMiles: Math.round((Number(form.distanceMiles) || 0) * 10) / 10, durationMin: Math.round(Number(form.durationMin) || 0),
    ...(form.hide?.length && { hide: form.hide }),
  };
  const key = newJobKey();
  const wraps = { [user.publicKey]: wrapKey(user.sk, user.publicKey, key) };
  for (const pk of [...new Set(invited)].filter((p) => isHex(p) && p !== user.publicKey).slice(0, MAX_INVITES)) wraps[pk] = wrapKey(user.sk, pk, key);
  const content = {
    v: 2, status: "requested", box: sealBox(key, job), wraps,
    sealed: seal(user.sk, user.publicKey, { pickup: { name: form.pickup.name, lat: form.pickup.lat, lng: form.pickup.lng }, dropoff: { name: form.dropoff.name, lat: form.dropoff.lat, lng: form.dropoff.lng }, contact: str(form.contact, 200) }),
  };
  return { kind: K.DELIVERY_REQUEST, content, tags: requestTags(id, wraps, user.publicKey) };
}

// A new version of a request (same d-tag), with a patch of its content: { status: "closed" } or { status: "assigned", courierPubkey, bidId }.
// It starts from the NEWEST version, so the box, the wraps and the sealed places are carried along.
export function versionEvent(request, patch) {
  const latest = deliveryVersions(request)[0] || request;
  const content = { ...(parse(latest) || {}), ...patch };
  return { kind: K.DELIVERY_REQUEST, content, tags: requestTags(dtagOf(request), content.wraps, request.pubkey) };
}

// Invite more couriers to an open request: a new version with their wraps added (the shipper's app opens its own wrap to get the job key).
// null when there is nothing to add, or the key cannot be opened (not the shipper's request).
export function inviteEvent(request, user, couriers) {
  if (request.pubkey !== user.publicKey) return null;
  const latest = deliveryVersions(request)[0] || request;
  const c = parse(latest);
  if (!c || c.v !== 2 || c.status !== "requested") return null;
  const key = unwrapKey(user.sk, user.publicKey, c.wraps?.[user.publicKey]);
  if (!key) return null;
  const wraps = { ...c.wraps };
  const room = MAX_INVITES + 1 - Object.keys(wraps).length;
  const add = [...new Set(couriers)].filter((p) => isHex(p) && !wraps[p] && p !== user.publicKey).slice(0, Math.max(0, room));
  if (!add.length) return null;
  for (const pk of add) wraps[pk] = wrapKey(user.sk, pk, key);
  return versionEvent(request, { wraps });
}

// A bid is sealed between the courier and the shipper (price, minutes, notes, CDL, vehicle, mint, share paid at pickup): relays and other couriers see only that a bid exists.
export function bidEvent(request, user, { priceSats, etaMinutes, note, cdl, vehicle, mint, upfrontPct = DEFAULT_UPFRONT, withdrawn = false }) {
  const latest = deliveryVersions(request)[0] || request;
  const body = { priceSats, etaMinutes, note: str(note, MAX_NOTE), cdl: normalizeCdl(cdl), vehicle: str(vehicle, 80), mint, upfrontPct, ...(withdrawn && { withdrawn: true }) };
  return {
    kind: K.DELIVERY_BID,
    content: { v: 2, sealed: seal(user.sk, request.pubkey, body) },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", `bid-${deliveryKey(request)}`], ["t", "delivery"]],
  };
}

// The shipper takes `bid`: the accept (exact places sealed to the courier) AND the new request version. Returns [acceptEvent, versionEvent].
export function acceptEvents(request, user, bid, exact) {
  if (isBidExpired(bid)) throw new Error("This bid has expired.");
  const latest = deliveryVersions(request)[0] || request;
  const accept = {
    kind: K.DELIVERY_ACCEPT,
    content: { bidId: bid.id, requestId: latest.id, sealed: seal(user.sk, bid.courier, { pickup: exact.pickup, dropoff: exact.dropoff, contact: exact.contact || "" }) },
    tags: [["e", bid.id], ["e", latest.id], ["p", bid.courier], ["d", `accept-${deliveryKey(request)}`], ["t", "delivery"]],
  };
  return [accept, versionEvent(request, { status: "assigned", courierPubkey: bid.courier, bidId: bid.id })];
}

// The courier takes a bid back (their newest bid then says so). Does nothing once the shipper has accepted it.
export const withdrawBidEvent = (request, user, bid) => bidEvent(request, user, { ...bid, withdrawn: true });

export function declineBidEvent(request, bid) {
  const latest = deliveryVersions(request)[0] || request;
  return { kind: K.DELIVERY_BID_DECLINE, content: { bidId: bid.id }, tags: [["e", latest.id], ["e", bid.id], ["p", bid.courier], ["d", `decline-${bid.id}`], ["t", "delivery"]] };
}

// stage: "delivered" ({ photo?, fix? }) | "withdrawn". The PROOF of delivery is the photo plus the courier's GPS fix ({ lat, lng, accuracy }); both are
// sealed to the shipper and signed with the event, so the shipper's app can check them (deliveryProof) and nobody else can read them.
export function stageEvent(request, user, stage, { photo = "", fix = null } = {}) {
  const latest = deliveryVersions(request)[0] || request;
  const f = fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lng) ? { lat: fix.lat, lng: fix.lng, accuracy: Math.round(Number(fix.accuracy) || 0), fixAt: Date.now() } : null;
  return {
    kind: K.DELIVERY_STAGE,
    content: { stage, at: Date.now(), ...((photo || f) && { sealed: seal(user.sk, request.pubkey, { ...(photo && { photo }), ...(f && f) }) }) },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", `stage-${deliveryKey(request)}-${stage}`], ["t", "delivery"]],
  };
}

// `verified` (phase "delivered" only): how the shipper checked it, one of VERIFIED_HOW. The note and `verified` are sealed to the courier.
export function confirmEvent(request, courierPubkey, phase, { ok = true, note = "", verified = "" } = {}, user = viewer) {
  const latest = deliveryVersions(request)[0] || request;
  const inner = { note: str(note, 300), ...(phase === "delivered" && VERIFIED_HOW.includes(verified) && { verified }) };
  return {
    kind: K.DELIVERY_CONFIRM,
    content: { v: 2, phase, ok, at: Date.now(), sealed: seal(user.sk, courierPubkey, inner) },
    tags: [["e", latest.id], ["p", courierPubkey], ["d", `confirm-${deliveryKey(request)}-${phase}`], ["t", "delivery"]],
  };
}

// The PROOF of a delivery, read by the shipper or the courier (the two who can open it): null until the courier marked it delivered.
//   { photo (a data: image or null), gps (a good fix, fresh, within DELIVERED_NEAR_M of the exact drop-off), distM (metres, or null),
//     verified (gps AND photo) }
// "verified" means the courier's signed claim holds up; it cannot prove the phone's GPS was honest, which is why the shipper still decides
// (and may say they verified it outside of GoGet).
export function deliveryProof(request, user) {
  const st = stagesOf(request).get("delivered");
  const courier = deliveryCourier(request);
  if (!st || !courier || !user) return null;
  const other = user.publicKey === request.pubkey ? courier : request.pubkey;
  const v = st.c.sealed ? unseal(user.sk, other, st.c.sealed) : null;
  const photo = v && typeof v.photo === "string" && v.photo.startsWith("data:image/") ? v.photo : null;
  const ex = exactDelivery(request, user);
  let distM = null, gps = false;
  if (v && ex && Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
    distM = Math.round(haversineDistance(v.lat, v.lng, ex.dropoff.lat, ex.dropoff.lng) * 1609.344);
    const fresh = Number.isFinite(v.fixAt) && v.fixAt <= st.at + 60000 && v.fixAt >= st.at - PROOF_FIX_MAX_AGE_MS;
    gps = distM <= DELIVERED_NEAR_M && Number.isFinite(v.accuracy) && v.accuracy <= PROOF_FIX_MAX_ACCURACY_M && fresh;
  }
  return { photo, gps, distM, verified: gps && !!photo };
}

// The photo a courier attached to "delivered", opened by the shipper (null if none or unreadable).
export const deliveryPhoto = (request, user) => deliveryProof(request, user)?.photo || null;
