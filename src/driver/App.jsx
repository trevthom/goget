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
  const { open, online, driveReady, alerts } = useDriver();
  const Screen = SCREENS[view] || HomeScreen;
  const tabs = [
    { id: "drive", label: "Drive", icon: "car", badge: online && (view !== "drive" || !alerts) ? open.length : 0 },
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

// The signed-in part of the app: this role's state and its screens. GoGet mounts this for the Passenger / Taxi Driver context.
export function DriverSession() {
  const { user } = useApp();
  return (
    <DriverProvider key={user.publicKey}>
      <Shell />
    </DriverProvider>
  );
}

function Gate() {
  const { user, setUser } = useApp();
  if (!user) return <AuthScreen onLogin={setUser} />;
  return <DriverSession />;
}

export default function DriverApp() {
  return (
    <AppProvider initialView="drive">
      <Gate />
    </AppProvider>
  );
}
