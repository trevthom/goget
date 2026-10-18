// ════════════════════════════════════════════════════════════
//  CONTEXT SWITCH — Account → "Switch role" (GoGet only): the four contexts, the one in use marked. A tap puts the person in
//  that context at once (src/lib/contexts.js keeps the choice; GoGetApp remounts the role). Switching is paused while a ride or a
//  delivery is running (`locked` names why), because the running screens must stay open until it is finished.
//
//    <ContextSwitch locked={false | "a ride is running"} />
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { CONTEXTS, setContextChoice, useContextChoice } from "../../lib/contexts.js";
import { APP_ROLE } from "../../config/app.js";
import Icon from "../../ui/Icon.jsx";

export default function ContextSwitch({ locked = "" }) {
  const { user, setView } = useApp();
  const choice = useContextChoice(user.publicKey) || APP_ROLE;
  const pick = (c) => {
    if (locked || c.id === choice) return;
    setView(c.first);
    setContextChoice(user.publicKey, c.id);
  };
  return (
    <div>
      <p className="text-sm text-neutral-500 mb-3">
        One account, four ways to use GoGet. Your wallet, vouches and settings stay the same in every role.
      </p>
      <ul className="space-y-2">
        {CONTEXTS.map((c) => {
          const on = c.id === choice;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => pick(c)}
                disabled={!!locked && !on}
                aria-pressed={on}
                className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left border ${on ? "border-black bg-neutral-100" : "border-neutral-200 active:bg-neutral-100"} disabled:opacity-50`}
              >
                <span className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center shrink-0"><Icon name={c.icon} size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[15px]">{c.title}</span>
                  <span className="block text-sm text-neutral-500">{c.blurb}</span>
                </span>
                {on && <Icon name="check" size={18} />}
              </button>
            </li>
          );
        })}
      </ul>
      {locked && <p className="text-xs text-neutral-500 mt-2" role="status">You cannot switch while {locked}. Finish it first.</p>}
    </div>
  );
}
