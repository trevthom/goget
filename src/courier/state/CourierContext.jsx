// ════════════════════════════════════════════════════════════
//  COURIER CONTEXT — State for the Courier role of GoGet (mounted only after login, keyed by the account).
//  What is on screen is DERIVED from signed events (lib/delivery.js): `open` (requests this courier may see: near, open, meeting the
//  CDL need), `jobs` (deliveries the shipper gave this courier), `bids` (this courier's bids and where they stand). UI-only: the radius.
//  Actions: placeBid / withdrawBid (a price, minutes to the pickup, notes, the CDL statement from Account → Courier details),
//  markDelivered (needs a good GPS fix near the drop-off; the proof, a photo + that fix, is sealed to the shipper), withdrawJob (only before the pickup).
//  Timers: every 3 s redeem the shipper's ecash payments (features/payments/redeemDelivery.js); every 6 s send the courier's exact
//  position, encrypted, to the shipper of each running job; every 8 s ask the relays for news. The screen stays awake during a job.
// ════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useGeolocation } from "../../lib/useGeolocation.js";
import { useWakeLock } from "../../lib/useWakeLock.js";
import { haversineDistance } from "../../lib/geo.js";
import { publishRideLocation } from "../../nostr/live.js";
import { getMyMint } from "../../features/ecash/myMint.js";
import { redeemDeliveryFor } from "../../features/payments/redeemDelivery.js";
import { bidEvent, bidsOfCourier, deliveryContent, deliveryStatus, exactDelivery, jobsFor, openRequestsFor, stageEvent, withdrawBidEvent, DELIVERED_NEAR_M, DEFAULT_UPFRONT } from "../../lib/delivery.js";
import { normalizeCdl } from "../../lib/cdl.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { DEFAULT_REQUEST_RADIUS_MILES, LOCATION_PING_MS } from "../../config/settings.js";

const CourierContext = createContext(null);
export const useCourier = () => useContext(CourierContext);
export const RADIUS_CHOICES = [10, 25, 50, 100];

export function CourierProvider({ children }) {
  const { user, deliveryRequests, publish, pullRecent, refreshData, pushNotice, liveTick, ecash, ecashOff, blocked } = useApp();
  const me = user.publicKey;
  const { pos: myPosition, error: geoError, status: gps } = useGeolocation(true);
  const [radius, setRadiusState] = useState(() => getSetting("courierRadius", DEFAULT_REQUEST_RADIUS_MILES * 2));
  const setRadius = useCallback((v) => { setRadiusState(v); setSetting("courierRadius", v); }, []);

  void liveTick;
  const cdl = normalizeCdl(user.courier?.cdl);
  const miles = (a, p) => (p && typeof p.lat === "number" ? haversineDistance(a.lat, a.lng, p.lat, p.lng) : null);
  const open = openRequestsFor(deliveryRequests, {
    me, cdl, blocked, distance: miles,
    near: myPosition ? { lat: myPosition.lat, lng: myPosition.lng, radiusMiles: radius } : null,
  });
  const jobs = jobsFor(deliveryRequests, me);
  const bids = bidsOfCourier(deliveryRequests, me);
  const mint = getMyMint();
  const ready = !ecashOff;
  const screenMayDim = useWakeLock(jobs.length > 0);

  // Ask the relays for news while the courier looks at jobs (and during a job).
  useEffect(() => {
    refreshData();
    const id = setInterval(() => pullRecent(), 8000);
    return () => clearInterval(id);
  }, [pullRecent, refreshData]);

  // ── Bids ──
  const placeBid = useCallback(async (request, { priceSats, etaMinutes, note, upfrontPct = DEFAULT_UPFRONT }) => {
    if (!ready) return { ok: false, message: "Connect your ecash wallet first (Account → Ecash wallet): you are paid in ecash." };
    const ev = bidEvent(request, user, { priceSats, etaMinutes, note, cdl: user.courier?.cdl, vehicle: user.courier?.vehicle || "", mint, upfrontPct });
    const ok = await publish(ev.kind, ev.content, ev.tags);
    refreshData();
    pushNotice(ok ? "Bid sent. You will see it under My jobs." : "Bid saved here. It will be sent as soon as a relay answers.");
    return { ok: true };
  }, [ready, user, mint, publish, refreshData, pushNotice]);
  const withdrawBid = useCallback(async (request, bid) => {
    const ev = withdrawBidEvent(request, user, bid);
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
    pushNotice("Bid taken back.");
  }, [user, publish, refreshData, pushNotice]);

  // ── A job ──
  const distanceToDropoff = useCallback((request) => {
    const ex = exactDelivery(request, user);
    return ex && myPosition ? haversineDistance(myPosition.lat, myPosition.lng, ex.dropoff.lat, ex.dropoff.lng) * 1609.344 : null;
  }, [user, myPosition]);
  const canDeliver = useCallback((request) => {
    const m = distanceToDropoff(request);
    return gps === "good" && m != null && m <= DELIVERED_NEAR_M;
  }, [distanceToDropoff, gps]);
  const markDelivered = useCallback(async (request, photo = "") => {
    if (!canDeliver(request)) return { ok: false, message: `Get within ${DELIVERED_NEAR_M} m of the drop-off with a good GPS fix first.` };
    const ev = stageEvent(request, user, "delivered", { photo, fix: myPosition });
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
    pushNotice("Marked delivered. The shipper confirms and pays the rest.");
    return { ok: true };
  }, [canDeliver, myPosition, user, publish, refreshData, pushNotice]);
  const withdrawJob = useCallback(async (request) => {
    const ev = stageEvent(request, user, "withdrawn");
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
    pushNotice("You withdrew from this delivery. Nothing was charged.");
  }, [user, publish, refreshData, pushNotice]);

  // ── Timers: redeem payments, share my position with each shipper I am working for ──
  const latest = useRef({});
  latest.current = { user, ecash, publish, deliveryRequests, jobs, myPosition, gps };
  useEffect(() => {
    if (!ecash) return undefined;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const { user: u, ecash: wallet, publish: pub, deliveryRequests: reqs } = latest.current;
        await redeemDeliveryFor({ user: u, ecash: wallet, publish: pub, requests: reqs });
      } finally { busy = false; }
    };
    run();
    const id = setInterval(run, 3000);
    return () => clearInterval(id);
  }, [ecash]);
  useEffect(() => {
    const id = setInterval(() => {
      const { user: u, jobs: list, myPosition: p, gps: g } = latest.current;
      if (!p || g === "stale") return;
      for (const r of list) if (["assigned", "in_transit"].includes(deliveryStatus(r))) publishRideLocation(u, r.pubkey, { lat: p.lat, lng: p.lng });
    }, LOCATION_PING_MS);
    return () => clearInterval(id);
  }, []);

  const value = {
    myPosition, geoError, gps, radius, setRadius, cdl, ready, mint,
    open, jobs, bids, placeBid, withdrawBid, markDelivered, withdrawJob, canDeliver, distanceToDropoff, screenMayDim,
    contentOf: deliveryContent,
  };
  return <CourierContext.Provider value={value}>{children}</CourierContext.Provider>;
}
