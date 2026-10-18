// ════════════════════════════════════════════════════════════
//  ACCOUNT (Shipping) — Switch role, profile, currency, the ecash wallet (deliveries are paid from it), the Lightning wallet,
//  contact methods, vouches, blocked people, relays, keys, log out. Every setting is a Fold (ui/Fold.jsx).
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { useShipper } from "../state/ShipperContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import { AccountHeader, ContactMethods, RelaysSection, BlockedSection, LogoutButton } from "../../features/profile/ProfileParts.jsx";
import WalletSection from "../../features/profile/WalletSection.jsx";
import VouchesSection from "../../features/profile/VouchesSection.jsx";
import EcashSection from "../../features/ecash/EcashSection.jsx";
import CurrencySection from "../../features/profile/CurrencySection.jsx";
import AppearanceSection from "../../features/profile/AppearanceSection.jsx";
import KeysSection from "../../features/profile/KeysSection.jsx";
import ContextSwitch from "../../features/goget/ContextSwitch.jsx";
import Fold from "../../ui/Fold.jsx";
import BackupSection from "../../features/profile/BackupSection.jsx";
import UnitsSection from "../../features/profile/UnitsSection.jsx";
import { RecoveryFold, RecoveryNotice } from "../../features/ecash/RecoverySection.jsx";

export default function AccountScreen() {
  const { user } = useApp();
  const { running } = useShipper();
  const busy = running.length > 0;
  return (
    <Screen title="Account">
      <div className="space-y-7">
        <AccountHeader />
        <RecoveryNotice />
        <div>
          <Fold id="context" title="Switch role" defaultOpen><ContextSwitch locked={busy ? "a delivery is running" : ""} /></Fold>
          <Fold id="appearance" title="Appearance"><AppearanceSection /></Fold>
          <Fold id="currency" title="Currency"><CurrencySection /></Fold>
          <Fold id="units" title="Units"><UnitsSection /></Fold>
          <Fold id="ecash" title="Ecash wallet"><EcashSection locked={busy} /></Fold>
          <RecoveryFold />
          <Fold id="backup" title="Backup"><BackupSection /></Fold>
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
