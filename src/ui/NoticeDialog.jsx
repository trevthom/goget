// ════════════════════════════════════════════════════════════
//  NOTICE DIALOG — Shows a one-time notice (lib/notices.js) until the person taps "I understand". Nothing closes it but that button
//  (no backdrop tap, no Escape): the point is that it was read. Remembered per account, so it shows once.
//    <NoticeDialog id="shipping" />
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { NOTICES, noticeSeen, markNoticeSeen } from "../lib/notices.js";
import Button from "./Button.jsx";
import Icon from "./Icon.jsx";

export default function NoticeDialog({ id }) {
  const { user } = useApp();
  const pk = user?.publicKey;
  const [seen, setSeen] = useState(() => noticeSeen(id, pk));
  const n = NOTICES[id];
  if (!n || seen) return null;
  const ok = () => { markNoticeSeen(id, pk); setSeen(true); };
  return (
    <div role="alertdialog" aria-modal="true" aria-label={n.title} className="fixed inset-0 z-[10050] flex items-center justify-center p-6 bg-[#000]/60 nr-fade">
      <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5" data-testid={`notice-${id}`}>
        <div className="w-11 h-11 rounded-full bg-amber-50 text-amber-800 flex items-center justify-center mb-3"><Icon name="alert" size={22} /></div>
        <h2 className="text-xl font-bold">{n.title}</h2>
        <ul className="mt-3 space-y-3 text-[15px] text-neutral-700">
          {n.points.map((p, i) => <li key={i} className={i === 0 ? "font-semibold text-black" : ""}>{p}</li>)}
        </ul>
        <Button className="mt-5" onClick={ok}>I understand</Button>
      </div>
    </div>
  );
}
