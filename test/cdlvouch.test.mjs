// CDL vouches: "I have seen this courier's CDL and these endorsements." Same rules as person vouches: the viewer counts only
// themself and the people they chose (one hop); a vouch for oneself is nothing; the newest vouch of each voucher counts;
// a vouch confirms only the endorsements it lists.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const { relay } = await import(`${R}/nostr/relay.js`);
const V = await import(`${R}/lib/vouches.js`);
const X = await import(`${R}/lib/cdlvouch.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const people = Object.fromEntries(["me", "friend", "friend2", "stranger", "courier", "deep"].map((n) => [n, generateKeypair()]));
const pk = (n) => people[n].publicKey;
let clock = Math.floor(Date.now() / 1000) - 500;
const publish = (who, ev) => {
  const e = buildSignedEvent(ev.kind, ev.content, [...ev.tags, ["t", "nostrride"]], people[who].sk);
  e.created_at = ++clock; relay._store(e); return e;
};
const claim = { has: true, endorsements: ["H", "T"] };

// ── The event ──
const ev = X.cdlVouchEvent(pk("courier"), ["h", "T", "zz", "H"]);
assert.equal(ev.kind, K.CDL_VOUCH);
assert.deepEqual(ev.content, { v: 1, has: true, endorsements: ["H", "T"] }, "known letters, once each, in order");
assert.deepEqual(ev.tags, [["d", "cdl-" + pk("courier")], ["p", pk("courier")]]);
assert.deepEqual(X.cdlUnvouchEvent(pk("courier")).content, { v: 1, has: false, endorsements: [] });

// ── Before any vouch there is nothing to show ──
publish("me", V.vouchEvent([pk("friend"), pk("friend2")]));
assert.equal(X.cdlTrustFor(pk("courier"), pk("me"), claim), null);
assert.equal(X.cdlTrustFor(pk("courier"), pk("me"), { has: false }), null, "no CDL claimed: nothing to confirm");

// ── Only me and the people I chose count ──
publish("friend", X.cdlVouchEvent(pk("courier"), ["H"]));
publish("stranger", X.cdlVouchEvent(pk("courier"), ["H", "T"])); // a stranger: not counted
publish("courier", X.cdlVouchEvent(pk("courier"), ["H", "T"])); // a vouch for oneself: ignored everywhere
assert.deepEqual(X.cdlVouchesFor(pk("courier")).map((v) => v.voucher).sort(), [pk("friend"), pk("stranger")].sort(), "a self-vouch is not a vouch");
let t = X.cdlTrustFor(pk("courier"), pk("me"), claim);
assert.deepEqual([t.cdl.n, t.direct, t.via], [1, false, [pk("friend")]]);
assert.deepEqual(t.endorsements, { H: { n: 1, direct: false }, T: { n: 0, direct: false } }, "H is confirmed, T is not: a vouch confirms only what it lists");
assert.equal(X.cdlTrustHeadline(t, claim), "CDL with H confirmed by 1 of your vouches");
assert.equal(X.cdlTrustDetail(t, () => "Sam"), "Sam");

// ── The newest vouch of a voucher counts; taking it back removes it ──
publish("friend2", X.cdlVouchEvent(pk("courier"), ["H", "T"]));
publish("friend", X.cdlVouchEvent(pk("courier"), ["T"])); // friend changes their mind: T only now
t = X.cdlTrustFor(pk("courier"), pk("me"), claim);
assert.deepEqual([t.endorsements.H.n, t.endorsements.T.n, t.cdl.n], [1, 2, 2]);
assert.equal(X.cdlTrustHeadline(t, claim), "CDL with H, T confirmed by 2 of your vouches");
publish("friend", X.cdlUnvouchEvent(pk("courier")));
publish("friend2", X.cdlUnvouchEvent(pk("courier")));
assert.equal(X.cdlTrustFor(pk("courier"), pk("me"), claim), null, "all taken back: nothing, not even a zero");

// ── My own vouch counts, and says so ──
publish("me", X.cdlVouchEvent(pk("courier"), ["H", "T"]));
t = X.cdlTrustFor(pk("courier"), pk("me"), claim);
assert.deepEqual([t.direct, t.via, t.endorsements.H.direct], [true, [], true]);
assert.equal(X.cdlTrustHeadline(t, claim), "You confirmed this CDL with H, T");
publish("friend2", X.cdlVouchEvent(pk("courier"), ["H"]));
t = X.cdlTrustFor(pk("courier"), pk("me"), claim);
assert.equal(X.cdlTrustHeadline(t, claim), "CDL with H, T confirmed by 1 of your vouches and by you");

// ── X covers H and N ──
publish("me", X.cdlUnvouchEvent(pk("courier")));
publish("friend2", X.cdlVouchEvent(pk("courier"), ["X"]));
t = X.cdlTrustFor(pk("courier"), pk("me"), { has: true, endorsements: ["H", "N"] });
assert.deepEqual([t.endorsements.H.n, t.endorsements.N.n], [1, 1], "a confirmed X endorsement covers hazmat and tank");

// ── One hop only, and the viewer matters ──
assert.equal(X.cdlTrustFor(pk("courier"), pk("deep"), claim), null, "someone who vouches for nobody sees nothing");
publish("deep", V.vouchEvent([pk("me")]));
assert.equal(X.cdlTrustFor(pk("courier"), pk("deep"), claim), null, "my vouches' vouches are two hops away");
assert.equal(X.cdlTrustFor(pk("courier"), pk("courier"), claim), null);
assert.equal(X.cdlTrustFor(null, pk("me"), claim), null);
assert.deepEqual(X.cdlVouchesFor("nothex"), []);

// A vouch whose content is junk, or that sits under another d-tag, counts for nothing.
relay._store(buildSignedEvent(K.CDL_VOUCH, "not json", [["d", "cdl-" + pk("deep")], ["p", pk("deep")], ["t", "nostrride"]], people.friend.sk));
relay._store(buildSignedEvent(K.CDL_VOUCH, { v: 1, has: true, endorsements: ["H"] }, [["d", "cdl-" + pk("me")], ["p", pk("deep")], ["t", "nostrride"]], people.friend.sk));
assert.deepEqual(X.cdlVouchesFor(pk("deep")), [], "only d = cdl-<that courier> counts");
console.log("cdl vouches: ok");
process.exit(0);
