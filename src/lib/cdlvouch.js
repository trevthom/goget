// ════════════════════════════════════════════════════════════
//  CDL VOUCHES — A courier's CDL and endorsements are their own statement: nothing checks them (lib/cdl.js). A person who has SEEN
//  the license can vouch for it: "I have seen this person's CDL and these endorsements." It is the same idea as lib/vouches.js:
//  the viewer counts only people THEY chose (themself and the people in their own vouch list, one hop), so a crowd of fake
//  accounts confirming each other changes nothing on anyone's screen.
//
//  One public, addressable event per voucher and courier (kind 30111, d = "cdl-<courier>", `p` = the courier):
//     { v:1, has:true, endorsements:["H","T"] }     what the voucher confirms (a subset of the letters in lib/cdl.js)
//     { v:1, has:false, endorsements:[] }           taking the vouch back
//  The newest one of each voucher counts. A vouch for oneself is ignored. A vouch confirms only what it lists: a courier who
//  claims H and T, vouched for "H" only, shows H confirmed and T "not confirmed".
//
//    cdlVouchEvent(target, endorsements)        the event to publish (an empty list = "CDL, no endorsement"; use cdlUnvouchEvent to take back)
//    cdlVouchesFor(target)                      every voucher's newest vouch: [{ voucher, endorsements, at }] (no filter by viewer)
//    cdlTrustFor(target, me, claim)             what ME can say about this claim: { cdl: {n, direct}, endorsements: {H: {n, direct}…}, via[], direct } or null
//    cdlTrustHeadline(t, claim) / cdlTrustDetail(t, nameOf)    the words
//  Pure reads of the event cache.
// ════════════════════════════════════════════════════════════

import { relay } from "../nostr/relay.js";
import { EVENT_KINDS } from "../nostr/eventKinds.js";
import { latestVersions } from "../nostr/replaceable.js";
import { vouchList } from "./vouches.js";
import { normalizeCdl } from "./cdl.js";

const HEX64 = /^[0-9a-f]{64}$/;
const parse = (e) => { try { return JSON.parse(e.content); } catch { return null; } };
const dOf = (pk) => `cdl-${pk}`;

export function cdlVouchEvent(target, endorsements = []) {
  const c = normalizeCdl({ has: true, endorsements });
  return { kind: EVENT_KINDS.CDL_VOUCH, content: { v: 1, has: true, endorsements: c.endorsements }, tags: [["d", dOf(target)], ["p", target]] };
}
export const cdlUnvouchEvent = (target) => ({ kind: EVENT_KINDS.CDL_VOUCH, content: { v: 1, has: false, endorsements: [] }, tags: [["d", dOf(target)], ["p", target]] });

// Every voucher's newest vouch for `target` that still stands: [{ voucher, endorsements }].
export function cdlVouchesFor(target) {
  if (!HEX64.test(target || "")) return [];
  const found = relay.query({ kinds: [EVENT_KINDS.CDL_VOUCH], "#p": [target] })
    .filter((e) => e.pubkey !== target && e.tags.some((t) => t[0] === "d" && t[1] === dOf(target)));
  return latestVersions(found)
    .map((e) => ({ e, c: parse(e) }))
    .filter(({ c }) => c && c.has === true)
    .map(({ e, c }) => ({ voucher: e.pubkey, endorsements: normalizeCdl({ has: true, endorsements: c.endorsements }).endorsements, at: e.created_at }));
}

// What `me` can say about a courier's claim ({ has, endorsements } from their profile or bid). Counts only me and the people I vouch for.
// null when none of them confirmed anything (or there is no CDL claim).
export function cdlTrustFor(target, me, claim) {
  const c = normalizeCdl(claim);
  if (!target || !me || !c.has || target === me) return null;
  const trusted = new Set([me, ...vouchList(me)]);
  const vouches = cdlVouchesFor(target).filter((v) => trusted.has(v.voucher));
  if (!vouches.length) return null;
  const endorsements = {};
  for (const letter of c.endorsements) {
    const said = vouches.filter((v) => v.endorsements.includes(letter) || (["H", "N"].includes(letter) && v.endorsements.includes("X")));
    endorsements[letter] = { n: said.length, direct: said.some((v) => v.voucher === me) };
  }
  return {
    cdl: { n: vouches.length, direct: vouches.some((v) => v.voucher === me) },
    endorsements,
    via: vouches.map((v) => v.voucher).filter((p) => p !== me),
    direct: vouches.some((v) => v.voucher === me),
  };
}

// "CDL confirmed by 2 of your vouches" · "You confirmed this CDL" · "CDL and H, T confirmed by …": only the claimed endorsements that were confirmed.
export function cdlTrustHeadline(t, claim) {
  if (!t) return "";
  const c = normalizeCdl(claim);
  const done = c.endorsements.filter((l) => t.endorsements[l]?.n);
  const what = done.length ? `CDL with ${done.join(", ")}` : "CDL";
  const n = t.via.length;
  if (!n) return `You confirmed this ${what}`;
  return `${what} confirmed by ${n} of your vouches${t.direct ? " and by you" : ""}`;
}
export function cdlTrustDetail(t, nameOf) {
  if (!t || !t.via.length) return "";
  return t.via.map((p) => nameOf(p)).join(", ");
}
