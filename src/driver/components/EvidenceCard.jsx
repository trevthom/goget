// ════════════════════════════════════════════════════════════
//  EVIDENCE CARD (driver) — What the rider's signed records say about
//  this ride: the deposit and the rest of the fare, and whether the
//  rider confirmed boarding and the end of the trip. Payment records are
//  re-checked HERE, against the driver's own Lightning server, never taken
//  on the rider's word. "Copy trip record" gives a dispute bundle.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { rideConfirm } from "../../lib/rides.js";
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
      {[...["deposit", "rest"].map((phase) => records.find((x) => x.phase === phase) || { phase, missing: true }), ...records.filter((x) => x.phase === "tip")].map((r) => {
        if (r.missing && r.phase === "deposit") return null;
        const k = `${r.phase}:${r.at}`;
        const [text, cls] = !r.missing ? LABEL[checks[k] || "unverified"] : ["Waiting for the rider's payment record.", "text-neutral-500"];
        return (
          <div key={k} className="py-1.5 text-[15px]">
            <div className="flex justify-between">
              <span className="font-medium">{r.phase === "deposit" ? "Deposit" : r.phase === "tip" ? "Tip" : "Rest of the fare"}</span>
              {!r.missing && <Money sats={r.amountSats} />}
            </div>
            <p className={`text-xs ${cls}`}>{!r.missing ? (checks[k] ? text : "Checking…") : text}</p>
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
