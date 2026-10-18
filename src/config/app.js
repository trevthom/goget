// ════════════════════════════════════════════════════════════
//  APP — Which app this bundle is, and (in GoGet) which role is on screen now.
//  Vite sets BUILD_ROLE at build time (vite.config.js `define`): "rider", "driver" or "goget".
//  Node tests have no such constant, so they get "rider".
//
//  The two standalone apps keep one role for their whole life. GoGet holds all four contexts in one bundle: the person
//  picks one after login and can change it in Account (src/lib/contexts.js). The pick calls setAppRole(), which moves the
//  live bindings below (ES module exports are live: every screen that reads them at render time sees the new value, and
//  the role's tree is remounted on a switch). Do NOT copy these into a module-level constant in code that GoGet loads.
//    APP_ROLE        "rider" (Passenger) | "driver" (Taxi Driver) | "courier" | "shipper" (Shipping)
//    IS_DRIVER_APP   the person is PAID in this role (driver or courier): the screens that differ for the payee read this
// ════════════════════════════════════════════════════════════

/* global __APP_ROLE__, __BUILD_ID__ */
export const BUILD_ROLE = typeof __APP_ROLE__ !== "undefined" ? __APP_ROLE__ : "rider";
export const IS_GOGET = BUILD_ROLE === "goget";
// When and from which commit this bundle was built (shown in Account, so a person can tell which version is running).
export const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "development";

export const ROLES = ["rider", "driver", "courier", "shipper"];
export let APP_ROLE = IS_GOGET ? "rider" : BUILD_ROLE;
export let IS_DRIVER_APP = APP_ROLE === "driver" || APP_ROLE === "courier";
export const APP_NAME = IS_GOGET ? "GoGet" : BUILD_ROLE === "driver" ? "NostrRide Driver" : "NostrRide";
export const SLOGAN = "You go. We get.";

// GoGet only: put a role on screen. Ignored in the two standalone apps and for an unknown role.
export function setAppRole(role) {
  if (!IS_GOGET || !ROLES.includes(role)) return APP_ROLE;
  APP_ROLE = role;
  IS_DRIVER_APP = role === "driver" || role === "courier";
  return APP_ROLE;
}

// What the person on the OTHER side of a job is called in this role: a driver's rider, a courier's shipper...
export const peerName = () => ({ rider: "driver", driver: "rider", courier: "shipper", shipper: "courier" }[APP_ROLE] || "driver");
