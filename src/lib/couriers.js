// ════════════════════════════════════════════════════════════
//  COURIERS — Who is available to carry a parcel, and who should be INVITED to a delivery request.
//  A delivery request is encrypted (lib/jobseal.js), so couriers cannot browse it on a relay. Instead a courier who is available publishes
//  PRESENCE (public, like a taxi driver's: a coarse place ~1 km, how far they will go, their CDL statement; it expires in 3 minutes), and
//  the shipper's app invites the couriers that fit: online, the pickup inside the courier's own distance, meeting the CDL need, not blocked
//  either way. The invitation is the job key sealed to that courier.
//
//    readPresence(event) → { pubkey, lat, lng, radiusMiles, cdl, hide, ts } | null     one presence beat, checked
//    eligibleCouriers(list, { pickup, need, me, blocked, wrapped, now, limit }) → [{ courier, miles }]   nearest first
//  Pure.
// ════════════════════════════════════════════════════════════

import { haversineDistance } from "./geo.js";
import { normalizeCdl, meetsCdl } from "./cdl.js";
import { hidesMe } from "./blocks.js";

export const COURIER_PRESENCE_TTL_MS = 5 * 60000; // a courier is "gone" when silent this long (beats come every 90 s)
export const MAX_INVITES = 50; // wraps per request: keeps the event small enough for a relay
const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// `content` = the parsed presence content (untrusted).
export function readPresence(pubkey, content) {
  if (!content || typeof content !== "object") return null;
  const lat = num(content.lat, -90, 90), lng = num(content.lng, -180, 180);
  if (lat == null || lng == null) return null;
  return {
    pubkey, lat, lng,
    radiusMiles: num(content.radiusMiles, 1, 1000) ?? 25,
    cdl: normalizeCdl(content.cdl),
    hide: Array.isArray(content.hide) ? content.hide.filter((t) => typeof t === "string").slice(0, 100) : [],
    ts: num(content.ts, 0, 4e12) ?? 0,
  };
}

// The couriers to invite, nearest first. `pickup` = the shipper's own exact pickup. A courier is skipped when: they are me, I blocked them,
// they blocked me (their hide tokens name me), their beat is old, the pickup is outside THEIR distance, they do not meet the CDL need, or
// they are already invited (`wrapped`, a Set of pubkeys).
export function eligibleCouriers(list, { pickup, need, me, blocked = [], wrapped = new Set(), now = Date.now(), limit = MAX_INVITES } = {}) {
  if (!pickup) return [];
  const mine = new Set(blocked.map((b) => b.pubkey));
  return list
    .filter((p) => p.pubkey !== me && !mine.has(p.pubkey) && !wrapped.has(p.pubkey) && now - p.ts <= COURIER_PRESENCE_TTL_MS && !hidesMe(p.hide, p.pubkey, me))
    .map((p) => ({ courier: p.pubkey, miles: haversineDistance(p.lat, p.lng, pickup.lat, pickup.lng), p }))
    .filter(({ miles, p }) => miles <= p.radiusMiles && meetsCdl(p.cdl, need))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, Math.max(0, limit))
    .map(({ courier, miles }) => ({ courier, miles }));
}
