// ════════════════════════════════════════════════════════════
//  RELAY CONFIG — The single source of truth for which Nostr relays
//  the app talks to. Saved to the browser (localStorage) so changes
//  persist across navigation and reloads, and broadcast to listeners
//  (relay.js, live.js) so they can re-connect immediately.
//
//  Edit DEFAULT_RELAYS to change the out-of-the-box list.
// ════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
];

const RELAY_KEY = "nostrride_relays";
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(RELAY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_RELAYS.slice();
}

let current = typeof window !== "undefined" ? load() : DEFAULT_RELAYS.slice();

export function getRelays() {
  return current;
}

export function setRelays(list, at = Date.now()) {
  current = list.slice();
  try {
    localStorage.setItem(RELAY_KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  touchSetting("relays", at);
  listeners.forEach((fn) => { try { fn(current); } catch { /* ignore */ } });
}

// Re-open every relay subscription (after the network came back, or the tab woke up).
export function reconnectAll() {
  listeners.forEach((fn) => { try { fn(current); } catch { /* ignore */ } });
}

export function onRelaysChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React hook: returns the current relay list and re-renders on change.
export function useRelays() {
  const [list, setList] = useState(getRelays());
  useEffect(() => onRelaysChange(setList), []);
  return list;
}

// ── When was each setting last changed on this device? ──
// The settings backup (lib/backup.js) merges two devices key by key: the newer change wins. So every write is stamped
// (one small map, `nostrride__changed`); a value that was never stamped counts as "changed at 0".
const CHANGED_KEY = "nostrride__changed";
function readChanged() {
  try { const m = JSON.parse(localStorage.getItem(CHANGED_KEY) || "{}"); return m && typeof m === "object" ? m : {}; } catch { return {}; }
}
export const settingChangedAt = (key) => Number(readChanged()[key]) || 0;
export function touchSetting(key, at = Date.now()) {
  try {
    const m = readChanged();
    m[key] = at;
    localStorage.setItem(CHANGED_KEY, JSON.stringify(m));
  } catch { /* ignore */ }
}

// ── Tiny generic settings persistence (e.g. driver notify prefs) ──
export function getSetting(key, fallback) {
  try {
    const raw = localStorage.getItem("nostrride_" + key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return fallback;
}

export function setSetting(key, value, at = Date.now()) {
  try {
    localStorage.setItem("nostrride_" + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  touchSetting(key, at);
}
