// ════════════════════════════════════════════════════════════
//  MILEAGE — Total miles a person has driven or carried, counted from their own finished
//  rides (the meter at the finish; the quoted trip if there is none) and completed deliveries
//  (the quoted route). Miles are stored in miles; lib/units.js only changes how they show.
//  The total goes into the person's own profile (kind 0 `stats`) so others can read it without
//  reading job events.
// ════════════════════════════════════════════════════════════

import { rideEnding, rideStatus } from "./rides.js";

const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const tenth = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Miles of one finished ride: the meter if the finish carries it, else the trip as quoted.
export function rideMiles(request) {
  const m = Number(rideEnding(request)?.fin?.miles);
  return m > 0 ? m : Number(parse(request)?.distanceMiles) || 0;
}

// Miles of one delivery: the route as quoted in the request.
export function deliveryMiles(request) {
  return Number(parse(request)?.distanceMiles) || 0;
}

// `drives`: ride requests; `deliveries`: delivery requests. Both are the person's COMPLETED jobs
// (filter first with completedDrives / completedDeliveries, or pass requests and a pubkey).
export function milesDriven(rideRequests, pubkey, deliveryRequests = [], deliveryCourier = () => null, deliveryDone = () => false) {
  let total = 0;
  for (const r of rideRequests) if (parse(r)?.driverPubkey === pubkey && rideStatus(r) === "completed") total += rideMiles(r);
  for (const r of deliveryRequests) if (deliveryCourier(r) === pubkey && deliveryDone(r)) total += deliveryMiles(r);
  return tenth(total);
}

// What a profile may carry: { miles } rounded to a tenth, or null when there is nothing to say.
export function statsOf(profile) {
  const m = Number(profile?.stats?.miles);
  return m > 0 && m < 1e7 ? { miles: tenth(m) } : null;
}
