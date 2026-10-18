// ════════════════════════════════════════════════════════════
//  ENDORSEMENT CHIPS — The six CDL endorsements as toggle chips (H N P S T X, with their names). Used where a shipper says which
//  endorsements a delivery REQUIRES and where a courier says which they HOLD (lib/cdl.js).
//    <EndorsementChips value={["H"]} onChange={(list) => …} disabled? />
// ════════════════════════════════════════════════════════════

import { ENDORSEMENTS } from "../../lib/cdl.js";

export default function EndorsementChips({ value = [], onChange, disabled = false }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].sort());
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="CDL endorsements">
      {ENDORSEMENTS.map((e) => {
        const on = value.includes(e.id);
        return (
          <button key={e.id} type="button" aria-pressed={on} disabled={disabled} onClick={() => toggle(e.id)} title={e.label}
            className={`px-3 py-2 rounded-full text-sm font-semibold border disabled:opacity-50 ${on ? "bg-black text-white border-black" : "bg-white text-neutral-700 border-neutral-300 active:bg-neutral-100"}`}>
            {e.id} <span className="font-normal">· {e.label}</span>
          </button>
        );
      })}
    </div>
  );
}
