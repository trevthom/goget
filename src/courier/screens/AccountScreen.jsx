// ════════════════════════════════════════════════════════════
//  ACCOUNT (Courier) — Switch role, the photo and name, COURIER DETAILS (the CDL box with endorsements, what the courier drives),
//  cash out location, currency, the ecash wallet (the courier is paid in it), vouches, blocked people, relays, keys, log out.
//  Every setting is a Fold (ui/Fold.jsx).
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useCourier } from "../state/CourierContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { AccountHeader, useSaveProfile, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "../../features/profile/ProfileParts.jsx";
import CourierSection from "../../features/profile/CourierSection.jsx";
import VouchesSection from "../../features/profile/VouchesSection.jsx";
import AppearanceSection from "../../features/profile/AppearanceSection.jsx";
import WalletsSection from "../../features/profile/WalletsSection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";
import ContextSwitch from "../../features/goget/ContextSwitch.jsx";
import Fold from "../../ui/Fold.jsx";
import { RecoveryFold, RecoveryNotice } from "../../features/ecash/RecoverySection.jsx";
import { cdlText } from "../../lib/cdl.js";

const GENDERS = [["", "Not set"], ["female", "Female"], ["male", "Male"]];

export default function AccountScreen() {
  const { user } = useApp();
  const { jobs, cdl } = useCourier();
  const save = useSaveProfile();
  const busy = jobs.length > 0;
  return (
    <Screen title="Account">
      <div className="space-y-7">
        <AccountHeader photoRequired />
        <RecoveryNotice />
        <div>
          <Fold id="context" title="Switch role" defaultOpen><ContextSwitch locked={busy ? "a delivery is running" : ""} /></Fold>
          <Fold id="courier" title="Courier details" status={cdl.has ? { text: cdlText(cdl), tone: "ok" } : null}><CourierSection locked={busy} /></Fold>
          <Fold id="appearance" title="Appearance"><AppearanceSection /></Fold>
          <Fold id="ecash" title="Wallets"><WalletsSection locked={busy} /></Fold>
          <RecoveryFold />
          <Fold id="gender" title="Gender (optional)">
            <p className="text-sm text-neutral-500 mb-2">
              Some people ask to see couriers and drivers of one gender first. This only changes the order of their list. Nobody is hidden, and you can leave it unset.
            </p>
            <div className="flex gap-2" role="group" aria-label="Gender">
              {GENDERS.map(([id, label]) => (
                <button key={id || "none"} type="button" aria-pressed={(user.gender || "") === id} onClick={() => save({ gender: id })}
                  className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${(user.gender || "") === id ? "bg-black text-white" : "bg-neutral-100 text-neutral-700"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Fold>
          <Fold id="contacts" title="Contact methods"><ContactMethods /></Fold>
          <Fold id="vouches" title="Your vouches"><VouchesSection /></Fold>
          <Fold id="blocked" title="Blocked people"><BlockedSection /></Fold>
          <Fold id="relays" title="Nostr relays"><RelaysSection /></Fold>
          <Fold id="keys" title="Your keys"><KeysSection user={user} /></Fold>
        </div>
        <LogoutButton />
      </div>
    </Screen>
  );
}
