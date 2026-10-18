import test from "node:test";
import assert from "node:assert/strict";
import { milesDriven, statsOf, deliveryMiles } from "../src/lib/mileage.js";

const req = (id, c) => ({ id, pubkey: "r", created_at: 1, kind: 30078, tags: [], content: JSON.stringify(c) });

test("delivery miles come from the quoted route", () => {
  assert.equal(deliveryMiles(req("d", { distanceMiles: 12.4 })), 12.4);
  assert.equal(deliveryMiles(req("d", {})), 0);
});
test("deliveries count only for the courier when done", () => {
  const list = [req("a", { distanceMiles: 10 }), req("b", { distanceMiles: 5.55 })];
  const total = milesDriven([], "bob", list, () => "bob", (r) => r.id === "a" || r.id === "b");
  assert.equal(total, 15.6);
  assert.equal(milesDriven([], "bob", list, () => "carl", () => true), 0);
});
test("stats read from a profile are bounded", () => {
  assert.deepEqual(statsOf({ stats: { miles: 12.34 } }), { miles: 12.3 });
  assert.equal(statsOf({ stats: { miles: -1 } }), null);
  assert.equal(statsOf({ stats: { miles: "x" } }), null);
  assert.equal(statsOf({}), null);
});
console.log("mileage tests ok");
