// ════════════════════════════════════════════════════════════
//  NEARBY REQUESTS (driver) — "See nearby requests": a list of every open ride request inside the
//  driver's request radius, closest first. It works with the new-request alerts on or off. Each row shows what a
//  driver needs to decide:
//    pickup · dropoff · the fare (this driver's own estimate) ·
//    drive time to the rider · the trip's distance · the trip's drive time · the rider's note to the driver
//  Tapping a row opens that request (Accept / Decline) on the map page; the driver comes back to this list afterwards.
// ════════════════════════════════════════════════════════════

import { formatDistance } from "../../lib/units.js";
import { useApp } from "../../state/AppContext.jsx";
import { useDriver, shownSats } from "../state/DriverContext.jsx";
import { driveMinutes, pickupEta, roadMiles } from "../../lib/fare.js";
import { haversineDistance } from "../../lib/geo.js";
import Money from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";
import { Screen } from "../../ui/Layout.jsx";

const whenText = (time) => (time === "ASAP" ? "Now" : new Date(time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }));

// The facts about one open request, for a row. `miles` = straight-line distance from the driver to the pickup (null without GPS).
export function requestFacts({ request, content: c, miles }, rates, prices, usdPrice) {
  const tripMiles = c.distanceMiles ?? roadMiles(haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng));
  return {
    sats: shownSats(request, rates, prices, usdPrice),
    awayMin: miles != null ? pickupEta(miles) : null,
    tripMiles,
    tripMin: c.durationMin ?? driveMinutes(tripMiles),
    when: c.time && c.time !== "ASAP" ? whenText(c.time) : null,
    notes: typeof c.notes === "string" ? c.notes.trim() : "",
  };
}

export default function NearbyRequests({ onBack, onPick }) {
  const { user, prices, usdPrice } = useApp();
  const { open } = useDriver();
  return (
    <Screen title="Nearby requests" onBack={onBack}>
      {open.length === 0 ? (
        <p className="text-neutral-600 text-[15px] mt-2" role="status">No ride requests inside your request radius right now. New ones appear here by themselves.</p>
      ) : (
        <>
          <p className="text-neutral-500 text-sm mb-1" role="status">{open.length} request{open.length === 1 ? "" : "s"} within your radius, closest first. Tap one to see it.</p>
          <ul className="divide-y divide-neutral-100">
            {open.map((item) => {
              const { request, content: c } = item;
              const f = requestFacts(item, user.rates, prices, usdPrice);
              return (
                <li key={request.id}>
                  <button type="button" onClick={() => onPick(request.id)} aria-label={`Request from ${c.pickup.name} to ${c.dropoff.name}`} className="w-full text-left py-4 active:bg-neutral-50">
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
                        <span className="w-2 h-2 rounded-full bg-black" /><span className="h-7 w-px bg-neutral-300 my-0.5" /><span className="w-2 h-2 bg-black" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-[15px] font-medium truncate">{c.pickup.name}</p>
                        <p className="text-[15px] font-medium truncate">{c.dropoff.name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Money sats={f.sats} className="font-bold" />
                        <p className="text-xs text-neutral-500">your fare, about</p>
                      </div>
                      <Icon name="chevron-right" size={18} className="text-neutral-400 mt-1" />
                    </div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-neutral-100 px-2 py-2"><dd className="font-semibold text-[15px]">{f.awayMin != null ? `${f.awayMin} min` : "—"}</dd><dt className="text-[11px] text-neutral-500">to the rider</dt></div>
                      <div className="rounded-xl bg-neutral-100 px-2 py-2"><dd className="font-semibold text-[15px]">{formatDistance(f.tripMiles)}</dd><dt className="text-[11px] text-neutral-500">trip distance</dt></div>
                      <div className="rounded-xl bg-neutral-100 px-2 py-2"><dd className="font-semibold text-[15px]">{f.tripMin} min</dd><dt className="text-[11px] text-neutral-500">trip drive time</dt></div>
                    </dl>
                    {f.when && <p className="text-sm font-semibold mt-2">Reserved for {f.when}</p>}
                    {f.notes && <p className="mt-2 text-sm text-neutral-600 bg-neutral-100 rounded-xl px-3 py-2">“{f.notes}”</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Screen>
  );
}
