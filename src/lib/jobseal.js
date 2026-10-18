// ════════════════════════════════════════════════════════════
//  JOB SEAL — How the public part of a delivery request is hidden from relays while the right couriers can still read it.
//  Relays are public: everything on them can be read. So a request holds NO readable detail. It holds:
//    box    the job (what, size, note, the coarse places, the time, the CDL need, the distance), encrypted with a one-time JOB KEY
//    wraps  the job key, sealed (NIP-44) one by one to each person who may read it: the shipper (their own copy) and every courier the
//           shipper's app INVITED (couriers that were online near the pickup, meeting the CDL need, see lib/couriers.js)
//  A courier opens their wrap with their own key, gets the job key, opens the box. Everyone else (relays, other couriers) sees a block of noise,
//  who was invited (the `p` tags) and how big it is. The exact addresses and the contact note are NOT in the box: they are sealed to the
//  shipper, and again to the ONE courier chosen (lib/delivery.js exactDelivery).
//
//    newJobKey()                      a fresh random job key (hex)
//    sealBox(key, job) / openBox(key, text)    encrypt / decrypt the job (openBox → null when it is not readable)
//    wrapKey(sk, toPubkey, key) / unwrapKey(sk, fromPubkey, wrap)   the key sealed to one person / opened by them
//  Pure (no network).
// ════════════════════════════════════════════════════════════

import { nip44, generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { seal, unseal } from "./privacy.js";

const HEX64 = /^[0-9a-f]{64}$/;

export const newJobKey = () => bytesToHex(generateSecretKey());

// The box is encrypted to the job key's own public key: only a holder of the key can derive the conversation key.
const boxKey = (key) => { const sk = hexToBytes(key); return nip44.getConversationKey(sk, getPublicKey(sk)); };

export const sealBox = (key, job) => nip44.encrypt(JSON.stringify(job), boxKey(key));

const opened = new Map(); // "key:text" → job (a screen re-reads the same box on every render)
export function openBox(key, text) {
  if (!HEX64.test(key || "") || typeof text !== "string") return null;
  const id = key + ":" + text;
  if (opened.has(id)) return opened.get(id);
  let job = null;
  try { const v = JSON.parse(nip44.decrypt(text, boxKey(key))); job = v && typeof v === "object" ? v : null; } catch { /* not this key */ }
  if (opened.size > 500) opened.clear();
  opened.set(id, job);
  return job;
}

export const wrapKey = (sk, toPubkey, key) => seal(sk, toPubkey, { k: key });
export function unwrapKey(sk, fromPubkey, wrap) {
  const v = unseal(sk, fromPubkey, wrap);
  return v && HEX64.test(v.k || "") ? v.k : null;
}
