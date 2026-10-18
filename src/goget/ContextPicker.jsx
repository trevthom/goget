// ════════════════════════════════════════════════════════════
//  CONTEXT PICKER — The first screen after login in GoGet: "How do you want to use GoGet today?" Four cards:
//  Taxi Driver, Courier, Passenger, Shipping. The pick is remembered for this account on this device and can be changed in
//  Account → Switch role.
// ════════════════════════════════════════════════════════════

import { CONTEXTS } from "../lib/contexts.js";
import { APP_NAME, SLOGAN } from "../config/app.js";
import Icon from "../ui/Icon.jsx";
import { useApp } from "../state/AppContext.jsx";
import ConnectionBanner from "../ui/ConnectionBanner.jsx";

export default function ContextPicker({ onPick }) {
  const { user, logout } = useApp();
  return (
    <div className="nr-frame overflow-y-auto bg-white mx-auto max-w-md sm:border-x sm:border-neutral-200">
      <ConnectionBanner />
      <div className="bg-[#000] text-[#fff] px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-8">
        <h1 className="text-[32px] leading-9 font-bold tracking-tight">{APP_NAME}</h1>
        <p className="text-xl font-semibold mt-2">{SLOGAN}</p>
        <p className="text-[#fff]/70 text-[15px] mt-1">Welcome, {user?.name || "friend"}.</p>
      </div>
      <div className="px-6 py-6">
        <h2 className="text-xl font-bold">How do you want to use GoGet?</h2>
        <p className="text-sm text-neutral-500 mt-1 mb-4">You can change this any time in Account.</p>
        <ul className="space-y-3">
          {CONTEXTS.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id)} aria-label={c.title}
                className="w-full flex items-center gap-4 rounded-2xl border border-neutral-300 px-4 py-4 text-left active:bg-neutral-100">
                <span className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name={c.icon} size={24} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{c.title}</span>
                  <span className="block text-sm text-neutral-500">{c.blurb}</span>
                </span>
                <Icon name="chevron-right" size={20} className="text-neutral-400" />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={logout} className="mt-6 text-sm font-semibold underline text-neutral-600">Log out</button>
      </div>
    </div>
  );
}
