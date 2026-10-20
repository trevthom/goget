// ════════════════════════════════════════════════════════════
//  PAY DELIVERY (shipper side) — Pays the courier the part of the price that is due (lib/deliveryPay.js dueNow): the share asked for
//  at pickup once the shipper typed the courier's code, the rest once the shipper confirmed the delivery. Called every few seconds
//  for each delivery of the shipper. One ecash token per payment, sealed to the courier, in a signed event (kind 30109).
//  A short wallet pays what it can; the rest stays due and is paid as soon as the wallet has money again. Never paid twice
//  (sentSats counts every payment, a refused one until the shipper's app took its token back from the mint).
//
//    payDelivery({ request, user, ecash, publish }) → { status, due, ... }
//      status: "ok" nothing due · "paid" a part was sent · "short" the wallet is too low · "wait" no wallet yet · "paying" one is in flight · "error"
// ════════════════════════════════════════════════════════════

import { dueNow, payEvent } from "../../lib/deliveryPay.js";
import { recoverRefusedDelivery } from "./recoverRefusedDelivery.js";
import { releaseWhenSafe } from "./handoff.js";

const busy = new Set();
const MIN_PART = 1;

export async function payDelivery({ request, user, ecash, publish }) {
  recoverRefusedDelivery({ request, user, ecash }).catch(() => {}); // a "refused" payment is checked at the mint, in the background; it is paid again only if the token came back
  const due = dueNow(request);
  if (!due) return { status: "ok", due: 0 };
  if (!ecash) return { status: "wait", due: due.amountSats };
  const lock = request.pubkey + ":" + request.id;
  if (busy.has(lock)) return { status: "paying", due: due.amountSats };
  busy.add(lock);
  try {
    const have = ecash.balance(due.mint);
    let amount = due.amountSats;
    // The mint may take a few sats of fee on top: when paying only part, leave room for it.
    if (have < amount + 2) amount = Math.max(0, have - 2 - Math.ceil(have * 0.01));
    if (amount < MIN_PART) return { status: "short", due: due.amountSats, shortSats: due.amountSats - have };
    let pay;
    try {
      pay = await ecash.pay(due.mint, amount);
    } catch (e) {
      if (e.code === "funds") return { status: "short", due: due.amountSats, shortSats: due.amountSats - have };
      return { status: "error", due: due.amountSats, message: e.message };
    }
    const ev = payEvent(request, due.courier, user, { phase: due.phase, amountSats: pay.sats, mint: due.mint, token: pay.token });
    // The event now holds the money. A durable publish saves it in the outbox BEFORE it is sent; the token leaves the wallet only when the event is safe (handoff.js).
    releaseWhenSafe(ecash, pay.id, publish(ev.kind, ev.content, ev.tags, { durable: true }));
    return { status: pay.sats < due.amountSats ? "short" : "paid", due: due.amountSats - pay.sats, shortSats: due.amountSats - pay.sats, sentNow: pay.sats };
  } finally {
    busy.delete(lock);
  }
}
