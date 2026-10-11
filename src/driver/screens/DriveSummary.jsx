// ════════════════════════════════════════════════════════════
//  DRIVE SUMMARY (driver) — Shown after a drive ends: what the trip paid,
//  who still owes what, and an optional rating of the rider. If the rider
//  cancelled, a short notice instead.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useDriver } from "../state/DriverContext.jsx";
import { rideEnding, rideStatus } from "../../lib/rides.js";
import { exactTrip } from "../../lib/privacy.js";
import { acceptFor, offerFrom } from "../../lib/trips.js";
import Money from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import RatingForm from "../../ui/RatingForm.jsx";
import RiderInfo from "../components/RiderInfo.jsx";
import BlockButton from "../../ui/BlockButton.jsx";
import EvidenceCard from "../components/EvidenceCard.jsx";
import { tipsOf } from "../../lib/evidence.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export default function DriveSummary({ request }) {
  const { user } = useApp();
  const { dismissReceipt, rateRider } = useDriver();
  const [rated, setRated] = useState(false);
  const completed = rideStatus(request) === "completed";
  const trip = exactTrip(request, user) || parse(request);
  const c = parse(request) || {};
  const accept = acceptFor(request, user.publicKey);
  const deposit = accept ? parse(accept)?.paidSats || 0 : 0;
  const offer = offerFrom(request, user.publicKey); // the fare this driver agreed to
  const fare = (offer ? parse(offer)?.priceSats : c.fareSats) || 0;
  const endedAt = rideEnding(request)?.at;
  const tipped = tipsOf(request).reduce((s, t) => s + t.sats, 0); // optional, from the rider, any time later

  if (!completed) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-white px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-8 text-center flex flex-col justify-center">
        <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4"><Icon name="x" size={30} /></div>
        <h1 className="text-2xl font-bold">The rider cancelled</h1>
        <p className="text-neutral-600 text-[15px] mt-2">Any deposit they paid is yours to keep. Check your wallet.</p>
        <Button className="mt-6" variant="go" onClick={() => dismissReceipt(request)}>Back to driving</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
        <div className="w-14 h-14 rounded-full bg-[#e6f4ec] text-[#05944f] flex items-center justify-center mb-3"><Icon name="check" size={28} strokeWidth={3} /></div>
        <h1 className="text-[28px] leading-8 font-bold">Trip complete</h1>
        {endedAt && <p className="text-neutral-500 text-sm mt-1">{new Date(endedAt * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>}

        {fare > 0 && (
          <dl className="mt-5 rounded-2xl bg-neutral-100 px-4 py-4 space-y-2 text-[15px]">
            <div className="flex justify-between items-end"><dt className="font-semibold">Fare</dt><dd><Money sats={fare} stacked className="text-2xl font-extrabold" /></dd></div>
            {deposit > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Deposit (paid up front)</dt><dd><Money sats={deposit} /></dd></div>}
            {fare - deposit > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Rider pays now</dt><dd><Money sats={fare - deposit} /></dd></div>}
            {tipped > 0 && <div className="flex justify-between"><dt className="font-semibold text-[#05683a]">Tip</dt><dd><Money sats={tipped} className="font-bold" /></dd></div>}
          </dl>
        )}
        <p className="text-neutral-500 text-xs mt-2">Payments go straight to your Lightning address. Check your wallet for the rest of the fare.</p>

        {trip && (
          <div className="mt-5 flex items-start gap-3">
            <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
              <span className="w-2 h-2 rounded-full bg-black" /><span className="h-5 w-px bg-neutral-300 my-0.5" /><span className="w-2 h-2 bg-black" />
            </div>
            <div className="min-w-0 flex-1 space-y-2.5">
              <p className="text-[15px] truncate">{trip.pickup.name}</p>
              <p className="text-[15px] truncate">{trip.dropoff.name}</p>
            </div>
          </div>
        )}

        <EvidenceCard request={request} />

        <div className="mt-6 pt-5 border-t border-neutral-100">
          <RiderInfo pubkey={request.pubkey} compact />
          <div className="mt-5">
            {rated ? (
              <p className="text-center text-neutral-600 text-[15px]">Thanks for rating your rider.</p>
            ) : (
              <RatingForm who="rider" onSubmit={(stars, review) => { rateRider(request, stars, review); setRated(true); }} onSkip={() => setRated(true)} />
            )}
          </div>
        </div>

        <div className="mt-4"><BlockButton pubkey={request.pubkey} /></div>
        <Button className="mt-4" variant="go" onClick={() => dismissReceipt(request)}>Back to driving</Button>
      </div>
    </div>
  );
}
