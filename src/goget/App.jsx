// ════════════════════════════════════════════════════════════
//  GOGET — "You go. We get." One app, four contexts, one account:
//    Taxi Driver  = the NostrRide driver app      (src/driver, unchanged)
//    Passenger    = the NostrRide rider app       (src/rider, unchanged)
//    Courier      = carries parcels, bids on delivery requests   (src/courier)
//    Shipping     = posts delivery requests, picks a bid         (src/shipper)
//  Flow: log in → pick a context (ContextPicker) → that role's own tabs. Account → Switch role changes it. The role in use is
//  put on screen with setAppRole() BEFORE its tree renders, and the tree is keyed by role + account, so a switch remounts it
//  with fresh state (a driver who switches to Passenger stops being online; presence expires by itself within 90 s).
//  The Taxi Driver and Passenger contexts mount the same Session components the standalone apps use.
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { AppProvider, useApp } from "../state/AppContext.jsx";
import AuthScreen from "../features/auth/AuthScreen.jsx";
import { RiderSession } from "../rider/App.jsx";
import { DriverSession } from "../driver/App.jsx";
import { CourierSession } from "../courier/App.jsx";
import { ShipperSession } from "../shipper/App.jsx";
import ContextPicker from "./ContextPicker.jsx";
import { setAppRole } from "../config/app.js";
import { contextById, setContextChoice, useContextChoice } from "../lib/contexts.js";

const SESSIONS = { rider: RiderSession, driver: DriverSession, courier: CourierSession, shipper: ShipperSession };

function Gate() {
  const { user, setUser, view, setView } = useApp();
  const choice = useContextChoice(user?.publicKey);
  const ctx = contextById(choice);
  setAppRole(ctx ? ctx.id : "rider"); // before the role's screens render (live bindings in config/app.js)
  // A saved view from another role (or none yet) goes to this role's first tab.
  useEffect(() => { if (ctx && !ctx.views.includes(view)) setView(ctx.first); }, [ctx, view, setView]);
  if (!user) return <AuthScreen onLogin={setUser} />;
  if (!ctx) {
    return <ContextPicker onPick={(id) => { setView(contextById(id).first); setContextChoice(user.publicKey, id); }} />;
  }
  const Session = SESSIONS[ctx.id];
  return <Session key={ctx.id + user.publicKey} />;
}

export default function GoGetApp() {
  return (
    <AppProvider initialView="home">
      <Gate />
    </AppProvider>
  );
}
