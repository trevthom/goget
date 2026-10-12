// ════════════════════════════════════════════════════════════
//  DRIVER APP — The root. Wraps everything in the shared state, shows the
//  login screen until someone is signed in, then three tabs:
//    Drive (home) · Earnings · Account
//  The tab bar is always visible.
// ════════════════════════════════════════════════════════════

import { AppProvider, useApp } from "../state/AppContext.jsx";
import { DriverProvider, useDriver } from "./state/DriverContext.jsx";
import { AppFrame, TabBar } from "../ui/Layout.jsx";
import ErrorBoundary from "../ui/ErrorBoundary.jsx";
import UserModal from "../ui/UserModal.jsx";
import NoticeBanner from "../ui/NoticeBanner.jsx";
import ConnectionBanner from "../ui/ConnectionBanner.jsx";
import AuthScreen from "../features/auth/AuthScreen.jsx";
import HomeScreen from "./screens/HomeScreen.jsx";
import EarningsScreen from "./screens/EarningsScreen.jsx";
import AccountScreen from "./screens/AccountScreen.jsx";

const SCREENS = { drive: HomeScreen, earnings: EarningsScreen, account: AccountScreen };

function Shell() {
  const { view, setView } = useApp();
  const { open, online, driveReady } = useDriver();
  const Screen = SCREENS[view] || HomeScreen;
  const tabs = [
    { id: "drive", label: "Drive", icon: "car", badge: view !== "drive" && online ? open.length : 0 },
    { id: "earnings", label: "Earnings", icon: "chart" },
    { id: "account", label: "Account", icon: "user", badge: !driveReady ? 1 : 0 },
  ];
  return (
    <AppFrame>
      <ErrorBoundary resetKey={view}>
        <Screen />
      </ErrorBoundary>
      <TabBar items={tabs} active={view} onChange={setView} />
      <UserModal />
      <ConnectionBanner />
      <NoticeBanner />
    </AppFrame>
  );
}

function Gate() {
  const { user, setUser } = useApp();
  if (!user) return <AuthScreen onLogin={setUser} />;
  return (
    <DriverProvider key={user.publicKey}>
      <Shell />
    </DriverProvider>
  );
}

export default function DriverApp() {
  return (
    <AppProvider initialView="drive">
      <Gate />
    </AppProvider>
  );
}
