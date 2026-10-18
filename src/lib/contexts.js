// ════════════════════════════════════════════════════════════
//  CONTEXTS — GoGet's four ways to use the app. After login the person picks one; Account → "Switch role" changes it later.
//    driver   Taxi Driver  takes rides            (the NostrRide driver app, unchanged)
//    courier  Courier      carries parcels        (bids on a shipper's delivery request)
//    rider    Passenger    asks for rides         (the NostrRide rider app, unchanged)
//    shipper  Shipping     sends a parcel         (posts a delivery request, picks a courier's bid)
//  The choice is kept per account on this device (`goget_context_<pk16>`); nothing about it is published.
//  Pure apart from that saved choice; useContextChoice() lets screens follow it.
// ════════════════════════════════════════════════════════════

import { useSyncExternalStore } from "react";
import { getSetting, setSetting } from "../config/relays.js";

export const CONTEXTS = [
  { id: "driver", title: "Taxi Driver", blurb: "Take riders where they are going and get paid in ecash.", icon: "taxi", first: "drive", views: ["drive", "earnings", "account"] },
  { id: "courier", title: "Courier", blurb: "Pick up and carry parcels. Bid on deliveries near you.", icon: "courier", first: "jobs", views: ["jobs", "mine", "earnings", "account"] },
  { id: "rider", title: "Passenger", blurb: "Get a ride. Pay the driver as the ride runs.", icon: "passenger", first: "home", views: ["home", "activity", "account"] },
  { id: "shipper", title: "Shipping", blurb: "Send a document, a package or heavy equipment. Pick a courier's bid.", icon: "ship", first: "ship", views: ["ship", "bids", "deliveries", "account"] },
];
export const contextById = (id) => CONTEXTS.find((c) => c.id === id) || null;
export const isContext = (id) => !!contextById(id);

const key = (pk) => "goget_context_" + String(pk).slice(0, 16);
const listeners = new Set();
let version = 0;

export function getContextChoice(pk) {
  try {
    const v = getSetting(key(pk), null);
    return isContext(v) ? v : null;
  } catch { return null; }
}

export function setContextChoice(pk, id) {
  if (!isContext(id)) return;
  setSetting(key(pk), id);
  version++;
  listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

export function clearContextChoice(pk) {
  setSetting(key(pk), null);
  version++;
  listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
// The saved choice for this account, live (null until the person has picked one).
export function useContextChoice(pk) {
  useSyncExternalStore(subscribe, () => version);
  return pk ? getContextChoice(pk) : null;
}
