// ════════════════════════════════════════════════════════════
//  BACKUP — What a person keeps on the account itself, so a new phone has it too: the block list, the settings, the notices already
//  read, and the list of people they vouch for. It is one addressable event (kind 30112, d = "backup") whose content is encrypted to
//  the person's OWN key (NIP-44 to themself), so only someone holding the nsec can read it: tied to the nsec, invisible to relays.
//
//  What goes in (inBackup): a fixed list of setting keys, plus the per-account keys for THIS account (the chosen role, automatic cash out,
//  the notices read). What never goes in: the ecash wallet (it has its own recovery phrase), the secret key, ride or delivery state,
//  caches, prices. Each setting carries the time it was last changed on a device; two devices merge KEY BY KEY, the newer change wins
//  (planRestore). A key a device never changed counts as time 0, so it never beats a stamped one, and a tie keeps what the device has.
//
//    inBackup(key, pubkey)            is this setting part of the backup?
//    cleanValue(key, value)           the value if it has the right shape, else undefined (a damaged backup cannot break a setting)
//    collectBackup({…})               the payload to seal: { v, at, settings: { key: { value, at } }, vouches }
//    backupHash(payload)              a short fingerprint that ignores `at`: "did anything change since the last upload?"
//    planRestore(payload, local, pk)  what to write on this device: { set: [{ key, value, at }], vouches: [pubkey…] }
//  Pure. (nostr/backupSync.js reads and writes the real storage and the relays.)
// ════════════════════════════════════════════════════════════

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isCurrency } from "./currency.js";
import { isMintUrl } from "./mints.js";
import { isContext } from "./contexts.js";

export const BACKUP_VERSION = 1;
export const MAX_BACKUP_CHARS = 90000; // relays refuse big events; the sealed text is ~4/3 of this
const HEX64 = /^[0-9a-f]{64}$/;

// Setting keys every account has, and the key families that carry the account's own 16-character key id at the end.
const EXACT = ["blocked", "genderPref", "requestAlerts", "requestRadius", "courierRadius", "currency", "amountUnit", "trustedContacts", "ecashMint", "dark", "relays"];
const PER_ACCOUNT = ["autoCashOut_", "goget_context_", "notice_"];
const id16 = (pubkey) => String(pubkey || "").slice(0, 16);

export function inBackup(key, pubkey) {
  if (typeof key !== "string") return false;
  if (EXACT.includes(key)) return true;
  const mine = id16(pubkey);
  return !!mine && PER_ACCOUNT.some((p) => key.startsWith(p)) && key.endsWith("_" + mine);
}

const isNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

// A value of the right shape, cleaned; undefined when it is not usable.
export function cleanValue(key, v) {
  switch (true) {
    case key === "blocked": {
      if (!Array.isArray(v)) return undefined;
      return v.filter((b) => b && HEX64.test(b.pubkey || "")).slice(-500).map((b) => ({ pubkey: b.pubkey, name: text(b.name, 60), at: isNum(b.at, 0, 4e12) ? b.at : 0 }));
    }
    case key === "genderPref": return v === "" || v === "male" || v === "female" ? v : undefined;
    case key === "requestAlerts" || key === "dark": return typeof v === "boolean" ? v : undefined;
    case key === "requestRadius" || key === "courierRadius": return isNum(v, 1, 1000) ? v : undefined;
    case key === "currency": return isCurrency(v) ? v : undefined;
    case key === "amountUnit": return v === "fiat" || v === "sats" ? v : undefined;
    case key === "trustedContacts": {
      if (!Array.isArray(v)) return undefined;
      return v.filter((c) => c && typeof c.name === "string" && typeof c.phone === "string").slice(0, 10).map((c) => ({ name: text(c.name, 40), phone: text(c.phone, 24) }));
    }
    case key === "ecashMint": return isMintUrl(v) ? v : undefined;
    case key === "relays": return Array.isArray(v) && v.length && v.length <= 20 && v.every((u) => typeof u === "string" && /^wss?:\/\/[^\s]+$/.test(u) && u.length < 200) ? v : undefined;
    case key.startsWith("autoCashOut_"): return v === null ? null : v && isNum(Number(v.amount), 0.000001, 1e6) && isCurrency(v.code) ? { amount: Number(v.amount), code: v.code } : undefined;
    case key.startsWith("goget_context_"): return isContext(v) ? v : undefined;
    case key.startsWith("notice_"): return v && isNum(v.version, 0, 1e6) ? { version: v.version, at: isNum(v.at, 0, 4e12) ? v.at : 0 } : undefined;
    default: return undefined;
  }
}

// Build the payload. `read(key)` = the value on this device, `changedAt(key)` = when it last changed here (0 = never stamped),
// `keys` = the setting keys present on this device, `vouches` = the people I vouch for.
export function collectBackup({ pubkey, keys, read, changedAt, vouches = [], now = Date.now() }) {
  const settings = {};
  for (const key of [...new Set(keys)].sort()) {
    if (!inBackup(key, pubkey)) continue;
    const value = cleanValue(key, read(key));
    if (value === undefined) continue;
    settings[key] = { value, at: changedAt(key) || 0 };
  }
  const payload = { v: BACKUP_VERSION, at: now, settings, vouches: [...new Set(vouches.filter((p) => HEX64.test(p)))].slice(0, 100) };
  return fitBackup(payload);
}

// Keep the payload under the size limit: first shorten the names on the block list, then drop the oldest blocks.
export function fitBackup(payload) {
  const size = (p) => JSON.stringify(p).length;
  if (size(payload) <= MAX_BACKUP_CHARS) return payload;
  const b = payload.settings.blocked;
  if (!b) return payload;
  let list = b.value.map((x) => ({ ...x, name: "" }));
  while (list.length && size({ ...payload, settings: { ...payload.settings, blocked: { ...b, value: list } } }) > MAX_BACKUP_CHARS) list = list.slice(1);
  return { ...payload, settings: { ...payload.settings, blocked: { ...b, value: list } } };
}

// A fingerprint of what the backup holds (not of when it was made).
export function backupHash(payload) {
  const settings = Object.keys(payload.settings || {}).sort().map((k) => [k, payload.settings[k].value, payload.settings[k].at]);
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify([payload.v, settings, payload.vouches || []])))).slice(0, 24);
}

// A payload read from the relays, cleaned: only known keys of this account, only values of the right shape.
export function readPayload(raw, pubkey) {
  if (!raw || typeof raw !== "object" || raw.v !== BACKUP_VERSION || !raw.settings || typeof raw.settings !== "object") return null;
  const settings = {};
  for (const [key, entry] of Object.entries(raw.settings)) {
    if (!inBackup(key, pubkey) || !entry || typeof entry !== "object") continue;
    const value = cleanValue(key, entry.value);
    if (value !== undefined) settings[key] = { value, at: isNum(entry.at, 0, 4e12) ? entry.at : 0 };
  }
  const vouches = Array.isArray(raw.vouches) ? [...new Set(raw.vouches.filter((p) => typeof p === "string" && HEX64.test(p)))].slice(0, 100) : [];
  return { v: BACKUP_VERSION, at: isNum(raw.at, 0, 4e12) ? raw.at : 0, settings, vouches };
}

// What to write on THIS device. `local` = { has(key), changedAt(key) }. A key is taken from the backup when this device does not have it, or when the
// backup's change is NEWER than this device's. A tie, or a newer local change, keeps the local value.
export function planRestore(payload, local, pubkey) {
  const set = [];
  for (const [key, { value, at }] of Object.entries(payload.settings || {})) {
    if (!inBackup(key, pubkey)) continue;
    if (!local.has(key) || at > local.changedAt(key)) set.push({ key, value, at });
  }
  return { set, vouches: payload.vouches || [] };
}
