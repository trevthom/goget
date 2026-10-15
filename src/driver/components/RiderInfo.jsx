// ════════════════════════════════════════════════════════════
//  RIDER INFO — How the driver sees a rider: photo, name, the vouch badge
//  (how many of the driver's vouches know and trust them) and their trip count.
//  Profile and history are pulled from relays on mount.
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { relay } from "../../nostr/relay.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import { tripCounts } from "../../lib/rides.js";
import Avatar from "../../ui/Avatar.jsx";
import VouchBadge from "../../ui/VouchBadge.jsx";

export function useRiderInfo(pubkey) {
  const { liveTick } = useApp();
  void liveTick; // re-read when the profile arrives
  useEffect(() => {
    if (!pubkey) return;
    relay.fetchProfile(pubkey);
    relay.fetchHistory(pubkey);
  }, [pubkey]);
  return {
    profile: pubkey ? getProfile(pubkey) : null,
    trips: pubkey ? tripCounts(pubkey).rides : 0,
  };
}

export default function RiderInfo({ pubkey, compact = false }) {
  const { openProfile } = useApp();
  const { profile, trips } = useRiderInfo(pubkey);
  const name = profile?.name || shortNpub(pubkey);
  return (
    <div className="flex items-center gap-3">
      <Avatar src={profile?.picture} name={name} size={compact ? 44 : 56} onClick={() => openProfile(pubkey)} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold truncate">{name}</p>
        <p className="text-sm text-neutral-500">{trips} trip{trips === 1 ? "" : "s"}</p>
        <VouchBadge pubkey={pubkey} />
      </div>
    </div>
  );
}
