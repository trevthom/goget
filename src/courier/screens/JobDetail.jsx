// ════════════════════════════════════════════════════════════
//  JOB DETAIL (Courier) — One delivery the shipper gave this courier, over a map:
//    go to the pickup   the exact addresses and the shipper's note (readable only now), a link to open them in a maps app, and the
//                       4-DIGIT CODE on this phone: the shipper types it when the parcel changes hands (the courier types nothing)
//    on the way         the drop-off; "Mark delivered" needs a good GPS fix within 300 m of it AND a photo of the parcel: that is the proof of
//                       delivery, sealed to the shipper ("No camera?" sends the GPS part only: the shipper must then verify outside of GoGet)
//    delivered          waiting for the shipper to confirm and pay the rest
//  The courier can withdraw before the pickup (nothing was paid); after the parcel changed hands the delivery cannot be dropped.
//  Payments arrive as ecash and are redeemed by the app (features/payments/redeemDelivery.js); the lines below show what was received.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useCourier } from "../state/CourierContext.jsx";
import { acceptedBid, deliveryContent, deliveryStatus, deliveryVerified, pickupCode, placesOf, typeLabel, sizeLabel, DELIVERED_NEAR_M } from "../../lib/delivery.js";
import { moneyOf, splitSats } from "../../lib/deliveryPay.js";
import { resizeImage } from "../../lib/image.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import MapView from "../../ui/MapView.jsx";
import Avatar from "../../ui/Avatar.jsx";
import VouchBadge from "../../ui/VouchBadge.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import { MapPage, Sheet, FloatButton } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";

const mapLink = (p, label) => `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}(${encodeURIComponent(label)})`;

export default function JobDetail({ request, onBack }) {
  const { user, btcPrice, openProfile, liveTick } = useApp();
  const { myPosition, markDelivered, withdrawJob, canDeliver, distanceToDropoff, gps } = useCourier();
  void liveTick;
  const status = deliveryStatus(request);
  const c = deliveryContent(request);
  const pl = placesOf(request, user);
  const bid = acceptedBid(request);
  const money = moneyOf(request);
  const shipper = getProfile(request.pubkey);
  const name = shipper?.name || shortNpub(request.pubkey);
  const [photo, setPhoto] = useState("");
  const [noPhoto, setNoPhoto] = useState(false); // no camera: send the GPS part of the proof alone
  const [msg, setMsg] = useState("");
  const [ask, setAsk] = useState(false);
  const [quit, setQuit] = useState(false);
  const m = distanceToDropoff(request);
  const near = canDeliver(request);
  const code = pickupCode(user.sk, request.pubkey, request);
  const target = status === "assigned" ? pl.pickup : pl.dropoff;

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { setPhoto(await resizeImage(file, 640, 0.6, 45000)); setMsg(""); } catch { setMsg("That photo could not be read."); }
  };
  const deliver = async () => {
    const r = await markDelivered(request, photo);
    if (!r.ok) setMsg(r.message);
  };

  return (
    <MapPage
      map={<MapView pickup={pl.pickup} dropoff={pl.dropoff} me={myPosition} fitKey={`${request.id}|${status}`} padBottom={420} />}
      top={<FloatButton icon="chevron-left" label="Back to my jobs" onClick={onBack} />}
    >
      <Sheet label="Delivery job">
        <h2 className="text-xl font-bold">
          {{ assigned: "Go to the pickup", in_transit: "Take it to the drop-off", delivered: "Delivered", disputed: "The shipper reported a problem", completed: "Completed and paid", closed: "This delivery is closed" }[status]}
        </h2>
        <p className="text-sm text-neutral-600 mt-1">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}{money ? ` · ` : ""}{money && <Money sats={money.priceSats} className="font-semibold" />}</p>
        {c.what?.note && <p className="text-sm text-neutral-600 mt-2 bg-neutral-100 rounded-xl px-3 py-2 whitespace-pre-wrap">{c.what.note}</p>}
        <div className="flex items-center gap-3 mt-3">
          <Avatar src={shipper?.picture} name={name} size={40} onClick={() => openProfile(request.pubkey)} />
          <div className="min-w-0"><button type="button" onClick={() => openProfile(request.pubkey)} className="font-semibold text-left">{name}</button><VouchBadge pubkey={request.pubkey} /></div>
        </div>

        <div className="mt-3 text-sm space-y-1">
          <p><span className="text-neutral-500">Pickup</span> {pl.pickup.name}</p>
          <p><span className="text-neutral-500">Drop-off</span> {pl.dropoff.name}</p>
          {pl.contact && <p className="bg-amber-50 text-amber-900 rounded-xl px-3 py-2"><span className="font-semibold">Note from the shipper:</span> {pl.contact}</p>}
          {["assigned", "in_transit"].includes(status) && pl.exact && (
            <a href={mapLink(target, target.name)} className="inline-flex items-center gap-1.5 font-semibold underline mt-1"><Icon name="navigation" size={14} /> Open {status === "assigned" ? "the pickup" : "the drop-off"} in a maps app</a>
          )}
        </div>

        {status === "assigned" && (
          <div className="mt-4 rounded-2xl bg-neutral-100 p-4 text-center" data-testid="pickup-code-card">
            <p className="text-sm text-neutral-600">When the shipper hands you the parcel, show this code. The shipper types it. You type nothing.</p>
            <p className="text-5xl font-extrabold tracking-[0.3em] mt-2" aria-label="Pickup code" data-testid="pickup-code">{code}</p>
            <p className="text-xs text-neutral-500 mt-2">{bid && bid.upfrontPct > 0 ? `${moneyText(splitSats(bid.priceSats, bid.upfrontPct).upfront, btcPrice)} is paid to you as soon as the shipper confirms.` : "Everything is paid when the parcel arrives."}</p>
          </div>
        )}

        {status === "in_transit" && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-neutral-600">
              {m == null ? "Waiting for your location…" : near ? "You are at the drop-off." : `You are ${m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km"} from the drop-off. Get within ${DELIVERED_NEAR_M} m to mark it delivered.`}
              {gps !== "good" && m != null ? " A good GPS fix is needed." : ""}
            </p>
            <p className="text-sm font-semibold inline-flex items-center gap-1.5"><Icon name="proof" size={16} /> Proof of delivery: your location and a photo</p>
            <label className="flex items-center gap-2 text-sm font-semibold underline">
              <Icon name="camera" size={16} /> {photo ? "Photo added (tap to change)" : "Take a photo of the delivered parcel"}
              <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="sr-only" aria-label="Photo of the delivered parcel" />
            </label>
            {photo && <img src={photo} alt="Your photo" className="w-full max-h-48 object-cover rounded-xl" />}
            <Button variant="go" onClick={() => setAsk(true)} disabled={!near || (!photo && !noPhoto)}>Mark delivered</Button>
            {!photo && !noPhoto && <button type="button" onClick={() => setNoPhoto(true)} className="w-full text-center text-xs underline text-neutral-500">No camera? Send my location only</button>}
            {!photo && noPhoto && <p className="text-xs text-neutral-500">Without a photo the shipper must verify the delivery outside of GoGet.</p>}
          </div>
        )}
        {status === "delivered" && <p className="mt-4 text-sm text-neutral-600">Proof sent. Waiting for {name} to confirm. The rest of the price is paid when they do.</p>}
        {status === "completed" && deliveryVerified(request) && <p className="mt-4 text-sm text-neutral-600 inline-flex items-center gap-1.5"><Icon name="proof" size={16} /> {deliveryVerified(request) === "outside" ? `${name} verified the delivery outside of GoGet.` : `${name} confirmed your photo and location.`}</p>}
        {status === "disputed" && <p className="mt-4 text-sm text-neutral-600">{name} reported a problem. The rest of the price is held. Contact them using Account → Contact methods.</p>}

        {money && (
          <div className="mt-4 rounded-2xl bg-neutral-100 p-4 text-sm">
            <div className="flex justify-between"><span className="text-neutral-500">Price</span><Money sats={money.priceSats} className="font-semibold" /></div>
            <div className="flex justify-between mt-1"><span className="text-neutral-500">Received so far</span><Money sats={money.paidSats} className="font-semibold" /></div>
          </div>
        )}
        {msg && <p className="text-sm text-red-600 mt-2" role="alert">{msg}</p>}
        {status === "assigned" && <button type="button" onClick={() => setQuit(true)} className="w-full text-center text-sm font-semibold underline text-red-600 mt-4">I cannot do this delivery</button>}
      </Sheet>
      <ConfirmDialog open={ask} title="Mark as delivered?" confirmLabel="Yes, delivered" cancelLabel="Not yet" message="The shipper is asked to confirm. Do not mark it unless the parcel is at the drop-off." onConfirm={() => { setAsk(false); deliver(); }} onCancel={() => setAsk(false)} />
      <ConfirmDialog open={quit} title="Withdraw from this delivery?" confirmLabel="Withdraw" cancelLabel="Keep it" danger message="Nothing has been charged. The shipper is told and has to post the delivery again." onConfirm={() => { setQuit(false); withdrawJob(request).then(onBack); }} onCancel={() => setQuit(false)} />
    </MapPage>
  );
}
