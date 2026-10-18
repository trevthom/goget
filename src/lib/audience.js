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
export const AUDIENCE_LIMIT = 100; // most people one request is sent to in all; more would make it heavy to send

// `people`: presence entries { pubkey, lat, lng, role?, cdl? }. `content`: the request's content (coarse pickup, cdl need).
// Presence is self-reported and anyone can make a key, so "the nearest 60" could all be fakes standing at the pickup, and no real
// driver would ever see the request. So the choice is mixed:
//   1. people the sender vouches for, or whom the sender's vouches vouch for (`trusted(pubkey)`), first, up to a third of the places;
//   2. then the nearest, up to half of what is left;
//   3. then the rest of the places, drawn AT RANDOM from everyone else within the radius.
// `limit` = how many more people this call may add (the caller subtracts those who already hold the request).
export function audienceFor(kind, content, people, { me, blocked = [], limit = AUDIENCE_LIMIT, trusted = () => false, random = Math.random } = {}) {
  const delivery = kind === EVENT_KINDS.DELIVERY_REQUEST;
  const p = content?.pickup;
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number" || limit <= 0) return [];
  const hidden = new Set((blocked || []).map((b) => (typeof b === "string" ? b : b.pubkey)));
  const radius = delivery ? AUDIENCE_MILES.delivery : AUDIENCE_MILES.ride;
  const near = (people || [])
    .filter((x) => x.pubkey !== me && !hidden.has(x.pubkey))
    .filter((x) => (delivery ? x.role === "courier" : x.role !== "courier"))
    .filter((x) => !delivery || meetsCdl(x.cdl, content.cdl))
    .map((x) => ({ pubkey: x.pubkey, miles: haversineDistance(p.lat, p.lng, x.lat, x.lng) }))
    .filter((x) => Number.isFinite(x.miles) && x.miles <= radius)
    .sort((a, b) => a.miles - b.miles);
  const out = [];
  const take = (list, n) => { for (const x of list) { if (n <= 0) break; out.push(x.pubkey); n--; } };
  const known = near.filter((x) => trusted(x.pubkey));
  take(known, Math.ceil(limit / 3));
  const rest = near.filter((x) => !out.includes(x.pubkey));
  take(rest, Math.ceil((limit - out.length) / 2));
  const pool = near.filter((x) => !out.includes(x.pubkey));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  take(pool, limit - out.length);
  return out;
}
