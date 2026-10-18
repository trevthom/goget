// ════════════════════════════════════════════════════════════
//  SHIPPER APP — GoGet's Shipping context. Four tabs: Ship (post a delivery) · Bids (a number shows when couriers have bid) ·
//  Deliveries (running, open and finished) · Account. Mounted by src/goget/App.jsx after the person picks "Shipping".
// ════════════════════════════════════════════════════════════

import { useApp } from "../state/AppContext.jsx";
import { ShipperProvider, useShipper } from "./state/ShipperContext.jsx";
import { AppFrame, TabBar } from "../ui/Layout.jsx";
import ErrorBoundary from "../ui/ErrorBoundary.jsx";
import UserModal from "../ui/UserModal.jsx";
import NoticeBanner from "../ui/NoticeBanner.jsx";
import ConnectionBanner from "../ui/ConnectionBanner.jsx";
import ShipScreen from "./screens/ShipScreen.jsx";
import BidsScreen from "./screens/BidsScreen.jsx";
import DeliveriesScreen from "./screens/DeliveriesScreen.jsx";
import AccountScreen from "./screens/AccountScreen.jsx";

const SCREENS = { ship: ShipScreen, bids: BidsScreen, deliveries: DeliveriesScreen, account: AccountScreen };

function Shell() {
  const { view, setView } = useApp();
  const { bidCount, draft, setDraft } = useShipper();
  const Screen = SCREENS[view] || ShipScreen;
  const tabs = [
    { id: "ship", label: "Ship", icon: "ship" },
    { id: "bids", label: "Bids", icon: "bid", badge: bidCount },
    { id: "deliveries", label: "Deliveries", icon: "package" },
    { id: "account", label: "Account", icon: "user" },
  ];
  // Tapping "Ship" while the address search or the map pin is open goes back to the form.
  const onTab = (id) => { if (id === "ship" && view === "ship" && draft.step !== "form") setDraft({ step: "form" }); else setView(id); };
  return (
    <AppFrame>
      <ErrorBoundary resetKey={view}>
        <Screen />
      </ErrorBoundary>
      <TabBar items={tabs} active={view} onChange={onTab} />
      <UserModal />
      <ConnectionBanner />
      <NoticeBanner />
    </AppFrame>
  );
}

export function ShipperSession() {
  const { user } = useApp();
  return (
    <ShipperProvider key={user.publicKey}>
      <Shell />
    </ShipperProvider>
  );
}
