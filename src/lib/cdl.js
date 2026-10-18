// ════════════════════════════════════════════════════════════
//  CDL — Commercial driver's license details in GoGet deliveries.
//  A courier says (Account → Courier details) whether they hold a CDL and which endorsements. The statement is self-declared and
//  NOT checked by anyone (the system is permissionless; there is no registry to ask). It travels in the courier's profile and on
//  every bid. A shipper may REQUIRE a CDL and some endorsements on a request; a courier who does not have them never sees it
//  (and a bid that does not meet it is ignored by the shipper's app).
//
//    ENDORSEMENTS            H hazmat · N tank · P passengers · S school bus · T double/triple trailers · X tank + hazmat
//    normalizeCdl(v)         → { has, endorsements[] }  (a courier's own statement; endorsements only count with a CDL)
//    normalizeNeed(v)        → { required, endorsements[] }  (what a request asks for; an endorsement implies a CDL)
//    meetsCdl(cdl, need)     does this courier satisfy the request? (X covers H and N, as a real X endorsement does)
//    normalizeCourier(v)     a profile's `courier` { cdl, vehicle } cleaned, or null
//    cdlText / needText      the words on screen
//  Pure.
// ════════════════════════════════════════════════════════════

export const ENDORSEMENTS = [
  { id: "H", label: "Hazardous materials" },
  { id: "N", label: "Tank vehicles" },
  { id: "P", label: "Passengers" },
  { id: "S", label: "School bus" },
  { id: "T", label: "Double / triple trailers" },
  { id: "X", label: "Tank vehicles + hazmat" },
];
const KNOWN = new Set(ENDORSEMENTS.map((e) => e.id));
const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x).toUpperCase()).filter((x) => KNOWN.has(x)))].sort();

export function normalizeCdl(v) {
  const has = !!(v && typeof v === "object" && v.has === true);
  return { has, endorsements: has ? clean(v.endorsements) : [] };
}

export function normalizeNeed(v) {
  const endorsements = clean(v && typeof v === "object" ? v.endorsements : []);
  return { required: !!(v && typeof v === "object" && v.required === true) || endorsements.length > 0, endorsements };
}

export function meetsCdl(cdl, need) {
  const n = normalizeNeed(need);
  if (!n.required) return true;
  const c = normalizeCdl(cdl);
  if (!c.has) return false;
  const have = new Set(c.endorsements);
  if (have.has("X")) { have.add("H"); have.add("N"); }
  return n.endorsements.every((e) => have.has(e));
}

export const cdlText = (cdl) => {
  const c = normalizeCdl(cdl);
  return c.has ? (c.endorsements.length ? `CDL · ${c.endorsements.join(", ")}` : "CDL") : "";
};
export const needText = (need) => {
  const n = normalizeNeed(need);
  return n.required ? (n.endorsements.length ? `CDL required · ${n.endorsements.join(", ")}` : "CDL required") : "";
};

// A courier's own details from their profile (kind 0 `courier`): { cdl, vehicle } or null. Untrusted: every field is cleaned.
export function normalizeCourier(v) {
  if (!v || typeof v !== "object") return null;
  const vehicle = typeof v.vehicle === "string" ? v.vehicle.trim().slice(0, 80) : "";
  const cdl = normalizeCdl(v.cdl);
  return cdl.has || vehicle ? { cdl, vehicle } : null;
}
