// ════════════════════════════════════════════════════════════
//  DELIVERY PAY — How a delivery is paid, in ecash, with no escrow. The price is the accepted bid's, fixed in sats. It is paid in
//  two parts by the shipper's app, so neither side carries all the risk:
//    "pickup"  the share the courier asked for in the bid (0 / 25 / 50 / 75 %, default 50), paid when the shipper typed the courier's
//              4-digit code (the parcel changed hands)
//    "final"   the rest, paid when the shipper confirms the parcel arrived
//  A part is ONE ecash token in a signed event (DELIVERY_PAY 30109, the token sealed to the courier); the courier's app redeems it at
//  the mint named in the bid and answers (DELIVERY_PAY_REPLY 30110): "received", or a FINAL refusal (never for an unreachable mint).
//  "Paid" = what the courier confirmed. A short wallet pays what it can; the rest stays due (never lost, never paid twice: a part is
//  due only for what was not already sent).
//
//    splitSats(price, pct)       → { upfront, final }
//    dueNow(request)             → { phase, amountSats, mint, courier } | null    the next payment the shipper's app owes
//    paidSats / sentSats(request, phase?)   confirmed by the courier / sent by the shipper
//    neededToAccept(bid)         ecash the shipper should hold at the bid's mint before taking it (price + a margin for the mint's fee)
//  Writers: payEvent (shipper), payReplyEvent (courier). Readers check who wrote what.
//  PRIVACY: a payment's amount, mint and token are sealed to the courier, a reply's amount and reason to the shipper (lib/delivery.js): relays
//  see that a payment of phase "pickup" or "final" happened, not how much. Only the shipper and the courier of a delivery can read its payments.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS as K } from "../nostr/eventKinds.js";
import { seal, unseal } from "./privacy.js";
import { acceptedBid, confirmsOf, deliveryCourier, deliveryKey, deliveryStatus, deliveryVersions, getDeliveryViewer, otherParty } from "./delivery.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const etags = (e) => e.tags.filter((t) => t[0] === "e").map((t) => t[1]);
const sats = (x) => (typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 1e9 ? x : null);
const PHASES = ["pickup", "final"];

export function splitSats(priceSats, pct) {
  const upfront = Math.min(priceSats, Math.round((priceSats * pct) / 100));
  return { upfront, final: priceSats - upfront };
}

export const neededToAccept = (bid) => bid.priceSats + Math.max(5, Math.ceil(bid.priceSats * 0.01));

// ── Building ──
export function payEvent(request, courierPubkey, user, { phase, amountSats, mint, token }) {
  const nonce = Math.random().toString(36).slice(2, 8);
  const latest = deliveryVersions(request)[0] || request;
  return {
    kind: K.DELIVERY_PAY,
    content: { v: 2, phase, sealed: seal(user.sk, courierPubkey, { token, amountSats, mint, at: Date.now() }) },
    tags: [["e", latest.id], ["p", courierPubkey], ["d", `pay-${deliveryKey(request)}-${phase}-${nonce}`], ["t", "delivery"]],
  };
}
export function payReplyEvent(request, payEventObj, { ok, receivedSats = 0, reason = "" }, user = getDeliveryViewer()) {
  const latest = deliveryVersions(request)[0] || request;
  return {
    kind: K.DELIVERY_PAY_REPLY,
    content: { v: 2, payId: payEventObj.id, ok: !!ok, sealed: seal(user.sk, request.pubkey, { receivedSats, reason: String(reason).slice(0, 200) }) },
    tags: [["e", latest.id], ["e", payEventObj.id], ["p", request.pubkey], ["d", "pay-reply-" + payEventObj.id], ["t", "delivery"]],
  };
}

// ── Reading ──
// The valid payments, oldest first: [{ id, event, phase, amountSats, mint, createdAt }]. Only the shipper's, to the assigned courier. Only the shipper
// and the courier can open them (a third person gets none).
export function paysOf(request) {
  const courier = deliveryCourier(request);
  if (!courier) return [];
  const viewer = getDeliveryViewer(), other = otherParty(request, courier);
  const ids = new Set(deliveryVersions(request).map((e) => e.id));
  return relay.query({ kinds: [K.DELIVERY_PAY], authors: [request.pubkey], "#p": [courier] })
    .filter((e) => etags(e).some((id) => ids.has(id)))
    .map((e) => {
      let c = parse(e);
      if (c && c.v === 2) { const inner = other ? unseal(viewer.sk, other, c.sealed) : null; c = inner && typeof inner === "object" ? { ...inner, phase: c.phase, sealed: c.sealed } : null; }
      return { e, c };
    })
    .filter(({ c }) => c && PHASES.includes(c.phase) && sats(c.amountSats) && typeof c.sealed === "string")
    .map(({ e, c }) => ({ id: e.id, event: e, phase: c.phase, amountSats: c.amountSats, mint: String(c.mint || ""), createdAt: e.created_at }))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// The courier's answers by payment id. Only the assigned courier counts; a refusal never overrides an earlier "received".
export function payReplies(request) {
  const courier = deliveryCourier(request), out = new Map();
  if (!courier) return out;
  const viewer = getDeliveryViewer(), other = otherParty(request, courier);
  const ids = new Set(deliveryVersions(request).map((e) => e.id));
  relay.query({ kinds: [K.DELIVERY_PAY_REPLY], authors: [courier], "#p": [request.pubkey] })
    .filter((e) => etags(e).some((id) => ids.has(id)))
    .sort((a, b) => a.created_at - b.created_at)
    .forEach((e) => {
      let c = parse(e);
      if (c && c.v === 2) { const inner = other ? unseal(viewer.sk, other, c.sealed) : null; c = inner && typeof inner === "object" ? { ...inner, payId: c.payId, ok: c.ok } : null; }
      if (!c || typeof c.payId !== "string" || out.get(c.payId)?.ok) return;
      out.set(c.payId, { ok: c.ok === true, receivedSats: sats(c.receivedSats) || 0, reason: typeof c.reason === "string" ? c.reason : "" });
    });
  return out;
}

// What the courier confirmed (never more than a payment claims, plus 2 sats of slack for a mint's fee).
export function paidSats(request, phase = null) {
  const replies = payReplies(request);
  return paysOf(request).filter((p) => !phase || p.phase === phase).reduce((s, p) => {
    const r = replies.get(p.id);
    return s + (r?.ok ? Math.min(p.amountSats, (r.receivedSats || p.amountSats) + 2) : 0);
  }, 0);
}
// Everything the shipper sent that was not refused (so the app never pays a part twice).
export function sentSats(request, phase = null) {
  const replies = payReplies(request);
  return paysOf(request).filter((p) => !phase || p.phase === phase).reduce((s, p) => s + (replies.get(p.id)?.ok === false ? 0 : p.amountSats), 0);
}

// The next payment the shipper's app owes right now, or null. The upfront part falls due when the pickup is confirmed; the rest when
// the delivery is confirmed (and, with 0 % upfront, that is the whole price).
export function dueNow(request) {
  const bid = acceptedBid(request);
  if (!bid) return null;
  const confirms = confirmsOf(request);
  const { upfront, final } = splitSats(bid.priceSats, bid.upfrontPct);
  const tries = [];
  if (confirms.has("pickup") && upfront > 0) tries.push(["pickup", upfront]);
  if (confirms.has("delivered") && final > 0) tries.push(["final", final]);
  for (const [phase, amount] of tries) {
    const left = amount - sentSats(request, phase);
    if (left >= 1) return { phase, amountSats: left, mint: bid.mint, courier: bid.courier };
  }
  return null;
}

// What the shipper still owes of the price, and what the courier has confirmed so far.
export function moneyOf(request) {
  const bid = acceptedBid(request);
  if (!bid) return null;
  const paid = paidSats(request);
  return { priceSats: bid.priceSats, paidSats: paid, owedSats: Math.max(0, bid.priceSats - paid), mint: bid.mint, upfrontPct: bid.upfrontPct };
}

// The deliveries this courier completed, newest first, shaped like lib/earnings.js completedDrives so summarizeEarnings() works on them:
// [{ request, fareSats (what the courier confirmed receiving), tips: [], tipSats: 0, at (seconds) }].
export function completedDeliveries(requests, pubkey) {
  return requests
    .filter((r) => deliveryCourier(r) === pubkey && deliveryStatus(r) === "completed")
    .map((request) => ({ request, fareSats: paidSats(request), tips: [], tipSats: 0, at: Math.floor((confirmsOf(request).get("delivered")?.at || request.created_at * 1000) / 1000) }))
    .sort((a, b) => b.at - a.at);
}

// The token inside a payment, opened by the courier (null if it is not theirs or is unreadable).
export function payToken(pay, request, user) {
  const v = unseal(user.sk, request.pubkey, parse(pay.event)?.sealed);
  return v && typeof v.token === "string" ? v.token : null;
}
