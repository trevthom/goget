// ════════════════════════════════════════════════════════════
//  BID CARD — One courier's bid on a delivery, as the shipper sees it: who (photo, name, the vouch badge), the price, how soon they
//  can be at the pickup, what they drive, the CDL they say they hold, their notes, and how much is paid when the parcel is handed over.
//  Accept (needs enough ecash at the courier's mint, asks first: it declines every other bid) or Decline (this bid only).
//  A mint the shipper never used is the COURIER's word, and a mint holds the money put into it: Accept waits for "I trust this mint" (features/ecash/myMint.js).
//    <BidCard request={…} bid={…} />
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useShipper } from "../state/ShipperContext.jsx";
import { relay } from "../../nostr/relay.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { mintLabel } from "../../lib/mints.js";
import { cdlText } from "../../lib/cdl.js";
import { splitSats, neededToAccept } from "../../lib/deliveryPay.js";
import Avatar from "../../ui/Avatar.jsx";
import VouchBadge from "../../ui/VouchBadge.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import AddFunds from "../../features/payments/AddFunds.jsx";
import { isKnownMint, trustMint } from "../../features/ecash/myMint.js";

export default function BidCard({ request, bid }) {
  const { openProfile, btcPrice, liveTick, ecash } = useApp();
  const { acceptBid, declineBid, fundsFor } = useShipper();
  const [ask, setAsk] = useState(false);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(null); // sats short
  const [busy, setBusy] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const unknownMint = !trusted && !isKnownMint(bid.mint, ecash);
  useEffect(() => { relay.fetchProfile(bid.courier); }, [bid.courier]);
  void liveTick;
  const p = getProfile(bid.courier);
  const name = p?.name || shortNpub(bid.courier);
  const { upfront } = splitSats(bid.priceSats, bid.upfrontPct);
  const cdl = cdlText(bid.cdl);
  const { have } = fundsFor(bid);

  const accept = async () => {
    setAsk(false); setBusy(true); setMsg("");
    const r = await acceptBid(request, bid);
    setBusy(false);
    if (!r.ok) { setMsg(r.message); if (r.short) setAdding(r.short); }
  };

  return (
    <li className="rounded-2xl border border-neutral-200 p-4" data-testid="bid-card">
      <div className="flex items-start gap-3">
        <Avatar src={p?.picture} name={name} size={48} onClick={() => openProfile(bid.courier)} />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => openProfile(bid.courier)} className="font-semibold text-[16px] truncate max-w-full text-left">{name}</button>
          <VouchBadge pubkey={bid.courier} />
          <p className="text-sm text-neutral-500 mt-0.5">
            {bid.vehicle || "Vehicle not named"}{bid.etaMinutes ? ` · at the pickup in about ${bid.etaMinutes} min` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <Money sats={bid.priceSats} stacked className="text-xl font-extrabold" />
        </div>
      </div>
      {cdl && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-neutral-100 text-xs font-semibold px-2.5 py-1"><Icon name="truck" size={13} /> {cdl}</p>
      )}
      {bid.note && <p className="mt-2 text-[15px] whitespace-pre-wrap bg-neutral-100 rounded-xl px-3 py-2">{bid.note}</p>}
      <p className="text-xs text-neutral-500 mt-2">
        {upfront > 0 ? `${bid.upfrontPct}% (${moneyText(upfront, btcPrice)}) is paid when you hand over the parcel; the rest when it arrives.` : "Nothing is paid until the parcel arrives."} Paid in ecash at {mintLabel(bid.mint)}.
      </p>
      {unknownMint && (
        <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <p>This courier is paid at <span className="font-semibold break-all">{mintLabel(bid.mint)}</span>, a mint you have never used. A mint holds the money put into it, and only the courier chose this one. Use it only if you trust it.</p>
          <button type="button" onClick={() => { trustMint(bid.mint); setTrusted(true); }} className="mt-2 font-semibold underline">I trust this mint</button>
        </div>
      )}
      {msg && <p className="text-sm text-red-600 mt-2" role="alert">{msg}</p>}
      <div className="flex gap-2 mt-3">
        <Button size="md" variant="go" onClick={() => setAsk(true)} loading={busy} disabled={unknownMint}>Accept</Button>
        <Button size="md" variant="outline" onClick={() => declineBid(request, bid)}>Decline</Button>
      </div>
      <ConfirmDialog open={ask} title={`Accept ${name}?`} confirmLabel="Accept this bid" cancelLabel="Not yet"
        message={`${moneyText(bid.priceSats, btcPrice)} for this delivery. Every other bid on it will be declined. You hold ${moneyText(have, btcPrice)} in ecash at this courier's mint; ${moneyText(neededToAccept(bid), btcPrice)} is needed.`}
        onConfirm={accept} onCancel={() => setAsk(false)} />
      {adding != null && <AddFunds mint={bid.mint} needSats={neededToAccept(bid)} onClose={() => setAdding(null)} onDone={() => setMsg("Funds added. Tap Accept again.")} />}
    </li>
  );
}
