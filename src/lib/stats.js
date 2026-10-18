// ════════════════════════════════════════════════════════════
//  STATS — The plain facts shown on a person's profile (Account header, the card that opens when you tap a name).
//  Counts and miles, never stars: they are read from signed events, so anyone can check them.
//    rides      finished rides as a passenger        drives     finished rides as a taxi driver
//    carried    finished deliveries as a courier     sent       finished deliveries as a shipper
//    miles      total miles DRIVEN: the metered miles of every finished drive (lib/rides.js driveMiles)
//               plus the route miles of every delivery carried (lib/delivery.js deliveryMiles)
//  `deliveryRequests` = the latest version of each delivery request (useApp().deliveryRequests). Pure reads of the event cache.
// ════════════════════════════════════════════════════════════

import { tripCounts, driveMiles } from "./rides.js";
import { deliveryCounts, deliveryMiles } from "./delivery.js";

export function personStats(pubkey, deliveryRequests = []) {
  const trips = tripCounts(pubkey);
  const deliveries = deliveryCounts(deliveryRequests, pubkey);
  const miles = Math.round((driveMiles(pubkey) + deliveryMiles(deliveryRequests, pubkey)) * 10) / 10;
  return { rides: trips.rides, drives: trips.drives, carried: deliveries.carried, sent: deliveries.sent, miles };
}

// "12.5 mi" · "1,204 mi" (whole miles from 100 up).
export const fmtMiles = (m) => `${(m >= 100 ? Math.round(m) : Math.round(m * 10) / 10).toLocaleString("en-US")} mi`;
