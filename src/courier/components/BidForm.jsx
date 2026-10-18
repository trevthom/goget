// ════════════════════════════════════════════════════════════
//  BID FORM — The courier looks at one delivery request and bids on it: the details (what, size, areas, distance, when, CDL need,
//  the shipper's notes), then a price, the minutes until the courier can be at the pickup, how much is paid when the parcel is handed
//  over, and the courier's own notes for the shipper. The CDL statement and the vehicle from Account → Courier details are added to the
//  bid automatically. A courier can change a bid or take it back while the shipper has not chosen.
//    <BidForm request={…} existing={bid|undefined} onClose />
// ════════════════════════════════════════════════════════════

import { formatDistance } from "../../lib/units.js";
import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useCourier } from "../state/CourierContext.jsx";
import { Modal, inputCls } from "../../ui/Parts.jsx";
import AmountInput from "../../ui/AmountInput.jsx";
import Button from "../../ui/Button.jsx";
import VouchBadge from "../../ui/VouchBadge.jsx";
import { moneyText } from "../../ui/Money.jsx";
import { cdlText, needText } from "../../lib/cdl.js";
import { deliveryContent, deliveryNeed, typeLabel, sizeLabel, MAX_NOTE, UPFRONT_CHOICES, DEFAULT_UPFRONT } from "../../lib/delivery.js";
import { mintLabel } from "../../lib/mints.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";

export default function BidForm({ request, existing, onClose }) {
  const { btcPrice, setView } = useApp();
  const { placeBid, withdrawBid, cdl, mint, ready } = useCourier();
  const c = deliveryContent(request);
  const need = needText(deliveryNeed(request));
  const [sats, setSats] = useState(existing ? existing.priceSats : null);
  const [eta, setEta] = useState(existing ? String(existing.etaMinutes) : "30");
  const [note, setNote] = useState(existing?.note || "");
  const [upfront, setUpfront] = useState(existing ? existing.upfrontPct : DEFAULT_UPFRONT);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shipper = getProfile(request.pubkey);

  const send = async () => {
    const minutes = Math.round(Number(eta));
    if (!sats) return setError("Enter your price.");
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 20160) return setError("Enter the minutes until you can be at the pickup (0 to 20160).");
    setBusy(true); setError("");
    const r = await placeBid(request, { priceSats: sats, etaMinutes: minutes, note: note.trim(), upfrontPct: upfront });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onClose();
  };

  return (
    <Modal open title={existing ? "Your bid" : "Bid on this delivery"} onClose={onClose}>
      <p className="font-semibold">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}</p>
      <p className="text-sm text-neutral-600 mt-0.5">{c.pickup?.name} → {c.dropoff?.name}</p>
      <p className="text-sm text-neutral-500">{c.distanceMiles ? formatDistance(c.distanceMiles) : ""}{c.durationMin ? ` · about ${c.durationMin} min` : ""} · {c.time && c.time !== "ASAP" ? "pickup " + new Date(c.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "as soon as possible"}</p>
      {need && <p className="text-sm font-semibold mt-1">{need}</p>}
      {c.what?.note && <p className="text-sm mt-2 bg-neutral-100 rounded-xl px-3 py-2 whitespace-pre-wrap">{c.what.note}</p>}
      <p className="text-xs text-neutral-500 mt-2">From {shipper?.name || shortNpub(request.pubkey)}</p>
      <VouchBadge pubkey={request.pubkey} />
      <p className="text-xs text-neutral-500 mt-1">You see the exact addresses only if the shipper chooses your bid.</p>

      <div className="mt-4">
        <AmountInput sats={sats} rate={btcPrice} min={1} max={1_000_000_000} onChange={setSats} label="Your price" />
      </div>

      <label className="block mt-4 text-sm">
        <span className="font-medium">Minutes until you can be at the pickup</span>
        <input aria-label="Minutes until you can be at the pickup" inputMode="numeric" value={eta} onChange={(e) => setEta(e.target.value.replace(/\D/g, "").slice(0, 5))} className={`${inputCls} mt-1`} />
      </label>

      <div className="mt-4">
        <p className="text-sm font-medium">Paid when the shipper hands you the parcel</p>
        <div className="flex gap-2 mt-1" role="group" aria-label="Paid at pickup">
          {UPFRONT_CHOICES.map((p) => (
            <button key={p} type="button" aria-pressed={upfront === p} onClick={() => setUpfront(p)}
              className={`flex-1 py-2 rounded-full text-sm font-semibold ${upfront === p ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>{p}%</button>
          ))}
        </div>
        <p className="text-xs text-neutral-500 mt-1">The rest is paid when the shipper confirms the parcel arrived.{sats ? ` At ${upfront}%: ${moneyText(Math.round((sats * upfront) / 100), btcPrice)} at pickup.` : ""}</p>
      </div>

      <label className="block mt-4 text-sm">
        <span className="font-medium">Notes for the shipper <span className="font-normal text-neutral-500">(optional)</span></span>
        <textarea aria-label="Notes for the shipper" value={note} maxLength={MAX_NOTE} rows={3} onChange={(e) => setNote(e.target.value)} placeholder="I have a lift gate and straps. I can also carry it inside." className={`${inputCls} mt-1 resize-none`} />
      </label>

      <div className="mt-3 rounded-xl bg-neutral-100 px-3 py-2 text-sm">
        <p className="text-neutral-500 text-xs">Your bid will show</p>
        <p className="font-medium">{cdlText(cdl) || "No CDL"}{`${cdl.has ? " · " : ""}`}</p>
        <button type="button" onClick={() => { onClose(); setView("account"); }} className="text-xs font-semibold underline">Change in Account → Courier details</button>
      </div>
      <p className="text-xs text-neutral-500 mt-2">You are paid in ecash at {mintLabel(mint)}.{!ready ? " Connect your ecash wallet first." : ""}</p>

      {error && <p className="text-sm text-red-600 mt-2" role="alert">{error}</p>}
      <Button className="mt-4" onClick={send} loading={busy} disabled={!sats || !ready}>{existing ? "Update bid" : "Send bid"}</Button>
      {existing && <Button className="mt-2" variant="outline" onClick={async () => { await withdrawBid(request, existing); onClose(); }}>Take my bid back</Button>}
    </Modal>
  );
}
