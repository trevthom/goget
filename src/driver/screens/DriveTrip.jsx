// ════════════════════════════════════════════════════════════
//  DRIVE TRIP (driver) — A confirmed ride, in three steps that the driver
//  moves forward with signed stage markers the rider's app reacts to:
//    to pickup   → "I've arrived" (works only within 150 m of the pickup)
//    at pickup   → "Start trip" (after the rider typed the 4-digit start code shown on this phone)
//    trip        → "Finish ride"
//  The rider's exact pickup/dropoff arrives sealed (NIP-44) with the
//  rider's confirmation; until then only the approximate area is known.
//  The driver's live location is sent to the rider by DriverContext.
//  While the rider rides, the screen shows what the ride has earned and what the rider has paid
//  (ecash ticks). After two missed payments the driver may finish the ride. Either person can
//  finish the ride at any time (after a confirmation): there are no cancellations and no fees, the
//  rider pays what the ride earned. A rider's extra stop is accepted here, or the ride is finished.
// ════════════════════════════════════════════════════════════

import { formatDistance } from "../../lib/units.js";
import { useEffect, useRef, useState } from "react";
import { ARRIVE_RADIUS_METERS } from "../../config/settings.js";
import { useApp } from "../../state/AppContext.jsx";
import { useDriver } from "../state/DriverContext.jsx";
import { rideConfirm, rideStage, rideTimes, rideKey } from "../../lib/rides.js";
import { startCode } from "../../lib/startcode.js";
import { canMarkArrived } from "../../lib/arrival.js";
import { fullTrip, nextStop, stopChanges, readStop } from "../../lib/stops.js";
import { MISSED_LIMIT } from "../../lib/ticks.js";
import { useRideLink } from "../../features/payments/useRideLink.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { moneyText } from "../../ui/Money.jsx";
import { meterView } from "../../lib/meter.js";
import FareBreakdown from "../../ui/FareBreakdown.jsx";
import TripMeter, { peekMeter } from "../../ui/TripMeter.jsx";
import { exactTrip } from "../../lib/privacy.js";
import { acceptFor, offerFrom } from "../../lib/trips.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta } from "../../lib/fare.js";
import { rideTerms } from "../../lib/terms.js";
import { EstimatedTotal, ChangeEstimate } from "../../ui/FareEstimate.jsx";
import MapView from "../../ui/MapView.jsx";
import Money from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import ContactSheet from "../../ui/ContactSheet.jsx";
import { MapPage, Sheet, StickyActions } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import RiderInfo, { useRiderInfo } from "../components/RiderInfo.jsx";
import { pickupChange, PICKUP_CHANGE_NOTE } from "../../lib/pickup.js";
import { readPickup } from "../../lib/privacy.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const r3 = (n) => Math.round(n * 1000) / 1000;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function DriveTrip({ request }) {
  const { user, liveTick, pushNotice } = useApp();
  const { myPosition, gps, arrive, startTrip, finishRide, answerPickup, answerStop, odo, agreed, driveMoney } = useDriver();
  const { btcPrice } = useApp();
  const stage = rideStage(request);
  const exact = exactTrip(request, user);
  const trip = exact || parse(request);
  const { profile } = useRiderInfo(request.pubkey);
  const accept = acceptFor(request, user.publicKey);
  const paid = accept ? parse(accept) : null;
  const [contact, setContact] = useState(false);
  const [ask, setAsk] = useState(null); // "finish" | "unpaid"
  const [dismissedMissed, setDismissedMissed] = useState(0); // "rider still with me": hide the missed-payments card until it grows
  const [dismissedRefused, setDismissedRefused] = useState(0); // the same for the refused-payment card
  const [now, setNow] = useState(Date.now());
  const [arrivedAt, setArrivedAt] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null); // road time from the map's route
  void liveTick;

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (stage === "arrived" && !arrivedAt) setArrivedAt(Date.now()); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const { pickup } = trip;
  // The trip with the stops and destination change the driver accepted; while riding the car heads for the next stop.
  const full = fullTrip(request, user);
  const stops = full?.stops || [];
  const dropoff = full?.dropoff || trip.dropoff;
  const key = rideKey(request);
  const [passed, setPassed] = useState(() => getSetting("stopsPassed", {})[key] || 0);
  // The rider asked to move the pickup. Until the driver accepts, the first one stays.
  const change = pickupChange(request);
  const pendingChange = stage === "enroute" && change?.status === "pending" ? change : null;
  const proposed = pendingChange ? readPickup(pendingChange.proposal, request, user) : null;
  const shiftMiles = proposed ? haversineDistance(pickup.lat, pickup.lng, proposed.lat, proposed.lng) : null;
  const target = stage === "riding" ? nextStop(stops, dropoff, passed) : pickup;
  useEffect(() => {
    if (stage !== "riding" || !myPosition || !stops[passed]) return;
    if (haversineDistance(myPosition.lat, myPosition.lng, stops[passed].lat, stops[passed].lng) * 1609.344 <= ARRIVE_RADIUS_METERS) {
      setPassed(passed + 1);
      setSetting("stopsPassed", { ...getSetting("stopsPassed", {}), [key]: passed + 1 });
    }
  }, [myPosition?.lat, myPosition?.lng, stage, stops.length, passed]); // eslint-disable-line react-hooks/exhaustive-deps
  const miles = myPosition ? haversineDistance(myPosition.lat, myPosition.lng, target.lat, target.lng) : null;
  // Minutes left: the road route from the car when the router answered, else a straight-line guess.
  const eta = miles == null ? null : routeInfo && !routeInfo.straight ? routeInfo.minutes : pickupEta(miles);
  const offer = offerFrom(request, user.publicKey); // the offer this driver made (its rates are frozen for the ride)
  const fare = offer ? parse(offer)?.priceSats : parse(request)?.fareSats;
  // The line always starts at the car, so it shows what is LEFT of the trip (through the stops still ahead).
  const ahead = [...stops.slice(passed), dropoff];
  const route = myPosition ? [{ lat: r3(myPosition.lat), lng: r3(myPosition.lng) }, ...(stage === "riding" ? ahead : [pickup])] : stage === "riding" ? [pickup, ...stops, dropoff] : null;
  const navUrl = exact ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving` : null;

  // Close to where the next step happens? Suggest it (never done for the driver).
  // Only with the exact address: the approximate area can be a kilometer off.
  const nearTarget = exact && stage !== "arrived" && miles != null && miles * 1609.344 <= ARRIVE_RADIUS_METERS;
  const nudged = useRef("");
  useEffect(() => {
    const k = `${request.id}|${stage}`;
    if (nearTarget && nudged.current !== k) {
      nudged.current = k;
      pushNotice(stage === "riding" ? "You're at the next stop. Finish the ride when the rider gets out." : "You're at the pickup. Tap I've arrived.");
    }
  }, [nearTarget, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Time and distance so far. The distance is the one the rider's app agreed on (the driver's own, unless the
  // rider's differs by more than 5%); until it arrives, the driver's own.
  const fresh = agreed && now - agreed.at < 90000;
  const view = meterView({
    stage, times: rideTimes(request), nowMs: now,
    pickupMiles: fresh && agreed.pm != null ? agreed.pm : odo.pm,
    tripMiles: fresh && agreed.tm != null ? agreed.tm : odo.tm,
  });
  const meterText = peekMeter(view);

  // Arrival: the button works only within 150 m of the pickup on a good GPS fix.
  const arrival = canMarkArrived({ pos: myPosition, status: gps, pickup });
  const canArrive = !!exact && arrival.ok;

  // Starting: this phone shows a 4-digit start code; the rider types it on the rider's phone (a signed "code"
  // confirmation), and "Start trip" unlocks when that confirmation arrives. The driver types nothing.
  const confirmNow = rideConfirm(request);
  const code = startCode(user.sk, request.pubkey, key);
  const mismatchBoarded = confirmNow.boarded && !confirmNow.boarded.ok;
  const canStart = !!confirmNow.code?.ok && !mismatchBoarded;

  // Money: what the ride has earned, what the rider has paid, how many payments are missed.
  const riding = stage === "riding";
  const missed = driveMoney?.missed || 0;
  const refused = driveMoney?.refused || 0;
  const showRefused = riding && refused > dismissedRefused;
  const showMissed = riding && !showRefused && missed >= MISSED_LIMIT && missed > dismissedMissed;
  const link = useRideLink({
    request, role: "driver", otherHeardAt: agreed?.at ?? null, active: riding,
    onSilence: ({ cutoff }) => finishRide(request, { reason: "silence", cutoff }),
  });
  const pendingStop = stopChanges(request).filter((c) => c.status === "pending").pop();
  const stopPlace = pendingStop ? readStop(pendingStop, request, user) : null;
  const terms = rideTerms(request); // this driver's frozen rates, for the estimates
  const acceptedStops = stopChanges(request).filter((c) => c.status === "accepted");
  const changeKinds = [...new Set(acceptedStops.map((c) => c.mode))];
  const atEnd = !!exact && riding && haversineDistance(myPosition?.lat ?? 0, myPosition?.lng ?? 0, dropoff.lat, dropoff.lng) * 1609.344 <= ARRIVE_RADIUS_METERS && !stops.slice(passed).length;

  const title =
    pendingChange ? "Rider changed the pickup"
    : stage === "enroute" ? `Pick up ${profile?.name || "your rider"}`
    : stage === "arrived" ? `Waiting for ${profile?.name || "your rider"}`
    : `Drop off at ${target.name}`;
  const sub =
    stage === "enroute" ? `${eta != null ? `${eta} min · ` : ""}${pickup.name}`
    : stage === "arrived" ? `Waiting ${mmss(Math.max(0, Math.floor((now - (arrivedAt || now)) / 1000)))} · ${pickup.name}`
    : eta != null ? `${eta} min to go` : "Trip under way";

  return (
    <MapPage
      map={
        <MapView
          pickup={pickup}
          dropoff={dropoff}
          route={route}
          onRoute={setRouteInfo}
          cars={myPosition ? [{ pubkey: "me", lat: myPosition.lat, lng: myPosition.lng }] : []}
          fitKey={`${request.id}|${stage}|${myPosition ? "pos" : "nopos"}`}
          padBottom={390}
          navigation
          follow={myPosition ? { lat: myPosition.lat, lng: myPosition.lng, id: "me" } : null}
        />
      }
    >
      {/* Nearly collapsed while driving; it opens by itself at the pickup / destination, when the driver has a step to take. */}
      <Sheet
        label="Current trip"
        peek={
          <div className="flex items-baseline gap-2">
            <p className="font-bold text-[17px] leading-6 truncate flex-1">{title}</p>
            {(meterText || (eta != null && stage !== "arrived")) && <span className="text-sm text-neutral-500 shrink-0 tabular-nums">{meterText || `${eta} min`}</span>}
          </div>
        }
        openKey={stage === "arrived" ? "arrived" : pendingChange ? `pickup-${pendingChange.id}` : nearTarget ? `near-${stage}` : ""}
        closeKey={stage}
      >
        <h2 className="text-2xl font-bold leading-tight">{title}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5" role="status">{sub}</p>
        {/* Starting the ride: the rider types the 4-digit code shown here, which proves the rider is at the car */}
        {stage === "arrived" && !mismatchBoarded && (
          <div className="mt-3 rounded-2xl border-2 border-black p-4" role="group" aria-label="Start code">
            <p className="font-bold">Start the ride</p>
            <p className="text-xs text-neutral-600 mb-3">When your rider is at the car, tell your rider this code. Your rider types it on their phone.</p>
            <div className="flex items-center justify-between rounded-xl bg-neutral-100 px-4 py-3">
              <span className="text-sm text-neutral-600">Start code</span>
              <span className="text-3xl font-extrabold tracking-widest tabular-nums" aria-label={`The start code is ${code}`}>{code}</span>
            </div>
            <p className={`text-sm mt-2 flex items-center gap-1 ${confirmNow.code?.ok ? "text-[#05944f] font-medium" : "text-neutral-500"}`}>
              {confirmNow.code?.ok ? <><Icon name="check" size={16} /> Your rider typed the code. You can start the trip.</> : "Waiting for your rider to type the code."}
            </p>
          </div>
        )}
        {/* What the ride has earned and what the rider has paid, tick by tick */}
        {riding && (
          <div className="mt-3 rounded-2xl bg-neutral-100 px-4 py-3" role="group" aria-label="Fare so far">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-neutral-600">Fare so far</span>
              <Money sats={driveMoney?.owed || 0} className="text-xl font-extrabold" />
            </div>
            <div className="flex items-baseline justify-between text-sm mt-1">
              <span className="text-neutral-600">Paid by the rider</span>
              <Money sats={driveMoney?.paid || 0} className="font-semibold" />
            </div>
            {fare > 0 && <EstimatedTotal className="mt-2" baseSats={fare} trip={full} changed={acceptedStops.length > 0} changeKinds={changeKinds} terms={terms} />}
            <FareBreakdown ledger={driveMoney?.ledger} paidSats={driveMoney?.paid || 0} className="mt-3 pt-3 border-t border-neutral-200" />
            <p className="text-xs text-neutral-500 mt-2">
              Your rates are frozen for this ride. Payments arrive in your ecash wallet as the ride runs.
            </p>
          </div>
        )}
        <TripMeter view={view} className="mt-3" />
        {pendingChange && (
          <div className="mt-3 rounded-2xl border-2 border-black p-4" role="group" aria-label="Pickup change request">
            <p className="font-bold">The rider asks for a new pickup</p>
            {proposed ? (
              <p className="text-[15px] mt-1">
                <span className="font-semibold">{proposed.name}</span>
                {shiftMiles != null && <span className="text-neutral-600"> · {shiftMiles < 0.1 ? `under ${formatDistance(0.1)}` : formatDistance(shiftMiles)} from the first pickup</span>}
              </p>
            ) : (
              <p className="text-sm text-neutral-600 mt-1">The new place can't be read yet.</p>
            )}
            <p className="text-xs text-neutral-600 mt-2">{PICKUP_CHANGE_NOTE} The rider is told this too.</p>
            <div className="flex gap-2 mt-3">
              <Button size="md" variant="go" disabled={!proposed} onClick={() => answerPickup(request, pendingChange.id, true)}>Accept new pickup</Button>
              <Button size="md" variant="secondary" onClick={() => answerPickup(request, pendingChange.id, false)}>Keep first pickup</Button>
            </div>
          </div>
        )}
        {stage === "enroute" && change?.status === "accepted" && (
          <p className="mt-3 text-sm text-[#05683a] bg-[#e6f4ec] rounded-xl px-3 py-2" role="status">New pickup accepted: {pickup.name}. {PICKUP_CHANGE_NOTE}</p>
        )}
        {!exact && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3">
            Showing the approximate area. The exact address arrives with the rider's confirmation. This can take a moment.
          </p>
        )}

        {showRefused && (
          <div className="mt-3 rounded-2xl border-2 border-amber-500 bg-amber-50 px-4 py-3" role="alert">
            <p className="font-bold text-amber-900">A payment from your rider was refused.</p>
            <p className="text-sm text-amber-900 mt-0.5">The mint did not give you that money. The rider's app may have taken it back first. You can finish the ride now. The rider still owes the fare and can pay it later.</p>
            <div className="flex gap-2 mt-3">
              <Button size="md" variant="danger" onClick={() => setAsk("unpaid")}>Finish ride</Button>
              <Button size="md" variant="secondary" onClick={() => setDismissedRefused(refused)}>Keep driving</Button>
            </div>
          </div>
        )}
        {showMissed && (
          <div className="mt-3 rounded-2xl border-2 border-amber-500 bg-amber-50 px-4 py-3" role="alert">
            <p className="font-bold text-amber-900">Your rider missed {missed} payments.</p>
            <p className="text-sm text-amber-900 mt-0.5">You can finish the ride now. The rider can still refill their wallet and pay what is missed, including these payments.</p>
            <div className="flex gap-2 mt-3">
              <Button size="md" variant="danger" onClick={() => setAsk("unpaid")}>Finish ride</Button>
              <Button size="md" variant="secondary" onClick={() => setDismissedMissed(missed)}>Rider still with me</Button>
            </div>
          </div>
        )}
        {link.askVouch && (
          <div className="mt-3 rounded-2xl bg-amber-50 text-amber-900 px-4 py-3" role="alert">
            <p className="text-sm font-semibold">Your rider's phone has been quiet for {Math.floor(link.quiet / 60000)} min.</p>
            <p className="text-xs mt-0.5">The ride does not end by itself. If your rider is still in the car (a flat battery, no signal), tap below. If both phones stay silent for 10 minutes, the ride finishes at the last signal.</p>
            <Button size="md" variant="secondary" className="mt-2" onClick={link.vouch}>Rider still with me</Button>
          </div>
        )}
        {pendingStop && (
          <div className="mt-3 rounded-2xl border-2 border-black p-4" role="group" aria-label="Stop request">
            <p className="font-bold">{pendingStop.mode === "destination" ? "The rider asks for a new destination" : "The rider asks to add a stop"}</p>
            <p className="text-[15px] mt-1 font-semibold">{stopPlace?.name || "The place can't be read yet."}</p>
            <ChangeEstimate className="mt-3" from={myPosition} ahead={ahead} mode={pendingStop.mode} place={stopPlace} terms={terms} />
            <p className="text-xs text-neutral-600 mt-2">
              If you accept, the rider keeps paying your normal fare for the extra distance and time. You can also finish the ride instead.
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="md" variant="go" disabled={!stopPlace} onClick={() => answerStop(request, pendingStop.id, true)}>Accept</Button>
              <Button size="md" variant="secondary" onClick={() => setAsk("finish")}>Finish ride</Button>
            </div>
          </div>
        )}

        {(() => {
          const c = rideConfirm(request);
          if (c.problem) return <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2" role="alert">The rider reported a problem: {c.problem.note || "no details"}</p>;
          if (stage === "arrived" && c.boarded) return <p className={`mt-3 text-sm rounded-xl px-3 py-2 ${c.boarded.ok ? "text-[#05944f] bg-[#e6f4ec]" : "text-red-700 bg-red-50"}`}>{c.boarded.ok ? "The rider confirmed they are in the car." : "The rider says the car or driver did not match. Do not start the trip."}</p>;
          return null;
        })()}
        <div className="mt-4 pt-4 border-t border-neutral-100"><RiderInfo pubkey={request.pubkey} /></div>

        <div className="flex gap-3 mt-4">
          <button type="button" onClick={() => setContact(true)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
            <Icon name="phone" size={18} /> Contact
          </button>
          {navUrl ? (
            <a href={navUrl} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] active:bg-neutral-200">
              <Icon name="navigation" size={18} /> Navigate
            </a>
          ) : (
            <span className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-neutral-100 font-semibold text-[15px] text-neutral-400"><Icon name="navigation" size={18} /> Navigate</span>
          )}
        </div>

        <div className="mt-4 flex items-start gap-3">
          <div className="flex flex-col items-center pt-1.5" aria-hidden="true">
            <span className="w-2 h-2 rounded-full bg-black" /><span className="h-5 w-px bg-neutral-300 my-0.5" /><span className="w-2 h-2 bg-black" />
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <p className="text-[15px] truncate">{pickup.name}</p>
            <p className="text-[15px] truncate">{dropoff.name}</p>
          </div>
          {fare > 0 && !riding && (
            <div className="text-right">
              <Money sats={fare} stacked className="font-bold" />
              <p className="text-xs text-neutral-500">estimate</p>
            </div>
          )}
        </div>

        {nearTarget && (
          <p className="mt-3 text-sm font-medium text-[#05944f] bg-[#e6f4ec] rounded-xl px-3 py-2" role="status">
            {stage === "riding" ? "You're at the next stop." : "You're at the pickup. Tap I've arrived."}
          </p>
        )}

        <StickyActions className="mt-5">
          {stage === "enroute" && (
            <>
              <Button variant="go" className={nearTarget ? "ring-4 ring-[#05944f]/30 animate-pulse" : ""} disabled={!canArrive} onClick={() => arrive(request, pickup)}>I've arrived</Button>
              {!canArrive && <p className="text-xs text-neutral-500 text-center mt-1.5" role="status">{exact ? arrival.reason : "Waiting for the exact pickup."}</p>}
            </>
          )}
          {stage === "arrived" && (
            <>
              <Button variant="go" disabled={!canStart} onClick={() => startTrip(request)}>Start trip</Button>
              {!canStart && <p className="text-xs text-neutral-500 text-center mt-1.5" role="status">{mismatchBoarded ? "Your rider says the car did not match." : "Start when your rider has typed the start code."}</p>}
            </>
          )}
          {stage === "riding" && <Button variant="go" className={atEnd ? "ring-4 ring-[#05944f]/30 animate-pulse" : ""} onClick={() => setAsk("finish")}>Finish ride</Button>}
        </StickyActions>
        {stage !== "riding" && (
          <Button variant="ghost" size="md" className="mt-1 !text-red-600" onClick={() => setAsk("finish")}>Finish ride</Button>
        )}
      </Sheet>

      <ContactSheet open={contact} onClose={() => setContact(false)} pubkey={request.pubkey} name={profile?.name} />
      <ConfirmDialog
        open={ask === "finish"}
        title="Finish this ride?"
        message={riding
          ? `${atEnd ? "" : "You are not at the destination. "}The rider pays what the ride has earned so far: the base rate, the miles and the minutes${driveMoney ? ` (${moneyText(driveMoney.owed, btcPrice)})` : ""}. The ride ends for both of you.`
          : "The ride has not started, so the rider owes nothing. The ride ends for both of you."}
        confirmLabel="Finish ride"
        cancelLabel="Keep driving"
        danger={!atEnd}
        onConfirm={() => { setAsk(null); finishRide(request, { reason: atEnd ? "destination" : "driver", atDestination: atEnd }); }}
        onCancel={() => setAsk(null)}
      />
      <ConfirmDialog
        open={ask === "unpaid"}
        title="Finish the ride?"
        message={`${refused > 0 && missed < MISSED_LIMIT ? "A payment from your rider was refused." : `Your rider missed ${missed} payments.`} If you finish now, the rider still owes what is missed and can pay it later after refilling their wallet.`}
        confirmLabel="Finish ride"
        cancelLabel="Keep driving"
        danger
        onConfirm={() => { setAsk(null); finishRide(request, { reason: "unpaid" }); }}
        onCancel={() => setAsk(null)}
      />
    </MapPage>
  );
}
