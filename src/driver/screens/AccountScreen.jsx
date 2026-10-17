// ════════════════════════════════════════════════════════════
//  ACCOUNT (driver) — Profile, what is needed to drive (vehicle,
//  Lightning address; the banner names what is still
//  missing), currency, your rates (frozen while a ride runs), the ecash wallet and the mint you
//  are paid at, optional gender, driving settings (request radius, alerts), the Lightning wallet,
//  contact methods, relays, keys, log out. Every setting is a Fold (ui/Fold.jsx): tap its title to open or close it.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useDriver } from "../state/DriverContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { Toggle, inputCls } from "../../ui/Parts.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton, useSaveProfile } from "../../features/profile/ProfileParts.jsx";
import VehicleSection from "../../features/profile/VehicleSection.jsx";
import TypicalFareSection from "../../features/profile/TypicalFareSection.jsx";
import { driveGaps, gapsText } from "../../lib/profile.js";
import LightningAddressSection from "../../features/profile/LightningAddressSection.jsx";
import AppearanceSection from "../../features/profile/AppearanceSection.jsx";
import WalletSection from "../../features/profile/WalletSection.jsx";
import VouchesSection from "../../features/profile/VouchesSection.jsx";
import EcashSection from "../../features/ecash/EcashSection.jsx";
import CurrencySection from "../../features/profile/CurrencySection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";
import Icon from "../../ui/Icon.jsx";
import Fold from "../../ui/Fold.jsx";
import { RecoveryFold, RecoveryNotice } from "../../features/ecash/RecoverySection.jsx";

const GENDERS = [["", "Not set"], ["female", "Female"], ["male", "Male"]];

export default function AccountScreen() {
  const { user } = useApp();
  const { driveReady, activeDrive, radius, setRadius, alerts, setAlerts } = useDriver();
  const onRide = !!activeDrive; // rates and the mint are frozen while a ride runs
  const save = useSaveProfile();
  const gaps = driveGaps(user);
  return (
    <Screen title="Account">
      <div className="space-y-7">
        <AccountHeader photoRequired />

        <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 ${driveReady ? "bg-[#e6f4ec] text-[#05683a]" : "bg-amber-50 text-amber-800"}`}>
          <Icon name={driveReady ? "check" : "alert"} size={20} />
          <p className="text-sm font-semibold" role="status">
            {driveReady ? "You're ready to drive." : `Still needed to drive: ${gapsText(gaps)}.`}
          </p>
        </div>

        <RecoveryNotice />

        <div>
          <Fold id="vehicle" title="Vehicle & plate" defaultOpen={gaps.some((g) => ["vehicle", "vehiclePhoto", "plate"].includes(g.id))}
            status={gaps.some((g) => ["vehicle", "vehiclePhoto", "plate"].includes(g.id)) ? { text: "Needed", tone: "warn" } : { text: "Ready", tone: "ok" }}>
            <VehicleSection
              vehicle={user.vehicle}
              ready={driveReady}
              onSave={(vehicle) => save({ vehicle })}
              gapsFor={(vehicle) => driveGaps({ ...user, vehicle })}
            />
          </Fold>
          <Fold id="lightning-address" title="Cash out location" defaultOpen={!user.lud16} status={user.lud16 ? { text: "Set", tone: "ok" } : { text: "Needed", tone: "warn" }}>
            <LightningAddressSection value={user.lud16 || ""} onSave={(lud16) => save({ lud16 })} />
          </Fold>
          <Fold id="appearance" title="Appearance"><AppearanceSection /></Fold>
          <Fold id="currency" title="Currency"><CurrencySection /></Fold>
          <Fold id="rates" title="Your rates"><TypicalFareSection rates={user.rates} onSave={(rates) => save({ rates })} locked={onRide} /></Fold>
          <Fold id="ecash" title="Ecash wallet"><EcashSection locked={onRide} /></Fold>
          <RecoveryFold />

          <Fold id="gender" title="Gender (optional)">
            <p className="text-sm text-neutral-500 mb-2">
              Some riders ask to see drivers of one gender first. This only changes the order of their list. Nobody is hidden, and you can leave it unset.
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

          <Fold id="driving" title="Driving">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-medium">Request radius</p>
                  <p className="text-sm text-neutral-500">Only show pickups this close.</p>
                </div>
                <input aria-label="Request radius in miles" type="number" min="1" max="100" value={radius}
                  onChange={(e) => setRadius(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className={`${inputCls} !w-20 text-center`} />
                <span className="text-sm text-neutral-500">mi</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="font-medium">New request alerts</p>
                  <p className="text-sm text-neutral-500">Banner and notification while you are online.</p>
                </div>
                <Toggle checked={alerts} onChange={setAlerts} label="New request alerts" />
              </div>
            </div>
          </Fold>

          <Fold id="wallet" title="Lightning wallet"><WalletSection /></Fold>
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
