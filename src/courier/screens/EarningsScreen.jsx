// ════════════════════════════════════════════════════════════
//  EARNINGS (Courier) — Totals for today, 7 days and all time, and the list of completed deliveries. Amounts are what the shipper's
//  ecash payments delivered to this courier's wallet (lib/deliveryPay.js completedDeliveries). The money itself is in Account → Ecash wallet.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { completedDeliveries } from "../../lib/deliveryPay.js";
import { summarizeEarnings } from "../../lib/earnings.js";
import { deliveryContent, placesOf, typeLabel } from "../../lib/delivery.js";
import { Screen } from "../../ui/Layout.jsx";
import Money from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";

const PERIODS = [["today", "Today"], ["week", "7 days"], ["all", "All time"]];

export default function EarningsScreen() {
  const { user, deliveryRequests, pullRecent } = useApp();
  const [period, setPeriod] = useState("today");
  useEffect(() => { relay.fetchHistory(user.publicKey); pullRecent(); }, [pullRecent, user.publicKey]);

  const done = completedDeliveries(deliveryRequests, user.publicKey);
  const t = summarizeEarnings(done)[period === "week" ? "week" : period];
  const since = { today: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(), week: Date.now() - 7 * 86400000, all: 0 }[period];
  const shown = done.filter((d) => d.at * 1000 >= since);

  return (
    <Screen title="Earnings">
      <div className="flex bg-neutral-100 p-1 rounded-full mb-5" role="tablist">
        {PERIODS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={period === id} onClick={() => setPeriod(id)}
            className={`flex-1 py-2 rounded-full text-sm font-semibold ${period === id ? "bg-black text-white" : "text-neutral-600"}`}>{label}</button>
        ))}
      </div>
      <div className="text-center mb-6">
        <Money sats={t.sats} stacked className="text-5xl font-extrabold tracking-tight" subClassName="text-neutral-500 text-sm" />
        <p className="text-neutral-600 mt-2">{t.trips} deliver{t.trips === 1 ? "y" : "ies"}</p>
      </div>
      {shown.length === 0 ? (
        <div className="text-center py-10">
          <Icon name="chart" size={40} className="mx-auto text-neutral-300 mb-3" />
          <p className="font-semibold">No deliveries {period === "today" ? "today" : "yet"}</p>
          <p className="text-neutral-500 text-sm mt-1">Bid on a job to start earning.</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {shown.slice(0, 100).map(({ request, fareSats, at }) => {
            const c = deliveryContent(request), pl = placesOf(request, user);
            return (
              <li key={request.id} className="flex items-center gap-3 py-3">
                <span className="w-11 h-11 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="package" size={20} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{typeLabel(c.what?.type)} to {pl.dropoff.name}</span>
                  <span className="block text-sm text-neutral-500">{new Date(at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                <Money sats={fareSats} className="font-semibold" />
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-neutral-500 text-xs mt-6">Shippers pay you in ecash, straight into your wallet: part when the parcel is handed to you, the rest when it arrives.</p>
    </Screen>
  );
}
