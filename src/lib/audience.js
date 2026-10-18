// ════════════════════════════════════════════════════════════
//  AUDIENCE — Who gets a copy of a new request. A request is sealed (nostr/sealing.js), so it
//  reaches only people we choose: the online drivers (for a ride) or couriers (for a delivery) near
//  the pickup. A courier who does not meet the CDL need is left out, a person we blocked is left
//  out, and a person who blocked us is not in the presence list at all (presence hides itself).
//  Pure: the caller passes the presence list. A driver who comes online later gets the request
//  when the shipper's or rider's app next sees them (AudienceSync).
// ════════════════════════════════════════════════════════════

import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { haversineDistance } from "./geo.js";
import { meetsCdl } from "./cdl.js";

export const AUDIENCE_MILES = { ride: 100, delivery: 200 }; // the widest radius a driver / courier can set
export const AUDIENCE_LIMIT = 60; // nearest first; more would make a request heavy to send

// `people`: presence entries { pubkey, lat, lng, role?, cdl? }. `content`: the request's content (coarse pickup, cdl need).
export function audienceFor(kind, content, people, { me, blocked = [], limit = AUDIENCE_LIMIT } = {}) {
  const delivery = kind === EVENT_KINDS.DELIVERY_REQUEST;
  const p = content?.pickup;
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number") return [];
  const hidden = new Set((blocked || []).map((b) => (typeof b === "string" ? b : b.pubkey)));
  return (people || [])
    .filter((x) => x.pubkey !== me && !hidden.has(x.pubkey))
    .filter((x) => (delivery ? x.role === "courier" : x.role !== "courier"))
    .filter((x) => !delivery || meetsCdl(x.cdl, content.cdl))
    .map((x) => ({ pubkey: x.pubkey, miles: haversineDistance(p.lat, p.lng, x.lat, x.lng) }))
    .filter((x) => x.miles <= (delivery ? AUDIENCE_MILES.delivery : AUDIENCE_MILES.ride))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, limit)
    .map((x) => x.pubkey);
}
