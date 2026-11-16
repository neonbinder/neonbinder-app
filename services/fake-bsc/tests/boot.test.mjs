// Boot order (src/index.ts): every load the fake answers from runs BEFORE the
// server listens, so on Cloud Run it runs in the startup phase (full CPU,
// requests held until the port opens), and a load failure exits without
// ever listening.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { CALLER, CALLER_KEY, FILTERS_PATH, MemoryStore, idToken, setLogSink, stubIdentity, stubVerifier, testConfig } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { boot, MISSES_BOOT_BUDGET_MS } = require("../dist/src/index.js");
const { DurableMisses } = require("../dist/src/missStore.js");
const { canonicalRequest, requestKey } = require("../dist/src/requestKey.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, "..", "dist", "src", "index.js");
const NS = "happy-cat-123-w0";

function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A replayable catalogue miss, first seen a moment ago (inside the TTL). */
function filtersMiss() {
  const request = canonicalRequest({ method: "POST", path: FILTERS_PATH, query: [], body: { filters: { sport: ["baseball"] } } });
  const at = new Date(Date.now() - 1000).toISOString();
  return { key: requestKey(request), kind: "catalogue", method: "POST", path: FILTERS_PATH, endpoint: "filters", request, count: 1, firstSeen: at, lastSeen: at };
}

/** A memory store with one durable miss already kept for NS. */
async function storeWithMiss() {
  const store = new MemoryStore();
  await new DurableMisses(store).save({ ns: NS }, filtersMiss());
  assert.equal((await store.listVersions("misses/", 100)).length, 1, "the miss object is in the store");
  return store;
}

const servers = [];
afterEach(async () => {
  setLogSink(() => {});
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

const startBoot = (store, over = {}) =>
  boot({ config: testConfig(), store, identity: stubIdentity(), verifyIdToken: stubVerifier, host: "127.0.0.1", ...over });

const get = async (server, p) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, {
    headers: { "x-nb-fake-bsc-key": CALLER_KEY, "x-nb-fake-id-token": idToken(CALLER) },
  });
  return { status: r.status, body: await r.json() };
};

describe("boot: load, then listen", () => {
  it("listens only after the recordings, captures and durable misses are in", async () => {
    const store = await storeWithMiss();
    const events = [];
    setLogSink((l) => events.push(`log:${JSON.parse(l).operation}`));
    const manifestGate = gate();
    const readManifest = store.readManifest.bind(store);
    store.readManifest = async () => (events.push("store:manifest"), await manifestGate.promise, readManifest());
    const read = store.read.bind(store);
    store.read = async (name) => (events.push(`store:read:${name.split("/")[0]}`), read(name));
    const listVersions = store.listVersions.bind(store);
    store.listVersions = async (prefix, limit) => (events.push("store:misses-list"), listVersions(prefix, limit));

    // Count every listen in the process, so "not yet" is not just "not logged yet".
    const realListen = http.Server.prototype.listen;
    let listens = 0;
    http.Server.prototype.listen = function (...args) {
      listens += 1;
      return realListen.apply(this, args);
    };
    let booted;
    try {
      const pending = startBoot(store).then((b) => (booted = b));
      await wait(150);
      assert.equal(listens, 0, "no listen while the manifest read is outstanding");
      assert.equal(booted, undefined);
      assert.ok(!events.includes("log:listening"));
      manifestGate.open();
      await pending;
    } finally {
      http.Server.prototype.listen = realListen;
    }
    servers.push(booted.server);
    assert.equal(listens, 1);

    const at = (e) => events.indexOf(e);
    assert.ok(at("store:manifest") >= 0 && at("store:read:write-captures") >= 0 && at("store:misses-list") >= 0, events.join(" "));
    const listening = at("log:listening");
    assert.ok(listening > at("store:read:write-captures"), "captures load before listen");
    assert.ok(listening > at("log:misses_restore_done"), "the miss restore settles before listen");
    assert.ok(at("log:boot") > listening);
    assert.ok(!events.includes("log:misses_restore_deferred"));

    // The first request is answered from the loaded state, with no hold.
    const health = await get(booted.server, "/__fake/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.loading, false);
    assert.ok(Array.isArray(health.body.writeCaptures.missing), "the captures are in on the first request");
    const started = Date.now();
    const misses = await get(booted.server, "/__fake/misses?prefix=happy-cat-");
    assert.ok(Date.now() - started < 1000, "the miss list is not held");
    assert.equal(misses.status, 200);
    assert.equal(misses.body.misses.length, 1, "the restored miss is listed on the first read");
  });

  it("never listens when the recordings load fails", async () => {
    const store = new MemoryStore();
    store.readManifest = async () => {
      throw new Error("bucket unreadable");
    };
    const ops = [];
    setLogSink((l) => ops.push(JSON.parse(l).operation));
    const realListen = http.Server.prototype.listen;
    let listens = 0;
    http.Server.prototype.listen = function (...args) {
      listens += 1;
      return realListen.apply(this, args);
    };
    try {
      await assert.rejects(startBoot(store), /bucket unreadable/);
    } finally {
      http.Server.prototype.listen = realListen;
    }
    assert.equal(listens, 0);
    assert.ok(!ops.includes("listening") && !ops.includes("boot"), ops.join(" "));
  });

  it("never listens when the write captures load fails", async () => {
    const store = new MemoryStore();
    const read = store.read.bind(store);
    store.read = async (name) => {
      if (name.startsWith("write-captures/")) throw new Error("capture unreadable");
      return read(name);
    };
    const realListen = http.Server.prototype.listen;
    let listens = 0;
    http.Server.prototype.listen = function (...args) {
      listens += 1;
      return realListen.apply(this, args);
    };
    try {
      await assert.rejects(startBoot(store), /capture unreadable/);
    } finally {
      http.Server.prototype.listen = realListen;
    }
    assert.equal(listens, 0);
  });

  it("listens after the budget when the miss restore overruns it, and holds the miss list for it", async () => {
    assert.equal(MISSES_BOOT_BUDGET_MS, 30_000);
    const store = await storeWithMiss();
    const ops = [];
    setLogSink((l) => ops.push(JSON.parse(l)));
    const listGate = gate();
    const listVersions = store.listVersions.bind(store);
    store.listVersions = async (prefix, limit) => (await listGate.promise, listVersions(prefix, limit));

    const booted = await startBoot(store, { missesBootBudgetMs: 50 });
    servers.push(booted.server);
    assert.ok(ops.some((o) => o.operation === "misses_restore_deferred"));
    assert.equal(ops.find((o) => o.operation === "boot").missesDeferred, true);
    // Recordings and captures are in: health never reads as loading.
    assert.equal((await get(booted.server, "/__fake/health")).body.loading, false);

    let settled = false;
    const held = get(booted.server, "/__fake/misses?prefix=happy-cat-").then((r) => ((settled = true), r));
    await wait(150);
    assert.equal(settled, false, "the miss list waits for the restore");
    listGate.open();
    const misses = await held;
    assert.equal(misses.status, 200);
    assert.equal(misses.body.misses.length, 1);
    await booted.missesRestored;
  });
});

describe("boot: the process", () => {
  const dirs = [];
  afterEach(async () => Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

  /** Runs the built entry point on a local store; resolves with its exit code and log lines. */
  function run(dir, { killOn } = {}) {
    const child = spawn(process.execPath, [ENTRY], {
      env: {
        PATH: process.env.PATH,
        PORT: "0",
        FAKE_BSC_STORE_DIR: dir,
        FAKE_BSC_LOCAL_DEV_BYPASS: "1",
        FAKE_BSC_CALLER_KEY: "c".repeat(40),
        FAKE_BSC_ADMIN_KEY: "a".repeat(40),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ops = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const op = JSON.parse(line).operation;
          ops.push(op);
          if (op === killOn) child.kill("SIGTERM");
        } catch {
          // not a log line
        }
      }
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    return new Promise((resolve) =>
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, ops });
      }),
    );
  }

  it("exits 1 without listening when the manifest is unreadable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fake-bsc-boot-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ not: "a manifest" }));
    const { code, ops } = await run(dir);
    assert.equal(code, 1);
    assert.ok(ops.includes("boot_failed"), ops.join(" "));
    assert.ok(!ops.includes("listening"), ops.join(" "));
  });

  it("restores the misses and then listens, in that order", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fake-bsc-boot-"));
    dirs.push(dir);
    const { signal, ops } = await run(dir, { killOn: "boot" });
    assert.equal(signal, "SIGTERM", ops.join(" "));
    assert.ok(ops.indexOf("misses_restore_done") >= 0 && ops.indexOf("misses_restore_done") < ops.indexOf("listening"), ops.join(" "));
    assert.ok(ops.indexOf("listening") < ops.indexOf("boot"), ops.join(" "));
  });
});
