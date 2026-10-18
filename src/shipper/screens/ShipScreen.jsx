// ════════════════════════════════════════════════════════════
//  SHIP (Shipping) — "Send something": what it is, how big, where from and to, when, and whether the courier needs a CDL.
//  The pickup and the drop-off are chosen on the same address search and map pin as a Passenger's ride (features/places).
//  "Post delivery request" publishes it (lib/delivery.js requestEvent): the public copy has only the AREAS; the exact addresses and
//  the contact note are sealed and go only to the courier whose bid the shipper accepts. Couriers then bid; the Bids tab shows them.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useShipper } from "../state/ShipperContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import Icon from "../../ui/Icon.jsx";
import PlaceSearch from "../../features/places/PlaceSearch.jsx";
import PinPicker from "../../features/places/PinPicker.jsx";
import EndorsementChips from "../../features/goget/EndorsementChips.jsx";
import { DELIVERY_TYPES, DELIVERY_SIZES, deliveryContent, exactDelivery, MAX_NOTE } from "../../lib/delivery.js";
import { SAMPLE_LOCATIONS } from "../../lib/locations.js";

const WORDS = {
  title: "Plan your delivery", pickup: "Pickup location", dropoff: "Drop-off location", dropoffPlaceholder: "Where is it going?",
  hint: "Not sure of the address? Try entering the name of a business or landmark, like a store, a warehouse or a hotel.",
  note: "Your delivery is encrypted. Only couriers online near the pickup are invited to read it, and they see only the approximate area until you pick one.",
};
const chip = (on) => `px-3.5 py-2 rounded-full text-sm font-semibold border ${on ? "bg-black text-white border-black" : "bg-white text-neutral-700 border-neutral-300 active:bg-neutral-100"}`;
const localNow = (offsetMs = 0) => new Date(Date.now() + offsetMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

// The places of my earlier deliveries, newest first, for quick picks: { pickup: [...], dropoff: [...] } (3 each).
function recentsOf(mine, user) {
  const out = { pickup: [], dropoff: [] };
  for (const r of mine) {
    const ex = exactDelivery(r, user);
    if (!ex) continue;
    for (const f of ["pickup", "dropoff"]) {
      const p = ex[f];
      if (out[f].length < 3 && !out[f].some((x) => x.name === p.name)) out[f].push({ ...p, area: deliveryContent(r)?.[f]?.name || "" });
    }
  }
  return out;
}

export default function ShipScreen() {
  const { user } = useApp();
  const { draft, setDraft, here, myPosition, mine, post, posting } = useShipper();
  const { pickup, dropoff } = draft;

  if (draft.step === "pin") {
    const field = draft.pinField === "dropoff" ? "dropoff" : "pickup";
    const other = field === "pickup" ? dropoff : pickup;
    const start = (field === "dropoff" ? dropoff || pickup : pickup) || myPosition || here || SAMPLE_LOCATIONS[0];
    return (
      <PinPicker key={field} field={field} start={start} me={myPosition}
        onBack={() => setDraft({ step: "search" })} onExit={() => setDraft({ step: "form" })}
        onConfirm={(place) => setDraft({ [field]: place, step: other ? "form" : "search" })} />
    );
  }
  if (draft.step === "search") {
    return (
      <PlaceSearch pickup={pickup} dropoff={dropoff} here={here} near={myPosition} recents={recentsOf(mine, user)} words={WORDS}
        onBack={() => setDraft({ step: "form" })} onExit={() => setDraft({ step: "form" })}
        onPin={(field) => setDraft({ step: "pin", pinField: field })} onDone={() => setDraft({ step: "form" })}
        onChange={(field, place) => setDraft(place && (field === "pickup" ? dropoff : pickup) ? { [field]: place, step: "form" } : { [field]: place })} />
    );
  }

  const timed = draft.when !== "ASAP";
  const ready = !!(pickup && dropoff);
  return (
    <Screen title="Send something">
      <p className="text-neutral-600 text-[15px] -mt-1 mb-5">A document, a package, large equipment — anything. Couriers bid. You pick one.</p>

      <h2 className="font-semibold mb-2">What are you sending?</h2>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What are you sending">
        {DELIVERY_TYPES.map((t) => <button key={t.id} type="button" aria-pressed={draft.type === t.id} onClick={() => setDraft({ type: t.id })} className={chip(draft.type === t.id)}>{t.label}</button>)}
      </div>

      <h2 className="font-semibold mt-5 mb-2">How big is it?</h2>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Size">
        {DELIVERY_SIZES.map((s) => (
          <button key={s.id} type="button" aria-pressed={draft.size === s.id} onClick={() => setDraft({ size: s.id })}
            className={`rounded-xl border px-3 py-2.5 text-left ${draft.size === s.id ? "bg-black text-white border-black" : "bg-white border-neutral-300 active:bg-neutral-100"}`}>
            <span className="block text-sm font-semibold">{s.label}</span>
            <span className={`block text-xs ${draft.size === s.id ? "text-white/70" : "text-neutral-500"}`}>{s.hint}</span>
          </button>
        ))}
      </div>

      <h2 className="font-semibold mt-5 mb-1">Tell couriers about it</h2>
      <p className="text-xs text-neutral-500 mb-2">Weight, what it is, anything special. Couriers near you can read this, so leave out private details.</p>
      <textarea aria-label="About the delivery" value={draft.note} maxLength={MAX_NOTE} rows={3} onChange={(e) => setDraft({ note: e.target.value })}
        placeholder="A pallet of tiles, about 600 lb. Needs a lift gate." className={`${inputCls} resize-none`} />

      <h2 className="font-semibold mt-5 mb-2">Where?</h2>
      {[["pickup", "Pickup", pickup], ["dropoff", "Drop-off", dropoff]].map(([field, label, place]) => (
        <button key={field} type="button" onClick={() => setDraft({ step: "search" })} aria-label={`${label}: ${place ? place.name : "not set"}`}
          className="w-full flex items-center gap-3 rounded-xl bg-neutral-100 px-4 py-3 mb-2 text-left active:bg-neutral-200">
          <span className={`w-2.5 h-2.5 shrink-0 ${field === "pickup" ? "rounded-full" : ""} bg-black`} aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-neutral-500">{label}</span>
            <span className="block text-[15px] font-medium truncate">{place ? place.name : `Choose the ${label.toLowerCase()}`}</span>
          </span>
          <Icon name="chevron-right" size={18} className="text-neutral-400" />
        </button>
      ))}

      <h2 className="font-semibold mt-5 mb-2">When?</h2>
      <div className="flex gap-2" role="group" aria-label="When">
        <button type="button" aria-pressed={!timed} onClick={() => setDraft({ when: "ASAP" })} className={chip(!timed)}>As soon as possible</button>
        <button type="button" aria-pressed={timed} onClick={() => setDraft({ when: draft.when === "ASAP" ? localNow(3600000) : draft.when })} className={chip(timed)}>Later</button>
      </div>
      {timed && (
        <input type="datetime-local" aria-label="Pickup date and time" value={draft.when} min={localNow()} onChange={(e) => setDraft({ when: e.target.value })} className={`${inputCls} mt-2`} />
      )}

      <h2 className="font-semibold mt-5 mb-1">Does the courier need a CDL?</h2>
      <label className="flex items-center gap-3 py-1.5">
        <input type="checkbox" checked={draft.cdlRequired || draft.endorsements.length > 0} disabled={draft.endorsements.length > 0}
          onChange={(e) => setDraft({ cdlRequired: e.target.checked })} className="w-5 h-5 accent-black" aria-label="Courier must have a CDL" />
        <span className="text-[15px]">Courier must have a commercial driver's license</span>
      </label>
      {(draft.cdlRequired || draft.endorsements.length > 0) && (
        <div className="mt-2">
          <p className="text-xs text-neutral-500 mb-2">Pick the endorsements the courier must hold. Couriers who do not have them will not see this request.</p>
          <EndorsementChips value={draft.endorsements} onChange={(endorsements) => setDraft({ endorsements })} />
        </div>
      )}

      <h2 className="font-semibold mt-5 mb-1">Who should the courier ask for? <span className="font-normal text-neutral-500">(optional)</span></h2>
      <p className="text-xs text-neutral-500 mb-2">A name, a phone number, a gate code. Only the courier you choose can read it.</p>
      <input aria-label="Note for the chosen courier" value={draft.contact} maxLength={200} onChange={(e) => setDraft({ contact: e.target.value })} placeholder="Ask for Sam at the loading dock" className={inputCls} />

      <div className="mt-6 sticky bottom-0 bg-white pt-2 pb-2">
        <Button onClick={post} disabled={!ready} loading={posting}>Post delivery request</Button>
        {!ready && <p className="text-xs text-neutral-500 text-center mt-2">Choose a pickup and a drop-off first.</p>}
      </div>
    </Screen>
  );
}
