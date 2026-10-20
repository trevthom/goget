// ════════════════════════════════════════════════════════════
//  JOBS (Courier) — Delivery requests this courier may see: open, near (the radius), and meeting the CDL need. A request that needs a
//  CDL or an endorsement the courier did not list in Account → Courier details is NOT shown at all. Nearest first. A tap opens the
//  request and the bid form. A request the courier already bid on says so.
// ════════════════════════════════════════════════════════════

import { formatDistance } from "../../lib/units.js";
import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useCourier, RADIUS_CHOICES } from "../state/CourierContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { openFold } from "../../ui/Fold.jsx";
import Icon from "../../ui/Icon.jsx";
import Money from "../../ui/Money.jsx";
import BidForm from "../components/BidForm.jsx";
import { deliveryContent, deliveryNeed, sizeLabel, typeLabel } from "../../lib/delivery.js";
import { needText } from "../../lib/cdl.js";
import { gpsMessage } from "../../lib/gps.js";

export default function JobsScreen() {
  const { setView } = useApp();
  const { open, bids, radius, setRadius, myPosition, geoError, gps, ready } = useCourier();
  const [picked, setPicked] = useState(null); // request id
  const mineBid = (r) => bids.find((b) => b.request.id === r.id && b.state === "pending")?.bid;
  const selected = picked ? open.find((x) => x.request.id === picked)?.request : null;

  return (
    <Screen title="Jobs">
      {!ready && (
        <p className="text-amber-800 bg-amber-50 rounded-xl px-3 py-2 text-sm mb-3" role="status">
          You have no ecash wallet on this phone, so you cannot bid. <button type="button" className="font-semibold underline" onClick={() => { openFold("ecash"); setView("account"); }}>Set up my wallet</button>
        </p>
      )}
      {!myPosition && <p className="text-sm text-neutral-600 mb-3" role="status">{gpsMessage(gps, myPosition, geoError)} Until your location is known, every open request is shown.</p>}

      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-neutral-500">Within</span>
        <div className="flex gap-1.5" role="group" aria-label="Distance">
          {RADIUS_CHOICES.map((r) => (
            <button key={r} type="button" aria-pressed={radius === r} onClick={() => setRadius(r)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold ${radius === r ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>{formatDistance(r, { digits: 0 })}</button>
          ))}
        </div>
      </div>

      {open.length === 0 ? (
        <div className="text-center py-12">
          <Icon name="package" size={40} className="mx-auto text-neutral-300 mb-3" />
          <p className="font-semibold">No delivery requests right now</p>
          <p className="text-neutral-500 text-sm mt-1">New ones appear here by themselves. Requests that need a CDL or an endorsement you did not list are hidden.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {open.map(({ request, miles }) => {
            const c = deliveryContent(request), need = needText(deliveryNeed(request)), bid = mineBid(request);
            return (
              <li key={request.id}>
                <button type="button" onClick={() => setPicked(request.id)} className="w-full text-left rounded-2xl border border-neutral-200 p-4 active:bg-neutral-50" aria-label={`${typeLabel(c.what?.type)} ${c.pickup?.name} to ${c.dropoff?.name}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}</span>
                    {bid && <span className="ml-auto text-xs font-semibold bg-[#e6f4ec] text-[#05683a] rounded-full px-2 py-0.5">Your bid: <Money sats={bid.priceSats} /></span>}
                  </div>
                  <p className="text-sm text-neutral-700 mt-1 truncate">{c.pickup?.name} → {c.dropoff?.name}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {miles != null ? `${formatDistance(miles)} away · ` : ""}{c.distanceMiles ? `${formatDistance(c.distanceMiles)} trip · ` : ""}{c.time && c.time !== "ASAP" ? "pickup " + new Date(c.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "as soon as possible"}
                  </p>
                  {need && <p className="text-xs font-semibold mt-1 inline-flex items-center gap-1"><Icon name="truck" size={12} /> {need}</p>}
                  {c.what?.note && <p className="text-sm text-neutral-600 mt-1 line-clamp-2">{c.what.note}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {selected && <BidForm key={selected.id} request={selected} existing={mineBid(selected)} onClose={() => setPicked(null)} />}
    </Screen>
  );
}
