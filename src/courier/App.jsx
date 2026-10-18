// ════════════════════════════════════════════════════════════
//  COURIER APP — GoGet's Courier context. Four tabs: Jobs (open delivery requests near you that you may carry; a number shows new
//  ones) · My jobs (the deliveries you were given, and your bids) · Earnings · Account. Mounted by src/goget/App.jsx after the person
//  picks "Courier".
// ════════════════════════════════════════════════════════════

import { useApp } from "../state/AppContext.jsx";
import { CourierProvider, useCourier } from "./state/CourierContext.jsx";
import { AppFrame, TabBar } from "../ui/Layout.jsx";
import ErrorBoundary from "../ui/ErrorBoundary.jsx";
import UserModal from "../ui/UserModal.jsx";
import NoticeBanner from "../ui/NoticeBanner.jsx";
import ConnectionBanner from "../ui/ConnectionBanner.jsx";
import JobsScreen from "./screens/JobsScreen.jsx";
import MineScreen from "./screens/MineScreen.jsx";
import EarningsScreen from "./screens/EarningsScreen.jsx";
import AccountScreen from "./screens/AccountScreen.jsx";

const SCREENS = { jobs: JobsScreen, mine: MineScreen, earnings: EarningsScreen, account: AccountScreen };

function Shell() {
  const { view, setView } = useApp();
  const { open, jobs } = useCourier();
  const Screen = SCREENS[view] || JobsScreen;
  const tabs = [
    { id: "jobs", label: "Jobs", icon: "route", badge: view !== "jobs" ? open.length : 0 },
    { id: "mine", label: "My jobs", icon: "courier", badge: jobs.length },
    { id: "earnings", label: "Earnings", icon: "chart" },
    { id: "account", label: "Account", icon: "user" },
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

export function CourierSession() {
  const { user, settingsEpoch } = useApp();
  return (
    <CourierProvider key={user.publicKey + ":" + settingsEpoch}>
      <Shell />
    </CourierProvider>
  );
}
