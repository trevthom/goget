// ════════════════════════════════════════════════════════════
//  DRIVER STATE — Everything only the driver app needs, on top of the
//  shared useApp() state:
//    • the driver's GPS position and the online/offline switch
//    • public presence while online (so riders see the car on their map)
//    • open requests near the driver, minus the ones they declined
//    • the driver's offer waiting on a rider, and the CURRENT drive —
//      both derived from signed events, so a reload shows the same screen
//    • encrypted live location sent to the rider during a drive
//    • settings: request radius, new-request alerts
//    • the ride's MONEY: the driver's app redeems the rider's ecash ticks as they arrive, answers each
//      one, keeps the ledger of what the ride has earned and counts MISSED payments (after two the
//      driver may finish the ride)
//    • actions: acceptRequest, arrive, startTrip, finishRide, waiveFare, answerPickup, answerStop
// ════════════════════════════════════════════════════════════

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { EVENT_KINDS } from "../../nostr/eventKinds.js";
import { publishPresence, publishRideLocation, subscribeMeter } from "../../nostr/live.js";
import { useDriveOdometer } from "./useDriveOdometer.js";
import { seedDemoData } from "../../nostr/demoData.js";
import { useGeolocation } from "../../lib/useGeolocation.js";
import { useWakeLock } from "../../lib/useWakeLock.js";
import { canBeOnline } from "../../lib/gps.js";
import { isNative } from "../../lib/nativeGeo.js";
import { haversineDistance } from "../../lib/geo.js";
import { pickupEta, quoteFare, roadMiles, driveMinutes, normalizeRates, typicalSats, APP_RATES } from "../../lib/fare.js";
import { canMarkArrived } from "../../lib/arrival.js";
import { currentLedger, ledgerSummary } from "../../lib/ridemoney.js";
import { rideTerms, rideMint } from "../../lib/terms.js";
import { milesAt, missedTicks, MISSED_LIMIT } from "../../lib/ticks.js";
import { paidSats, waiverEvent } from "../../lib/payments.js";
import { waiverSplit } from "../../lib/finish.js";
import { stopReplyEvent } from "../../lib/stops.js";
import { redeemAllFor } from "../../features/payments/redeemTicks.js";
import { getMyMint } from "../../features/ecash/myMint.js";
import { isDriveReady } from "../../lib/profile.js";
import { seal } from "../../lib/privacy.js";
import { PICKUP_CHANGE_NOTE } from "../../lib/pickup.js";
import { activeDriveFor, consentedDrive, pendingOfferFor, declinedDrivers } from "../../lib/trips.js";
import { hideList, hidesMe } from "../../lib/blocks.js";
import { isRideExpired, rideEnding, rideKey, rideStatus, rideTimes, rideVersions } from "../../lib/rides.js";
import { DEFAULT_REQUEST_RADIUS_MILES, LOCATION_PING_MS } from "../../config/settings.js";
import { getSetting, setSetting } from "../../config/relays.js";
import { moneyText } from "../../ui/Money.jsx";
import { useAutoCashOut } from "../../features/ecash/useAutoCashOut.js";

const DriverContext = createContext(null);
export const useDriver = () => useContext(DriverContext);

const HOUR = 3600000;
const PRESENCE_EVERY_MS = 15000;
const LOCATION_EVERY_MS = LOCATION_PING_MS; // the rider's shared-trip pings run at the same pace (config/settings.js)
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const carLabel = (v) => (v ? [v.year, v.make, v.model].filter(Boolean).join(" ") : "");

// The price the rider offered; older requests without one get an estimate.
export function fareOf(request, usdPrice) {
  const c = parse(request) || {};
  if (c.fareSats > 0) return c.fareSats;
  const miles = roadMiles(haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng));
  return quoteFare({ miles, minutes: driveMinutes(miles) }, usdPrice).sats;
}

// What this driver typically charges for this trip, in sats (from their own rates; the app's if unset). null when
// the price of the rates' currency is not known yet.
export function typicalSatsFor(request, rates, prices) {
  const c = parse(request) || {};
  const straight = c.pickup && c.dropoff ? haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng) : 0;
  const miles = c.distanceMiles ?? roadMiles(straight);
  const minutes = c.durationMin ?? driveMinutes(miles);
  return typicalSats(rates, miles, minutes, prices);
}

// What to show a driver for a request: this driver's own estimate (the app's formula if the price is not known yet).
export function shownSats(request, rates, prices, usdPrice) {
  return typicalSatsFor(request, rates, prices) ?? fareOf(request, usdPrice);
}

export function DriverProvider({ children }) {
  const { user, rideRequests, publish, refreshData, pullRecent, pushNotice, liveTick, btcPrice, usdPrice, prices, priceFor, ecash, ecashOff, isBlockedPk, blocked } = useApp();
  const me = user.publicKey;
  const driveReady = isDriveReady(user);
  const { pos: myPosition, error: geoError, status: gps } = useGeolocation(true);
  const posRef = useRef(null);
  const gpsRef = useRef(gps);
  const blockedRef = useRef(blocked); // the riders I blocked: the public presence carries their hide tokens (lib/blocks.js)
  blockedRef.current = blocked;
  useEffect(() => { posRef.current = myPosition; }, [myPosition]);
  useEffect(() => { gpsRef.current = gps; }, [gps]);

  // ── Settings (saved on this device) ──
  const [radius, setRadiusState] = useState(() => getSetting("requestRadius", DEFAULT_REQUEST_RADIUS_MILES));
  const [alerts, setAlertsState] = useState(() => getSetting("requestAlerts", true));
  const setRadius = useCallback((v) => { setRadiusState(v); setSetting("requestRadius", v); }, []);
  const setAlerts = useCallback((v) => { setAlertsState(v); setSetting("requestAlerts", v); }, []);

  // Demo riders and requests (development builds only; never sent to relays).
  useEffect(() => { seedDemoData(); refreshData(); }, [refreshData]);

  // ── Current drive and waiting offer, from events ──
  void liveTick;
  const activeDrive = activeDriveFor(rideRequests, me);
  const pending = pendingOfferFor(me); // { offer, request } | null

  // The driver's own odometer (miles to the pickup, miles on the trip), and the distances the rider's app
  // says both screens should show (lib/meter.js: the driver's, unless the rider's differs by more than 5%).
  const odo = useDriveOdometer(activeDrive, myPosition);
  useAutoCashOut({ locked: !!activeDrive }); // cashes out by itself at the amount set in Account → Ecash wallet
  const [agreed, setAgreed] = useState(null); // { pm, tm, at }

  // ── Online / offline ──
  const [online, setOnline] = useState(false);
  // A good or an approximate GPS fix may go online (lib/gps.js canBeOnline); a stale, missing or very vague one may not.
  // A driver is paid in ecash: with the wallet disconnected from this device, nothing could be received, so GO stays off.
  const goOnline = useCallback(() => { if (driveReady && !ecashOff && canBeOnline(gpsRef.current, posRef.current)) setOnline(true); }, [driveReady, ecashOff]);
  const goOffline = useCallback(() => setOnline(false), []);
  useEffect(() => { if (!driveReady || ecashOff) setOnline(false); }, [driveReady, ecashOff]);

  // Public presence (coarsened) while online and free to take a ride.
  const visible = online && !activeDrive;
  useEffect(() => {
    if (!visible) return;
    const beat = () => {
      const p = posRef.current;
      // Never advertise a stale or very vague position (an approximate one is fine: it is rounded to ~100 m).
      if (p && canBeOnline(gpsRef.current, p)) publishPresence(user, { lat: p.lat, lng: p.lng, vehicle: carLabel(user.vehicle), rates: normalizeRates(user.rates) || undefined, hide: hideList(user.sk, blockedRef.current) });
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
    const beat = () => { if (posRef.current && gpsRef.current !== "stale") publishRideLocation(user, riderPubkey, { ...posRef.current, ...odo.milesRef.current }); };
    beat();
    const id = setInterval(beat, LOCATION_EVERY_MS);
    return () => clearInterval(id);
  }, [riderPubkey, user]);

  // The rider's app sends the distances to show. Forget them when the ride changes.
  useEffect(() => {
    setAgreed(null);
    if (!riderPubkey) return;
    return subscribeMeter(user, riderPubkey, (m) => {
      const ok = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 5000 ? x : null);
      setAgreed({ pm: ok(m.pm), tm: ok(m.tm), at: Date.now() });
    });
  }, [riderPubkey, user]);

  // In the native shell the page can be throttled in the background, so send a
  // location when each fix arrives (at most every 5 s) instead of relying on timers.
  const lastNativeSend = useRef({ ride: 0, presence: 0 });
  useEffect(() => {
    if (!isNative() || !myPosition || gps === "stale") return;
    const now = Date.now();
    if (riderPubkey && now - lastNativeSend.current.ride > 5000) {
      lastNativeSend.current.ride = now;
      publishRideLocation(user, riderPubkey, { ...myPosition, ...odo.milesRef.current });
    } else if (visible && canBeOnline(gps, myPosition) && now - lastNativeSend.current.presence > 15000) {
      lastNativeSend.current.presence = now;
      publishPresence(user, { lat: myPosition.lat, lng: myPosition.lng, vehicle: carLabel(user.vehicle), rates: normalizeRates(user.rates) || undefined, hide: hideList(user.sk, blockedRef.current) });
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
    .filter((r) => !hidesMe(parse(r)?.hide, r.pubkey, user.sk)) // the rider blocked me: this request never shows up for me
    .filter((r) => !isRideExpired(parse(r), r.created_at))
    .filter((r) => !declinedDrivers(r).has(me)) // the rider turned my offer down: it does not come back
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
      .filter((r) => parse(r)?.driverPubkey === me && !doneKeys.includes(rideKey(r)) && consentedDrive(r, me))
      .map((r) => ({ r, end: rideEnding(r) }))
      .filter(({ r, end }) => {
        if (!end || Date.now() - end.at * 1000 > 6 * HOUR) return false;
        const status = rideStatus(r);
        // The rider finishing before the ride started is news; my own finish is not.
        return status === "completed" || (status === "closed" && end.by !== me);
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
      if (ev.kind === EVENT_KINDS.RIDE_FINISH && mine) pushNotice("The rider finished the ride.");
      else if (ev.kind === EVENT_KINDS.RIDE_STOP_CHANGE && mine) pushNotice("Your rider asked to add a stop or change the destination. Open the trip to accept it or finish the ride.");
      else if (ev.kind === EVENT_KINDS.RIDE_ACCEPT && mine) pushNotice("Rider confirmed. Head to the pickup.");
      else if (ev.kind === EVENT_KINDS.RIDE_PICKUP_CHANGE && mine) pushNotice(`Your rider asked to change the pickup. Open the trip to accept or decline. ${PICKUP_CHANGE_NOTE}`);
      else if (ev.kind === EVENT_KINDS.RIDE_PAYMENT && mine && parse(ev)?.phase === "tip" && parse(ev)?.amountSats > 0) pushNotice(`A rider sent you a ${moneyText(parse(ev).amountSats, btcPrice)} tip. Thank you for the ride!`);
      else if (ev.kind === EVENT_KINDS.RIDE_REQUEST && alerts && online && !activeDrive && !isBlockedPk(ev.pubkey)) {
        const c = parse(ev);
        const p = posRef.current;
        if (c?.status === "requested" && c.pickup && p && haversineDistance(p.lat, p.lng, c.pickup.lat, c.pickup.lng) <= radius) {
          pushNotice("New ride request nearby.");
        }
      }
    });
  }, [me, pushNotice, alerts, online, activeDrive, radius, isBlockedPk, btcPrice]);

  // The ride I was waiting on went to someone else (or was closed).
  const hadPending = useRef(null);
  useEffect(() => {
    if (pending) { hadPending.current = pending.request; return; }
    const gone = hadPending.current;
    hadPending.current = null;
    if (!gone || activeDrive) return;
    // When the rider chooses ME, the accept and the in-progress request can reach this phone a moment after my offer
    // disappears: wait a little before saying the ride went away (a new drive cancels the timer through the cleanup).
    const t = setTimeout(() => {
      if (latest.current.activeDrive) return;
      pushNotice(declinedDrivers(gone).has(me) ? "The rider chose not to ride with you for that request. It is still open for other drivers." : "That ride is no longer available.");
    }, 4000);
    return () => clearTimeout(t);
  }, [pending?.request.id, !!activeDrive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The ride's money ──
  // Every few seconds: redeem the rider's ecash ticks (also for rides that already ended, because the rider
  // may pay what was missed later), answer them, and work out what the current drive has earned, what the rider
  // has paid and how many payments are MISSED. After two missed payments the driver may finish the ride.
  const milesNow = useRef(null);
  const tripMiles = agreed && Date.now() - agreed.at < 90000 && agreed.tm != null ? agreed.tm : odo.tm;
  milesNow.current = tripMiles;
  // The timer below reads the latest values through this ref, so it does not restart on every relay event.
  const latest = useRef({});
  latest.current = { rideRequests, activeDrive, user, publish, priceFor, pushNotice };
  const [driveMoney, setDriveMoney] = useState(null);
  const warned = useRef("");
  const activeKey = activeDrive ? rideKey(activeDrive) : null;
  useEffect(() => { setDriveMoney(null); }, [activeKey]);
  useEffect(() => {
    if (!ecash) return;
    let alive = true, running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const { rideRequests: reqs, activeDrive: drive, user: u, publish: pub, priceFor: price, pushNotice: notify } = latest.current;
        await redeemAllFor({ user: u, ecash, publish: pub, rideRequests: reqs });
        if (!alive || !drive) return;
        const terms = rideTerms(drive);
        const ledger = terms && rideTimes(drive).startedAt
          ? currentLedger(drive, { terms, price: price(terms.currency), nowMs: Date.now(), miles: milesNow.current, role: "driver" })
          : null;
        if (!ledger) { setDriveMoney(null); return; }
        const sum = ledgerSummary(drive, ledger);
        const missed = missedTicks(ledger, sum.paid + sum.forgiven, Date.now());
        setDriveMoney((m) => (m && m.owed === sum.owed && m.paid === sum.paid && m.missed === missed && m.outstanding === sum.outstanding ? m : { ...sum, missed, ledger, terms }));
        const key = rideKey(drive);
        if (missed >= MISSED_LIMIT && warned.current !== key + ":" + missed) {
          warned.current = key + ":" + missed;
          notify(`Your rider missed ${missed} payments. You can finish the ride.`);
        }
      } finally { running = false; }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [ecash]);
  // A new tick or reply is worth a look at once, not in 3 s: run the loop's work when relay events arrive for this driver.
  useEffect(() => {
    if (!ecash) return;
    return relay.onEvent((_id, ev) => {
      if (ev.kind !== EVENT_KINDS.RIDE_TICK) return;
      const { rideRequests: reqs, user: u, publish: pub } = latest.current;
      redeemAllFor({ user: u, ecash, publish: pub, rideRequests: reqs }).catch(() => {});
    });
  }, [ecash]);

  // ── Actions ──
  // "I'll take it": offer to drive. The offer carries this driver's rates and mint (copied: they are frozen
  // for the ride once the rider chooses it). The price in the offer is this driver's own estimate.
  const acceptRequest = useCallback(
    (request) => {
      const c = parse(request);
      const rates = normalizeRates(user.rates) || APP_RATES;
      const mint = getMyMint();
      const estimate = typicalSatsFor(request, user.rates, prices);
      const fare = estimate;
      if (!(fare > 0)) { pushNotice(`The bitcoin price for ${rates.currency} is not available yet. Try again in a moment.`); return Promise.resolve(false); }
      const miles = myPosition ? haversineDistance(myPosition.lat, myPosition.lng, c.pickup.lat, c.pickup.lng) : null;
      const demo = request.tags.some((t) => t[0] === "demo");
      const tripMi = c.distanceMiles ?? roadMiles(haversineDistance(c.pickup.lat, c.pickup.lng, c.dropoff.lat, c.dropoff.lng));
      const sent = publish(
        EVENT_KINDS.RIDE_OFFER,
        {
          priceSats: fare,
          mode: "metered", // this driver's standard fare, paid tick by tick (the price above is only an estimate)
          rates, // a copy of this driver's rates, frozen once the rider chooses this offer
          mint, // the ecash mint this driver is paid at
          tripMiles: tripMi,
          tripMinutes: c.durationMin ?? driveMinutes(tripMi),
          etaMinutes: miles == null ? 5 : pickupEta(miles),
          message: "",
          typicalSats: estimate, // this driver's own typical fare for the trip (riders see it)
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
    [publish, refreshData, myPosition, user, prices, pushNotice]
  );

  const mark = useCallback(
    (request, stage, extra = {}) => {
      // A marker is replaceable (a relay keeps only the newest), so it also carries the earlier time:
      // `at` = now, and the "riding" marker recalls when the driver arrived.
      const arrivedAt = rideTimes(request).arrivedAt;
      publish(
        EVENT_KINDS.RIDE_STAGE,
        { stage, at: Date.now(), ...(stage === "riding" && arrivedAt ? { arrivedAt } : {}), ...extra },
        [["e", request.id], ["p", request.pubkey], ["d", "stage-" + rideKey(request)], ["t", "ride-stage"]]
      );
      refreshData();
    },
    [publish, refreshData]
  );
  // Answer the rider's request to change the pickup (accepted = true / false).
  const answerPickup = useCallback(
    (request, changeId, accepted) => {
      publish(
        EVENT_KINDS.RIDE_PICKUP_REPLY,
        { changeId, accepted: !!accepted },
        [["e", request.id], ["p", request.pubkey], ["d", `pickup-reply-${changeId}`], ["t", "ride-pickup"]]
      );
      refreshData();
      pushNotice(accepted ? `New pickup accepted. Your route now goes there. ${PICKUP_CHANGE_NOTE}` : `Kept the first pickup. The rider is told. ${PICKUP_CHANGE_NOTE}`);
    },
    [publish, refreshData, pushNotice]
  );
  // "I've arrived" counts only within 150 m of the pickup on a good GPS fix (lib/arrival.js). The marker carries the
  // measured distance, so the rider's app can check it against the car's position.
  const arrive = useCallback(
    (request, pickup) => {
      const check = canMarkArrived({ pos: posRef.current, status: gpsRef.current, pickup });
      if (!check.ok) { pushNotice(check.reason); return false; }
      mark(request, "arrived", { distM: check.meters });
      return true;
    },
    [mark, pushNotice]
  );
  const startTrip = useCallback((request) => mark(request, "riding", { codes: true }), [mark]);

  // Answer the rider's ask to add a stop or change the destination. The driver's other choice is to finish the ride.
  const answerStop = useCallback(
    (request, changeId, accepted) => {
      const ev = stopReplyEvent(request, changeId, accepted);
      publish(ev.kind, ev.content, ev.tags);
      refreshData();
      pushNotice(accepted ? "Stop accepted. The rider pays your normal fare for the extra distance and time." : "You did not accept the stop. You can finish the ride, or keep driving the first trip.");
    },
    [publish, refreshData, pushNotice]
  );

  // Finish the ride (there are no cancellations, and no fees for finishing). The rider owes what the ride earned up to
  // now: the base, the miles and the minutes (the signed event carries the clock and the meter). `atDestination` =
  // the driver is at the end of the trip. `reason`: "driver" | "destination" |
  // "unpaid" (the rider missed payments) | "silence" (both phones silent: the charge runs to `cutoff`).
  const finishRide = useCallback(
    (request, { reason = "driver", atDestination = false, cutoff } = {}) => {
      const latest = rideVersions(request)[0] || request;
      const times = rideTimes(latest);
      const now = Date.now();
      const at = cutoff != null ? Math.min(now, cutoff) : now;
      const miles = cutoff != null && driveMoney?.ledger ? milesAt(driveMoney.ledger, at) : milesNow.current ?? 0;
      publish(
        EVENT_KINDS.RIDE_FINISH,
        {
          requestId: latest.id, reason, role: "driver", at, atDestination,
          ...(times.startedAt ? { miles: Math.round(miles * 100) / 100, minutes: Math.round((Math.max(0, at - times.startedAt) / 60000) * 100) / 100 } : {}),
        },
        [["e", latest.id], ["p", latest.pubkey], ["d", "finish-" + latest.id], ["t", "ride-finish"]]
      );
      refreshData();
    },
    [publish, refreshData, driveMoney]
  );

  // The driver may waive any part of the fare, any time after the ride. What the rider has not paid yet is forgiven first;
  // if more is waived, the rest is sent back as ecash (sealed to the rider). Returns true when it was sent.
  const waiveFare = useCallback(
    async (request, waiveSats, reason = "") => {
      const terms = rideTerms(request);
      const sum = ledgerSummary(request, currentLedger(request, { terms, price: terms ? priceFor(terms.currency) : null, nowMs: Date.now(), miles: null }));
      const split = waiverSplit({ outstandingSats: sum.outstanding, paidSats: paidSats(request), waiveSats });
      const forgiven = split.forgiven;
      let refund = split.refund;
      if (!forgiven && !refund) return false;
      let token = "", pay = null;
      if (refund > 0) {
        const mint = rideMint(request);
        if (!ecash || !mint) { pushNotice("Your ecash wallet is not ready, so the money cannot be sent back yet."); return false; }
        try { pay = await ecash.payUpTo(mint, refund); token = pay.token; } catch (e) { pushNotice(e.message || "Not enough ecash to send back."); return false; }
        // The mint takes a small fee for spending ecash, so the last few sats may not fit. The rider gets what was really sent.
        if (pay.sats < refund) { pushNotice(`The mint's fee left you able to send back ${moneyText(pay.sats, btcPrice)} of ${moneyText(refund, btcPrice)}.`); refund = pay.sats; }
      }
      const ev = waiverEvent(request, user, { forgivenSats: forgiven, refundSats: refund, token, reason });
      publish(ev.kind, ev.content, ev.tags).catch(() => {});
      if (pay) ecash.settle(pay.id);
      refreshData();
      return true;
    },
    [publish, refreshData, user, ecash, pushNotice, priceFor, btcPrice]
  );

  const value = {
    driveReady, myPosition, geoError, gps,
    online, goOnline, goOffline,
    radius, setRadius, alerts, setAlerts,
    open, decline, skip, skipped,
    activeDrive, pending, receipt, dismissReceipt, odo, agreed, driveMoney, tripMiles,
    acceptRequest, answerPickup, answerStop, arrive, startTrip, finishRide, waiveFare,
  };
  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
}
