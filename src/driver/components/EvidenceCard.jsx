// ════════════════════════════════════════════════════════════
//  EVIDENCE CARD (driver) — What the rider's signed records say about
//  this ride: the ecash payments (ticks) and how each was answered, any tip
//  sent over Lightning, and whether the rider confirmed boarding and the end
//  of the trip. A tip record is re-checked HERE, against the driver's own
//  Lightning server, never taken on the rider's word. "Copy trip record"
//  gives a dispute bundle.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { rideConfirm } from "../../lib/rides.js";
import { ticksOf, tickReplies, paidSats } from "../../lib/payments.js";
import { paymentRecords, verifyPayment, disputeRecord } from "../../lib/evidence.js";
import Money from "../../ui/Money.jsx";
import Icon from "../../ui/Icon.jsx";

const LABEL = {
  confirmed: ["Confirmed by your Lightning server", "text-[#05944f]"],
  consistent: ["Proof matches the invoice. Check your wallet to be sure.", "text-neutral-600"],
  unverified: ["Not verified. Check your wallet.", "text-amber-700"],
};

export default function EvidenceCard({ request }) {
  const { user, liveTick } = useApp();
  void liveTick;
  const records = paymentRecords(request, user);
  const confirm = rideConfirm(request);
  const [checks, setChecks] = useState({});
  const [copied, setCopied] = useState(false);
  const key = records.map((r) => `${r.phase}:${r.at}`).join(",");

  useEffect(() => {
    let alive = true;
    records.forEach((r) => verifyPayment(r, user.lud16).then((v) => alive && setChecks((c) => ({ ...c, [`${r.phase}:${r.at}`]: v }))));
    return () => { alive = false; };
  }, [key, user.lud16]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = () => {
    navigator.clipboard?.writeText(JSON.stringify(disputeRecord(request, user), null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-2xl border border-neutral-200 p-4 mt-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Trip record</h2>
      {(() => {
        const ticks = ticksOf(request), replies = tickReplies(request);
        const refused = ticks.filter((t) => replies.get(t.id)?.ok === false).length;
        const waiting = ticks.filter((t) => !replies.has(t.id)).length;
        return (
          <div className="py-1.5 text-[15px]">
            <div className="flex justify-between">
              <span className="font-medium">Ecash payments</span>
              <Money sats={paidSats(request)} />
            </div>
            <p className="text-xs text-neutral-600">
              {ticks.length} sent · {ticks.length - refused - waiting} received{refused ? ` · ${refused} refused by the mint` : ""}{waiting ? ` · ${waiting} waiting` : ""}
            </p>
          </div>
        );
      })()}
      {records.filter((x) => x.phase === "tip").map((r) => {
        const k = `${r.phase}:${r.at}`;
        const [text, cls] = LABEL[checks[k] || "unverified"];
        return (
          <div key={k} className="py-1.5 text-[15px]">
            <div className="flex justify-between"><span className="font-medium">Tip</span><Money sats={r.amountSats} /></div>
            <p className={`text-xs ${cls}`}>{checks[k] ? text : "Checking…"}</p>
          </div>
        );
      })}
      <div className="py-1.5 text-[15px] border-t border-neutral-100 mt-1">
        <p className="font-medium">Rider's word</p>
        <p className="text-xs text-neutral-600">
          {confirm.boarded ? (confirm.boarded.ok ? "Said they got in the car." : `Did not board: ${confirm.boarded.note || "no reason given"}`) : "No boarding confirmation."}
        </p>
        {confirm.problem && <p className="text-xs text-red-600">Reported a problem during the trip: {confirm.problem.note || "no details"}</p>}
        <p className={`text-xs ${confirm.ended && !confirm.ended.ok ? "text-red-600" : "text-neutral-600"}`}>
          {confirm.ended ? (confirm.ended.ok ? "Confirmed the trip ended." : `Reported a problem: ${confirm.ended.note || "no details"}`) : "No end-of-trip confirmation yet."}
        </p>
      </div>
      <button type="button" onClick={copy} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold underline">
        <Icon name="copy" size={14} /> {copied ? "Copied" : "Copy trip record"}
      </button>
    </div>
  );
}
