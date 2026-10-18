// ════════════════════════════════════════════════════════════
//  DELIVERIES (Shipping) — The shipper's own deliveries: running ones first, then open requests, then finished ones. A tap opens
//  the delivery (DeliveryDetail): the courier, the map, the pickup code, the money, and the confirmation that the parcel arrived.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useShipper } from "../state/ShipperContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import Icon from "../../ui/Icon.jsx";
import DeliveryDetail from "./DeliveryDetail.jsx";
import { deliveryContent, deliveryStatus, isDeliveryExpired, placesOf, sizeLabel, typeLabel } from "../../lib/delivery.js";

export const STATUS_WORDS = {
  requested: ["Waiting for bids", "bg-amber-50 text-amber-800"],
  assigned: ["Courier on the way", "bg-[#e6f4ec] text-[#05683a]"],
  in_transit: ["On its way", "bg-[#e6f4ec] text-[#05683a]"],
  delivered: ["Delivered: please check", "bg-amber-50 text-amber-800"],
  completed: ["Completed", "bg-neutral-100 text-neutral-700"],
  disputed: ["Problem reported", "bg-red-50 text-red-700"],
  closed: ["Closed", "bg-neutral-100 text-neutral-600"],
  expired: ["Expired", "bg-neutral-100 text-neutral-600"],
};
export const statusOf = (request) => {
  const s = deliveryStatus(request);
  return s === "requested" && isDeliveryExpired(request) ? "expired" : s;
};

export default function DeliveriesScreen() {
  const { user } = useApp();
  const { mine } = useShipper();
  const [openId, setOpenId] = useState(null);
  const open = openId ? mine.find((r) => r.id === openId) : null;
  if (open) return <DeliveryDetail request={open} onBack={() => setOpenId(null)} />;

  const rank = (r) => ({ assigned: 0, in_transit: 0, delivered: 0, disputed: 0, requested: 1 }[statusOf(r)] ?? 2);
  const rows = [...mine].sort((a, b) => rank(a) - rank(b) || b.created_at - a.created_at);
  return (
    <Screen title="Deliveries">
      {rows.length === 0 ? (
        <div className="text-center py-12">
          <Icon name="package" size={40} className="mx-auto text-neutral-300 mb-3" />
          <p className="font-semibold">Nothing sent yet</p>
          <p className="text-neutral-500 text-sm mt-1">Post a delivery on the Ship tab. It will show up here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const c = deliveryContent(r), pl = placesOf(r, user), st = statusOf(r);
            const [label, tone] = STATUS_WORDS[st];
            return (
              <li key={r.id}>
                <button type="button" onClick={() => setOpenId(r.id)} className="w-full text-left rounded-2xl border border-neutral-200 p-4 active:bg-neutral-50" aria-label={`${typeLabel(c.what?.type)} to ${pl.dropoff.name}: ${label}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}</span>
                    <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold ${tone}`}>{label}</span>
                  </div>
                  <p className="text-sm text-neutral-600 mt-1 truncate">{pl.pickup.name} → {pl.dropoff.name}</p>
                  <p className="text-xs text-neutral-500 mt-0.5">{c.time && c.time !== "ASAP" ? "Pickup " + new Date(c.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "As soon as possible"} · posted {new Date(r.created_at * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Screen>
  );
}
