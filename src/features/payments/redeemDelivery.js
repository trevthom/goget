// ════════════════════════════════════════════════════════════
//  REDEEM DELIVERY (courier side) — Takes the shipper's ecash payments as they arrive. For each payment (kind 30109) not yet answered:
//  open the token (sealed to the courier), check it is from the mint named in the accepted bid, redeem it (the money becomes the
//  courier's own ecash at once) and answer with a signed reply (kind 30110): "received", or a FINAL refusal (a token the mint says is
//  spent, the wrong mint, an unreadable one). A token already redeemed for ANOTHER payment is a replay: refused. When the mint cannot be
//  reached nothing is answered and it is tried again a little later: a shipper is never told "refused" because of a bad connection.
//
//    redeemDeliveryFor({ user, ecash, publish, requests }) → { received, refused, waiting }
//  Looks at every delivery the courier was given (also finished ones: the shipper may pay late).
// ════════════════════════════════════════════════════════════

import { acceptedBid, deliveryCourier } from "../../lib/delivery.js";
import { paysOf, payReplies, payReplyEvent, payToken } from "../../lib/deliveryPay.js";

const inFlight = new Set();
const retryAt = new Map();
const RETRY_MS = 15000;

export async function redeemDeliveryFor({ user, ecash, publish, requests, nowMs = Date.now() }) {
  const out = { received: 0, refused: 0, waiting: 0 };
  if (!ecash) return out;
  // Requests whose payments may be waiting: the ones that name this courier.
  const mine = requests.filter((r) => deliveryCourier(r) === user.publicKey);
  for (const request of mine) {
    const bid = acceptedBid(request);
    if (!bid) continue;
    const replies = payReplies(request);
    for (const pay of paysOf(request)) {
      if (replies.has(pay.id) || inFlight.has(pay.id)) continue;
      if ((retryAt.get(pay.id) || 0) > nowMs) { out.waiting++; continue; }
      inFlight.add(pay.id);
      const answer = (ok, receivedSats, reason) => {
        const ev = payReplyEvent(request, pay.event, { ok, receivedSats, reason }, user);
        publish(ev.kind, ev.content, ev.tags).catch(() => {});
      };
      try {
        const token = payToken(pay, request, user);
        if (!token) { answer(false, 0, "The payment could not be opened."); out.refused++; continue; }
        const res = await ecash.redeem(token, { only: [bid.mint], ref: pay.id });
        answer(true, res.sats, "");
        out.received += res.sats;
      } catch (e) {
        if (e?.code === "used" && e.ref === pay.id && e.sats > 0) { answer(true, e.sats, ""); out.received += e.sats; } // redeemed before; the reply was lost
        else if (e?.code === "used") { answer(false, 0, "This token was already used for another payment."); out.refused++; }
        else if (e?.definitive) { answer(false, 0, e.message || "The mint refused this payment."); out.refused++; }
        else { retryAt.set(pay.id, nowMs + RETRY_MS); out.waiting++; }
      } finally {
        inFlight.delete(pay.id);
      }
    }
  }
  return out;
}
