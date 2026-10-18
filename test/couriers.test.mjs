// Job seal and courier invitations: the job is encrypted with a one-time key that is sealed to each invited courier; couriers announce
// they are available (public presence); the shipper's app invites the ones that fit.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const J = await import(`${R}/lib/jobseal.js`);
const C = await import(`${R}/lib/couriers.js`);
const B = await import(`${R}/lib/blocks.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);

const ship = generateKeypair(), c1 = generateKeypair(), c2 = generateKeypair(), c3 = generateKeypair(), nosy = generateKeypair();

// ── The seal ──
const key = J.newJobKey();
assert.match(key, /^[0-9a-f]{64}$/); assert.notEqual(J.newJobKey(), key, "a new key every time");
const job = { what: { type: "package", note: "fragile" }, pickup: { name: "Downtown", lat: 38.04, lng: -84.5 } };
const box = J.sealBox(key, job);
assert.ok(!box.includes("fragile") && !box.includes("Downtown"), "the box is noise");
assert.deepEqual(J.openBox(key, box), job, "the key opens it");
assert.equal(J.openBox(J.newJobKey(), box), null, "another key does not");
assert.equal(J.openBox(key, box.slice(0, -4) + "AAAA"), null, "a damaged box does not open");
assert.equal(J.openBox("nothex", box), null); assert.equal(J.openBox(key, 5), null);
const wrap = J.wrapKey(ship.sk, c1.publicKey, key);
assert.equal(J.unwrapKey(c1.sk, ship.publicKey, wrap), key, "the invited courier opens their wrap");
assert.equal(J.unwrapKey(ship.sk, ship.publicKey, J.wrapKey(ship.sk, ship.publicKey, key)), key, "the shipper keeps their own copy");
assert.equal(J.unwrapKey(c2.sk, ship.publicKey, wrap), null, "another courier cannot");
assert.equal(J.unwrapKey(c1.sk, nosy.publicKey, wrap), null, "a wrap from someone else's key is not the shipper's");
assert.equal(J.unwrapKey(c1.sk, ship.publicKey, "garbage"), null);

// ── Presence is checked ──
const p = (kp, content) => C.readPresence(kp.publicKey, content);
assert.equal(p(c1, { lat: 91, lng: 0 }), null); assert.equal(p(c1, { lat: "1", lng: 0 }), null); assert.equal(p(c1, null), null); assert.equal(p(c1, "x"), null);
const ok = p(c1, { lat: 38.04, lng: -84.5, radiusMiles: 25, cdl: { has: true, endorsements: ["t", "zz", "H"] }, hide: ["a", 5], ts: 1000 });
assert.deepEqual([ok.radiusMiles, ok.cdl, ok.hide, ok.ts], [25, { has: true, endorsements: ["H", "T"] }, ["a"], 1000], "the CDL statement and hide tokens are cleaned");
assert.equal(p(c1, { lat: 1, lng: 1, radiusMiles: 99999 }).radiusMiles, 25, "an absurd distance falls back");

// ── Who is invited ──
const now = 1_000_000;
const at = (kp, miles, extra = {}) => ({ pubkey: kp.publicKey, lat: 38.04 + miles / 69, lng: -84.5, radiusMiles: 25, cdl: { has: false, endorsements: [] }, hide: [], ts: now - 1000, ...extra });
const pickup = { lat: 38.04, lng: -84.5 };
const list = [at(c1, 3), at(c2, 10, { cdl: { has: true, endorsements: ["T"] } }), at(c3, 40), at(nosy, 1, { ts: now - 10 * 60000 })];
const names = (r) => r.map((x) => x.courier);
assert.deepEqual(names(C.eligibleCouriers(list, { pickup, need: { required: false }, me: ship.publicKey, now })), [c1.publicKey, c2.publicKey], "nearest first; one 40 miles away is outside their own 25 miles; one silent for 10 minutes is gone");
assert.deepEqual(names(C.eligibleCouriers(list, { pickup, need: { required: true, endorsements: ["T"] }, me: ship.publicKey, now })), [c2.publicKey], "the CDL need keeps only couriers who say they meet it");
assert.deepEqual(names(C.eligibleCouriers(list, { pickup, need: { required: false }, me: ship.publicKey, now, blocked: [{ pubkey: c1.publicKey }] })), [c2.publicKey], "a courier I blocked is not sent my job");
const hid = [at(c1, 3, { hide: B.hideList(c1.publicKey, [{ pubkey: ship.publicKey }]) })];
assert.deepEqual(C.eligibleCouriers(hid, { pickup, need: { required: false }, me: ship.publicKey, now }), [], "a courier who blocked me is not sent my job");
assert.deepEqual(names(C.eligibleCouriers(list, { pickup, need: { required: false }, me: ship.publicKey, now, wrapped: new Set([c1.publicKey]) })), [c2.publicKey], "already invited: not again");
assert.deepEqual(C.eligibleCouriers(list, { pickup, need: { required: false }, me: c1.publicKey, now }).map((x) => x.courier).includes(c1.publicKey), false, "never myself");
assert.equal(C.eligibleCouriers(list, { pickup: null, me: ship.publicKey, now }).length, 0, "no pickup: nobody");
assert.equal(C.eligibleCouriers(list, { pickup, need: { required: false }, me: ship.publicKey, now, limit: 1 }).length, 1, "a limit is honoured");
assert.ok(C.eligibleCouriers(list, { pickup, need: { required: false }, me: ship.publicKey, now })[0].miles < 4, "the distance is reported");
console.log("couriers: ok");
