// ════════════════════════════════════════════════════════════
//  EARNINGS (driver) — Totals for today, this week and all time, and the
//  list of completed drives. Amounts are the agreed fares (riders pay
//  you directly over Lightning, so check your wallet for what arrived).
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { completedDrives, summarizeEarnings } from "../../lib/earnings.js";
import { exactTrip } from "../../lib/privacy.js";
import { Screen } from "../../ui/Layout.jsx";
import Money from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";

const PERIODS = [["today", "Today"], ["week", "7 days"], ["all", "All time"]];
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export default function EarningsScreen() {
  const { user, rideRequests, pullRecent } = useApp();
  const [period, setPeriod] = useState("today");

  useEffect(() => {
    relay.fetchHistory(user.publicKey);
    pullRecent();
  }, [pullRecent, user.publicKey]);

  const drives = completedDrives(rideRequests, user.publicKey);
  const totals = summarizeEarnings(drives);
  const t = totals[period];
  const since = { today: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(), week: Date.now() - 7 * 86400000, all: 0 }[period];
  const shown = drives.filter((d) => d.at * 1000 >= since);

  return (
    <Screen title="Earnings">
      <div className="flex bg-neutral-100 p-1 rounded-full mb-5" role="tablist">
        {PERIODS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={period === id} onClick={() => setPeriod(id)}
            className={`flex-1 py-2 rounded-full text-sm font-semibold ${period === id ? "bg-black text-white" : "text-neutral-600"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="text-center mb-6">
        <Money sats={t.sats} stacked className="text-5xl font-extrabold tracking-tight" subClassName="text-neutral-500 text-sm" />
        <p className="text-neutral-600 mt-2">{t.trips} trip{t.trips === 1 ? "" : "s"}</p>
        {t.tips > 0 && <p className="text-[#05683a] text-sm font-medium mt-0.5">Includes <Money sats={t.tips} className="font-semibold" /> in tips</p>}
      </div>

      {shown.length === 0 ? (
        <div className="text-center py-10">
          <Icon name="chart" size={40} className="mx-auto text-neutral-300 mb-3" />
          <p className="font-semibold">No trips {period === "today" ? "today" : "yet"}</p>
          <p className="text-neutral-500 text-sm mt-1">Go online on the Drive tab to start earning.</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {shown.slice(0, 100).map(({ request, fareSats, tipSats, at }) => {
            const trip = exactTrip(request, user) || parse(request);
            return (
              <li key={request.id} className="flex items-center gap-3 py-3">
                <span className="w-11 h-11 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name="car" size={20} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{trip?.dropoff?.name}</span>
                  <span className="block text-sm text-neutral-500">{new Date(at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                <span className="text-right">
                  <Money sats={fareSats} className="font-semibold" />
                  {tipSats > 0 && <span className="block text-xs text-[#05683a]">+ <Money sats={tipSats} /> tip</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-neutral-500 text-xs mt-6">
        Fares are paid peer to peer over Lightning, straight to your Lightning address. This list shows the agreed fares.
      </p>
    </Screen>
  );
}
