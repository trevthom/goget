// ════════════════════════════════════════════════════════════
//  DRIVE SUMMARY (driver) — Shown after a ride ends (either person finished it):
//  what the ride earned (base + miles + minutes, or the flat price), what the rider
//  has paid so far in ecash and what is still open, an optional rating of the rider,
//  and "Waive part of the fare" (the driver may waive all or part of it). If the rider
//  finished the ride before it started: a short notice, nothing is owed.
//  Ecash the rider pays later still arrives in the wallet (DriverContext redeems it).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useDriver } from "../state/DriverContext.jsx";
import { rideEnding, rideStatus } from "../../lib/rides.js";
import { exactTrip } from "../../lib/privacy.js";
import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideTerms, rideMint } from "../../lib/terms.js";
import { FINISH_REASONS } from "../../lib/finish.js";
import { waiversOf } from "../../lib/payments.js";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import RatingForm from "../../ui/RatingForm.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import { Modal, inputCls } from "../../ui/Parts.jsx";
import RiderInfo from "../components/RiderInfo.jsx";
import BlockButton from "../../ui/BlockButton.jsx";
import EvidenceCard from "../components/EvidenceCard.jsx";
import { tipsOf } from "../../lib/evidence.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };

export default function DriveSummary({ request }) {
  const { user, btcPrice, liveTick, priceFor } = useApp();
  const { dismissReceipt, rateRider, driveMoney, waiveFare } = useDriver();
  void liveTick;
  const [rated, setRated] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const completed = rideStatus(request) === "completed";
  const trip = exactTrip(request, user) || parse(request);
  const end = rideEnding(request);
  const endedAt = end?.at;
  const fin = end?.fin;
  const tipped = tipsOf(request).reduce((s, t) => s + t.sats, 0); // optional, from the rider, any time later
  // Worked out from the signed events (start time, finish event) so it is right on any device and after any restart.
  const terms = rideTerms(request);
  const sum = ledgerSummary(request, terms ? currentLedger(request, { terms, price: priceFor(terms.currency), nowMs: Date.now(), miles: null, role: "driver" }) : null);
  const waived = waiversOf(request).reduce((t, w) => ({ forgiven: t.forgiven + w.forgivenSats, refund: t.refund + w.refundSats }), { forgiven: 0, refund: 0 });

  if (!completed) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto bg-white px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-8 text-center flex flex-col justify-center">
        <div className="w-16 h-16 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4"><Icon name="x" size={30} /></div>
        <h1 className="text-2xl font-bold">The rider finished the ride</h1>
        <p className="text-neutral-600 text-[15px] mt-2">It was before the ride started, so nothing is owed.</p>
        <Button className="mt-6" variant="go" onClick={() => dismissReceipt(request)}>Back to driving</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-white">
      <div className="px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8">
        <div className="w-14 h-14 rounded-full bg-[#e6f4ec] text-[#05944f] flex items-center justify-center mb-3"><Icon name="check" size={28} strokeWidth={3} /></div>
        <h1 className="text-[28px] leading-8 font-bold">Ride finished</h1>
        {endedAt && <p className="text-neutral-500 text-sm mt-1">{new Date(endedAt * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>}
        {fin?.reason && <p className="text-neutral-600 text-sm mt-1">{FINISH_REASONS[fin.reason]}</p>}

        <dl className="mt-5 rounded-2xl bg-neutral-100 px-4 py-4 space-y-2 text-[15px]">
          <div className="flex justify-between items-end"><dt className="font-semibold">Fare</dt><dd><Money sats={sum.owed} stacked className="text-2xl font-extrabold" /></dd></div>
          <div className="flex justify-between"><dt className="text-neutral-600">Paid by the rider</dt><dd><Money sats={sum.paid} /></dd></div>
          {sum.forgiven > 0 && <div className="flex justify-between"><dt className="text-neutral-600">Waived by you</dt><dd><Money sats={sum.forgiven} /></dd></div>}
          {sum.outstanding > 2 && <div className="flex justify-between"><dt className="font-semibold text-amber-700">Not paid yet</dt><dd><Money sats={sum.outstanding} className="font-bold" /></dd></div>}
          {tipped > 0 && <div className="flex justify-between"><dt className="font-semibold text-[#05683a]">Tip</dt><dd><Money sats={tipped} className="font-bold" /></dd></div>}
        </dl>
        {sum.outstanding > 2 && (
          <p className="text-neutral-600 text-sm mt-2">The rider can still refill their wallet and pay what is missed. It arrives in your ecash wallet by itself. {driveMoney?.missed ? `${driveMoney.missed} payments were missed during the ride.` : ""}</p>
        )}
        <p className="text-neutral-500 text-xs mt-2">Payments arrived in your ecash wallet as the ride ran. Cash out to your Lightning address in Account.</p>
        {(waived.forgiven > 0 || waived.refund > 0) && <p className="text-neutral-600 text-sm mt-2">You waived {moneyText(waived.forgiven + waived.refund, btcPrice)}{waived.refund > 0 ? `, and sent ${moneyText(waived.refund, btcPrice)} back to the rider` : ""}.</p>}
        {(sum.outstanding > 2 || sum.paid > 0) && (
          <button type="button" onClick={() => setWaiving(true)} className="mt-3 text-sm font-semibold underline">Waive part of the fare</button>
        )}

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
      {waiving && <Waive request={request} sum={sum} onClose={() => setWaiving(false)} onWaive={waiveFare} />}
    </div>
  );
}

// Waive part of the fare. What the rider has not paid is forgiven first; if more is waived, that part is sent back as ecash.
function Waive({ request, sum, onClose, onWaive }) {
  const { btcPrice, pushNotice, ecash } = useApp();
  // Money goes back from the driver's own ecash at the ride's mint, so no more can be refunded than they still hold there.
  const held = ecash ? ecash.balance(rideMint(request) || "") : 0;
  const max = sum.outstanding + Math.min(sum.paid, held);
  const [sats, setSats] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = Number.isFinite(sats) && sats >= 1 && sats <= max;
  const refund = ok ? Math.max(0, sats - sum.outstanding) : 0;
  const send = async () => {
    setBusy(true);
    const done = await onWaive(request, sats, reason.trim());
    setBusy(false);
    if (done) { pushNotice("Fare waived. The rider is told."); onClose(); }
  };
  return (
    <Modal open title="Waive part of the fare" onClose={onClose}>
      <p className="text-neutral-600 text-[15px] mb-3">
        You can waive all or part of the fare, for any reason. What the rider has not paid is forgiven first. If you waive more than that, the rest is sent back to the rider as ecash.
      </p>
      {held < sum.paid && <p className="text-xs text-amber-700 mt-2">You hold less ecash than the rider paid (the rest was cashed out or spent), so at most {moneyText(max, btcPrice)} can be waived.</p>}
      <div className="rounded-2xl bg-neutral-100 px-4 py-3">
        <AmountInput sats={sats} rate={btcPrice} min={1} max={max} onChange={setSats} label="Amount to waive" />
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={() => setSats(Math.max(1, sum.outstanding))} disabled={sum.outstanding < 1} className="text-sm font-semibold underline disabled:text-neutral-400">Forgive what is not paid</button>
        <button type="button" onClick={() => setSats(max)} className="text-sm font-semibold underline ml-auto">The whole fare</button>
      </div>
      {ok && <p className="text-xs text-neutral-600 mt-2">{refund > 0 ? `${moneyText(Math.min(sats, sum.outstanding), btcPrice)} forgiven and ${moneyText(refund, btcPrice)} sent back.` : `${moneyText(sats, btcPrice)} forgiven. Nothing is sent back.`}</p>}
      <input aria-label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={140} placeholder="Reason (optional)" className={`${inputCls} mt-3`} />
      <Button className="mt-3" onClick={send} disabled={!ok} loading={busy}>Waive {ok ? moneyText(sats, btcPrice) : ""}</Button>
    </Modal>
  );
}
