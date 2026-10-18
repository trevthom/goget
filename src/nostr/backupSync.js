// ════════════════════════════════════════════════════════════
//  BACKUP SYNC — Reads and writes the person's encrypted backup (lib/backup.js) on the relays and on this device.
//    uploadIfChanged(user, publish)   collect what this device holds; if it differs from the last upload, publish it (sealed to the person's own key)
//    downloadBackup(user)             ask the relays for the newest backup; { reliable, payload }  (reliable = a relay was connected and answered)
//    restoreFrom(payload, user, hooks)  write what is newer than this device's copy, tell the app (hooks) so the screen follows; returns what changed
//  Safety rules: nothing is uploaded before a RELIABLE download this session (a phone that could not reach the relays must never overwrite a
//  full backup with an empty one); the secret key and the ecash wallet are never part of it; the backup is sealed with NIP-44 to the account's
//  own key, so a relay sees only a blob and its size.
// ════════════════════════════════════════════════════════════

import { relay } from "./relay.js";
import { getRelays, getSetting, settingChangedAt } from "../config/relays.js";
import { EVENT_KINDS, APP_TAG } from "./eventKinds.js";
import { seal, unseal } from "../lib/privacy.js";
import { collectBackup, backupHash, planRestore, readPayload, inBackup } from "../lib/backup.js";
import { vouchList, vouchEvent } from "../lib/vouches.js";
import { latestVersions } from "./replaceable.js";

const PREFIX = "nostrride_";
const hashKey = (pk) => `${PREFIX}_backup_${String(pk).slice(0, 16)}`; // the fingerprint of the last upload (device-local, not part of the backup)

// The setting keys on this device (without the app prefix). "relays" is stored under the same prefix.
function localKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && !k.startsWith(PREFIX + "_")) out.push(k.slice(PREFIX.length));
    }
  } catch { /* no storage */ }
  return out;
}
const hasKey = (key) => { try { return localStorage.getItem(PREFIX + key) != null; } catch { return false; } };

export function currentBackup(user, now = Date.now()) {
  return collectBackup({ pubkey: user.publicKey, keys: localKeys(), read: (k) => getSetting(k, undefined), changedAt: settingChangedAt, vouches: vouchList(user.publicKey), now });
}

export const backupEvent = (user, payload) => ({
  kind: EVENT_KINDS.SETTINGS_BACKUP,
  content: { v: 1, sealed: seal(user.sk, user.publicKey, payload) },
  tags: [["d", "backup"]],
});

// The newest backup of this person in the cache, opened and cleaned (null if none, or it is not readable with this key).
export function cachedBackup(user) {
  const events = latestVersions(relay.query({ kinds: [EVENT_KINDS.SETTINGS_BACKUP], authors: [user.publicKey] }))
    .filter((e) => e.tags.some((t) => t[0] === "d" && t[1] === "backup"))
    .sort((a, b) => b.created_at - a.created_at);
  for (const e of events) {
    let c = null;
    try { c = JSON.parse(e.content); } catch { /* skip */ }
    const payload = readPayload(c && unseal(user.sk, user.publicKey, c.sealed), user.publicKey);
    if (payload) return payload;
  }
  return null;
}

export async function downloadBackup(user) {
  let events = null;
  try {
    events = await relay.pool.querySync(getRelays(), { kinds: [EVENT_KINDS.SETTINGS_BACKUP], authors: [user.publicKey], "#d": ["backup"], "#t": [APP_TAG] });
  } catch { events = null; }
  (events || []).forEach((e) => relay.ingest(e));
  return { reliable: events != null && relay.linkUp(), payload: cachedBackup(user) };
}

// Upload when something changed since the last upload. Returns "sent" | "same" | "empty".
export async function uploadIfChanged(user, publish) {
  const payload = currentBackup(user);
  if (!Object.keys(payload.settings).length && !payload.vouches.length) return "empty";
  const hash = backupHash(payload);
  let last = null;
  try { last = localStorage.getItem(hashKey(user.publicKey)); } catch { /* no storage */ }
  if (last === hash) return "same";
  const ev = backupEvent(user, payload);
  await publish(ev.kind, ev.content, ev.tags); // the cache has it at once; a relay that is down gets it from the outbox
  try { localStorage.setItem(hashKey(user.publicKey), hash); } catch { /* no storage */ }
  return "sent";
}

// Write what the backup has that is newer than this device. `hooks.apply(key, value, at)` writes one setting the way the app does (so live
// state follows, e.g. the block list on screen); `hooks.publishVouches(list)` re-publishes the public vouch list when this account has none.
// Returns { changed: [keys], vouches: bool }.
export async function restoreFrom(payload, user, hooks) {
  const plan = planRestore(payload, { has: hasKey, changedAt: settingChangedAt }, user.publicKey);
  const changed = [];
  for (const { key, value, at } of plan.set) {
    if (!inBackup(key, user.publicKey)) continue;
    hooks.apply(key, value, at);
    changed.push(key);
  }
  let vouches = false;
  if (plan.vouches.length && vouchList(user.publicKey).length === 0 && hooks.publishVouches) {
    await hooks.publishVouches(plan.vouches);
    vouches = true;
  }
  // If this device now holds exactly what the backup holds, nothing needs uploading; if it also holds things the backup lacks, the next upload sends them.
  if (changed.length || vouches) {
    try {
      const same = backupHash(currentBackup(user)) === backupHash(payload);
      if (same) localStorage.setItem(hashKey(user.publicKey), backupHash(payload)); else localStorage.removeItem(hashKey(user.publicKey));
    } catch { /* no storage */ }
  }
  return { changed, vouches };
}

export { vouchEvent };
