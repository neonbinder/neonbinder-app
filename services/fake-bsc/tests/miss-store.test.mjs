// Durable catalogue misses (CONTRACT.md, "Durable misses"): DurableMisses on
// its own, the StateStore seams that drive it, and the server routes around
// it. Everything runs on a MemoryStore; a failing or hanging store is the
// same instance with one method replaced.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { FILTERS_PATH, LOADER, MemoryStore, setLogSink, startFake } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { canonicalRequest, requestKey } = require("../dist/src/requestKey.js");
const { SANITISE_ALLOWLIST_VERSION } = require("../dist/src/sanitise.js");
const { MISS_TTL_MS, MAX_MISSES_PER_NAMESPACE, MAX_PREFIX_MISS_LISTS, StateStore } = require("../dist/src/state.js");
const { DurableMisses, MAX_PERSISTED_MISSES, MISS_OBJECT_ROOT, missObjectName, missRecordFor, parseMissObjectName, readMissRecord } = require("../dist/src/missStore.js");
const { MISS_WRITE_BUDGET_MS } = require("../dist/src/routes/api.js");
const { readMissScope } = require("../dist/recorder/cli.js");
const { FakeClient } = require("../dist/recorder/fake-client.js");

const NS = "happy-cat-123-w0";
const BSC = `tok-${NS}`;
const T0 = Date.parse("2026-11-01T00:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

/** A catalogue filters miss as the StateStore holds it (a distinct key per `sport`). */
function filtersMiss(sport = "baseball", firstSeenMs = T0) {
  const request = canonicalRequest({ method: "POST", path: FILTERS_PATH, query: [], body: { filters: { sport: [sport] } } });
  return {
    key: requestKey(request),
    kind: "catalogue",
    method: "POST",
    path: FILTERS_PATH,
    endpoint: "filters",
    request,
    count: 1,
    firstSeen: iso(firstSeenMs),
    lastSeen: iso(firstSeenMs),
  };
}

/** What `StateStore.recordMiss` takes: a miss without its bookkeeping. */
const fresh = ({ count, firstSeen, lastSeen, ...rest }) => rest;

const stored = async (store) => (await store.listVersions(MISS_OBJECT_ROOT, 100_000)).map((v) => v.name).sort();

/** Wraps a store's create and delete to record what was asked of it. */
function watch(store) {
  const calls = { creates: [], deletes: [] };
  const create = store.createOnce.bind(store);
  const del = store.deleteVersion.bind(store);
  store.createOnce = async (name, value) => (calls.creates.push(name), create(name, value));
  store.deleteVersion = async (name, generation) => (calls.deletes.push({ name, generation }), del(name, generation));
  return calls;
}

/** A promise the test settles by hand. */
function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}

const lines = [];
beforeEach(() => {
  lines.length = 0;
  setLogSink((l) => lines.push(JSON.parse(l)));
});
afterEach(() => setLogSink(() => {}));

describe("miss object names", () => {
  const key = requestKey(canonicalRequest({ method: "POST", path: FILTERS_PATH, query: [], body: { filters: {} } }));

  it("names one object per owner kind and reads the name back", () => {
    const v = SANITISE_ALLOWLIST_VERSION;
    for (const [owner, name] of [
      [{ ns: NS }, `misses/v${v}/ns/${NS}/${key}.json`],
      [{ prefix: "happy-cat-" }, `misses/v${v}/prefix/happy-cat-/${key}.json`],
      [null, `misses/v${v}/anon/${key}.json`],
    ]) {
      assert.equal(missObjectName(owner, key), name);
      assert.deepEqual(parseMissObjectName(name), { allowlistVersion: v, owner, key });
    }
  });

  it("refuses a key or an owner that cannot name an object", () => {
    assert.equal(missObjectName({ ns: NS }, "not-a-hash"), null);
    assert.equal(missObjectName({ ns: "../x" }, key), null);
    assert.equal(missObjectName({ ns: "UPPER" }, key), null);
    assert.equal(missObjectName({ prefix: "no-trailing-dash" }, key), null);
    assert.equal(parseMissObjectName(`misses/v1/ns/${NS}/${key}.txt`), null);
    assert.equal(parseMissObjectName(`other/v1/anon/${key}.json`), null);
  });
});

describe("DurableMisses.save", () => {
  let store;
  let calls;
  let misses;
  beforeEach(() => {
    store = new MemoryStore();
    calls = watch(store);
    misses = new DurableMisses(store);
  });

  it("keeps a replayable catalogue miss as one object holding only what the recorder replays", async () => {
    const m = { ...filtersMiss(), count: 9, nearMiss: { key: "k", diffPaths: ["body.filters.sport"] } };
    await misses.save({ ns: NS }, m);
    assert.deepEqual(await stored(store), [missObjectName({ ns: NS }, m.key)]);
    const obj = await store.read(missObjectName({ ns: NS }, m.key));
    assert.deepEqual(Object.keys(obj).sort(), ["allowlistVersion", "endpoint", "firstSeen", "key", "method", "owner", "path", "request", "schema"]);
    assert.deepEqual(obj.owner, { ns: NS });
    assert.deepEqual(obj.request.body, { filters: { sport: ["baseball"] } });
    assert.equal(JSON.stringify(obj).includes("diffPaths"), false, "no near miss");
    assert.equal(JSON.stringify(obj).includes('"count"'), false, "no count");
  });

  it("writes an owner's key once however often it is missed, and once per owner", async () => {
    const m = filtersMiss();
    await misses.save({ ns: NS }, m);
    await misses.save({ ns: NS }, { ...m, count: 5 });
    assert.equal(calls.creates.length, 1);
    await misses.save({ ns: "other-ns" }, m);
    await misses.save(null, m);
    await misses.save({ prefix: "happy-cat-" }, m);
    assert.equal(calls.creates.length, 4, "each owner has its own object");
    assert.equal((await stored(store)).length, 4);
  });

  it("does not write a second object after a restart: the create finds the first", async () => {
    const m = filtersMiss();
    await misses.save({ ns: NS }, m);
    const again = new DurableMisses(store);
    await again.save({ ns: NS }, m);
    assert.equal((await stored(store)).length, 1);
    assert.equal(again.size, 1);
  });

  it("refuses what the replay allowlist refuses, and keeps no needs-model miss", async () => {
    const good = filtersMiss();
    const withQuery = { ...good, request: canonicalRequest({ method: "POST", path: FILTERS_PATH, query: [["x", "1"]], body: { filters: { sport: ["baseball"] } } }) };
    withQuery.key = requestKey(withQuery.request);
    const badSlug = filtersMiss("base ball");
    const badFacet = (() => {
      const request = canonicalRequest({ method: "POST", path: FILTERS_PATH, query: [], body: { filters: { seller: ["x"] } } });
      return { ...good, request, key: requestKey(request) };
    })();
    const bigBody = (() => {
      const request = canonicalRequest({ method: "POST", path: FILTERS_PATH, query: [], body: { filters: { sport: Array.from({ length: 50 }, (_, i) => `slug-${i}-${"x".repeat(95)}`) } } });
      return { ...good, request, key: requestKey(request) };
    })();
    const wrongKey = { ...good, key: "0".repeat(64) };
    const needsModel = { key: "1".repeat(64), kind: "needs-model", method: "POST", path: "seller/x", count: 1, firstSeen: iso(T0), lastSeen: iso(T0) };
    for (const [label, m] of Object.entries({ withQuery, badSlug, badFacet, bigBody, wrongKey, needsModel })) {
      await misses.save({ ns: NS }, m);
      assert.deepEqual(await stored(store), [], label);
    }
    assert.equal(calls.creates.length, 0);
    assert.equal(misses.size, 0);
  });

  it("refuses an owner that cannot name an object", async () => {
    await misses.save({ ns: "Not A Namespace" }, filtersMiss());
    await misses.save({ prefix: "abc" }, filtersMiss());
    assert.deepEqual(await stored(store), []);
  });

  it("settles when the store fails, keeps nothing, and lets a later miss of the key try again", async () => {
    const create = store.createOnce.bind(store);
    let fail = true;
    store.createOnce = async (n, v) => {
      if (fail) throw new Error("secret detail: nope");
      return create(n, v);
    };
    const m = filtersMiss();
    await assert.doesNotReject(misses.save({ ns: NS }, m));
    assert.equal(misses.size, 0);
    const failed = lines.find((l) => l.operation === "miss_persist_failed");
    assert.ok(failed, "logged");
    assert.equal(failed.error, "Error");
    assert.equal(JSON.stringify(failed).includes("secret detail"), false, "the error class only, never its message");
    fail = false;
    await misses.save({ ns: NS }, m);
    assert.equal((await stored(store)).length, 1);
  });
});

describe("DurableMisses removal", () => {
  let store;
  let calls;
  beforeEach(() => {
    store = new MemoryStore();
    calls = watch(store);
  });

  it("deletes the exact generation it created", async () => {
    const misses = new DurableMisses(store);
    const m = filtersMiss();
    await misses.save({ ns: NS }, m);
    const [{ generation }] = await store.listVersions(MISS_OBJECT_ROOT, 10);
    await misses.remove({ ns: NS }, m.key);
    assert.deepEqual(calls.deletes, [{ name: missObjectName({ ns: NS }, m.key), generation }]);
    assert.deepEqual(await stored(store), []);
    assert.equal(misses.size, 0);
  });

  it("finds the live generation of an object it did not create (it existed before a restart)", async () => {
    const m = filtersMiss();
    const first = new DurableMisses(store);
    await first.save({ ns: NS }, m);
    const second = new DurableMisses(store);
    await second.save({ ns: NS }, m); // create answers null: already there
    const [{ generation }] = await store.listVersions(MISS_OBJECT_ROOT, 10);
    await second.remove({ ns: NS }, m.key);
    assert.deepEqual(calls.deletes.map((d) => d.generation), [generation]);
    assert.deepEqual(await stored(store), []);
  });

  it("removes only the named owner's object; removeKey removes every owner's, and no other key's", async () => {
    const misses = new DurableMisses(store);
    const a = filtersMiss("baseball");
    const b = filtersMiss("football");
    for (const owner of [{ ns: NS }, { ns: "other-ns" }, { prefix: "happy-cat-" }, null]) {
      await misses.save(owner, a);
      await misses.save(owner, b);
    }
    await misses.remove({ ns: NS }, a.key);
    assert.equal((await stored(store)).length, 7);
    assert.ok(!(await stored(store)).includes(missObjectName({ ns: NS }, a.key)));
    await misses.removeKey(a.key);
    const left = await stored(store);
    assert.equal(left.length, 4);
    assert.ok(left.every((n) => n.endsWith(`${b.key}.json`)));
    assert.equal(misses.size, 4);
  });

  it("a delete queued behind a slow create still removes the object", async () => {
    const g = gate();
    const create = store.createOnce.bind(store);
    store.createOnce = async (n, v) => (await g.promise, create(n, v));
    const misses = new DurableMisses(store);
    const m = filtersMiss();
    const saving = misses.save({ ns: NS }, m);
    const removing = misses.remove({ ns: NS }, m.key);
    g.open();
    await Promise.all([saving, removing]);
    assert.deepEqual(await stored(store), []);
    assert.equal(misses.size, 0);
  });

  it("a miss saved again right after its removal ends with exactly one object", async () => {
    const g = gate();
    const create = store.createOnce.bind(store);
    let first = true;
    store.createOnce = async (n, v) => {
      if (first) {
        first = false;
        await g.promise;
      }
      return create(n, v);
    };
    const misses = new DurableMisses(store);
    const m = filtersMiss();
    const ops = [misses.save({ ns: NS }, m), misses.remove({ ns: NS }, m.key), misses.save({ ns: NS }, m)];
    g.open();
    await Promise.all(ops);
    assert.deepEqual(await stored(store), [missObjectName({ ns: NS }, m.key)]);
    assert.equal(misses.size, 1);
  });

  it("a failed delete is logged and leaves the object for the next boot", async () => {
    const misses = new DurableMisses(store);
    const m = filtersMiss();
    await misses.save({ ns: NS }, m);
    store.deleteVersion = async () => {
      throw new Error("down");
    };
    await assert.doesNotReject(misses.remove({ ns: NS }, m.key));
    assert.equal((await stored(store)).length, 1);
    assert.ok(lines.some((l) => l.operation === "miss_delete_failed" && l.reason === "evicted"));
  });

  it("expire removes what was first seen before the cutoff, and keeps a miss first seen exactly at it", async () => {
    const misses = new DurableMisses(store);
    const cutoff = T0;
    const old = filtersMiss("old", cutoff - 1);
    const edge = filtersMiss("edge", cutoff);
    const young = filtersMiss("young", cutoff + 1);
    for (const m of [old, edge, young]) await misses.save({ ns: NS }, m);
    await misses.expire(cutoff);
    assert.deepEqual(await stored(store), [edge, young].map((m) => missObjectName({ ns: NS }, m.key)).sort());
  });

  it("removeAll removes the objects it knows and the ones it never saw", async () => {
    const misses = new DurableMisses(store);
    await misses.save({ ns: NS }, filtersMiss("baseball"));
    const stray = filtersMiss("football");
    await store.createOnce(missObjectName(null, stray.key), missRecordFor(null, stray).record);
    await store.createOnce(`misses/v0/anon/${"a".repeat(64)}.json`, { anything: true });
    await store.write("manifest.json", { version: 1 });
    await misses.removeAll();
    assert.deepEqual(await stored(store), []);
    assert.notEqual(await store.read("manifest.json"), null, "nothing outside misses/ is touched");
    assert.equal(misses.size, 0);
  });
});

describe("DurableMisses cap", () => {
  it("removes the oldest object when a miss would pass the cap, whatever order they arrive in", async () => {
    const store = new MemoryStore();
    const misses = new DurableMisses(store, { maxPersisted: 3 });
    const sports = ["a1", "a2", "a3", "a4"];
    // The newest arrives first, so "oldest" is by firstSeen, not arrival.
    const ms = [filtersMiss(sports[0], T0 + 3000), filtersMiss(sports[1], T0), filtersMiss(sports[2], T0 + 2000), filtersMiss(sports[3], T0 + 4000)];
    for (const m of ms) await misses.save({ ns: NS }, m);
    assert.equal(misses.size, 3);
    assert.deepEqual(await stored(store), [ms[0], ms[2], ms[3]].map((m) => missObjectName({ ns: NS }, m.key)).sort());
  });

  it("never removes the miss being saved, even when it is the oldest", async () => {
    const store = new MemoryStore();
    const misses = new DurableMisses(store, { maxPersisted: 2 });
    await misses.save({ ns: NS }, filtersMiss("b1", T0 + 2000));
    await misses.save({ ns: NS }, filtersMiss("b2", T0 + 3000));
    const oldest = filtersMiss("b3", T0);
    await misses.save({ ns: NS }, oldest);
    assert.ok((await stored(store)).includes(missObjectName({ ns: NS }, oldest.key)));
    assert.equal((await stored(store)).length, 2);
  });

  it("holds 2,000 by default", () => {
    assert.equal(MAX_PERSISTED_MISSES, 2000);
  });

  it("a miss evicted past the cap stays listed in memory", async () => {
    const store = new MemoryStore();
    const state = new StateStore(() => T0, new DurableMisses(store, { maxPersisted: 1 }));
    const a = filtersMiss("c1");
    const b = filtersMiss("c2");
    state.recordMiss({ ns: NS }, fresh(a));
    await state.flushMisses(1000);
    state.recordMiss({ ns: NS }, fresh(b));
    await state.flushMisses(1000);
    assert.equal((await stored(store)).length, 1);
    assert.deepEqual(state.listMisses({ ns: NS }).map((m) => m.key).sort(), [a.key, b.key].sort());
  });
});

describe("DurableMisses.restore", () => {
  let store;
  let calls;
  beforeEach(() => {
    store = new MemoryStore();
    calls = watch(store);
  });
  const plant = async (owner, m, over = {}) => {
    const name = missObjectName(owner, m.key);
    await store.createOnce(name, { ...missRecordFor(owner, m).record, ...over });
    return name;
  };
  const never = () => false;

  it("returns valid, current, unrecorded misses with count 1 and lastSeen = firstSeen", async () => {
    const m = filtersMiss("baseball", T0);
    await plant({ ns: NS }, m);
    const out = await new DurableMisses(store).restore(T0 + 1000, never);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].owner, { ns: NS });
    assert.equal(out[0].miss.key, m.key);
    assert.equal(out[0].miss.count, 1);
    assert.equal(out[0].miss.firstSeen, iso(T0));
    assert.equal(out[0].miss.lastSeen, iso(T0));
    assert.deepEqual(out[0].miss.request.body, { filters: { sport: ["baseball"] } });
  });

  it("deletes an object that fails validation, and keeps the valid one beside it", async () => {
    const good = filtersMiss("good");
    const goodName = await plant({ ns: NS }, good);
    const bad = filtersMiss("bad");
    const badName = await plant({ ns: NS }, bad, { schema: 2 });
    const body = filtersMiss("body");
    const bodyName = await plant({ ns: NS }, body, { request: { method: "POST", path: FILTERS_PATH, query: [], body: { filters: { seller: ["x"] } } } });
    const owner = filtersMiss("owner");
    const ownerName = await plant({ ns: NS }, owner, { owner: { ns: "someone-else" } });
    const key = filtersMiss("key");
    const keyName = await plant({ ns: NS }, key, { key: "f".repeat(64) });
    const date = filtersMiss("date");
    const dateName = await plant({ ns: NS }, date, { firstSeen: "yesterday" });
    const endpoint = filtersMiss("endpoint");
    const endpointName = await plant({ ns: NS }, endpoint, { endpoint: "results" });
    const out = await new DurableMisses(store).restore(T0, never);
    assert.deepEqual(out.map((o) => o.miss.key), [good.key]);
    assert.deepEqual(await stored(store), [goodName]);
    for (const n of [badName, bodyName, ownerName, keyName, dateName, endpointName]) assert.ok(calls.deletes.some((d) => d.name === n), n);
    assert.equal(lines.find((l) => l.operation === "misses_restored").deleted, 6);
  });

  it("deletes an object kept under another allowlist version without reading it", async () => {
    const m = filtersMiss();
    const old = missObjectName({ ns: NS }, m.key, SANITISE_ALLOWLIST_VERSION + 1);
    await store.createOnce(old, missRecordFor({ ns: NS }, m).record);
    let reads = 0;
    const read = store.readVersion.bind(store);
    store.readVersion = async (n, g) => (reads++, read(n, g));
    const out = await new DurableMisses(store).restore(T0, never);
    assert.deepEqual(out, []);
    assert.equal(reads, 0);
    assert.deepEqual(await stored(store), []);
  });

  it("deletes an object whose body claims another allowlist version", async () => {
    const m = filtersMiss();
    await plant({ ns: NS }, m, { allowlistVersion: SANITISE_ALLOWLIST_VERSION + 1 });
    assert.deepEqual(await new DurableMisses(store).restore(T0, never), []);
    assert.deepEqual(await stored(store), []);
  });

  it("deletes an object under misses/ whose name is not a miss object at all", async () => {
    await store.createOnce("misses/notes.txt", { x: 1 });
    await store.createOnce(`misses/v1/ns/UPPER/${"a".repeat(64)}.json`, { x: 1 });
    assert.deepEqual(await new DurableMisses(store).restore(T0, never), []);
    assert.deepEqual(await stored(store), []);
  });

  it("deletes an object whose request already has a recording, asking by key", async () => {
    const recorded = filtersMiss("recorded");
    const open = filtersMiss("open");
    await plant({ ns: NS }, recorded);
    await plant({ prefix: "happy-cat-" }, recorded);
    const openName = await plant({ ns: NS }, open);
    const asked = [];
    const out = await new DurableMisses(store).restore(T0, (k) => (asked.push(k), k === recorded.key));
    assert.deepEqual(out.map((o) => o.miss.key), [open.key]);
    assert.deepEqual(await stored(store), [openName]);
    assert.ok(asked.includes(recorded.key));
  });

  it("keeps a miss first seen exactly 30 days ago and deletes one a millisecond older", async () => {
    const now = T0 + MISS_TTL_MS;
    const edge = filtersMiss("edge", T0);
    const old = filtersMiss("old", T0 - 1);
    const edgeName = await plant({ ns: NS }, edge);
    await plant({ ns: NS }, old);
    const out = await new DurableMisses(store).restore(now, never);
    assert.deepEqual(out.map((o) => o.miss.key), [edge.key]);
    assert.deepEqual(await stored(store), [edgeName]);
  });

  it("keeps the newest 500 per owner and deletes the rest", async () => {
    const total = MAX_MISSES_PER_NAMESPACE + 3;
    const all = Array.from({ length: total }, (_, i) => filtersMiss(`p${i}`, T0 + i * 1000));
    for (const m of all) await plant({ ns: NS }, m);
    await plant({ ns: "other-ns" }, all[0]);
    const out = await new DurableMisses(store).restore(T0 + total * 1000, never);
    const mine = out.filter((o) => o.owner.ns === NS).map((o) => o.miss.key);
    assert.equal(mine.length, MAX_MISSES_PER_NAMESPACE);
    assert.deepEqual(new Set(mine), new Set(all.slice(3).map((m) => m.key)), "the three oldest go");
    assert.equal(out.filter((o) => o.owner.ns === "other-ns").length, 1, "another owner has its own 500");
    assert.equal((await stored(store)).length, MAX_MISSES_PER_NAMESPACE + 1);
  });

  it("keeps the newest objects up to the total cap and deletes the oldest", async () => {
    const all = [0, 1, 2, 3, 4].map((i) => filtersMiss(`t${i}`, T0 + i * 1000));
    for (const [i, m] of all.entries()) await plant(i % 2 ? { ns: NS } : null, m);
    const misses = new DurableMisses(store, { maxPersisted: 3 });
    const out = await misses.restore(T0 + 10_000, never);
    assert.deepEqual(new Set(out.map((o) => o.miss.key)), new Set(all.slice(2).map((m) => m.key)));
    assert.equal((await stored(store)).length, 3);
    assert.equal(misses.size, 3);
  });

  it("survives a failed listing and a failed read: nothing is deleted, the fake carries on", async () => {
    const m = filtersMiss();
    await plant({ ns: NS }, m);
    const failList = new DurableMisses(store);
    const list = store.listVersions.bind(store);
    store.listVersions = async () => {
      throw new Error("down");
    };
    assert.deepEqual(await failList.restore(T0, never), []);
    assert.ok(lines.some((l) => l.operation === "misses_restore_failed"));
    store.listVersions = list;
    store.readVersion = async () => {
      throw new Error("down");
    };
    assert.deepEqual(await new DurableMisses(store).restore(T0, never), []);
    assert.equal((await stored(store)).length, 1, "a read that failed leaves the object for the next boot");
  });

  it("readMissRecord rejects a record read back under a different owner's name", async () => {
    const m = filtersMiss();
    const rec = missRecordFor({ ns: NS }, m).record;
    assert.ok(readMissRecord(missObjectName({ ns: NS }, m.key), rec));
    assert.equal(readMissRecord(missObjectName(null, m.key), rec), null);
    assert.equal(readMissRecord(missObjectName({ ns: NS }, m.key), [rec]), null);
  });
});

describe("StateStore with durable misses", () => {
  let store;
  let now;
  let state;
  const fresh2 = (persistence) => new StateStore(() => now, persistence);
  beforeEach(() => {
    store = new MemoryStore();
    now = T0;
    state = fresh2(new DurableMisses(store));
  });
  const flush = async (s = state) => assert.equal(await s.flushMisses(2000), true);
  const record = (owner, m, s = state) => s.recordMiss(owner, fresh(m));

  it("a miss survives a new StateStore on the same store: same key, firstSeen and request, count back to 1", async () => {
    const m = filtersMiss("baseball", T0);
    record({ ns: NS }, m);
    record({ ns: NS }, m);
    record({ prefix: "happy-cat-" }, filtersMiss("football"));
    record(null, filtersMiss("hockey"));
    await flush();
    now = T0 + 5000;
    const next = fresh2(new DurableMisses(store));
    assert.equal(await next.restoreMisses((k) => k === "never"), 3);
    const back = next.listMisses({}).find((x) => x.key === m.key);
    assert.equal(back.ns, NS);
    assert.equal(back.count, 1);
    assert.equal(back.firstSeen, iso(T0));
    assert.equal(back.lastSeen, iso(T0));
    assert.deepEqual(back.request.body, { filters: { sport: ["baseball"] } });
    assert.deepEqual(next.listMisses({}).map((x) => [x.ns, x.prefix ?? null]).sort((x, y) => String(x).localeCompare(String(y))), [[NS, null], [null, "happy-cat-"], [null, null]].sort((x, y) => String(x).localeCompare(String(y))));
  });

  it("the same owner and key is written once, however often it is missed", async () => {
    const calls = watch(store);
    const m = filtersMiss();
    for (let i = 0; i < 4; i++) record({ ns: NS }, m);
    await flush();
    assert.equal(calls.creates.length, 1);
    assert.equal(state.listMisses({ ns: NS })[0].count, 4);
  });

  it("a needs-model miss is not written", async () => {
    state.recordMiss({ ns: NS }, { key: "2".repeat(64), kind: "needs-model", method: "POST", path: "seller/x" });
    await flush();
    assert.deepEqual(await stored(store), []);
  });

  it("a stored recording removes the miss for every owner, and a restart does not bring it back", async () => {
    const m = filtersMiss();
    const other = filtersMiss("football");
    for (const owner of [{ ns: NS }, { ns: "other-ns" }, { prefix: "happy-cat-" }, null]) {
      record(owner, m);
      record(owner, other);
    }
    await flush();
    assert.equal((await stored(store)).length, 8);
    state.clearMiss(m.key);
    await flush();
    const left = await stored(store);
    assert.equal(left.length, 4);
    assert.ok(left.every((n) => n.endsWith(`${other.key}.json`)));
    const next = fresh2(new DurableMisses(store));
    await next.restoreMisses(() => false);
    assert.equal(next.listMisses({}).filter((x) => x.key === m.key).length, 0);
  });

  it("reset keeps the objects; reset-all removes every one, strays included", async () => {
    record({ ns: NS }, filtersMiss());
    record({ prefix: "happy-cat-" }, filtersMiss("football"));
    await flush();
    const strayMiss = filtersMiss("stray");
    await store.createOnce(missObjectName({ ns: "gone-ns" }, strayMiss.key), missRecordFor({ ns: "gone-ns" }, strayMiss).record);
    state.reset({ prefix: "happy-cat-" });
    state.reset({ ns: NS });
    await flush();
    assert.equal((await stored(store)).length, 3);
    assert.equal(state.listMisses({}).length, 2);
    state.resetAll();
    await flush();
    assert.deepEqual(await stored(store), []);
    assert.equal(state.listMisses({}).length, 0);
  });

  it("expireMisses drops a miss first seen over 30 days ago from memory and the bucket, and keeps one exactly 30 days old", async () => {
    const old = filtersMiss("old", T0);
    const edge = filtersMiss("edge", T0 + 1);
    record({ ns: NS }, { ...old });
    now = T0 + 1;
    record({ ns: NS }, edge);
    await flush();
    now = T0 + 1 + MISS_TTL_MS; // edge is exactly 30 days old; old is 30 days and 1 ms
    assert.equal(state.expireMisses(), 1);
    await flush();
    assert.deepEqual(state.listMisses({ ns: NS }).map((m) => m.key), [edge.key]);
    assert.deepEqual(await stored(store), [missObjectName({ ns: NS }, edge.key)]);
    now += 1;
    assert.equal(state.expireMisses(), 1);
    await flush();
    assert.deepEqual(await stored(store), []);
  });

  it("evicting the oldest of an owner's 500 removes its object too", async () => {
    const first = filtersMiss("e0", T0);
    record({ ns: NS }, first);
    for (let i = 1; i <= MAX_MISSES_PER_NAMESPACE; i++) record({ ns: NS }, filtersMiss(`e${i}`, T0 + i));
    await flush();
    assert.equal(state.listMisses({ ns: NS }).length, MAX_MISSES_PER_NAMESPACE);
    const names = await stored(store);
    assert.equal(names.length, MAX_MISSES_PER_NAMESPACE);
    assert.ok(!names.includes(missObjectName({ ns: NS }, first.key)));
  });

  it("dropping the oldest prefix list past 200 removes that prefix's objects too", async () => {
    const m = filtersMiss();
    for (let i = 0; i <= MAX_PREFIX_MISS_LISTS; i++) record({ prefix: `pfx${i}-` }, m);
    await flush();
    const names = await stored(store);
    assert.equal(names.length, MAX_PREFIX_MISS_LISTS);
    assert.ok(!names.includes(missObjectName({ prefix: "pfx0-" }, m.key)));
    assert.ok(names.includes(missObjectName({ prefix: `pfx${MAX_PREFIX_MISS_LISTS}-` }, m.key)));
  });

  it("flushMisses answers false after the budget when the store hangs, and never rejects", async () => {
    store.createOnce = () => new Promise(() => undefined);
    record({ ns: NS }, filtersMiss());
    assert.equal(state.pendingMissWrites, 1);
    const started = Date.now();
    // flushMisses' own timer is unref'd (it must not hold a server open), so the test holds the loop.
    const hold = setInterval(() => undefined, 20);
    try {
      assert.equal(await state.flushMisses(60), false);
    } finally {
      clearInterval(hold);
    }
    assert.ok(Date.now() - started < 1000);
    assert.equal(state.pendingMissWrites, 1, "the write carries on");
    assert.equal(await new StateStore().flushMisses(10), true, "nothing pending: true at once");
  });

  it("a state with no persistence restores nothing and writes nothing", async () => {
    const plain = new StateStore(() => T0);
    plain.recordMiss({ ns: NS }, fresh(filtersMiss()));
    assert.equal(await plain.flushMisses(10), true);
    assert.equal(await plain.restoreMisses(() => false), 0);
  });

  it("a restore that finds a miss already listed keeps its count and the earlier firstSeen", async () => {
    const m = filtersMiss("early", T0);
    record({ ns: NS }, m);
    await flush();
    now = T0 + 9000;
    const s = fresh2(new DurableMisses(store));
    record({ ns: NS }, { ...filtersMiss("early", T0 + 9000) }, s);
    record({ ns: NS }, filtersMiss("early", T0 + 9000), s);
    assert.equal(await s.restoreMisses(() => false), 0);
    const got = s.listMisses({ ns: NS })[0];
    assert.equal(got.count, 2);
    assert.equal(got.firstSeen, iso(T0), "the earlier firstSeen wins");
  });

  it("a miss seen while the restore is still listing learns the object's generation, so its recording removes it", async () => {
    const m = filtersMiss("raced", T0);
    await store.createOnce(missObjectName({ ns: NS }, m.key), missRecordFor({ ns: NS }, m).record);
    const g = gate();
    const list = store.listVersions.bind(store);
    store.listVersions = async (p, n) => (await g.promise, list(p, n));
    const s = fresh2(new DurableMisses(store));
    const restoring = s.restoreMisses(() => false);
    record({ ns: NS }, m, s); // its create finds the object already there
    await s.flushMisses(1000);
    g.open();
    await restoring;
    assert.equal(s.listMisses({ ns: NS }).length, 1);
    assert.equal((await stored(store)).length, 1, "one object, not two");
    s.clearMiss(m.key);
    await s.flushMisses(1000);
    assert.deepEqual(await stored(store), []);
  });
});

describe("misses over HTTP", () => {
  let store;
  let fake;
  let calls;
  beforeEach(async () => {
    store = new MemoryStore();
    calls = watch(store);
    fake = await startFake({ store, persistence: new DurableMisses(store) });
  });
  afterEach(() => fake.close());

  const missFilters = (sport = "baseball", extra = {}) => fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body: { filters: { sport: [sport] } }, ...extra });

  it("keeps the miss before it answers 501", async () => {
    const r = await missFilters();
    assert.equal(r.status, 501);
    assert.equal(r.headers.get("x-nb-fake"), "unrecorded");
    assert.equal((await stored(store)).length, 1, "the object is there by the time the answer is");
  });

  it("answers the same 501 when the store fails", async () => {
    store.createOnce = async () => {
      throw new Error("down");
    };
    const r = await missFilters();
    assert.equal(r.status, 501);
    assert.equal(r.body.error, "unrecorded");
    assert.equal(fake.state.listMisses({ ns: NS }).length, 1, "still on the in-memory list");
  });

  it("answers 501 within the write budget when the store hangs", async () => {
    store.createOnce = () => new Promise(() => undefined);
    const started = Date.now();
    const r = await missFilters();
    const took = Date.now() - started;
    assert.equal(r.status, 501);
    assert.ok(took >= MISS_WRITE_BUDGET_MS - 100, `waited for the write first (${took} ms)`);
    assert.ok(took < MISS_WRITE_BUDGET_MS + 1500, `then answered (${took} ms)`);
  });

  it("does not wait for the store on a needs-model miss", async () => {
    store.createOnce = () => new Promise(() => undefined);
    const started = Date.now();
    const r = await fake.call("POST", "/api/seller/x", { bsc: BSC, body: {} });
    assert.equal(r.status, 501);
    assert.ok(Date.now() - started < 1000);
  });

  it("repeats of a miss write nothing more", async () => {
    await missFilters();
    await missFilters();
    await missFilters();
    assert.equal(calls.creates.length, 1);
    assert.equal(fake.state.listMisses({ ns: NS })[0].count, 3);
  });

  it("an upload of its recording removes the objects of every owner before it answers", async () => {
    await missFilters();
    await missFilters("baseball", { bsc: "tok-other-ns" });
    // Prefix and anonymous owners reach the list through card-listing; the same request key is shared by hand here.
    const m = filtersMiss("baseball");
    fake.state.recordMiss({ prefix: "other-slug-" }, fresh(m));
    fake.state.recordMiss(null, fresh(m));
    await fake.state.flushMisses(2000);
    assert.equal((await stored(store)).length, 4);
    const body = { filters: { sport: ["baseball"] } };
    const up = await fake.call("POST", "/__fake/recordings", {
      email: LOADER,
      admin: true,
      body: { recordings: [{ request: { method: "POST", path: FILTERS_PATH, query: [], body }, response: { status: 200, body: { aggregations: {} } }, allowlistVersion: SANITISE_ALLOWLIST_VERSION }] },
    });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.deepEqual(await stored(store), []);
  });

  it("reset keeps the objects, reset-all removes them and says so", async () => {
    await missFilters();
    assert.equal((await fake.call("POST", "/__fake/reset", { body: { prefix: "happy-cat-" } })).status, 200);
    assert.equal((await stored(store)).length, 1);
    const r = await fake.call("POST", "/__fake/reset-all", { email: LOADER, admin: true, body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.body.missesRemoved, true);
    assert.deepEqual(await stored(store), []);
  });

  it("a new process on the same store lists the miss once it has restored", async () => {
    await missFilters("baseball");
    await missFilters("football");
    await fake.close();
    const next = new DurableMisses(store);
    const probe = await startFake({ store, persistence: next });
    fake = probe;
    assert.equal(probe.state.listMisses({}).length, 0, "nothing in memory before the restore");
    assert.equal(await probe.state.restoreMisses((k) => probe.catalogue.get(k) !== undefined), 2);
    const r = await probe.call("GET", "/__fake/misses?prefix=happy-cat-");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.misses.map((m) => [m.ns, m.count]), [[NS, 1], [NS, 1]]);
  });

  it("the TTL sweep on a miss read removes an expired miss from the list and the bucket", async () => {
    let t = T0;
    await fake.close();
    const s2 = new MemoryStore();
    fake = await startFake({ store: s2, persistence: new DurableMisses(s2), now: () => t });
    await missFilters();
    assert.equal((await stored(s2)).length, 1);
    t = T0 + MISS_TTL_MS + 1;
    const r = await fake.call("GET", `/__fake/misses?ns=${NS}`);
    assert.deepEqual(r.body.misses, []);
    assert.deepEqual(await stored(s2), []);
  });
});

describe("the miss list while misses restore", () => {
  it("holds GET /__fake/misses until the restore is done, and does not hold /api", async () => {
    const store = new MemoryStore();
    const done = gate();
    let loading = true;
    const fake = await startFake({ store, persistence: new DurableMisses(store), appOver: { missesLoading: () => loading, missesLoaded: done.promise } });
    try {
      const settled = [];
      const held = fake.call("GET", "/__fake/misses?prefix=happy-cat-").then((r) => (settled.push("misses"), r));
      const profile = await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC });
      assert.equal(profile.status, 200, "/api answers while the misses restore");
      await new Promise((r) => setTimeout(r, 150));
      assert.deepEqual(settled, []);
      loading = false;
      done.open();
      assert.equal((await held).status, 200);
    } finally {
      await fake.close();
    }
  });

  it("answers 503 loading when the restore outlasts the hold", async () => {
    const fake = await startFake({ appOver: { missesLoading: () => true, missesLoaded: new Promise(() => undefined), loadWaitMs: 100 } });
    try {
      const r = await fake.call("GET", "/__fake/misses?prefix=happy-cat-");
      assert.equal(r.status, 503);
      assert.equal(r.headers.get("x-nb-fake"), "loading");
    } finally {
      await fake.close();
    }
  });
});

// Races in the boot window: the restore reads the kept misses, then (after it
// has judged them) still has work to finish before it puts them back in
// memory. A stored recording or a reset-all that ran in that gap used to be
// undone by the restore. Both are now held until the restore is done.
describe("bulk miss removals while misses restore", () => {
  const body = { filters: { sport: ["baseball"] } };
  const recordingUpload = { recordings: [{ request: { method: "POST", path: FILTERS_PATH, query: [], body }, response: { status: 200, body: { aggregations: {} } }, allowlistVersion: SANITISE_ALLOWLIST_VERSION }] };
  const INVALID = `${MISS_OBJECT_ROOT}v${SANITISE_ALLOWLIST_VERSION}/ns/${NS}/${"f".repeat(64)}.json`;

  /**
   * A store holding one kept miss (baseball, for NS) and one invalid object
   * whose delete stalls until the test opens `stall`: the restore has judged
   * every object and indexed the kept one, but has not yet handed it back.
   * Then a new process on that store, its restore started the way index.ts
   * starts it.
   */
  async function restoringFake() {
    const store = new MemoryStore();
    const first = await startFake({ store, persistence: new DurableMisses(store) });
    await first.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body });
    await first.close();
    await store.createOnce(INVALID, { not: "a miss" });
    assert.equal((await stored(store)).length, 2);

    const stall = gate();
    const stalled = gate();
    const del = store.deleteVersion.bind(store);
    store.deleteVersion = async (name, generation) => {
      if (name === INVALID) {
        stalled.open();
        await stall.promise;
      }
      return del(name, generation);
    };
    let loading = true;
    const done = gate();
    const fake = await startFake({ store, persistence: new DurableMisses(store), appOver: { missesLoading: () => loading, missesLoaded: done.promise } });
    const restore = fake.state.restoreMisses((k) => fake.catalogue.get(k) !== undefined).finally(() => {
      loading = false;
      done.open();
    });
    await stalled.promise;
    return { store, fake, stall, restore };
  }

  it("a recording uploaded mid-restore waits for it, and its miss does not come back", async () => {
    const { store, fake, stall, restore } = await restoringFake();
    try {
      const settled = [];
      const up = fake.call("POST", "/__fake/recordings", { email: LOADER, admin: true, body: recordingUpload }).then((r) => (settled.push("upload"), r));
      await new Promise((r) => setTimeout(r, 150));
      assert.deepEqual(settled, [], "the upload is held until the restore is done");
      stall.open();
      await restore;
      assert.equal((await up).status, 200);
      assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses.length, 0, "the recorded miss is not listed again");
      assert.deepEqual(await stored(store), [], "and its object is gone");
    } finally {
      stall.open();
      await fake.close();
    }
  });

  it("a reset-all mid-restore waits for it, and leaves no miss in memory or the bucket", async () => {
    const { store, fake, stall, restore } = await restoringFake();
    try {
      const settled = [];
      const reset = fake.call("POST", "/__fake/reset-all", { email: LOADER, admin: true, body: {} }).then((r) => (settled.push("reset-all"), r));
      await new Promise((r) => setTimeout(r, 150));
      assert.deepEqual(settled, [], "reset-all is held until the restore is done");
      stall.open();
      await restore;
      const r = await reset;
      assert.equal(r.status, 200);
      assert.equal(r.body.missesRemoved, true);
      assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses.length, 0, "the restore put nothing back");
      assert.deepEqual(await stored(store), []);
      // The key is not left indexed: missing it again keeps it again.
      await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body });
      assert.equal((await stored(store)).length, 1);
    } finally {
      stall.open();
      await fake.close();
    }
  });

  it("the hold is checked after the admin check, and answers 503 loading past the cap", async () => {
    const fake = await startFake({ appOver: { missesLoading: () => true, missesLoaded: new Promise(() => undefined), loadWaitMs: 100 } });
    try {
      assert.equal((await fake.call("POST", "/__fake/reset-all", { body: {} })).status, 403, "a plain caller is refused at once, not held");
      for (const [path, b] of [["/__fake/reset-all", {}], ["/__fake/recordings", recordingUpload]]) {
        const r = await fake.call("POST", path, { email: LOADER, admin: true, body: b });
        assert.equal(r.status, 503, path);
        assert.equal(r.headers.get("x-nb-fake"), "loading", path);
      }
    } finally {
      await fake.close();
    }
  });
});

describe("GET /__fake/misses?all=1", () => {
  let fake;
  beforeEach(async () => {
    fake = await startFake();
    const body = { filters: { sport: ["baseball"] } };
    await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body });
    await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: "tok-other-ns", body });
    await fake.call("GET", "/api/marketplace/card/c7/card-listing", { extra: { "x-nb-fake-ns": "other-slug-" } });
  });
  afterEach(() => fake.close());

  it("lists every owner's misses to an admin", async () => {
    const r = await fake.call("GET", "/__fake/misses?all=1", { email: LOADER, admin: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.misses.map((m) => m.ns ?? m.prefix).sort(), ["happy-cat-123-w0", "other-ns", "other-slug-"].sort());
    assert.equal(r.body.allowlistVersion, SANITISE_ALLOWLIST_VERSION);
  });

  it("is 403 for a plain caller and for an admin key from a non-admin caller", async () => {
    assert.equal((await fake.call("GET", "/__fake/misses?all=1")).status, 403);
    assert.equal((await fake.call("GET", "/__fake/misses?all=1", { admin: true })).status, 403, "admin key, caller not on the admin list");
    assert.equal((await fake.call("GET", "/__fake/misses?all=1", { email: LOADER })).status, 403, "admin caller, no admin key");
  });

  it("is 403 for a plain caller whatever the value, so a bad value tells it nothing", async () => {
    assert.equal((await fake.call("GET", "/__fake/misses?all=2")).status, 403);
  });

  it("is 400 for any value but 1, and when combined with ns or prefix", async () => {
    const admin = { email: LOADER, admin: true };
    for (const q of ["all=2", "all=", "all", "all=true", "all=0", "all=1&all=1", "all=1&ns=happy-cat-123-w0", "all=1&prefix=happy-cat-", "ns=happy-cat-123-w0&all=1"]) {
      assert.equal((await fake.call("GET", `/__fake/misses?${q}`, admin)).status, 400, q);
    }
  });

  it("leaves ns and prefix reads to a plain caller", async () => {
    assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses.length, 1);
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=other-slug-")).body.misses.length, 1);
  });
});

describe("recorder: --all", () => {
  const flags = (...pairs) => new Map(pairs);

  it("readMissScope takes exactly one of --all and --prefix", () => {
    assert.deepEqual(readMissScope(flags(["--all", true])), { all: true });
    assert.deepEqual(readMissScope(flags(["--prefix", "happy-cat-"])), { prefix: "happy-cat-" });
    assert.throws(() => readMissScope(flags()), /--prefix .* or --all is required/);
    assert.throws(() => readMissScope(flags(["--all", true], ["--prefix", "happy-cat-"])), /not both/);
    assert.throws(() => readMissScope(flags(["--all", "yes"])), /takes no value/);
    assert.throws(() => readMissScope(flags(["--prefix", "ab"])), /at least 3/);
    assert.throws(() => readMissScope(flags(["--prefix", true])), /required/);
  });

  it("FakeClient.allMisses asks for ?all=1 with the admin key; misses(prefix) does not", async () => {
    const seen = [];
    const client = new FakeClient({
      baseUrl: "https://fake.example.run.app",
      callerKey: "c".repeat(40),
      adminKey: "a".repeat(40),
      idToken: async () => "h.p.s",
      fetchImpl: async (url, init) => (seen.push({ url: String(url), admin: init.headers["x-nb-fake-bsc-admin-key"] }), new Response(JSON.stringify({ misses: [{ key: "k" }] }), { status: 200 })),
    });
    assert.deepEqual(await client.allMisses(), [{ key: "k" }]);
    await client.misses("happy-cat-");
    assert.equal(seen[0].url, "https://fake.example.run.app/__fake/misses?all=1");
    assert.equal(seen[0].admin, "a".repeat(40));
    assert.equal(seen[1].url, "https://fake.example.run.app/__fake/misses?prefix=happy-cat-");
    assert.equal(seen[1].admin, undefined);
  });
});
