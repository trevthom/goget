// ════════════════════════════════════════════════════════════
//  APPEARANCE — The dark mode switch and the distance units (Units: miles or kilometers, lib/units.js). Each saves and applies as soon
//  as it is flipped: there is no Save button (lib/appearance.js and lib/units.js keep them on this device).
// ════════════════════════════════════════════════════════════

import { useDark } from "../../lib/appearance.js";
import { SectionLabel, Toggle } from "../../ui/Parts.jsx";
import UnitsSection from "./UnitsSection.jsx";

export default function AppearanceSection() {
  const [dark, setDark] = useDark();
  return (
    <section>
      <SectionLabel>Appearance</SectionLabel>
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium">Dark mode</p>
          <p className="text-sm text-neutral-500">Darker colors and a dark map. Saved on this device.</p>
        </div>
        <Toggle checked={dark} onChange={setDark} label="Dark mode" />
      </div>
      <div className="mt-5">
        <p className="text-[15px] font-medium mb-2">Units</p>
        <UnitsSection />
      </div>
    </section>
  );
}
