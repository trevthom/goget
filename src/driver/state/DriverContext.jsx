// ════════════════════════════════════════════════════════════
//  DRIVER STATE — Everything only the driver app needs, on top of the
//  shared useApp() state:
//    • the driver's GPS position and the online/offline switch
//    • public presence while online (so riders see the car on their map)
//    • open requests near the driver, minus the ones they declined
//    • the driver's offer waiting on a rider, and the CURRENT drive —
//      both derived from signed events, so a reload shows the same screen
//    • encrypted live location sent to the rider during a drive
//    • settings: deposit %, request radius, new-request alerts
//    • actions: acceptRequest, arrive, startTrip, completeTrip,
//      cancelDrive, rateRider
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { publishPresence, publishRideLocation } from "../../nostr/live.js";
import { seedDemoData } from "../../nostr/demoData.js";
import { useGeolocation } from "../../lib/useGeolocation.js";
import { useWakeLock } from "../../lib/useWakeLock.js";
import { isNative } from "../../lib/nativeGeo.js";
import { haversineDistance } from "../../lib/geo.js";
import { depositSats, pickupEta, quoteFare, roadMiles, driveMinutes, normalizeRates, typicalFareUsd, satsFromUsd } from "../../lib/fare.js";
import { isDriveReady } from "../../lib/profile.js";
import { seal } from "../../lib/privacy.js";
import { activeDriveFor, pendingOfferFor } from "../../lib/trips.js";
import { isRideExpired, rideEnding, rideKey, rideStatus } from "../../lib/rides.js";
import { DEFAULT_DEPOSIT_PERCENT, DEFAULT_REQUEST_RADIUS_MILES } from "../../config/settings.js";
import { getSetting, setSetting } from "../../config/relays.js";

const DriverContext = createContext(null);
export const useDriver = () => useContext(DriverContext);

const HOUR = 3600000;
const PRESENCE_EVERY_MS = 15000;
const LOCATION_EVERY_MS = 6000;
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const carLabel = (v) => (v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "");

// The price the rider offered; older requests without one get an estimate.
export function fareOf(request, btcUsd) {
  const c = parse(request) || {};
  if (c.fareSats > 0) return c.fareSats;
  const miles = roadMiles(haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng));
  return quoteFare({ miles, minutes: driveMinutes(miles) }, btcUsd).sats;
}

// What this driver typically charges for this trip, in sats (from their own rates; the app's if unset).
export function typicalSatsFor(request, rates, btcUsd) {
  const c = parse(request) || {};
  const straight = c.pickup && c.dropoff ? haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng) : 0;
  const miles = c.distanceMiles ?? roadMiles(straight);
  const minutes = c.durationMin ?? driveMinutes(miles);
  return satsFromUsd(typicalFareUsd(rates, miles, minutes), btcUsd);
}

export function DriverProvider({ children }) {
  const { user, rideRequests, publish, refreshData, pullRecent, pushNotice, liveTick, btcUsd, isBlockedPk } = useApp();
  const me = user.publicKey;
  const driveReady = isDriveReady(user);
  const { pos: myPosition, error: geoError, status: gps } = useGeolocation(true);
  const posRef = useRef(null);
  const gpsRef = useRef(gps);
  useEffect(() => { posRef.current = myPosition; }, [myPosition]);
  useEffect(() => { gpsRef.current = gps; }, [gps]);

  // ── Settings (saved on this device) ──
  const [depositPct, setDepositPctState] = useState(() => getSetting("depositPct", DEFAULT_DEPOSIT_PERCENT));
  const [radius, setRadiusState] = useState(() => getSetting("requestRadius", DEFAULT_REQUEST_RADIUS_MILES));
  const [alerts, setAlertsState] = useState(() => getSetting("requestAlerts", true));
  const setDepositPct = useCallback((v) => { setDepositPctState(v); setSetting("depositPct", v); }, []);
  const setRadius = useCallback((v) => { setRadiusState(v); setSetting("requestRadius", v); }, []);
  const setAlerts = useCallback((v) => { setAlertsState(v); setSetting("requestAlerts", v); }, []);

  // Demo riders and requests (development builds only; never sent to relays).
  useEffect(() => { seedDemoData(); refreshData(); }, [refreshData]);

  // ── Current drive and waiting offer, from events ──
  void liveTick;
  const activeDrive = activeDriveFor(rideRequests, me);
  const pending = pendingOfferFor(me); // { offer, request } | null

  // ── Online / offline ──
  const [online, setOnline] = useState(false);
  // Only a good GPS fix may go online: a laptop with a Wi-Fi/IP position must not appear as a car.
  const goOnline = useCallback(() => { if (driveReady && gpsRef.current === "good") setOnline(true); }, [driveReady]);
  const goOffline = useCallback(() => setOnline(false), []);
  useEffect(() => { if (!driveReady) setOnline(false); }, [driveReady]);

  // Public presence (coarsened) while online and free to take a ride.
  const visible = online && !activeDrive;
  useEffect(() => {
    if (!visible) return;
    const beat = () => {
      const p = posRef.current;
      // Never advertise a weak or stale position.
      if (p && gpsRef.current === "good") publishPresence(user, { lat: p.lat, lng: p.lng, vehicle: carLabel(user.vehicle), rates: normalizeRates(user.rates) || undefined });
    };
    beat();
    const id = setInterval(beat, PRESENCE_EVERY_MS);
    return () => clearInterval(id);
  }, [visible, user]);

  // Exact position, encrypted to the rider, for the whole drive.
  const riderPubkey = activeDrive?.pubkey;
  useEffect(() => {
    if (!riderPubkey) return;
    // A weak fix still helps the rider find the car; a stale one would show it in the wrong place.
    const beat = () => { if (posRef.current && gpsRef.current !== "stale") publishRideLocation(user, riderPubkey, posRef.current); };
    beat();
    const id = setInterval(beat, LOCATION_EVERY_MS);
    return () => clearInterval(id);
  }, [riderPubkey, user]);

  // In the native shell the page can be throttled in the background, so send a
  // location when each fix arrives (at most every 5 s) instead of relying on timers.
  const lastNativeSend = useRef({ ride: 0, presence: 0 });
  useEffect(() => {
    if (!isNative() || !myPosition || gps === "stale") return;
    const now = Date.now();
    if (riderPubkey && now - lastNativeSend.current.ride > 5000) {
      lastNativeSend.current.ride = now;
      publishRideLocation(user, riderPubkey, myPosition);
    } else if (visible && gps === "good" && now - lastNativeSend.current.presence > 15000) {
      lastNativeSend.current.presence = now;
      publishPresence(user, { lat: myPosition.lat, lng: myPosition.lng, vehicle: carLabel(user.vehicle), rates: normalizeRates(user.rates) || undefined });
    }
  }, [myPosition]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sleeping phone loses GPS and relay connections: keep the screen on while working.
  useWakeLock(online || !!activeDrive);

  // Poll so requests and the rider's confirmation arrive even if the live
  // subscription missed them.
  const watching = online || !!activeDrive || !!pending;
  useEffect(() => {
    pullRecent();
    if (!watching) return;
    const id = setInterval(() => pullRecent(), activeDrive ? 6000 : 8000);
    return () => clearInterval(id);
  }, [watching, activeDrive, pullRecent]);

  // ── Requests nearby ──
  const [declined, setDeclined] = useState(() => getSetting("declinedRides", []));
  const [skipped, setSkipped] = useState([]); // card timed out this session
  const decline = useCallback((request) => {
    setDeclined((list) => {
      const next = [...list, request.id].slice(-200);
      setSetting("declinedRides", next);
      return next;
    });
  }, []);
  const skip = useCallback((request) => setSkipped((l) => [...l, request.id]), []);

  const open = rideRequests
    .filter((r) => r.pubkey !== me && !isBlockedPk(r.pubkey) && rideStatus(r) === "requested")
    .filter((r) => !isRideExpired(parse(r), r.created_at))
    .filter((r) => !declined.includes(r.id))
    .filter((r) => !pending || r.id !== pending.request.id)
    .map((r) => {
      const c = parse(r);
      const demo = r.tags.some((t) => t[0] === "demo");
      const miles = myPosition ? haversineDistance(myPosition.lat, myPosition.lng, c.pickup.lat, c.pickup.lng) : null;
      return { request: r, content: c, demo, miles };
    })
    .filter(({ demo, miles }) => demo || miles == null || miles <= radius)
    .sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9) || b.request.created_at - a.request.created_at);

  // ── The receipt to show after a drive ends ──
  const [doneKeys, setDoneKeys] = useState(() => getSetting("driverDone", []));
  const receipt =
    rideRequests
      .filter((r) => parse(r)?.driverPubkey === me && !doneKeys.includes(rideKey(r)))
      .map((r) => ({ r, end: rideEnding(r) }))
      .filter(({ r, end }) => {
        if (!end || Date.now() - end.at * 1000 > 6 * HOUR) return false;
        const status = rideStatus(r);
        return status === "completed" || (status === "cancelled" && end.by !== me);
      })
      .sort((a, b) => b.end.at - a.end.at)[0]?.r || null;
  const dismissReceipt = useCallback((request) => {
    setDoneKeys((keys) => {
      const next = [...keys, rideKey(request)].slice(-100);
      setSetting("driverDone", next);
      return next;
    });
  }, []);

  // ── Banners ──
  useEffect(() => {
    const since = Math.floor(Date.now() / 1000) - 60;
    return relay.onEvent((_id, ev) => {
      if (ev.pubkey === me || ev.created_at < since) return;
      const mine = (ev.tags || []).some((t) => t[0] === "p" && t[1] === me);
      if (ev.kind === EVENT_KINDS.RIDE_CANCEL && mine) pushNotice("The rider cancelled the ride.");
      else if (ev.kind === EVENT_KINDS.RIDE_ACCEPT && mine) pushNotice("Rider confirmed. Head to the pickup.");
      else if (ev.kind === EVENT_KINDS.RIDE_REQUEST && alerts && online && !activeDrive && !isBlockedPk(ev.pubkey)) {
        const c = parse(ev);
        const p = posRef.current;
        if (c?.status === "requested" && c.pickup && p && haversineDistance(p.lat, p.lng, c.pickup.lat, c.pickup.lng) <= radius) {
          pushNotice("New ride request nearby.");
        }
      }
    });
  }, [me, pushNotice, alerts, online, activeDrive, radius, isBlockedPk]);

  // The ride I was waiting on went to someone else (or was cancelled).
  const hadPending = useRef(null);
  useEffect(() => {
    if (pending) { hadPending.current = pending.request.id; return; }
    if (hadPending.current && !activeDrive) pushNotice("That ride is no longer available.");
    hadPending.current = null;
  }, [pending?.request.id, !!activeDrive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ──
  // "I'll take it": offer to drive, asking the deposit. With no price given the driver
  // accepts the rider's offer; a higher `priceSats` is a counter-offer.
  const acceptRequest = useCallback(
    (request, priceSats) => {
      const c = parse(request);
      const fare = priceSats > 0 ? Math.round(priceSats) : fareOf(request, btcUsd);
      const miles = myPosition ? haversineDistance(myPosition.lat, myPosition.lng, c.pickup.lat, c.pickup.lng) : null;
      const demo = request.tags.some((t) => t[0] === "demo");
      const sent = publish(
        EVENT_KINDS.RIDE_OFFER,
        {
          priceSats: fare,
          upfrontSats: depositSats(fare, depositPct),
          etaMinutes: miles == null ? 5 : pickupEta(miles),
          message: "",
          typicalSats: typicalSatsFor(request, user.rates, btcUsd), // this driver's own typical fare for the trip (riders see it)
          gender: user.gender === "male" || user.gender === "female" ? user.gender : "", // optional, self-declared
          // The plate is private: only this rider can read it.
          plate: seal(user.sk, request.pubkey, {
            plateState: user.vehicle?.plateState || "",
            plateNumber: user.vehicle?.plateNumber || "",
          }),
        },
        [
          ["e", request.id], // which request this offer is for
          ["p", request.pubkey], // who to notify (the rider)
          // unique per (driver, request) so offers to different requests don't overwrite each other:
          ["d", "offer-" + request.id],
          ["t", "ride-offer"],
        ],
        { localOnly: demo } // demo requests are local-only, so the offer must be too
      );
      refreshData();
      return sent;
    },
    [publish, refreshData, depositPct, myPosition, user, btcUsd]
  );

  const mark = useCallback(
    (request, stage) => {
      publish(
        EVENT_KINDS.RIDE_STAGE,
        { stage },
        [["e", request.id], ["p", request.pubkey], ["d", "stage-" + rideKey(request)], ["t", "ride-stage"]]
      );
      refreshData();
    },
    [publish, refreshData]
  );
  const arrive = useCallback((request) => mark(request, "arrived"), [mark]);
  const startTrip = useCallback((request) => mark(request, "riding"), [mark]);

  const completeTrip = useCallback(
    (request) => {
      publish(
        EVENT_KINDS.RIDE_COMPLETE,
        { requestId: request.id },
        [["e", request.id], ["p", request.pubkey], ["d", "complete-" + request.id], ["t", "ride-complete"]]
      );
      refreshData();
    },
    [publish, refreshData]
  );

  const cancelDrive = useCallback(
    (request) => {
      publish(
        EVENT_KINDS.RIDE_CANCEL,
        { requestId: request.id, reason: "Cancelled by driver" },
        [["e", request.id], ["p", request.pubkey], ["d", "cancel-" + request.id], ["t", "ride-cancel"]]
      );
      refreshData();
    },
    [publish, refreshData]
  );

  const rateRider = useCallback(
    (request, rating, review) => {
      publish(
        EVENT_KINDS.RATING,
        { rating, review, rideId: request.id },
        [["p", request.pubkey], ["e", request.id], ["d", "rating-" + request.id], ["t", "rating"]]
      );
    },
    [publish]
  );

  const value = {
    driveReady, myPosition, geoError, gps,
    online, goOnline, goOffline,
    depositPct, setDepositPct, radius, setRadius, alerts, setAlerts,
    open, decline, skip, skipped,
    activeDrive, pending, receipt, dismissReceipt,
    acceptRequest, arrive, startTrip, completeTrip, cancelDrive, rateRider,
  };
  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}
