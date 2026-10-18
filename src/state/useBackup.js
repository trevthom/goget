// ════════════════════════════════════════════════════════════
//  useBackup — Keeps the person's encrypted backup (nostr/backupSync.js, lib/backup.js) and this device in step. While logged in:
//    at login        download the newest backup from the relays; write what is newer than this device (the block list, settings, the chosen role,
//                    the vouch list when the account has none), say so in a notice; THE FIRST TIME ONLY, remount the role screens so state they read
//                    at start-up follows (later changes reach the screen live where they can: blocks, dark mode, currency, relays)
//    every 20 s      upload if anything changed (never before a reliable download: an offline phone must not overwrite a good backup)
//    every 5 min     download again (another device changed something)
//  It runs in AppProvider; screens do not call it.
// ════════════════════════════════════════════════════════════

import { useEffect, useRef } from "react";
import { downloadBackup, restoreFrom, uploadIfChanged } from "../nostr/backupSync.js";
import { setSetting, setRelays, touchSetting } from "../config/relays.js";
import { setDark } from "../lib/appearance.js";
import { setCurrency } from "../lib/currency.js";
import { setContextChoice } from "../lib/contexts.js";
import { vouchEvent } from "../lib/vouches.js";

const UPLOAD_EVERY_MS = 20000;
const DOWNLOAD_EVERY_MS = 5 * 60000;

export function useBackup({ user, publish, refreshVouches, setBlocked, pushNotice, bumpEpoch }) {
  const latest = useRef({});
  latest.current = { user, publish, refreshVouches, setBlocked, pushNotice, bumpEpoch };
  const pk = user?.publicKey;

  useEffect(() => {
    if (!pk) return undefined;
    let alive = true, reliable = false, first = true;

    // Write one restored setting the way the app does, so what is on screen follows; then keep the backup's own change time.
    const apply = (key, value, at) => {
      const { setBlocked: setB } = latest.current;
      if (key === "blocked") { setSetting(key, value, at); setB(value); }
      else if (key === "dark") setDark(value);
      else if (key === "currency") setCurrency(value);
      else if (key === "relays") setRelays(value, at);
      else if (key.startsWith("goget_context_")) setContextChoice(pk, value);
      else setSetting(key, value, at);
      touchSetting(key, at);
    };

    const sync = async () => {
      const { user: u } = latest.current;
      const r = await downloadBackup(u);
      if (!alive) return;
      if (r.payload) {
        await latest.current.refreshVouches(); // an existing public vouch list is known before deciding to restore one
        if (!alive) return;
        const res = await restoreFrom(r.payload, u, {
          apply,
          publishVouches: async (list) => { const ev = vouchEvent(list); await latest.current.publish(ev.kind, ev.content, ev.tags); await latest.current.refreshVouches(); },
        });
        if (res.changed.length || res.vouches) {
          if (first) latest.current.bumpEpoch();
          latest.current.pushNotice("Your blocks and settings were restored from your backup.");
        }
      }
      if (r.reliable) reliable = true;
      first = false;
    };
    const upload = async () => {
      if (!reliable || !alive) return;
      try { await uploadIfChanged(latest.current.user, latest.current.publish); } catch { /* try again in a moment */ }
    };

    sync().then(upload).catch(() => {});
    const a = setInterval(upload, UPLOAD_EVERY_MS);
    const b = setInterval(() => sync().then(upload).catch(() => {}), DOWNLOAD_EVERY_MS);
    return () => { alive = false; clearInterval(a); clearInterval(b); };
  }, [pk]);
}
