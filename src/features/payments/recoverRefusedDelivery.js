// ════════════════════════════════════════════════════════════
//  RECOVER REFUSED DELIVERY PAYMENTS (shipper side) — A courier may answer a payment with "refused" (kind 30110, ok:false). The shipper's app
//  does not take that on trust: a courier could redeem the token and still say "refused", and the shipper's app would pay the same part again,
//  and again, until the wallet is empty. (The same rule as features/payments/recoverRefused.js for rides.)
//
//  So for each refused payment the shipper's app tries to take its own token back from the mint (the token was sealed with the shipper's own
//  key, so the shipper can open it):
//    • the mint accepts it: the token was never spent. The money is back in the wallet, the part was NOT paid, and it is due again;
//    • the mint says no (it is spent): the courier has the money, so the part counts as paid, whatever the courier said;
//    • the mint cannot be reached: nothing is decided, the part still counts as sent, and the app tries again later.
//  Either way the shipper pays for a part once.
//
//    recoverRefusedDelivery({ request, user, ecash, nowMs }) → { recovered, spent, waiting }
// ════════════════════════════════════════════════════════════

import { paysOf, payReplies, payVerdict, setPayVerdict, ownPayToken } from "../../lib/deliveryPay.js";

const inFlight = new Set();
const retryAt = new Map(); // payment id → ms epoch
const RETRY_MS = 15000;

export async function recoverRefusedDelivery({ request, user, ecash, nowMs = Date.now() }) {
  const out = { recovered: 0, spent: 0, waiting: 0 };
  if (!ecash || user.publicKey !== request.pubkey) return out;
  const replies = payReplies(request);
  for (const pay of paysOf(request)) {
    if (replies.get(pay.id)?.ok !== false || payVerdict(pay.id) || inFlight.has(pay.id)) continue;
    if ((retryAt.get(pay.id) || 0) > nowMs) { out.waiting++; continue; }
    inFlight.add(pay.id);
    try {
      const token = ownPayToken(pay, request, user);
      if (!token) { setPayVerdict(pay.id, "spent"); out.spent++; continue; } // cannot be opened: do not pay it twice
      try {
        await ecash.redeem(token);
        setPayVerdict(pay.id, "recovered");
        out.recovered++;
      } catch (e) {
        if (e?.definitive) { setPayVerdict(pay.id, "spent"); out.spent++; }
        else { retryAt.set(pay.id, nowMs + RETRY_MS); out.waiting++; }
      }
    } finally {
      inFlight.delete(pay.id);
    }
  }
  return out;
}
