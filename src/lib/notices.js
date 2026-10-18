// ════════════════════════════════════════════════════════════
//  NOTICES — Notices a person must read ONCE (and say they understood), kept per account on this device
//  (`notice_<id>_<pk16>`; the settings backup, lib/backup.js, carries it to a new device, so it is once per person, not once per phone).
//    shipping   the first time someone opens the Shipping context: you are responsible for what you send; illegal or dangerous
//               goods are still illegal.
//  A notice has a `version`: when its words change in a way that matters, raise it and everyone sees it once more.
//
//    NOTICES[id] → { version, title, points[] }       noticeSeen(id, pubkey) → bool       markNoticeSeen(id, pubkey)
// ════════════════════════════════════════════════════════════

import { getSetting, setSetting } from "../config/relays.js";

export const NOTICES = {
  shipping: {
    version: 1,
    title: "Before you ship",
    points: [
      "You are responsible for what you send.",
      "Illegal or dangerous goods are still illegal. GoGet does not make them legal. Do not send drugs, weapons, stolen goods, explosives, or anything else the law forbids.",
      "GoGet cannot look inside a parcel or check what it holds. Tell the courier the truth about it. For hazardous goods, use a courier who holds the right CDL endorsement.",
      "A courier may refuse a parcel. GoGet does not insure what you send.",
    ],
  },
};

const key = (id, pubkey) => `notice_${id}_${String(pubkey).slice(0, 16)}`;

export function noticeSeen(id, pubkey) {
  const n = NOTICES[id];
  if (!n || !pubkey) return true; // no such notice, no account: nothing to show
  const v = getSetting(key(id, pubkey), null);
  return !!v && typeof v === "object" && v.version >= n.version;
}

export function markNoticeSeen(id, pubkey, at = Date.now()) {
  const n = NOTICES[id];
  if (!n || !pubkey) return;
  setSetting(key(id, pubkey), { version: n.version, at });
}
