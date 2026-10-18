// ════════════════════════════════════════════════════════════
//  SHIPPER CONTEXT — State for the Shipping role of GoGet (mounted only after login, keyed by the account).
//  Holds what is UI-only (the delivery being planned: `draft`) and the actions; everything else is DERIVED from signed events
//  (lib/delivery.js), so a reload or a second device shows the same screens:
//    mine      my deliveries, newest first          inbox     requests with bids waiting [{ request, bids }]     bidCount  their total (tab badge)
//    post()            publish the request (route distance from the map router, exact places sealed to me)
//    acceptBid()       take ONE bid: the others are declined at once; needs ecash at the courier's mint for the whole price
//    declineBid()      turn one bid down; closeRequest() close a request nobody took
//    confirmPickup()   type the 4-digit code shown on the courier's phone → the parcel changed hands, the pickup share is paid
//    confirmDelivered(request, how) / reportProblem()   the parcel arrived (the rest is paid; `how` = "gps+photo" or "outside": verified outside of GoGet) / it did not, or is damaged
//  Invitations: a request is encrypted (lib/jobseal.js), so couriers cannot browse it. The app invites the couriers who are available (their
//  public presence, lib/couriers.js) when the request is posted AND every 20 s while it is open, as new couriers come online. Keep the app open.
//  A timer (every 3 s) pays what is due (features/payments/payDelivery.js) and keeps the screen awake while a delivery runs.
// ════════════════════════════════════════════════════════════

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useWakeLock } from "../../lib/useWakeLock.js";
import { useGeolocation } from "../../lib/useGeolocation.js";
import { reverseGeocode } from "../../lib/geocode.js";
import { haversineDistance } from "../../lib/geo.js";
import { getDrivingRoute, metersToMiles } from "../../lib/routing.js";
import { hideList } from "../../lib/blocks.js";
import { attemptGate, recordAttempt, checkCode } from "../../lib/startcode.js";
import { acceptEvents, bidInbox, confirmEvent, declineBidEvent, deliveriesOf, deliveryCourier, deliveryInvited, deliveryNeed, deliveryStatus, exactDelivery, inviteEvent, isBidExpired, isDeliveryExpired, isRunning, pickupCode, requestEvent, versionEvent } from "../../lib/delivery.js";
import { eligibleCouriers } from "../../lib/couriers.js";
import { subscribeCourierPresence } from "../../nostr/live.js";
import { normalizeNeed } from "../../lib/cdl.js";
import { neededToAccept, dueNow } from "../../lib/deliveryPay.js";
import { payDelivery } from "../../features/payments/payDelivery.js";
import { moneyText } from "../../ui/Money.jsx";

const ShipperContext = createContext(null);
export const useShipper = () => useContext(ShipperContext);

export const EMPTY_DRAFT = { step: "form", pinField: "pickup", type: "package", size: "medium", note: "", pickup: null, dropoff: null, when: "ASAP", cdlRequired: false, endorsements: [], contact: "" };

export function ShipperProvider({ children }) {
  const { user, deliveryRequests, publish, pullRecent, refreshData, pushNotice, liveTick, setView, isBlockedPk, blocked, ecash, ecashOff, btcPrice } = useApp();
  const me = user.publicKey;
  const { pos: myPosition, error: geoError, status: gps } = useGeolocation(true);

  // Where am I, by name (for "Your location" in the address search): one lookup per ~300 m.
  const [here, setHere] = useState(null);
  const hereAt = useRef(null);
  useEffect(() => {
    if (!myPosition) return undefined;
    const last = hereAt.current;
    if (last && haversineDistance(last.lat, last.lng, myPosition.lat, myPosition.lng) < 0.2) return undefined;
    hereAt.current = { lat: myPosition.lat, lng: myPosition.lng };
    let alive = true;
    const fallback = { name: "Current location", fullName: "Current location", area: "Near you", lat: myPosition.lat, lng: myPosition.lng };
    reverseGeocode(myPosition.lat, myPosition.lng).then((p) => alive && setHere(p || fallback)).catch(() => alive && setHere(fallback));
    return () => { alive = false; };
  }, [myPosition?.lat, myPosition?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Who is available (public presence): the couriers a new request can be sent to.
  const couriersRef = useRef([]);
  const [couriersTick, setCouriersTick] = useState(0);
  useEffect(() => subscribeCourierPresence((list) => { couriersRef.current = list; setCouriersTick((t) => t + 1); }, { excludePubkey: me }), [me]);

  // ── The delivery being planned ──
  const [draft, setDraftState] = useState(EMPTY_DRAFT);
  const setDraft = useCallback((patch) => setDraftState((d) => ({ ...d, ...patch })), []);
  const resetDraft = useCallback(() => setDraftState(EMPTY_DRAFT), []);
  const [posting, setPosting] = useState(false);

  // ── Everything else is derived from events ──
  void liveTick;
  const mine = deliveriesOf(deliveryRequests, me);
  const inbox = bidInbox(deliveryRequests, me, { blocked });
  const bidCount = inbox.reduce((n, x) => n + x.bids.length, 0);
  const running = mine.filter((r) => isRunning(deliveryStatus(r)));
  const screenMayDim = useWakeLock(running.length > 0);

  // Bids arrive over the relays: ask for news every few seconds while something is open.
  const waiting = mine.some((r) => ["requested", "assigned", "in_transit", "delivered"].includes(deliveryStatus(r)));
  useEffect(() => {
    refreshData();
    if (!waiting) return undefined;
    const id = setInterval(() => pullRecent(), 8000);
    return () => clearInterval(id);
  }, [waiting, pullRecent, refreshData]);

  // ── Post a request ──
  const post = useCallback(async () => {
    const d = draft;
    if (!d.pickup || !d.dropoff || posting) return false;
    let t = null;
    if (d.when !== "ASAP") {
      t = Date.parse(d.when);
      if (isNaN(t)) { pushNotice("Pick a valid date and time."); return false; }
      if (t < Date.now() - 60000) { pushNotice("Pick a time in the future."); return false; }
      if (t > Date.now() + 90 * 86400000) { pushNotice("A delivery can be at most 90 days ahead."); return false; }
    }
    setPosting(true);
    let miles = haversineDistance(d.pickup.lat, d.pickup.lng, d.dropoff.lat, d.dropoff.lng) * 1.3, minutes = (miles / 30) * 60; // a straight-line guess if the router is down
    try {
      const r = await getDrivingRoute([d.pickup, d.dropoff]);
      if (r) { miles = metersToMiles(r.distanceMeters); minutes = r.durationSeconds / 60; }
    } catch { /* keep the guess */ }
    const need = normalizeNeed({ required: d.cdlRequired, endorsements: d.endorsements });
    const invited = eligibleCouriers(couriersRef.current, { pickup: d.pickup, need, me, blocked }).map((x) => x.courier);
    const ev = requestEvent(user, {
      type: d.type, size: d.size, note: d.note.trim(), pickup: d.pickup, dropoff: d.dropoff, time: d.when,
      cdl: need, distanceMiles: miles, durationMin: minutes, contact: d.contact.trim(),
      hide: hideList(me, blocked),
    }, invited);
    const ok = await publish(ev.kind, ev.content, ev.tags);
    setPosting(false);
    resetDraft();
    refreshData();
    pushNotice(!ok ? "Saved here. It will be sent as soon as a relay answers." : invited.length ? `Posted. Sent to ${invited.length} courier${invited.length === 1 ? "" : "s"} near you.` : "Posted. No courier is online near the pickup yet. Keep GoGet open: couriers are invited as they come online.");
    setView("deliveries");
    return true;
  }, [draft, posting, user, me, blocked, publish, pushNotice, refreshData, resetDraft, setView]);

  // ── Invite couriers who come online later (every 20 s and when the list of available couriers changes) ──
  const inviteLatest = useRef({});
  inviteLatest.current = { mine, user, blocked, publish };
  useEffect(() => {
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const { mine: list, user: u, blocked: bl, publish: pub } = inviteLatest.current;
        for (const request of list) {
          if (deliveryStatus(request) !== "requested" || isDeliveryExpired(request)) continue;
          const ex = exactDelivery(request, u);
          if (!ex) continue;
          const add = eligibleCouriers(couriersRef.current, { pickup: ex.pickup, need: deliveryNeed(request), me: u.publicKey, blocked: bl, wrapped: deliveryInvited(request) });
          const ev = add.length ? inviteEvent(request, u, add.map((x) => x.courier)) : null;
          if (ev) await pub(ev.kind, ev.content, ev.tags);
        }
      } finally { busy = false; }
    };
    run();
    const id = setInterval(run, 20000);
    return () => clearInterval(id);
  }, [couriersTick]);

  // ── Bids ──
  // How much ecash I hold at a bid's mint, and what it takes to accept it.
  const fundsFor = useCallback((bid) => ({ have: ecash ? ecash.balance(bid.mint) : 0, need: neededToAccept(bid) }), [ecash]);
  const acceptBid = useCallback(async (request, bid) => {
    if (ecashOff || !ecash) return { ok: false, message: "Connect your ecash wallet first (Account → Ecash wallet)." };
    if (isBidExpired(bid)) return { ok: false, message: "This bid has expired. Ask the courier to bid again." };
    const { have, need } = fundsFor(bid);
    if (have < need) return { ok: false, short: need - have, message: `You need ${moneyText(need, btcPrice)} in ecash at this courier's mint. You have ${moneyText(have, btcPrice)}.` };
    const exact = exactDelivery(request, user);
    if (!exact) return { ok: false, message: "Your own copy of the addresses could not be read." };
    const [accept, version] = acceptEvents(request, user, bid, exact);
    await publish(accept.kind, accept.content, accept.tags);
    await publish(version.kind, version.content, version.tags);
    refreshData();
    pushNotice("Courier chosen. The other bids were declined.");
    return { ok: true };
  }, [ecash, ecashOff, fundsFor, user, publish, refreshData, pushNotice, btcPrice]);
  const declineBid = useCallback(async (request, bid) => {
    const ev = declineBidEvent(request, bid);
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
  }, [publish, refreshData]);
  const closeRequest = useCallback(async (request) => {
    const ev = versionEvent(request, { status: "closed" });
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
    pushNotice("Request closed. Nothing was charged.");
  }, [publish, refreshData, pushNotice]);

  // ── The handover: the courier's phone shows 4 digits, the shipper types them ──
  const [tries, setTries] = useState({}); // delivery id → { wrong, lockedUntil }
  const confirmPickup = useCallback(async (request, typed) => {
    const courier = deliveryCourier(request);
    if (!courier) return { ok: false, message: "No courier yet." };
    const gate = attemptGate(tries[request.id], Date.now());
    if (!gate.open) return { ok: false, message: `Too many wrong tries. Wait ${Math.ceil(gate.waitMs / 1000)} seconds.` };
    const ok = checkCode(typed, pickupCode(user.sk, courier, request));
    setTries((t) => ({ ...t, [request.id]: recordAttempt(tries[request.id], ok, Date.now()) }));
    if (!ok) return { ok: false, message: "That code is not right. Ask the courier to read it again." };
    const ev = confirmEvent(request, courier, "pickup", {}, user);
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
    return { ok: true };
  }, [tries, user, publish, refreshData]);
  // `verified`: "gps+photo" (the courier's proof held up) or "outside" (the shipper checked it outside of GoGet).
  const confirmDelivered = useCallback(async (request, verified = "outside") => {
    const ev = confirmEvent(request, deliveryCourier(request), "delivered", { verified }, user);
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
  }, [user, publish, refreshData]);
  const reportProblem = useCallback(async (request, note) => {
    const ev = confirmEvent(request, deliveryCourier(request), "problem", { ok: false, note }, user);
    await publish(ev.kind, ev.content, ev.tags);
    refreshData();
  }, [user, publish, refreshData]);

  // ── Pay what is due, every 3 s and when something changes ──
  const [payState, setPayState] = useState({}); // delivery id → the last payDelivery result
  const latest = useRef({});
  latest.current = { mine, user, ecash, publish };
  useEffect(() => {
    if (!ecash) return undefined;
    let alive = true, busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        const { mine: list, user: u, ecash: wallet, publish: pub } = latest.current;
        for (const request of list) {
          if (!dueNow(request)) { continue; }
          const res = await payDelivery({ request, user: u, ecash: wallet, publish: pub });
          if (alive) setPayState((s) => (s[request.id]?.status === res.status && s[request.id]?.due === res.due ? s : { ...s, [request.id]: res }));
        }
      } finally { busy = false; }
    };
    run();
    const id = setInterval(run, 3000);
    const onWake = () => run();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onWake); window.removeEventListener("online", onWake); };
  }, [ecash]);

  const value = {
    myPosition, geoError, gps, here,
    draft, setDraft, resetDraft, posting, post,
    mine, inbox, bidCount, running,
    fundsFor, acceptBid, declineBid, closeRequest,
    confirmPickup, confirmDelivered, reportProblem, tries,
    payState, screenMayDim, isBlockedPk,
  };
  return <ShipperContext.Provider value={value}>{children}</ShipperContext.Provider>;
}
