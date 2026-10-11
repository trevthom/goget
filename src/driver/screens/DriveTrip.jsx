// ════════════════════════════════════════════════════════════
//  DRIVE TRIP (driver) — A confirmed ride, in three steps that the driver
//  moves forward with signed stage markers the rider's app reacts to:
//    to pickup   → "I've arrived"
//    at pickup   → "Start trip"
//    trip        → "Complete trip"
//  The rider's exact pickup/dropoff arrives sealed (NIP-44) with the
//  rider's confirmation; until then only the approximate area is known.
//  The driver's live location is sent to the rider by DriverContext.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { ARRIVE_RADIUS_METERS } from "../../config/settings.js";
import { useApp } from "../../state/AppContext.jsx";
import { useDriver } from "../state/DriverContext.jsx";
import { rideConfirm, rideStage } from "../../lib/rides.js";
import { exactTrip } from "../../lib/privacy.js";
import { acceptFor, offerFrom } from "../../lib/trips.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta } from "../../lib/fare.js";
import MapView from "../../ui/MapView.jsx";
import Money from "../../ui/Money.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import ContactSheet from "../../ui/ContactSheet.jsx";
import { MapPage, Sheet } from "../../ui/Layout.jsx";
import { ConfirmDialog } from "../../ui/Parts.jsx";
import RiderInfo, { useRiderInfo } from "../components/RiderInfo.jsx";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const r3 = (n) => Math.round(n * 1000) / 1000;
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export default function DriveTrip({ request }) {
  const { user, liveTick, pushNotice } = useApp();
  const { myPosition, arrive, startTrip, completeTrip, cancelDrive } = useDriver();
  const stage = rideStage(request);
  const exact = exactTrip(request, user);
  const trip = exact || parse(request);
  const { profile } = useRiderInfo(request.pubkey);
  const accept = acceptFor(request, user.publicKey);
  const paid = accept ? parse(accept) : null;
  const [contact, setContact] = useState(false);
  const [ask, setAsk] = useState(null); // "complete" | "cancel"
  const [now, setNow] = useState(Date.now());
  const [arrivedAt, setArrivedAt] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null); // road time from the map's route
  void liveTick;

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (stage === "arrived" && !arrivedAt) setArrivedAt(Date.now()); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const { pickup, dropoff } = trip;
  const target = stage === "riding" ? dropoff : pickup;
  const miles = myPosition ? haversineDistance(myPosition.lat, myPosition.lng, target.lat, target.lng) : null;
  // Minutes left: the road route from the car when the router answered, else a straight-line guess.
  const eta = miles == null ? null : routeInfo && !routeInfo.straight ? routeInfo.minutes : pickupEta(miles);
  const offer = offerFrom(request, user.publicKey); // the fare this driver agreed to
  const fare = offer ? parse(offer)?.priceSats : parse(request)?.fareSats;
  // The line always starts at the car, so it shows what is LEFT of the trip.
  const route = myPosition ? [{ lat: r3(myPosition.lat), lng: r3(myPosition.lng) }, target] : stage === "riding" ? [pickup, dropoff] : null;
  const navUrl = exact ? `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving` : null;

  // Close to where the next step happens? Suggest it (never done for the driver).
  // Only with the exact address: the approximate area can be a kilometer off.
  const nearTarget = exact && stage !== "arrived" && miles != null && miles * 1609.344 <= ARRIVE_RADIUS_METERS;
  const nudged = useRef("");
  useEffect(() => {
    const k = `${request.id}|${stage}`;
    if (nearTarget && nudged.current !== k) {
      nudged.current = k;
      pushNotice(stage === "riding" ? "You're at the destination. Complete the trip when the rider gets out." : "You're at the pickup. Tap I've arrived.");
    }
  }, [nearTarget, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const title =
    stage === "enroute" ? `Pick up ${profile?.name || "your rider"}`
    : stage === "arrived" ? `Waiting for ${profile?.name || "your rider"}`
    : `Drop off at ${dropoff.name}`;
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
            {eta != null && stage !== "arrived" && <span className="text-sm text-neutral-500 shrink-0">{eta} min</span>}
          </div>
        }
        openKey={stage === "arrived" ? "arrived" : nearTarget ? `near-${stage}` : ""}
        closeKey={stage}
      >
        <h2 className="text-2xl font-bold leading-tight">{title}</h2>
        <p className="text-neutral-600 text-[15px] mt-0.5" role="status">{sub}</p>
        {!exact && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3">
            Showing the approximate area. The exact address arrives with the rider's confirmation. This can take a moment.
          </p>
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
          {fare > 0 && (
            <div className="text-right">
              <Money sats={fare} stacked className="font-bold" />
              {paid?.paidSats > 0 && <p className="text-xs text-neutral-500">{paid.verified ? "deposit received" : "deposit paid*"}</p>}
            </div>
          )}
        </div>
        {paid?.paidSats > 0 && !paid.verified && (
          <p className="text-xs text-neutral-500 mt-1">*The rider says the deposit is paid. Check your wallet.</p>
        )}

        {nearTarget && (
          <p className="mt-3 text-sm font-medium text-[#05944f] bg-[#e6f4ec] rounded-xl px-3 py-2" role="status">
            {stage === "riding" ? "You're at the destination." : "You're at the pickup. Let the rider know."}
          </p>
        )}
        <div className="mt-5">
          {stage === "enroute" && <Button variant="go" className={nearTarget ? "ring-4 ring-[#05944f]/30 animate-pulse" : ""} onClick={() => arrive(request)}>I've arrived</Button>}
          {stage === "arrived" && <Button variant="go" onClick={() => startTrip(request)}>Start trip</Button>}
          {stage === "riding" && <Button variant="go" className={nearTarget ? "ring-4 ring-[#05944f]/30 animate-pulse" : ""} onClick={() => setAsk("complete")}>Complete trip</Button>}
          <Button variant="ghost" size="md" className="mt-1 !text-red-600" onClick={() => setAsk("cancel")}>
            {stage === "arrived" ? "Cancel (rider didn't show)" : "Cancel trip"}
          </Button>
        </div>
      </Sheet>

      <ContactSheet open={contact} onClose={() => setContact(false)} pubkey={request.pubkey} name={profile?.name} />
      <ConfirmDialog
        open={ask === "complete"}
        title="Complete this trip?"
        message="Only complete the trip once the rider is at the destination. The rider can't undo this."
        confirmLabel="Complete trip"
        cancelLabel="Not yet"
        onConfirm={() => { setAsk(null); completeTrip(request); }}
        onCancel={() => setAsk(null)}
      />
      <ConfirmDialog
        open={ask === "cancel"}
        title="Cancel this trip?"
        message="The rider is told right away and the ride ends for both of you."
        confirmLabel="Cancel trip"
        cancelLabel="Keep trip"
        danger
        onConfirm={() => { setAsk(null); cancelDrive(request); }}
        onCancel={() => setAsk(null)}
      />
    </MapPage>
  );
}
