// ════════════════════════════════════════════════════════════
//  COURIER SECTION — Account → Courier details (GoGet, Courier role): "I have a CDL" and the endorsements held, and what the courier
//  drives. Saved in the profile (kind 0 `courier`) and copied onto every bid, so the shipper sees it. It is the courier's own
//  statement: nothing checks it (there is no registry in a permissionless system). A shipper may REQUIRE a CDL and endorsements; a
//  courier without them does not see that request at all (lib/cdl.js).
// ════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useSaveProfile } from "./ProfileParts.jsx";
import { normalizeCdl, cdlText } from "../../lib/cdl.js";
import { cdlVouchesFor } from "../../lib/cdlvouch.js";
import { getProfile } from "../../nostr/profiles.js";
import { shortNpub } from "../../nostr/keys.js";
import EndorsementChips from "../goget/EndorsementChips.jsx";
import Button from "../../ui/Button.jsx";
import { inputCls } from "../../ui/Parts.jsx";

export default function CourierSection({ locked = false }) {
  const { user, liveTick } = useApp();
  void liveTick; // vouches arrive from the relays
  const save = useSaveProfile();
  const saved = user.courier || {};
  const [has, setHas] = useState(!!saved.cdl?.has);
  const [endorsements, setEndorsements] = useState(saved.cdl?.endorsements || []);
  const [vehicle, setVehicle] = useState(saved.vehicle || "");
  const [done, setDone] = useState(false);
  useEffect(() => { setHas(!!user.courier?.cdl?.has); setEndorsements(user.courier?.cdl?.endorsements || []); setVehicle(user.courier?.vehicle || ""); }, [user.courier]);

  const draft = { cdl: normalizeCdl({ has, endorsements }), vehicle: vehicle.trim().slice(0, 80) };
  const changed = JSON.stringify(draft) !== JSON.stringify({ cdl: normalizeCdl(saved.cdl), vehicle: saved.vehicle || "" });
  const onSave = () => {
    save({ courier: draft.cdl.has || draft.vehicle ? draft : null });
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={has} disabled={locked} onChange={(e) => { setHas(e.target.checked); if (!e.target.checked) setEndorsements([]); }} className="w-5 h-5 accent-black" aria-label="I have a CDL" />
          <span className="font-medium text-[15px]">I have a CDL (commercial driver's license)</span>
        </label>
        {has && (
          <div className="mt-3">
            <p className="text-sm text-neutral-500 mb-2">Tap the endorsements you hold.</p>
            <EndorsementChips value={endorsements} onChange={setEndorsements} disabled={locked} />
          </div>
        )}
        {has && (() => {
          const vouchers = cdlVouchesFor(user.publicKey);
          return (
            <p className="text-xs text-neutral-600 mt-2" data-testid="cdl-vouchers">
              {vouchers.length ? `Vouched by ${vouchers.map((v) => `${getProfile(v.voucher)?.name || shortNpub(v.voucher)} (${v.endorsements.join(", ") || "CDL"})`).join(", ")}.` : "No one has vouched for your CDL yet. Someone who has seen it can vouch from your profile card."}
            </p>
          );
        })()}
        <p className="text-xs text-neutral-500 mt-2">
          This shows on every bid you send{has ? `: “${cdlText(draft.cdl)}”` : ""}. It is your own statement. Shippers who need a CDL or an endorsement you do not list will not see their request.
        </p>
      </div>
      <div>
        <p className="font-medium text-[15px]">What do you drive?</p>
        <input aria-label="What you drive" value={vehicle} maxLength={80} disabled={locked} onChange={(e) => setVehicle(e.target.value)} placeholder="Cargo van · 16 ft box truck with lift gate" className={`${inputCls} mt-1`} />
        <p className="text-xs text-neutral-500 mt-1">Also shown on your bids, so a shipper knows what will arrive.</p>
      </div>
      <Button size="md" onClick={onSave} disabled={!changed || locked}>{done ? "Saved" : "Save courier details"}</Button>
      {locked && <p className="text-xs text-neutral-500">Locked while a delivery is running.</p>}
    </div>
  );
}
