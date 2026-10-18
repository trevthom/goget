// ════════════════════════════════════════════════════════════
//  CDL BADGE — A courier's CDL statement ("CDL · H, T") and what the VIEWER's own vouches say about it (lib/cdlvouch.js):
//  "CDL with H confirmed by 2 of your vouches". The statement is the courier's own and nothing checks it; a vouch means
//  "I have seen this license". With `canVouch` the badge also offers "I have seen this CDL": pick the endorsements you saw,
//  confirm (one public event), or take your vouch back. Nothing is drawn for a courier who says they have no CDL.
//
//    <CdlBadge pubkey={hex} claim={{ has, endorsements }} canVouch? />
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { getProfile } from "../nostr/profiles.js";
import { shortNpub } from "../nostr/keys.js";
import { cdlText, normalizeCdl } from "../lib/cdl.js";
import { cdlTrustFor, cdlTrustHeadline, cdlTrustDetail, cdlVouchEvent, cdlUnvouchEvent, cdlVouchesFor } from "../lib/cdlvouch.js";
import EndorsementChips from "../features/goget/EndorsementChips.jsx";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";

export default function CdlBadge({ pubkey, claim, canVouch = false }) {
  const { user, publish, refreshVouches, liveTick } = useApp();
  const c = normalizeCdl(claim);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(c.endorsements);
  const [busy, setBusy] = useState(false);
  void liveTick; // the vouches arrive from the relays after the card is shown
  if (!c.has || !pubkey) return null;
  const me = user?.publicKey;
  const trust = me ? cdlTrustFor(pubkey, me, c) : null;
  const mine = me ? cdlVouchesFor(pubkey).find((v) => v.voucher === me) : null;
  const nameOf = (p) => getProfile(p)?.name || shortNpub(p);
  const detail = cdlTrustDetail(trust, nameOf);
  const may = canVouch && me && pubkey !== me;

  const send = async (ev) => {
    setBusy(true);
    await publish(ev.kind, ev.content, ev.tags);
    await refreshVouches();
    setBusy(false);
    setOpen(false);
  };

  return (
    <div className="mt-2" data-testid="cdl-badge">
      <p className="inline-flex flex-wrap items-center gap-1.5 rounded-full bg-neutral-100 text-xs font-semibold px-2.5 py-1">
        <Icon name="license" size={13} /> {cdlText(c)}
        {c.endorsements.map((l) => trust?.endorsements[l]?.n ? <span key={l} className="text-[#05683a]" title={`${l} confirmed`}>{l}✓</span> : null)}
      </p>
      {trust ? (
        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#e6f4ec] text-[#05683a] text-xs font-semibold px-2.5 py-1 ml-1">
          <Icon name="proof" size={13} /> {cdlTrustHeadline(trust, c)}
        </p>
      ) : (
        <p className="text-[11px] text-neutral-500 mt-1">Their own statement. No one you vouch for has confirmed it.</p>
      )}
      {detail && <p className="text-xs text-neutral-600 mt-1">{detail}</p>}
      {may && !open && (
        <button type="button" onClick={() => { setPicked(mine?.endorsements?.length ? mine.endorsements : c.endorsements); setOpen(true); }} className="block text-xs font-semibold underline mt-1">
          {mine ? "Change my CDL vouch" : "I have seen this CDL"}
        </button>
      )}
      {may && open && (
        <div className="mt-2 rounded-xl bg-neutral-100 p-3 text-left">
          <p className="text-sm font-medium">Only vouch if you have seen the license yourself.</p>
          <p className="text-xs text-neutral-500 mt-1 mb-2">Tap the endorsements you saw on it. Your vouch is public.</p>
          <EndorsementChips value={picked} onChange={setPicked} />
          <div className="flex gap-2 mt-3">
            <Button size="md" onClick={() => send(cdlVouchEvent(pubkey, picked))} loading={busy}>Confirm vouch</Button>
            <Button size="md" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
          {mine && <button type="button" disabled={busy} onClick={() => send(cdlUnvouchEvent(pubkey))} className="block text-xs font-semibold underline text-red-600 mt-2">Take my vouch back</button>}
        </div>
      )}
    </div>
  );
}
