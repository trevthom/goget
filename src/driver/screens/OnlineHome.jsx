// ════════════════════════════════════════════════════════════
//  ONLINE HOME (driver) — The Drive tab when there is no ride under
//  way. Map + one bottom sheet that changes with the driver's state:
//    offline   big GO button
//    online    "Looking for requests…", the count, and "See nearby requests" (a list screen, NearbyRequests);
//              the requests are also price tags on the map
//    request   an incoming-request card with a countdown: Accept / Decline. It pops up by itself ONLY when
//              "New request alerts" is on; with alerts off the driver opens requests from the list or the map.
//    waiting   "Waiting for <rider> to confirm" after the driver accepted
//  Every driver replies with their STANDARD fare (their own rates, paid tick by tick): an offer carrying
//  the driver's rates and mint. The rider picks a driver, which starts the drive (DriveTrip). There is
//  no deposit: the rider pays in ecash as the ride runs.
// ════════════════════════════════════════════════════════════

import { formatDistance, ratePerUnit, unitName } from "../../lib/units.js";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useDriver, fareOf, typicalSatsFor, shownSats } from "../state/DriverContext.jsx";
import { driveMinutes, pickupEta, roadMiles, ratesOrApp } from "../../lib/fare.js";
import { formatFiat } from "../../lib/currency.js";
import { mintLabel } from "../../lib/mints.js";
import { getMyMint } from "../../features/ecash/myMint.js";
import { haversineDistance } from "../../lib/geo.js";
import { completedDrives, summarizeEarnings } from "../../lib/earnings.js";
import { isScheduledLater } from "../../lib/trips.js";
import { OFFER_TTL_SECONDS, REQUEST_CARD_SECONDS } from "../../config/settings.js";
import MapView from "../../ui/MapView.jsx";
import Money, { moneyText } from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Avatar from "../../ui/Avatar.jsx";
import Icon from "../../ui/Icon.jsx";
import { MapPage, Sheet, FloatButton, StickyActions } from "../../ui/Layout.jsx";
import { Spinner } from "../../ui/Parts.jsx";
import { gpsMessage, canBeOnline, approxNote } from "../../lib/gps.js";
import RiderInfo, { useRiderInfo } from "../components/RiderInfo.jsx";
import NearbyRequests from "./NearbyRequests.jsx";

const whenText = (time) => (time === "ASAP" ? "Now" : new Date(time).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }));

export default function OnlineHome() {
  const { user, rideRequests, btcPrice, usdPrice, prices, setView } = useApp();
  const { myPosition, online, open, pending, skipped, alerts } = useDriver();
  const [focusId, setFocusId] = useState(null); // request opened by hand (list or map tag)
  const [listOpen, setListOpen] = useState(false); // the "See nearby requests" screen
  const [backToList, setBackToList] = useState(false); // the card was opened from the list: return there when it closes
  const [ignored, setIgnored] = useState(null); // offer id the driver stopped waiting on
  const mapRef = useRef(null);

  const today = summarizeEarnings(completedDrives(rideRequests, user.publicKey)).today;

  const manual = focusId ? open.find((o) => o.request.id === focusId) : null;
  const auto = online && alerts && !manual
    ? open.find((o) => !skipped.includes(o.request.id) && !isScheduledLater(o.request)) || null
    : null;
  const card = manual || auto;
  const waiting = pending && pending.offer.id !== ignored ? pending : null;

  const openFromList = (id) => { setBackToList(true); setListOpen(false); setFocusId(id); };
  const openByHand = (id) => { setBackToList(false); setFocusId(id); };
  const closeCard = () => { setFocusId(null); if (backToList) { setBackToList(false); setListOpen(true); } };

  if (listOpen && online && !waiting) return <NearbyRequests onBack={() => setListOpen(false)} onPick={openFromList} />;

  const pills = online ? open.slice(0, 20).map((o) => ({ id: o.request.id, lat: o.content.pickup.lat, lng: o.content.pickup.lng, text: moneyText(shownSats(o.request, user.rates, prices, usdPrice), btcPrice) })) : [];

  return (
    <MapPage
      map={
        <MapView
          ref={mapRef}
          me={myPosition}
          pills={pills}
          onPill={openByHand}
          fitKey={`${myPosition ? "pos" : "nopos"}|${online}`}
          padBottom={300}
        />
      }
      top={
        <>
          <Avatar src={user.picture} name={user.name} size={44} onClick={() => setView("account")} className="shadow-[0_2px_10px_rgba(0,0,0,0.22)] ring-2 ring-white" />
          <button
            type="button"
            onClick={() => setView("earnings")}
            className="mx-auto bg-black text-white rounded-full px-4 py-2.5 text-[15px] font-bold shadow-[0_2px_10px_rgba(0,0,0,0.3)]"
            aria-label="Today's earnings"
          >
            {moneyText(today.sats, btcPrice)}
          </button>
          <FloatButton icon="locate" label="Center on my location" onClick={() => mapRef.current?.fit()} />
        </>
      }
    >
      {waiting ? (
        <Waiting key={waiting.offer.id} pending={waiting} onStop={() => setIgnored(waiting.offer.id)} />
      ) : card ? (
        <Incoming key={card.request.id} item={card} auto={!manual} onClose={closeCard} />
      ) : online ? (
        <OnlineSheet onSeeAll={() => setListOpen(true)} />
      ) : (
        <OfflineSheet />
      )}
    </MapPage>
  );
}

function OfflineSheet() {
  const { myPosition, geoError, gps, goOnline, open } = useDriver();
  const { ecashOff } = useApp();
  return (
    <Sheet label="You're offline">
      <div className="flex flex-col items-center text-center">
        <button
          type="button"
          onClick={goOnline}
          disabled={!canBeOnline(gps, myPosition) || ecashOff}
          aria-label="Go online"
          className="w-24 h-24 rounded-full bg-[#05944f] text-[#fff] text-2xl font-extrabold tracking-wide shadow-[0_6px_18px_rgba(5,148,79,0.45)] active:scale-95 transition-transform disabled:bg-neutral-300 disabled:shadow-none"
        >
          GO
        </button>
        <h2 className="text-xl font-bold mt-4">You're offline</h2>
        <p className="text-neutral-600 text-[15px] mt-1 max-w-xs" role="status">
          {ecashOff
            ? "Your ecash wallet is not connected on this device, so you cannot be paid. Connect it in Account."
            : !canBeOnline(gps, myPosition)
            ? gpsMessage(gps, myPosition, geoError)
            : gps === "weak"
            ? approxNote(myPosition)
            : open.length
            ? `${open.length} request${open.length === 1 ? "" : "s"} near you. Go online to see them.`
            : "Go online to start getting ride requests."}
        </p>
      </div>
    </Sheet>
  );
}

function OnlineSheet({ onSeeAll }) {
  const { goOffline, open, geoError, myPosition, gps, alerts } = useDriver();
  return (
    <Sheet label="You're online">
      <div className="flex items-center gap-3">
        <span className="w-3 h-3 rounded-full bg-[#05944f] animate-pulse" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold leading-tight">You're online</h2>
          <p className="text-neutral-600 text-sm" role="status">
            {!canBeOnline(gps, myPosition) ? `Riders can't see you. ${gpsMessage(gps, myPosition, geoError)}` : gps === "weak" ? approxNote(myPosition) : open.length ? `${open.length} request${open.length === 1 ? "" : "s"} near you` : "Looking for ride requests…"}
          </p>
        </div>
        <Button size="sm" variant="secondary" full={false} onClick={goOffline}>Go offline</Button>
      </div>
      {open.length > 0 && (
        <Button variant="go" className="mt-4" onClick={onSeeAll}>See nearby requests ({open.length})</Button>
      )}
      {!alerts && <p className="text-neutral-500 text-xs text-center mt-3">New request alerts are off, so requests do not pop up. Turn them on in Account.</p>}
    </Sheet>
  );
}

// The incoming-request card. `auto` cards count down and then step aside
// (the request stays open for other drivers); cards opened by hand do not.
function Incoming({ item, auto, onClose }) {
  const { user, btcPrice, usdPrice, prices } = useApp();
  const { acceptRequest, decline, skip } = useDriver();
  const { request, content: c, miles } = item;
  const [left, setLeft] = useState(REQUEST_CARD_SECONDS);
  const [busy, setBusy] = useState(false);
  const { profile } = useRiderInfo(request.pubkey);

  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => { if (auto && left <= 0) skip(request); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const typical = typicalSatsFor(request, user.rates, prices); // this driver's own fare for the trip (null while its price is unknown)
  const fare = typical ?? fareOf(request, usdPrice);
  const rates = ratesOrApp(user.rates);
  const tripMiles = c.distanceMiles ?? roadMiles(haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng));
  const tripMin = c.durationMin ?? driveMinutes(tripMiles);
  const awayMin = miles != null ? pickupEta(miles) : null;

  const accept = () => { setBusy(true); acceptRequest(request); };
  const dismiss = () => { decline(request); onClose(); };

  return (
    <Sheet label="Ride request">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">{auto ? "New ride request" : "Ride request"}</h2>
        {auto && left > 0 && (
          <span className="text-sm font-bold tabular-nums bg-neutral-100 rounded-full px-3 py-1" aria-label={`${left} seconds left`}>0:{String(left).padStart(2, "0")}</span>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold text-neutral-500 mb-0.5">Your standard fare, about</p>
          <Money sats={fare} stacked className="text-4xl font-extrabold tracking-tight" subClassName="text-neutral-500 text-sm" />
        </div>
        <div className="text-right text-sm text-neutral-600">
          <p>{tripMin} min · {formatDistance(tripMiles)} trip</p>
          {c.time && c.time !== "ASAP" && <p className="font-semibold text-black">{whenText(c.time)}</p>}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-3">
        <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
          <span className="w-2 h-2 rounded-full bg-black" /><span className="h-9 w-px bg-neutral-300 my-0.5" /><span className="w-2 h-2 bg-black" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-[15px] font-medium truncate">{c.pickup.name}</p>
            <p className="text-xs text-neutral-500">{awayMin != null ? `${awayMin} min · ${formatDistance(miles)} away` : "Pickup area"} · approximate</p>
          </div>
          <p className="text-[15px] font-medium truncate">{c.dropoff.name}</p>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-neutral-100"><RiderInfo pubkey={request.pubkey} compact /></div>
      {c.notes && <p className="mt-2 text-sm text-neutral-600 bg-neutral-100 rounded-xl px-3 py-2">“{c.notes}”</p>}

      <p className="text-xs mt-3 text-neutral-500">
        The rider pays your rates as the ride runs: {formatFiat(rates.base, rates.currency)} base, {formatFiat(ratePerUnit(rates.perMile), rates.currency)}/{unitName()}, {formatFiat(rates.perMinute, rates.currency)}/min.
      </p>

      <p className="text-xs text-neutral-500 mt-3">
        You are paid in ecash at {mintLabel(getMyMint())} as the ride runs: your base rate at the start, then every mile and every minute. Your rates and mint are frozen once the rider chooses you. You get the exact pickup once {profile?.name || "the rider"} confirms you.
      </p>

      <StickyActions className="mt-4">
        <div className="flex gap-3">
          <Button variant="secondary" full={false} onClick={dismiss} aria-label="Decline" className="!px-5"><Icon name="x" size={22} /></Button>
          <Button variant="go" onClick={accept} loading={busy}>{busy ? "Sending…" : "Accept"}</Button>
        </div>
      </StickyActions>
    </Sheet>
  );
}

// After accepting: waiting for the rider to pick a driver and pay.
function Waiting({ pending, onStop }) {
  const { offer, request } = pending;
  const { profile } = useRiderInfo(request.pubkey);
  const c = JSON.parse(request.content);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, offer.created_at + OFFER_TTL_SECONDS - Math.floor(now / 1000));
  return (
    <Sheet label="Waiting for the rider">
      <div className="flex items-center gap-3">
        <Spinner size={28} />
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold leading-tight">Waiting for {profile?.name || "the rider"}</h2>
          <p className="text-neutral-600 text-sm">They are choosing a driver. Your offer holds for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}.</p>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-neutral-100 text-[15px]">
        <p className="font-medium truncate">{c.pickup.name} → {c.dropoff.name}</p>
        <p className="text-neutral-600 mt-0.5"><Money sats={JSON.parse(offer.content).priceSats} className="font-semibold" /> standard fare (estimate)</p>
      </div>
      <Button variant="secondary" size="md" className="mt-4" onClick={onStop}>Keep browsing requests</Button>
      <p className="text-neutral-500 text-xs text-center mt-2">If the rider still confirms you, the pickup appears right away.</p>
    </Sheet>
  );
}
