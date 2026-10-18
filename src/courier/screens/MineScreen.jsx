// ════════════════════════════════════════════════════════════
//  MY JOBS (Courier) — Deliveries the shipper gave this courier (tap one to work on it), and the courier's bids: waiting, chosen,
//  declined (the shipper turned it down, or took another bid), expired.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useCourier } from "../state/CourierContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import Icon from "../../ui/Icon.jsx";
import Money from "../../ui/Money.jsx";
import JobDetail from "./JobDetail.jsx";
import BidForm from "../components/BidForm.jsx";
import { acceptedBid, bidExpiresAt, deliveryContent, deliveryStatus, placesOf, sizeLabel, typeLabel } from "../../lib/delivery.js";

const BID_WORDS = { pending: ["Waiting for the shipper", "bg-amber-50 text-amber-800"], accepted: ["Chosen", "bg-[#e6f4ec] text-[#05683a]"], declined: ["Declined", "bg-neutral-100 text-neutral-600"], closed: ["Closed", "bg-neutral-100 text-neutral-600"], expired: ["Expired: bid again", "bg-neutral-100 text-neutral-600"] };
const JOB_WORDS = { assigned: "Go to the pickup", in_transit: "On the way to the drop-off", delivered: "Waiting for the shipper", disputed: "The shipper reported a problem" };

export default function MineScreen() {
  const { user } = useApp();
  const { jobs, bids } = useCourier();
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const job = openId ? jobs.find((r) => r.id === openId) : null;
  if (job) return <JobDetail request={job} onBack={() => setOpenId(null)} />;
  const waiting = bids.filter((b) => b.state !== "accepted" || deliveryStatus(b.request) === "requested");
  const edit = editing ? bids.find((b) => b.request.id === editing) : null;

  return (
    <Screen title="My jobs">
      <h2 className="font-bold text-[17px] mb-2">Deliveries</h2>
      {jobs.length === 0 ? (
        <p className="text-neutral-500 text-sm mb-6">No delivery to carry right now. Bid on a job and wait for the shipper to choose you.</p>
      ) : (
        <ul className="space-y-3 mb-6">
          {jobs.map((r) => {
            const c = deliveryContent(r), pl = placesOf(r, user), st = deliveryStatus(r), bid = acceptedBid(r);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} className="w-full text-left rounded-2xl border border-black p-4 active:bg-neutral-50" aria-label={`Open delivery to ${pl.dropoff.name}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}</span>
                    {bid && <span className="ml-auto"><Money sats={bid.priceSats} className="font-semibold" /></span>}
                  </div>
                  <p className="text-sm text-neutral-700 mt-1 truncate">{pl.pickup.name} → {pl.dropoff.name}</p>
                  <p className="text-sm font-semibold text-[#05683a] mt-1">{JOB_WORDS[st]}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="font-bold text-[17px] mb-2">My bids</h2>
      {waiting.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="inbox" size={36} className="mx-auto text-neutral-300 mb-2" />
          <p className="text-neutral-500 text-sm">You have not bid on anything yet. Open the Jobs tab.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {waiting.map(({ request, bid, state }) => {
            const c = deliveryContent(request), [label, tone] = BID_WORDS[state] || BID_WORDS.closed;
            return (
              <li key={bid.id}>
                <button type="button" disabled={state !== "pending" && state !== "expired"} onClick={() => setEditing(request.id)} className="w-full text-left rounded-2xl border border-neutral-200 p-4 enabled:active:bg-neutral-50" aria-label={`Your bid on ${c.dropoff?.name}: ${label}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{typeLabel(c.what?.type)} · {c.dropoff?.name}</span>
                    <span className={`ml-auto shrink-0 text-[11px] px-2 py-0.5 rounded-full font-semibold ${tone}`}>{label}</span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1">Your bid: <Money sats={bid.priceSats} className="font-semibold" />{bid.note ? ` · “${bid.note.slice(0, 60)}${bid.note.length > 60 ? "…" : ""}”` : ""}</p>
                  {state === "pending" && <p className="text-xs text-neutral-500 mt-0.5">Good for {Math.max(1, Math.ceil((bidExpiresAt(bid) - Date.now()) / 86400000))} more day(s). Then it expires.</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <BidForm key={edit.request.id} request={edit.request} existing={edit.bid} onClose={() => setEditing(null)} />}
    </Screen>
  );
}
