// ════════════════════════════════════════════════════════════
//  BIDS (Shipping) — Every bid waiting for an answer, grouped by delivery. They arrive while the shipper does something else; the
//  tab shows how many are waiting, so nothing has to be accepted or declined at once. Accepting one declines the rest.
// ════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useApp } from "../../state/AppContext.jsx";
import { useShipper } from "../state/ShipperContext.jsx";
import { Screen } from "../../ui/Layout.jsx";
import Icon from "../../ui/Icon.jsx";
import BidCard from "../components/BidCard.jsx";
import { typeLabel, sizeLabel, deliveryContent, placesOf } from "../../lib/delivery.js";

export default function BidsScreen() {
  const { pullRecent, user } = useApp();
  const { inbox } = useShipper();
  useEffect(() => { pullRecent(); }, [pullRecent]);
  return (
    <Screen title="Bids">
      {inbox.length === 0 ? (
        <div className="text-center py-12">
          <Icon name="inbox" size={40} className="mx-auto text-neutral-300 mb-3" />
          <p className="font-semibold">No bids waiting</p>
          <p className="text-neutral-500 text-sm mt-1">When couriers bid on a delivery you posted, they show up here. This tab shows a number when there is something new.</p>
        </div>
      ) : (
        <div className="space-y-7">
          {inbox.map(({ request, bids }) => {
            const c = deliveryContent(request), pl = placesOf(request, user);
            return (
              <section key={request.id} aria-label={`Bids on ${c.dropoff?.name || "delivery"}`}>
                <h2 className="font-bold text-[17px]">{typeLabel(c.what?.type)} · {sizeLabel(c.what?.size)}</h2>
                <p className="text-sm text-neutral-500 mb-3 truncate">{pl.pickup.name} → {pl.dropoff.name} · {bids.length} bid{bids.length === 1 ? "" : "s"}</p>
                <ul className="space-y-3">
                  {bids.map((bid) => <BidCard key={bid.id} request={request} bid={bid} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
