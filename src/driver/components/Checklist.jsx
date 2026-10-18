// ════════════════════════════════════════════════════════════
//  CHECKLIST — What a driver still needs before going online (isDriveReady):
//  face photo, vehicle, vehicle photo, plate. Each row says done, or names exactly what is missing and
//  jumps to the Account tab where it is filled in.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import Icon from "../../ui/Icon.jsx";
import { driveGaps } from "../../lib/profile.js";

const STEPS = [
  { id: "photo", title: "Profile photo", hint: "Riders see your face before they get in." },
  { id: "vehicle", title: "Vehicle", hint: "Year, make and model of your car." },
  { id: "vehiclePhoto", title: "Vehicle photo", hint: "A clear photo of your car." },
  { id: "plate", title: "License plate", hint: "Shown only to the rider you drive." },
];

export function driveSteps(user) {
  const gaps = driveGaps(user);
  return STEPS.map((s) => {
    const gap = gaps.find((g) => g.id === s.id);
    return { ...s, done: !gap, hint: gap?.missing.length ? `Still needed: ${gap.missing.join(", ")}.` : s.hint };
  });
}

export default function Checklist() {
  const { user, setView } = useApp();
  const steps = driveSteps(user);
  return (
    <ul className="divide-y divide-neutral-100">
      {steps.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => !s.done && setView("account")} disabled={s.done} className="w-full flex items-center gap-3 py-3.5 text-left disabled:cursor-default">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${s.done ? "bg-[#05944f] text-[#fff]" : "border-2 border-neutral-300"}`}>
              {s.done && <Icon name="check" size={16} strokeWidth={3} />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-semibold">{s.title}</span>
              <span className="block text-sm text-neutral-500">{s.done ? "Done" : s.hint}</span>
            </span>
            {!s.done && <Icon name="chevron-right" size={18} className="text-neutral-400" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
