// One-time notices: shown until the person says they understood, remembered per account, shown again when the version is raised.
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const N = await import(`${R}/lib/notices.js`);
const alice = "a".repeat(64), bob = "b".repeat(64);

assert.match(N.NOTICES.shipping.points.join(" "), /responsible for what you send/);
assert.match(N.NOTICES.shipping.points.join(" "), /illegal or dangerous goods are still illegal/i);
assert.equal(N.noticeSeen("shipping", alice), false, "new account: the notice is due");
N.markNoticeSeen("shipping", alice);
assert.equal(N.noticeSeen("shipping", alice), true, "once read, it stays read");
assert.equal(N.noticeSeen("shipping", bob), false, "per account: another person on this phone still sees it");
assert.ok([...store.keys()].some((k) => k.startsWith("nostrride_notice_shipping_" + alice.slice(0, 16))), "saved under a per-account key");
// A raised version shows again.
N.NOTICES.shipping.version = 2;
assert.equal(N.noticeSeen("shipping", alice), false, "new words: everyone reads them once more");
N.markNoticeSeen("shipping", alice);
assert.equal(N.noticeSeen("shipping", alice), true);
// Unknown notice or no account: nothing to show.
assert.equal(N.noticeSeen("nope", alice), true);
assert.equal(N.noticeSeen("shipping", null), true);
N.markNoticeSeen("nope", alice);
console.log("notices: ok");
