// ════════════════════════════════════════════════════════════
//  STRIKE SECTION — The Account part for the optional Strike link, in both apps (lib/strike.js).
//    rider:  Strike SENDS the bitcoin. Add funds and tips are paid from the rider's Strike account, from the Bitcoin
//            balance or from dollars (Strike converts). The rider chooses which balance.
//    driver: Strike RECEIVES. A cash out is paid into the driver's Strike account, and the driver chooses what Strike
//            keeps it as: Bitcoin, or US dollars (Strike converts what arrives).
//  The person pastes their own API key. It is saved encrypted on this device; "Disconnect" erases it.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { IS_DRIVER_APP } from "../../config/app.js";
import { RIDER_SCOPES, DRIVER_SCOPES } from "../../lib/strike.js";
import { SectionLabel, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";
import CurrencyChoice from "../payments/CurrencyChoice.jsx";

export default function StrikeSection() {
  const { strike } = useApp();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const scopes = IS_DRIVER_APP ? DRIVER_SCOPES : RIDER_SCOPES;

  const connect = async () => {
    setBusy("connect");
    setError("");
    try {
      await strike.connect(key);
      setKey("");
    } catch (e) {
      setError(e.message || "Could not connect to Strike.");
    }
    setBusy("");
  };
  const refresh = async () => {
    setBusy("refresh");
    setError("");
    try { await strike.refresh(); } catch (e) { setError(e.message || "Could not read your Strike balance."); }
    setBusy("");
  };

  return (
    <section>
      <SectionLabel>Strike</SectionLabel>
      {!strike.connected ? (
        <div className="bg-neutral-100 rounded-xl border border-neutral-200 p-4">
          <p className="text-sm text-neutral-600 mb-2">
            {IS_DRIVER_APP
              ? "Link your Strike account to cash out into it. You choose whether Strike keeps what you cash out as Bitcoin or as US dollars."
              : "Link your Strike account to add funds and send tips in one tap. Strike pays from your Bitcoin balance, or from your dollars and buys the bitcoin for you."}
          </p>
          <p className="text-xs text-neutral-500 mb-2">
            In Strike, open Developers and make an API key. Give it only {IS_DRIVER_APP ? "these permissions (the last is optional)" : "these permissions"}:
          </p>
          <ul className="text-xs font-mono text-neutral-600 mb-3 list-disc pl-5">{scopes.map((s) => <li key={s}>{s}</li>)}</ul>
          <input aria-label="Strike API key" type="password" autoComplete="off" value={key} onChange={(e) => { setKey(e.target.value); setError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && key && !busy) { e.preventDefault(); connect(); } }}
            placeholder="Paste your Strike API key" spellCheck={false} className={`${inputCls} !text-sm font-mono mb-2`} />
          {error && <p className="text-red-600 text-xs mb-2" role="alert">{error}</p>}
          <Button size="md" onClick={connect} disabled={!key.trim()} loading={busy === "connect"}>Connect Strike</Button>
          <p className="text-[11px] text-neutral-500 mt-2">The key stays on this device, encrypted with your Nostr key. Anyone with the key can spend from the permissions you gave it, so give it no more than the list above.</p>
        </div>
      ) : (
        <div className="rounded-2xl bg-neutral-100 p-4">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-[15px] flex-1">Strike is connected{strike.sandbox ? " (sandbox)" : ""}</p>
            <button type="button" onClick={refresh} disabled={busy === "refresh"} className="text-blue-600 text-xs">{busy === "refresh" ? "Reading…" : "Refresh"}</button>
          </div>
          {!strike.balances && <p className="text-xs text-neutral-500 mt-1">Your balance is not shown. That is fine: this key may not read balances.</p>}

          {IS_DRIVER_APP ? (
            <div className="mt-3">
              <p className="font-medium text-[15px] mb-1">Cash outs arrive as</p>
              <CurrencyChoice value={strike.receive} onChange={strike.setReceive} label="Cash outs arrive as" balances={strike.balances}
                notes={{ BTC: "Exactly the sats you cash out.", USD: "Strike converts them to dollars when they arrive. You see an estimate before you confirm." }} />
              <p className="text-xs text-neutral-500 mt-2">
                This is only for cash outs from this app. Tips reach your Lightning address and follow your Strike account's own settings.
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <p className="font-medium text-[15px] mb-1">Pay with</p>
              <CurrencyChoice value={strike.source} onChange={strike.setSource} label="Pay with" balances={strike.balances}
                notes={{ USD: "Strike buys the bitcoin for you." }} />
              <p className="text-xs text-neutral-500 mt-2">You see the exact cost, and confirm, before Strike sends anything.</p>
            </div>
          )}
          {error && <p className="text-red-600 text-xs mt-2" role="alert">{error}</p>}
          <button type="button" onClick={() => { strike.disconnect(); setError(""); }} className="text-red-600 text-sm font-semibold mt-4">Disconnect Strike</button>
          <p className="text-[11px] text-neutral-500 mt-1">This erases the key from this device. To cancel it everywhere, delete the key in Strike.</p>
        </div>
      )}
    </section>
  );
}
