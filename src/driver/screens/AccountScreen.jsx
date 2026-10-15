// ════════════════════════════════════════════════════════════
//  ACCOUNT (driver) — Profile, what is needed to drive (vehicle,
//  Lightning address; the banner names what is still
//  missing), currency, your rates (frozen while a ride runs), the ecash wallet and the mint you
//  are paid at, optional gender, driving settings (request radius, alerts), the Lightning wallet,
//  contact methods, relays, keys, log out.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useDriver } from "../state/DriverContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { SectionLabel, Toggle, inputCls } from "../../ui/Parts.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton, useSaveProfile } from "../../features/profile/ProfileParts.jsx";
import VehicleSection from "../../features/profile/VehicleSection.jsx";
import TypicalFareSection from "../../features/profile/TypicalFareSection.jsx";
import { driveGaps, gapsText } from "../../lib/profile.js";
import LightningAddressSection from "../../features/profile/LightningAddressSection.jsx";
import WalletSection from "../../features/profile/WalletSection.jsx";
import VouchesSection from "../../features/profile/VouchesSection.jsx";
import EcashSection from "../../features/ecash/EcashSection.jsx";
import CurrencySection from "../../features/profile/CurrencySection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";
import Icon from "../../ui/Icon.jsx";

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

        <VehicleSection
          vehicle={user.vehicle}
          ready={driveReady}
          onSave={(vehicle) => save({ vehicle })}
          gapsFor={(vehicle) => driveGaps({ ...user, vehicle })}
        />
        <LightningAddressSection value={user.lud16 || ""} onSave={(lud16) => save({ lud16 })} />

        <CurrencySection />
        <TypicalFareSection rates={user.rates} onSave={(rates) => save({ rates })} locked={onRide} />
        <EcashSection locked={onRide} />

        <section>
          <SectionLabel>Gender (optional)</SectionLabel>
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
        </section>

        <section>
          <SectionLabel>Driving</SectionLabel>
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
        </section>

        <WalletSection />
        <ContactMethods />
        <VouchesSection />
        <BlockedSection />
        <RelaysSection />
        <KeysSection user={user} />
        <LogoutButton />
      </div>
    </Screen>
  );
}
