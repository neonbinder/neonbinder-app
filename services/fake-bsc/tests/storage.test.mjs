// Recordings persist through the store: versioned manifest, auto-promote,
// boot load, and tampered or stale objects skipped.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { Catalogue, LocalDirStore, MemoryStore, checkRecording, Captures } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { ManifestConflictError } = require("../dist/src/store/types.js");
const { CatalogueFullError, MAX_RECORDINGS_TOTAL } = require("../dist/src/catalogue.js");

function rec(sport) {
  const c = checkRecording({
    request: { method: "POST", path: "search/bulk-upload/filters", query: [], body: { filters: { sport: [sport] } } },
    response: { status: 200, body: { aggregations: { year: [{ label: "1996", slug: "1996", count: 1, active: false }] } } },
  });
  assert.ok(c.ok);
  return c.recording;
}

describe("local directory store", () => {
  it("writes recordings, promotes a versioned manifest, and loads it back at boot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fake-bsc-store-"));
    try {
      const store = new LocalDirStore(dir);
      const a = new Catalogue(store);
      assert.deepEqual(await a.load(), { loaded: 0, skipped: 0 });
      assert.equal((await a.add([rec("baseball")])).version, 1);
      assert.equal((await a.add([rec("football")])).version, 2);
      assert.ok(a.get(rec("football").key), "promoted in memory at once");

      const b = new Catalogue(new LocalDirStore(dir));
      assert.deepEqual(await b.load(), { loaded: 2, skipped: 0 });
      assert.equal(b.manifestVersion, 2);
      const history = await new LocalDirStore(dir).list("manifests/");
      assert.deepEqual(history, ["manifests/00000001.json", "manifests/00000002.json"]);

      // Tamper with one recording on disk: an extra field is outside the allowlist.
      const obj = path.join(dir, "recordings", "v1", `${rec("baseball").key}.json`);
      const r = JSON.parse(await readFile(obj, "utf8"));
      r.response.body.aggregations.year[0].sellerEmail = "x@y.co";
      await writeFile(obj, JSON.stringify(r));
      const c = new Catalogue(new LocalDirStore(dir));
      assert.deepEqual(await c.load(), { loaded: 1, skipped: 1 });
      assert.equal(c.get(rec("baseball").key), undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses object names that escape the directory", async () => {
    const store = new LocalDirStore("/tmp/never-used");
    await assert.rejects(store.read("../etc/passwd"));
    await assert.rejects(store.write("a/../../b.json", {}));
  });
});

describe("manifest conflicts", () => {
  it("re-reads and retries once when another writer moved the manifest", async () => {
    const store = new MemoryStore();
    const a = new Catalogue(store);
    await a.load();
    const b = new Catalogue(store);
    await b.load();
    await b.add([rec("hockey")]);
    const out = await a.add([rec("baseball")]);
    assert.equal(out.version, 2);
    const fresh = new Catalogue(store);
    assert.deepEqual(await fresh.load(), { loaded: 2, skipped: 0 });
  });

  it("raises a conflict from a stale conditional write", async () => {
    const store = new MemoryStore();
    await store.writeManifest({ schema: 1, version: 1, entries: {} }, null);
    await assert.rejects(store.writeManifest({ schema: 1, version: 2, entries: {} }, null), ManifestConflictError);
  });

  it("skips a manifest entry whose object was written under another allowlist version", async () => {
    const store = new MemoryStore();
    const r = rec("golf");
    await store.write(`recordings/v999/${r.key}.json`, { ...r, allowlistVersion: 999 });
    await store.writeManifest({ schema: 1, version: 1, allowlistVersion: 999, updatedAt: "", entries: { [r.key]: { object: `recordings/v999/${r.key}.json` } } }, null);
    const c = new Catalogue(store);
    assert.deepEqual(await c.load(), { loaded: 0, skipped: 1 });
  });
});

describe("manifest entry cap", () => {
  /** A manifest holding `n` stale entries (another allowlist version: the boot skips them without a read). */
  async function storeWithEntries(n) {
    const store = new MemoryStore();
    const entries = {};
    for (let i = 0; i < n; i++) {
      const key = i.toString(16).padStart(64, "0");
      entries[key] = { object: `recordings/v999/${key}.json`, pathTemplate: "x", recordedAt: "2026-11-01T00:00:00.000Z" };
    }
    await store.writeManifest({ schema: 1, version: 1, allowlistVersion: 999, updatedAt: "", entries }, null);
    return store;
  }
  const manifestOf = async (store) => (await store.readManifest()).value;

  it("is 5,000 entries", () => {
    assert.equal(MAX_RECORDINGS_TOTAL, 5000);
  });

  it("takes an upload that lands exactly on the cap and refuses the next new key, writing nothing", async () => {
    const store = await storeWithEntries(MAX_RECORDINGS_TOTAL - 1);
    const c = new Catalogue(store);
    await c.load();
    assert.equal((await c.add([rec("baseball")])).version, 2, "at the cap");
    assert.equal(Object.keys((await manifestOf(store)).entries).length, MAX_RECORDINGS_TOTAL);
    const err = await c.add([rec("football")]).then(
      () => null,
      (e) => e,
    );
    assert.ok(err instanceof CatalogueFullError);
    assert.equal(err.total, MAX_RECORDINGS_TOTAL + 1);
    assert.equal(err.max, MAX_RECORDINGS_TOTAL);
    assert.equal((await manifestOf(store)).version, 2, "no manifest written");
    assert.equal(await store.read(`recordings/v1/${rec("football").key}.json`), null, "no recording object written");
    assert.equal(c.get(rec("football").key), undefined);
  });

  it("counts a replaced key once, and a key repeated within one upload once", async () => {
    const store = new MemoryStore();
    const c = new Catalogue(store, { maxEntries: 3 });
    await c.load();
    await c.add([rec("baseball"), rec("football")]);
    // A new key repeated in the upload is one entry: 2 + 1 = 3.
    await c.add([rec("hockey"), rec("hockey")]);
    assert.equal(Object.keys((await manifestOf(store)).entries).length, 3);
    // Full: re-uploading held keys is still taken.
    assert.equal((await c.add([rec("baseball"), rec("hockey")])).added, 2);
    // A replace plus one new key is refused as a whole.
    await assert.rejects(c.add([rec("baseball"), rec("golf")]), CatalogueFullError);
    assert.equal(Object.keys((await manifestOf(store)).entries).length, 3);
  });

  it("counts the recordings already in the store at boot", async () => {
    const store = new MemoryStore();
    const a = new Catalogue(store, { maxEntries: 2 });
    await a.load();
    await a.add([rec("baseball"), rec("football")]);
    const b = new Catalogue(store, { maxEntries: 2 });
    assert.deepEqual(await b.load(), { loaded: 2, skipped: 0 });
    await assert.rejects(b.add([rec("hockey")]), CatalogueFullError);
    assert.equal((await b.add([rec("football")])).added, 1, "a replace is still taken");
  });

  it("re-checks after a manifest conflict: another writer took the last room", async () => {
    const store = new MemoryStore();
    const a = new Catalogue(store, { maxEntries: 2 });
    await a.load();
    await a.add([rec("baseball")]);
    const b = new Catalogue(store, { maxEntries: 2 });
    await b.load();
    await b.add([rec("hockey")]);
    // a still sees one entry; the re-read shows two.
    await assert.rejects(a.add([rec("golf")]), CatalogueFullError);
    assert.equal(Object.keys((await manifestOf(store)).entries).length, 2);
  });

  it("takes a replace-only upload on a manifest already over the cap", async () => {
    const store = new MemoryStore();
    const big = new Catalogue(store, { maxEntries: 10 });
    await big.load();
    await big.add([rec("baseball"), rec("football"), rec("hockey")]);
    const small = new Catalogue(store, { maxEntries: 2 });
    await small.load();
    assert.equal((await small.add([rec("hockey")])).added, 1);
    await assert.rejects(small.add([rec("golf")]), CatalogueFullError);
  });
});

describe("write capture store", () => {
  it("keeps the latest capture per endpoint across a restart", async () => {
    const store = new MemoryStore();
    const a = new Captures(store);
    await a.save({ endpoint: "PUT seller/bulk-upload", status: 200, shape: { "": ["array"] }, capturedAt: "2026-11-14T00:00:00Z" });
    await a.save({ endpoint: "PUT seller/bulk-upload", status: 200, shape: { "": ["object"] }, capturedAt: "2026-11-15T00:00:00Z" });
    const b = new Captures(store);
    assert.equal(await b.load(), 1);
    assert.deepEqual(b.list()[0].shape, { "": ["object"] });
  });
});
