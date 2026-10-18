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
//    Courier   DELIVERY_STAGE 30107    "delivered" (+ optional photo sealed to the shipper, + metres from the drop-off) or "withdrawn" (before pickup).
//  Status (deliveryStatus): requested → assigned → in_transit → delivered → completed;  disputed (the shipper reported a problem);  closed
//  (the shipper closed it, or the courier withdrew before pickup: nothing was paid).  A request nobody took expires (deliveryExpiryMs).
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

const HOUR = 3600000;
export const DELIVERY_TTL_MS = 12 * HOUR; // an ASAP request lives 12 h; a timed one until 12 h after its pickup time
export const MAX_NOTE = 500;
export const UPFRONT_CHOICES = [0, 25, 50, 75]; // % of the price paid when the parcel is handed over
export const DEFAULT_UPFRONT = 50;
export const DELIVERED_NEAR_M = 300; // "Delivered" needs a good GPS fix this close to the drop-off

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

// Results are cached until the event cache changes (relay.version), as in lib/rides.js.
const memo = new Map();
let memoVersion = -1;
function cached(key, fn) {
  if (relay.version !== memoVersion) { memo.clear(); memoVersion = relay.version; }
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}

// ── The request and its versions ──
export const deliveryKey = (request) => `${request.pubkey}:${dtagOf(request)}`;
export const deliveryContent = (request) => parse(request) || {};

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
export const deliveryNeed = (request) => normalizeNeed(parse(request)?.cdl);

export function deliveryExpiryMs(content, createdAtSec) {
  if (content?.time && content.time !== "ASAP") {
    const t = Date.parse(content.time);
    if (!isNaN(t)) return t + DELIVERY_TTL_MS;
  }
  return createdAtSec * 1000 + DELIVERY_TTL_MS;
}
export const isDeliveryExpired = (request, now = Date.now()) => now > deliveryExpiryMs(parse(request), request.created_at);

// A future delivery (more than 30 minutes away).
export function isScheduledDelivery(request, now = Date.now()) {
  const time = parse(request)?.time;
  if (!time || time === "ASAP") return false;
  const t = Date.parse(time);
  return !isNaN(t) && t - now > 30 * 60000;
}

// ── Bids ──
// One valid bid from an event, or null. Whatever a courier signs is checked: numbers, the mint address, the CDL statement.
export function readBid(e, shipper) {
  const c = parse(e);
  if (!c || e.pubkey === shipper) return null;
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

// "pending" | "accepted" | "declined" | "closed" | "expired" for one bid of this request.
export function bidState(request, bid) {
  const status = deliveryStatus(request);
  const accepted = acceptedBid(request);
  if (accepted && accepted.id === bid.id) return "accepted";
  if (deliveryCourier(request)) return "declined"; // another bid was taken: every other bid is declined at once
  if (status === "closed") return "closed";
  if (isDeliveryExpired(request)) return "expired";
  if (declinedBidIds(request).has(bid.id)) return "declined";
  return "pending";
}

// The bids the shipper can still pick: pending, meeting the CDL need, not from a blocked person. Cheapest first, then the nearest.
export function pendingBids(request, { blocked = [] } = {}) {
  if (deliveryStatus(request) !== "requested" || isDeliveryExpired(request)) return [];
  const need = deliveryNeed(request);
  const declined = declinedBidIds(request);
  const hidden = new Set(blocked.map((b) => b.pubkey));
  return allBids(request)
    .filter((b) => !declined.has(b.id) && !hidden.has(b.courier) && meetsCdl(b.cdl, need))
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
        const c = parse(e);
        if (!c || !["pickup", "delivered", "problem"].includes(c.phase) || c.ok !== true && c.phase !== "problem" || out.has(c.phase)) return;
        out.set(c.phase, { at: e.created_at * 1000, c, event: e });
      });
    return out;
  });
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
  const c = parse(request) || {};
  return { pickup: place(c.pickup) || { name: "Approximate area", lat: 0, lng: 0 }, dropoff: place(c.dropoff) || { name: "Approximate area", lat: 0, lng: 0 }, exact: false, contact: "" };
}

// ── Lists for the screens ──
// The requests a courier may see: open (not taken, not expired), not their own, not from someone they blocked or who blocked
// them, and meeting their CDL. `near` = { lat, lng, radiusMiles } narrows by the coarse pickup (null = no filter).
export function openRequestsFor(requests, { me, cdl, blocked = [], near = null, now = Date.now(), distance = null } = {}) {
  const hidden = new Set(blocked.map((b) => b.pubkey));
  return requests
    .filter((r) => r.pubkey !== me && !hidden.has(r.pubkey))
    .filter((r) => deliveryStatus(r) === "requested" && !isDeliveryExpired(r, now))
    .filter((r) => !hidesMe(parse(r)?.hide, r.pubkey, me))
    .filter((r) => meetsCdl(cdl, deliveryNeed(r)))
    .map((r) => ({ request: r, miles: near && distance ? distance(near, parse(r)?.pickup) : null }))
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
    if (state !== "pending" && state !== "accepted" && now - bid.at > 86400000) continue;
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

// ── Building events (the caller publishes them with useApp().publish) ──
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// A new request. `form`: { type, size, note, pickup, dropoff (exact places with `area` names), time, cdl, distanceMiles, durationMin, contact?, hide? }.
export function requestEvent(user, form) {
  const id = newId();
  const need = normalizeNeed(form.cdl);
  const content = {
    v: 1,
    what: { type: TYPE_IDS.has(form.type) ? form.type : "package", size: SIZE_IDS.has(form.size) ? form.size : "medium", note: str(form.note, MAX_NOTE) },
    pickup: publicPlace(form.pickup), dropoff: publicPlace(form.dropoff),
    time: form.time && form.time !== "ASAP" && !isNaN(Date.parse(form.time)) ? new Date(form.time).toISOString() : "ASAP",
    cdl: need,
    distanceMiles: Math.round((Number(form.distanceMiles) || 0) * 10) / 10, durationMin: Math.round(Number(form.durationMin) || 0),
    ...(form.hide?.length && { hide: form.hide }),
    status: "requested",
    sealed: seal(user.sk, user.publicKey, { pickup: { name: form.pickup.name, lat: form.pickup.lat, lng: form.pickup.lng }, dropoff: { name: form.dropoff.name, lat: form.dropoff.lat, lng: form.dropoff.lng }, contact: str(form.contact, 200) }),
  };
  return { kind: K.DELIVERY_REQUEST, content, tags: [["d", id], ["t", "delivery"]] };
}

// A new version of a request (same d-tag), with a patch of its content: { status: "closed" } or { status: "assigned", courierPubkey, bidId }.
export function versionEvent(request, patch) {
  return { kind: K.DELIVERY_REQUEST, content: { ...(parse(request) || {}), ...patch }, tags: [["d", dtagOf(request)], ["t", "delivery"]] };
}

export function bidEvent(request, user, { priceSats, etaMinutes, note, cdl, vehicle, mint, upfrontPct = DEFAULT_UPFRONT, withdrawn = false }) {
  const latest = deliveryVersions(request)[0] || request;
  return {
    kind: K.DELIVERY_BID,
    content: { priceSats, etaMinutes, note: str(note, MAX_NOTE), cdl: normalizeCdl(cdl), vehicle: str(vehicle, 80), mint, upfrontPct, ...(withdrawn && { withdrawn: true }) },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", `bid-${deliveryKey(request)}`], ["t", "delivery"]],
  };
}

// The shipper takes `bid`: the accept (exact places sealed to the courier) AND the new request version. Returns [acceptEvent, versionEvent].
export function acceptEvents(request, user, bid, exact) {
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

// stage: "delivered" ({ photo?, distM? }) | "withdrawn". A photo is sealed to the shipper.
export function stageEvent(request, user, stage, { photo = "", distM = null } = {}) {
  const latest = deliveryVersions(request)[0] || request;
  return {
    kind: K.DELIVERY_STAGE,
    content: { stage, at: Date.now(), ...(Number.isFinite(distM) && { distM: Math.round(distM) }), ...(photo && { sealed: seal(user.sk, request.pubkey, { photo }) }) },
    tags: [["e", latest.id], ["p", request.pubkey], ["d", `stage-${deliveryKey(request)}-${stage}`], ["t", "delivery"]],
  };
}

export function confirmEvent(request, courierPubkey, phase, { ok = true, note = "" } = {}) {
  const latest = deliveryVersions(request)[0] || request;
  return {
    kind: K.DELIVERY_CONFIRM,
    content: { phase, ok, note: str(note, 300), at: Date.now() },
    tags: [["e", latest.id], ["p", courierPubkey], ["d", `confirm-${deliveryKey(request)}-${phase}`], ["t", "delivery"]],
  };
}

// The photo a courier attached to "delivered", opened by the shipper (null if none or unreadable).
export function deliveryPhoto(request, user) {
  const st = stagesOf(request).get("delivered");
  const courier = deliveryCourier(request);
  if (!st?.c?.sealed || !courier || !user) return null;
  const v = unseal(user.sk, courier, st.c.sealed);
  return v && typeof v.photo === "string" && v.photo.startsWith("data:image/") ? v.photo : null;
}
