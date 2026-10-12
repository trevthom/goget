// ════════════════════════════════════════════════════════════
//  ONBOARDING — Shown on the Drive tab until the driver has everything
//  riders need (lib/profile.js isDriveReady). A checklist, like the
//  "finish setting up" step in other driver apps.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import Button from "../../ui/Button.jsx";
import { Screen } from "../../ui/Layout.jsx";
import Checklist, { driveSteps } from "../components/Checklist.jsx";
import { driveGaps, gapsText } from "../../lib/profile.js";

export default function Onboarding() {
  const { user, setView } = useApp();
  const left = driveSteps(user).filter((s) => !s.done).length;
  return (
    <Screen title="Get ready to drive">
      <p className="text-neutral-600 text-[15px] -mt-1 mb-4">
        {left} step{left === 1 ? "" : "s"} left. Riders need these before they will ride with you.
      </p>
      <p className="text-amber-800 bg-amber-50 rounded-xl px-3 py-2 text-sm mb-3" role="status">
        Still needed: {gapsText(driveGaps(user))}.
      </p>
      <Checklist />
      <Button className="mt-6" onClick={() => setView("account")}>Complete in Account</Button>
      <p className="text-neutral-500 text-xs text-center mt-3">
        Your photo and car are public. Your plate is sealed and shared only with the rider you drive.
      </p>
    </Screen>
  );
}
