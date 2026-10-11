// ════════════════════════════════════════════════════════════
//  DRIVE ODOMETER (driver app) — Counts the miles the driver's own GPS
//  covers on one drive, in two legs:
//    pm  the drive TO the pickup (from when the rider confirmed until the
//        driver arrives)
//    tm  the TRIP itself (from "Start trip" to the end)
//  The legs never reset when the rider changes the pickup (the miles already
//  driven stay counted). Saved on this device, so a reload keeps the count.
//  The numbers go to the rider in every location update; the rider's app
//  decides which distance both screens show (lib/meter.js).
// ════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import { newOdo, stepOdo } from "../../lib/odometer.js";
import { rideKey, rideStage } from "../../lib/rides.js";
import { getSetting, setSetting } from "../../config/relays.js";

const STORE = "driverOdo";
const SAVE_EVERY_MS = 5000;

export function useDriveOdometer(request, pos) {
  const key = request ? rideKey(request) : null;
  const stage = request ? rideStage(request) : null;
  const ref = useRef({ key: null, pickup: newOdo(), trip: newOdo(), savedAt: 0 });
  const [miles, setMiles] = useState({ pm: 0, tm: 0 });
  const milesRef = useRef({ pm: 0, tm: 0 }); // the latest, for timers

  const publish = () => {
    const m = { pm: ref.current.pickup.miles, tm: ref.current.trip.miles };
    milesRef.current = m;
    setMiles((prev) => (prev.pm === m.pm && prev.tm === m.tm ? prev : m));
  };
  const save = (force = false) => {
    const r = ref.current;
    if (!r.key || (!force && Date.now() - r.savedAt < SAVE_EVERY_MS)) return;
    r.savedAt = Date.now();
    const all = getSetting(STORE, {});
    const recent = Object.entries({ ...all, [r.key]: { pickup: r.pickup, trip: r.trip } }).slice(-5); // keep the last few rides
    setSetting(STORE, Object.fromEntries(recent));
  };

  // A new ride: pick up where this device left off, if it was reloaded.
  useEffect(() => {
    const saved = key ? getSetting(STORE, {})[key] : null;
    ref.current = { key, pickup: saved?.pickup || newOdo(), trip: saved?.trip || newOdo(), savedAt: 0 };
    publish();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every new GPS fix adds to the leg that is running.
  useEffect(() => {
    if (!key || !pos || ref.current.key !== key) return;
    const fix = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, t: Date.now() };
    if (stage === "enroute") ref.current.pickup = stepOdo(ref.current.pickup, fix);
    else if (stage === "riding") ref.current.trip = stepOdo(ref.current.trip, fix);
    else return; // waiting at the pickup: no miles
    publish();
    save();
  }, [pos?.lat, pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save when a leg ends.
  useEffect(() => { save(true); }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...miles, milesRef };
}
