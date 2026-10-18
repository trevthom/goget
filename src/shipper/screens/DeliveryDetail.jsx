// ════════════════════════════════════════════════════════════
//  DELIVERY DETAIL (Shipping) — One delivery, from the shipper's side, over a map:
//    waiting for bids   → see the bids, or close the request
//    courier chosen     → the courier's live position; at the handover the shipper TYPES the 4-digit code shown on the courier's phone
//                         (the parcel changed hands) and the pickup share of the price is paid by the app
//    on its way         → the courier's position; what has been paid
//    delivered          → the PROOF: the courier's photo and a signed GPS fix, checked against the drop-off. With both, "Parcel received"
//                         pays the rest. Without them the shipper may say "I verified it outside of GoGet", or report a problem (holds it)
//    closed / completed → what happened and what was paid
//  The courier's exact position is end-to-end encrypted to this shipper and shown only while the delivery runs.
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useShipper } from "../state/ShipperContext.jsx";
import { relay } from "../../nostr/relay.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { subscribeRideLocation } from "../../nostr/live.js";
import { acceptedBid, deliveryContent, deliveryCourier, deliveryInvited, deliveryProof, deliveryVerified, deliveryNeed, pendingBids, placesOf, typeLabel, sizeLabel } from "../../lib/delivery.js";
import { moneyOf, dueNow, splitSats } from "../../lib/deliveryPay.js";
import { needText } from "../../lib/cdl.js";
import { attemptGate, CODE_DIGITS } from "../../lib/startcode.js";
import { statusOf, STATUS_WORDS } from "./DeliveriesScreen.jsx";
import MapView from "../../ui/MapView.jsx";
import Avatar from "../../ui/Avatar.jsx";
import VouchBadge from "../../ui/VouchBadge.jsx";
import CdlBadge from "../../ui/CdlBadge.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import { MapPage, Sheet, FloatButton } from "../../ui/Layout.jsx";
import { ConfirmDialog, inputCls } from "../../ui/Parts.jsx";
import AddFunds from "../../features/payments/AddFunds.jsx";

// The two checks of the proof: a photo, and a signed GPS fix at the drop-off.
function ProofCard({ proof, name }) {
  const row = (ok, text) => <li className="flex items-center gap-2"><Icon name={ok ? "check" : "x"} size={14} className={ok ? "text-[#05944f]" : "text-[#dc2626]"} /> {text}</li>;
  return (
    <div className="rounded-xl bg-neutral-100 px-3 py-2 text-sm" data-testid="proof-card">
      <p className="font-semibold inline-flex items-center gap-1.5"><Icon name="proof" size={16} /> Proof of delivery</p>
      <ul className="mt-1 space-y-0.5">
        {row(!!proof?.photo, proof?.photo ? `Photo from ${name}` : "No photo")}
        {row(!!proof?.gps, proof?.gps ? `Location signed ${proof.distM} m from the drop-off` : proof?.distM != null ? `Location ${proof.distM} m from the drop-off, or the fix was weak or old` : "No location in the proof")}
      </ul>
      {!proof?.verified && <p className="text-xs text-neutral-600 mt-2">GoGet cannot verify this delivery. If you checked it another way, say so below. Otherwise report a problem.</p>}
    </div>
  );
}

export default function DeliveryDetail({ request, onBack }) {
  const { user, setView, openProfile, btcPrice, liveTick } = useApp();
  const { confirmPickup, confirmDelivered, reportProblem, closeRequest, payState, tries, setDraft } = useShipper();
  void liveTick;
  const status = statusOf(request);
  const c = deliveryContent(request);
  const pl = placesOf(request, user);
  const courier = deliveryCourier(request);
  const bid = acceptedBid(request);
  const money = moneyOf(request);
  const due = dueNow(request);
  const pay = payState[request.id];
  const profile = courier ? getProfile(courier) : null;
  const name = profile?.name || (courier ? shortNpub(courier) : "");
  const [loc, setLoc] = useState(null);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState(false);
  const [problem, setProblem] = useState(false);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { if (courier) relay.fetchProfile(courier); }, [courier]);
  const live = courier && ["assigned", "in_transit"].includes(status);
  useEffect(() => {
    if (!live) return undefined;
    return subscribeRideLocation(user, courier, (l) => { if (l && Number.isFinite(l.lat) && Number.isFinite(l.lng)) setLoc(l); });
  }, [live, courier, user]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const gate = attemptGate(tries[request.id], now);
  const submitCode = async () => {
    setMsg("");
    const r = await confirmPickup(request, typed);
    if (!r.ok) setMsg(r.message);
    else setTyped("");
  };
  const [label, tone] = STATUS_WORDS[status];
  const proof = status === "delivered" || status === "disputed" || status === "completed" ? deliveryProof(request, user) : null;
  const photo = proof?.photo || null;
  const how = proof?.verified ? "gps+photo" : "outside"; // what a confirmation records
  const bids = status === "requested" ? pendingBids(request).length : 0;
  const repost = () => {
    setDraft({ type: c.what?.type || "package", size: c.what?.size || "medium", note: c.what?.note || "", pickup: pl.exact ? pl.pickup : null, dropoff: pl.exact ? pl.dropoff : null, cdlRequired: !!deliveryNeed(request).required, endorsements: deliveryNeed(request).endorsements, contact: pl.contact || "", step: "form", when: "ASAP" });
    setView("ship");
  };

  const headline = {
    requested: bids ? `${bids} bid${bids === 1 ? "" : "s"} waiting` : "Waiting for bids",
    expired: "Nobody took this in time",
    assigned: `${name} is on the way to the pickup`,
    in_transit: `${name} is carrying it to the drop-off`,
    delivered: "Delivered. Please check it.",
    disputed: "You reported a problem",
    completed: "Delivered and paid",
    closed: "Closed. Nothing was charged.",
  }[status];

  return (
    <MapPage
      map={<MapView pickup={pl.exact ? pl.pickup : null} dropoff={pl.exact ? pl.dropoff : null} cars={loc ? [{ pubkey: courier, lat: loc.lat, lng: loc.lng }] : []} fitKey={`${request.id}|${loc ? "loc" : "noloc"}`} padBottom={420} />}
      top={<FloatButton icon="chevron-left" label="Back to deliveries" onClick={onBack} />}
    >
      <Sheet label="Delivery">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{headline}</h2>
          <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${tone}`}>{label}</span>
        </div>
        <p className="text-sm text-neutral-600 mt-1">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}{needText(c.cdl) ? ` · ${needText(c.cdl)}` : ""}</p>
        <p className="text-sm mt-1"><span className="text-neutral-500">From</span> {pl.pickup.name}</p>
        <p className="text-sm"><span className="text-neutral-500">To</span> {pl.dropoff.name}</p>
        {c.what?.note && <p className="text-sm text-neutral-600 mt-2 bg-neutral-100 rounded-xl px-3 py-2 whitespace-pre-wrap">{c.what.note}</p>}

        {courier && (
          <div className="flex items-center gap-3 mt-4">
            <Avatar src={profile?.picture} name={name} size={44} onClick={() => openProfile(courier)} />
            <div className="min-w-0">
              <button type="button" onClick={() => openProfile(courier)} className="font-semibold text-left">{name}</button>
              <VouchBadge pubkey={courier} />
              {bid?.vehicle && <p className="text-sm text-neutral-500">{bid.vehicle}</p>}
              {bid?.cdl?.has && <CdlBadge pubkey={courier} claim={bid.cdl} />}
            </div>
          </div>
        )}

        {status === "requested" && (
          <div className="mt-4 space-y-2">
            {bids > 0 && <Button onClick={() => setView("bids")}>See the {bids} bid{bids === 1 ? "" : "s"}</Button>}
            <Button variant="outline" onClick={() => closeRequest(request)}>Close this request</Button>
            <p className="text-xs text-neutral-500" data-testid="invited-note">
              <Icon name="lock" size={12} className="inline -mt-0.5" /> Encrypted. {deliveryInvited(request).size ? `Sent to ${deliveryInvited(request).size} courier${deliveryInvited(request).size === 1 ? "" : "s"} who ${deliveryInvited(request).size === 1 ? "was" : "were"} online near the pickup.` : "No courier is online near the pickup yet."} More are invited as they come online, so keep GoGet open. Nothing is charged until you accept a bid and hand over the parcel.
            </p>
          </div>
        )}
        {status === "expired" && <div className="mt-4"><Button onClick={repost}>Post it again</Button></div>}

        {status === "assigned" && (
          <div className="mt-4 rounded-2xl bg-neutral-100 p-4">
            <p className="font-semibold">When the courier takes the parcel</p>
            <p className="text-sm text-neutral-600 mt-1">Ask the courier for the {CODE_DIGITS}-digit code on their phone and type it here. That tells GoGet the parcel changed hands{bid && bid.upfrontPct > 0 ? `, and ${moneyText(splitSats(bid.priceSats, bid.upfrontPct).upfront, btcPrice)} is paid` : ""}.</p>
            <input aria-label="Pickup code" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_DIGITS} value={typed} disabled={!gate.open}
              onChange={(e) => { setTyped(e.target.value.replace(/\D/g, "")); setMsg(""); }}
              className={`${inputCls} block w-full mt-3 text-center text-3xl tracking-[0.4em] font-bold`} placeholder="····" />
            <Button className="mt-3" onClick={submitCode} disabled={typed.length !== CODE_DIGITS || !gate.open}>Confirm handover</Button>
            {!gate.open && <p className="text-sm text-amber-700 mt-2">Too many wrong tries. Try again in {Math.ceil(gate.waitMs / 1000)} s.</p>}
            {msg && <p className="text-sm text-red-600 mt-2" role="alert">{msg}</p>}
            <p className="text-xs text-neutral-500 mt-3">Changed your mind? Nothing has been charged. Ask the courier to withdraw, or let it expire.</p>
          </div>
        )}

        {status === "delivered" && (
          <div className="mt-4 space-y-3">
            {photo && <img src={photo} alt="Photo from the courier at the drop-off" className="w-full rounded-xl max-h-64 object-cover" />}
            <ProofCard proof={proof} name={name} />
            {proof?.verified
              ? <Button variant="go" onClick={() => setAsk(true)}>Parcel received{money ? ` · pay ${moneyText(splitSats(money.priceSats, bid?.upfrontPct ?? 50).final, btcPrice)}` : ""}</Button>
              : <Button variant="go" onClick={() => setAsk(true)}>I verified it outside of GoGet{money ? ` · pay ${moneyText(splitSats(money.priceSats, bid?.upfrontPct ?? 50).final, btcPrice)}` : ""}</Button>}
            <Button variant="danger" onClick={() => setProblem(true)}>Report a problem</Button>
          </div>
        )}
        {status === "disputed" && (
          <div className="mt-4 space-y-3">
            {photo && <img src={photo} alt="Photo from the courier at the drop-off" className="w-full rounded-xl max-h-64 object-cover" />}
            <ProofCard proof={proof} name={name} />
            <p className="text-sm text-neutral-600">The rest of the price is held. If it turned out fine, you can still confirm.</p>
            <Button variant="go" onClick={() => setAsk(true)}>{proof?.verified ? "It is fine: pay the rest" : "I verified it outside of GoGet: pay the rest"}</Button>
          </div>
        )}
        {status === "closed" && <div className="mt-4"><Button onClick={repost}>Post it again</Button></div>}

        {money && (
          <div className="mt-4 rounded-2xl bg-neutral-100 p-4 text-sm">
            <div className="flex justify-between"><span className="text-neutral-500">Price</span><Money sats={money.priceSats} className="font-semibold" /></div>
            <div className="flex justify-between mt-1"><span className="text-neutral-500">Paid so far</span><Money sats={money.paidSats} className="font-semibold" /></div>
            {pay?.status === "short" && due && (
              <div className="mt-3">
                <p className="text-red-600 font-semibold" role="alert">Your ecash is short by {moneyText(Math.max(1, pay.shortSats || due.amountSats), btcPrice)}. Add funds so the courier is paid.</p>
                <Button size="md" className="mt-2" onClick={() => setAdding(true)}>Add funds</Button>
              </div>
            )}
            {pay?.status === "error" && <p className="text-red-600 mt-2" role="alert">{pay.message}</p>}
          </div>
        )}
        {status === "completed" && deliveryVerified(request) && <p className="text-sm text-neutral-600 mt-3 inline-flex items-center gap-1.5"><Icon name="proof" size={16} /> {deliveryVerified(request) === "outside" ? "You verified this delivery outside of GoGet." : "Verified by the courier's photo and GPS location."}</p>}
        {status === "completed" && <p className="text-xs text-neutral-500 mt-3">Thank you. Know and trust this courier? Add them under Account → Your vouches.</p>}
      </Sheet>

      <ConfirmDialog open={ask} title="Parcel received?" confirmLabel="Yes, pay the courier" cancelLabel="Not yet"
        message={`This pays the rest of the price to ${name}. It cannot be taken back.`}
        onConfirm={() => { setAsk(false); confirmDelivered(request, how); }} onCancel={() => setAsk(false)} />
      {problem && (
        <div role="dialog" aria-modal="true" aria-label="Report a problem" className="fixed inset-0 z-[10000] flex items-end justify-center bg-[#000]/50" onClick={() => setProblem(false)}>
          <div className="w-full max-w-md bg-white rounded-t-3xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold">What went wrong?</h3>
            <p className="text-sm text-neutral-500 mt-1 mb-3">The rest of the price is held until you decide. The courier sees your note.</p>
            <textarea aria-label="What went wrong" value={note} maxLength={300} rows={3} onChange={(e) => setNote(e.target.value)} className={`${inputCls} resize-none`} />
            <Button className="mt-3" disabled={!note.trim()} onClick={() => { setProblem(false); reportProblem(request, note.trim()); }}>Report it</Button>
            <button type="button" onClick={() => setProblem(false)} className="w-full text-center text-sm font-semibold underline mt-3">Cancel</button>
          </div>
        </div>
      )}
      {adding && bid && <AddFunds mint={bid.mint} needSats={due?.amountSats || 0} onClose={() => setAdding(false)} />}
    </MapPage>
  );
}
