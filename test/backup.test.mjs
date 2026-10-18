// The account backup: blocks, settings, notices read and the vouch list, sealed to the person's own key (nsec), merged key by key
// between devices (the newer change wins), never uploaded before a reliable download, and never holding a secret.
// Run with: npm test
import assert from "node:assert/strict";
const R = new URL("../src", import.meta.url).pathname;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
};
const { relay } = await import(`${R}/nostr/relay.js`);
const S = await import(`${R}/config/relays.js`);
const B = await import(`${R}/lib/backup.js`);
const BS = await import(`${R}/nostr/backupSync.js`);
const V = await import(`${R}/lib/vouches.js`);
const { generateKeypair } = await import(`${R}/nostr/keys.js`);
const { buildSignedEvent } = await import(`${R}/nostr/events.js`);
const { EVENT_KINDS: K } = await import(`${R}/nostr/eventKinds.js`);

const kp = generateKeypair(), other = generateKeypair(), friend = generateKeypair(), bad = generateKeypair();
const me = { sk: kp.sk, publicKey: kp.publicKey };
const id16 = kp.publicKey.slice(0, 16);

// ── What is in the backup, and what never is ──
for (const key of ["blocked", "genderPref", "requestAlerts", "requestRadius", "courierRadius", "currency", "amountUnit", "trustedContacts", "ecashMint", "dark", "relays", `autoCashOut_${id16}`, `goget_context_${id16}`, `notice_shipping_${id16}`]) assert.equal(B.inBackup(key, kp.publicKey), true, key);
for (const key of ["key", "driver_key", "outbox", "prices", "riderDone", "driverDone", "stopsPassed", "tripShare", "declinedRides", "expiredNoted", "fold_ecash", `ecashOff_${id16}`, "_backup_x", `goget_context_${other.publicKey.slice(0, 16)}`, `notice_shipping_${other.publicKey.slice(0, 16)}`, "seedbox", ""])
  assert.equal(B.inBackup(key, kp.publicKey), false, `${key} stays on this device (a secret, a cache, or another account's)`);
assert.equal(B.inBackup(null, kp.publicKey), false);

// ── Values are checked: a damaged backup cannot break a setting ──
assert.equal(B.cleanValue("genderPref", "robot"), undefined);
assert.equal(B.cleanValue("genderPref", "female"), "female");
assert.equal(B.cleanValue("requestRadius", 99999), undefined);
assert.equal(B.cleanValue("currency", "XXX"), undefined);
assert.equal(B.cleanValue("currency", "EUR"), "EUR");
assert.equal(B.cleanValue("ecashMint", "javascript:alert(1)"), undefined);
assert.equal(B.cleanValue("relays", ["wss://relay.example"]) !== undefined, true);
assert.equal(B.cleanValue("relays", ["javascript:1"]), undefined);
assert.equal(B.cleanValue("goget_context_" + id16, "pirate"), undefined);
assert.equal(B.cleanValue("dark", "yes"), undefined);
assert.deepEqual(B.cleanValue("blocked", [{ pubkey: bad.publicKey, name: "x".repeat(200), at: 5 }, { pubkey: "nothex" }, null]), [{ pubkey: bad.publicKey, name: "x".repeat(60), at: 5 }]);
assert.deepEqual(B.cleanValue("autoCashOut_" + id16, { amount: "25", code: "USD" }), { amount: 25, code: "USD" });
assert.equal(B.cleanValue("autoCashOut_" + id16, { amount: 25, code: "ZZZ" }), undefined);
assert.equal(B.cleanValue("nonsense", 1), undefined);

// ── Set up a device: settings, stamped as they are saved ──
S.setSetting("blocked", [{ pubkey: bad.publicKey, name: "Spammer", at: 1 }], 1000);
S.setSetting("genderPref", "female", 2000);
S.setSetting("currency", "EUR", 3000);
S.setSetting(`notice_shipping_${id16}`, { version: 1, at: 5 }, 4000);
S.setSetting("prices", { prices: { USD: 1 }, at: 1 }, 5000); // a cache: not part of it
store.set("nostrride_key", JSON.stringify("ncryptsec1secret")); // the saved (encrypted) secret key: never part of it
S.setSetting(`goget_context_${other.publicKey.slice(0, 16)}`, "courier", 6000); // another account on this phone
assert.equal(S.settingChangedAt("genderPref"), 2000, "every write is stamped");
assert.equal(S.settingChangedAt("never"), 0);

// A vouch list exists (public).
const list = V.vouchEvent([friend.publicKey]);
relay._store(buildSignedEvent(list.kind, list.content, [...list.tags, ["t", "nostrride"]], kp.sk));

// ── The payload ──
let payload = BS.currentBackup(me, 9000);
assert.deepEqual(Object.keys(payload.settings).sort(), ["blocked", "currency", "genderPref", `notice_shipping_${id16}`].sort(), "only what belongs to the backup, and only this account's");
assert.deepEqual(payload.settings.genderPref, { value: "female", at: 2000 });
assert.deepEqual(payload.vouches, [friend.publicKey]);
assert.ok(!JSON.stringify(payload).includes("ncryptsec1"), "no secret key");
const h1 = B.backupHash(payload);
assert.equal(B.backupHash({ ...payload, at: 123456 }), h1, "the fingerprint ignores when it was made");
S.setSetting("genderPref", "male", 9500);
assert.notEqual(B.backupHash(BS.currentBackup(me, 9600)), h1, "a changed setting changes it");
S.setSetting("genderPref", "female", 2000);

// ── Sealed to the person's own key: a relay sees a blob ──
const ev = BS.backupEvent(me, payload);
assert.equal(ev.kind, K.SETTINGS_BACKUP);
assert.deepEqual(ev.tags, [["d", "backup"]]);
const wire = JSON.stringify(ev);
for (const secret of [bad.publicKey, "Spammer", "female", "EUR", friend.publicKey]) assert.ok(!wire.includes(secret), `the relay cannot read ${secret.slice(0, 8)}…`);
const signed = buildSignedEvent(ev.kind, ev.content, [...ev.tags, ["t", "nostrride"]], kp.sk);
relay._store(signed);
assert.deepEqual(BS.cachedBackup(me).settings.genderPref, { value: "female", at: 2000 }, "the owner opens it");
assert.equal(BS.cachedBackup({ sk: other.sk, publicKey: kp.publicKey }), null, "another key cannot");
// a backup someone else signed under my d-tag is not read as mine
relay._store(buildSignedEvent(ev.kind, ev.content, [...ev.tags, ["t", "nostrride"]], other.sk));
assert.equal(BS.cachedBackup({ sk: other.sk, publicKey: other.publicKey }), null, "its content is sealed to a different key pair");

// ── Merging key by key: the newer change wins ──
const remote = { v: 1, at: 1, vouches: [], settings: { genderPref: { value: "male", at: 2500 }, currency: { value: "GBP", at: 2999 }, dark: { value: true, at: 10 }, courierRadius: { value: 50, at: 0 }, [`goget_context_${other.publicKey.slice(0, 16)}`]: { value: "shipper", at: 99999 } } };
const local = { has: (k) => store.has("nostrride_" + k), changedAt: S.settingChangedAt };
const plan = B.planRestore(remote, local, kp.publicKey);
assert.deepEqual(plan.set.map((s) => s.key).sort(), ["courierRadius", "dark", "genderPref"].sort(), "newer remote wins, absent keys are filled, an older remote and another account's keys are not applied");
assert.equal(plan.set.find((s) => s.key === "genderPref").at, 2500);
const tie = B.planRestore({ ...remote, settings: { genderPref: { value: "male", at: 2000 } } }, local, kp.publicKey);
assert.deepEqual(tie.set, [], "a tie keeps what this device has");
assert.equal(B.readPayload({ v: 2 }, kp.publicKey), null, "an unknown version is not read");
assert.equal(B.readPayload({ v: 1, settings: { genderPref: { value: "robot", at: 1 }, key: { value: "x", at: 1 } } }, kp.publicKey).settings.genderPref, undefined, "junk values and non-backup keys are dropped on reading");

// ── A new phone: download, restore, and what the app is told ──
store.clear();
relay.pool.querySync = async (_r, f) => (f.kinds?.includes(K.SETTINGS_BACKUP) ? [signed] : []);
let linked = true; relay.linkUp = () => linked;
const down = await BS.downloadBackup(me);
assert.equal(down.reliable, true); assert.equal(down.payload.settings.currency.value, "EUR");
const applied = [], published = [];
const hooks = {
  apply: (key, value, at) => { applied.push(key); S.setSetting(key, value, at); },
  publishVouches: async (l) => { published.push(l); },
};
// the public vouch list is on a relay already: it is not republished
let res = await BS.restoreFrom(down.payload, me, hooks);
assert.deepEqual(applied.sort(), ["blocked", "currency", "genderPref", `notice_shipping_${id16}`].sort());
assert.deepEqual(res.changed.sort(), applied.sort());
assert.equal(res.vouches, false, "the account already has a public vouch list");
assert.equal(S.getSetting("genderPref", ""), "female"); assert.equal(S.settingChangedAt("genderPref"), 2000, "the backup's change time is kept");
// nothing changed since: restoring again does nothing
applied.length = 0;
res = await BS.restoreFrom(down.payload, me, hooks);
assert.deepEqual([res.changed, res.vouches], [[], false]);
// ...and the phone, now equal to the backup, has nothing to upload
const sent = [];
const publish = async (kind, content, tags) => { sent.push({ kind, content, tags }); return true; };
assert.equal(await BS.uploadIfChanged(me, publish), "same", "restored state is not uploaded again");
S.setSetting("genderPref", "male", 9999);
assert.equal(await BS.uploadIfChanged(me, publish), "sent", "a change is uploaded");
assert.equal(sent.length, 1); assert.equal(sent[0].kind, K.SETTINGS_BACKUP);
assert.equal(await BS.uploadIfChanged(me, publish), "same", "once");
// A person whose list was lost: the backup's vouches are published again
store.clear();
const freshMe = { sk: other.sk, publicKey: other.publicKey };
const otherBackup = { v: 1, at: 1, settings: {}, vouches: [friend.publicKey] };
res = await BS.restoreFrom(otherBackup, freshMe, hooks);
assert.deepEqual([res.vouches, published.length], [true, 1], "no public list on relays: the backup's vouches are published again");
assert.deepEqual(published[0], [friend.publicKey]);

// ── Nothing to back up: nothing is sent ──
store.clear();
assert.equal(await BS.uploadIfChanged({ sk: bad.sk, publicKey: bad.publicKey }, publish), "empty");

// ── An unreliable download (no relay connected) is not a reason to overwrite ──
linked = false;
const offline = await BS.downloadBackup(me);
assert.equal(offline.reliable, false, "no connected relay: the caller must not upload yet");
relay.pool.querySync = async () => { throw new Error("down"); };
linked = true;
assert.equal((await BS.downloadBackup(me)).reliable, false, "a failed query is not reliable either");

// ── A huge block list is cut to fit one event ──
const many = Array.from({ length: 500 }, (_, i) => ({ pubkey: i.toString(16).padStart(64, "0"), name: "N".repeat(60), at: i }));
S.setSetting("blocked", many, 1);
const fit = BS.currentBackup(me);
assert.ok(JSON.stringify(fit).length <= B.MAX_BACKUP_CHARS, "one event stays small enough for a relay");
console.log("backup: ok");
process.exit(0);
