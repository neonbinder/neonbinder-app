// The recorder against a MOCKED BSC. Nothing here reaches BuySportsCards:
// every BSC answer is a stub, and the fake is the in-process server.
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { ADMIN_KEY, CALLER_KEY, FILTERS_PATH, LOADER, RESULTS_PATH, idToken, rawResultsRow, resultsBody, startFake } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { runRecordSession, bscCaller, fetchableRequest, MAX_REQUESTS_PER_SESSION } = require("../dist/recorder/record.js");
const { parseCredentials, readCredentials } = require("../dist/recorder/credentials.js");
const { parseArgs } = require("../dist/recorder/cli.js");
const { FakeClient } = require("../dist/recorder/fake-client.js");
const { runCaptureWrite, loadWriteRequest, describeWrite } = require("../dist/recorder/capture-write.js");
const { requestKey, canonicalRequest } = require("../dist/src/requestKey.js");

const NS = "happy-cat-123-w0";

/** A miss list entry for a catalogue request. */
function miss(method, p, body) {
  const req = canonicalRequest({ method, path: p, body });
  return { ns: NS, key: requestKey(req), kind: "catalogue", method, path: p, request: { method, path: p, query: [], body: req.body }, count: 1 };
}

function fakeStub(lists) {
  const uploads = [];
  let call = 0;
  return {
    uploads,
    misses: async () => lists[Math.min(call++, lists.length - 1)],
    uploadRecording: async (r) => {
      uploads.push(r);
      return { manifestVersion: uploads.length };
    },
  };
}

function clock() {
  const c = { t: 1_000_000, slept: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.slept.push(ms);
    c.t += ms;
  };
  return c;
}

const base = (c, over = {}) => ({ prefix: "happy-cat-123-", watch: false, tokenExpiresAt: c.t + 3600_000, now: c.now, sleep: c.sleep, ...over });

describe("record session", () => {
  it("fetches only catalogue misses, at most one a second, and sanitises before upload", async () => {
    const c = clock();
    const misses = [
      miss("POST", RESULTS_PATH, resultsBody({ sport: ["baseball"] })),
      miss("POST", RESULTS_PATH, resultsBody({ sport: ["football"] })),
      { ns: NS, key: "k", kind: "needs-model", method: "POST", path: "seller/new/thing", count: 1 },
    ];
    const fake = fakeStub([misses]);
    const sent = [];
    const result = await runRecordSession({
      ...base(c),
      fake,
      bsc: async (req) => {
        sent.push({ at: c.t, path: req.path });
        c.t += 50;
        return { kind: "response", status: 200, body: [rawResultsRow("c1", "1", "A"), rawResultsRow("c2", "2", "B")] };
      },
    });
    assert.equal(result.stopReason, "done");
    assert.equal(result.sent, 2);
    assert.equal(result.recorded, 2);
    assert.deepEqual(result.needsModel, ["POST seller/new/thing"]);
    assert.ok(sent[1].at - sent[0].at >= 1000, "one request a second");
    const uploaded = JSON.stringify(fake.uploads);
    for (const leak of ["someone@example.com", "Real Person", "real-seller", "/Catalog/front.jpg"]) assert.ok(!uploaded.includes(leak), `leaked ${leak}`);
    assert.equal(fake.uploads[0].key, misses[0].key);
  });

  for (const [label, answer, reason] of [
    ["a 429", { kind: "response", status: 429, body: null }, "rate_limited"],
    ["a 503", { kind: "response", status: 503, body: null }, "server_error"],
    ["a 401", { kind: "response", status: 401, body: null }, "unauthorised"],
    ["a 403", { kind: "response", status: 403, body: null }, "unauthorised"],
    ["a timeout", { kind: "timeout" }, "timeout"],
    ["a network error", { kind: "network" }, "network"],
    ["a 400", { kind: "response", status: 400, body: null }, "unexpected_status"],
  ]) {
    it(`stops on the first ${label}, with no retry`, async () => {
      const c = clock();
      const fake = fakeStub([[miss("POST", FILTERS_PATH, { filters: { sport: ["a"] } }), miss("POST", FILTERS_PATH, { filters: { sport: ["b"] } })]]);
      let calls = 0;
      const r = await runRecordSession({ ...base(c), fake, bsc: async () => (calls++, answer) });
      assert.equal(r.stopReason, reason);
      assert.equal(calls, 1);
      assert.equal(fake.uploads.length, 0);
    });
  }

  it("records a 404 card-listing as a 404 with no body", async () => {
    const c = clock();
    const fake = fakeStub([[{ ...miss("GET", "marketplace/card/c1/card-listing"), request: { method: "GET", path: "marketplace/card/c1/card-listing", query: [] } }]]);
    const r = await runRecordSession({ ...base(c), fake, bsc: async () => ({ kind: "response", status: 404, body: null }) });
    assert.equal(r.recorded, 1);
    assert.deepEqual(fake.uploads[0].response, { status: 404, body: null });
  });

  it(`never sends more than ${MAX_REQUESTS_PER_SESSION} in a session, whatever --max says`, async () => {
    const c = clock();
    const many = Array.from({ length: 320 }, (_, i) => miss("POST", FILTERS_PATH, { filters: { sport: [`s${i}`] } }));
    const fake = fakeStub([many]);
    let calls = 0;
    const r = await runRecordSession({ ...base(c, { tokenExpiresAt: Infinity }), maxRequests: 10_000, minIntervalMs: 0, fake, bsc: async () => (calls++, { kind: "response", status: 200, body: { aggregations: {} } }) });
    assert.equal(r.stopReason, "cap");
    assert.equal(calls, MAX_REQUESTS_PER_SESSION);
    assert.ok(c.slept.every((ms) => ms >= 0));
  });

  it("refuses a miss whose request is not a catalogue read or whose key does not recompute", async () => {
    assert.equal(fetchableRequest({ ...miss("POST", FILTERS_PATH, {}), key: "0".repeat(64) }), null);
    const put = miss("PUT", "seller/bulk-upload", { sellerId: "x", listings: [] });
    assert.equal(fetchableRequest(put), null);
    const c = clock();
    const fake = fakeStub([[put]]);
    let calls = 0;
    const r = await runRecordSession({ ...base(c), fake, bsc: async () => (calls++, { kind: "response", status: 200, body: {} }) });
    assert.equal(calls, 0);
    assert.equal(r.sent, 0);
    assert.equal(r.needsModel.length, 1);
  });

  it("stops before sending with a token about to expire", async () => {
    const c = clock();
    const fake = fakeStub([[miss("POST", FILTERS_PATH, {})]]);
    const r = await runRecordSession({ ...base(c, { tokenExpiresAt: c.t + 60_000 }), fake, bsc: async () => assert.fail("must not send") });
    assert.equal(r.stopReason, "token_expiring");
  });

  it("stops when the fake refuses an upload", async () => {
    const c = clock();
    const fake = { misses: async () => [miss("POST", FILTERS_PATH, {})], uploadRecording: async () => { throw new Error("400"); } };
    const r = await runRecordSession({ ...base(c), fake, bsc: async () => ({ kind: "response", status: 200, body: { aggregations: {} } }) });
    assert.equal(r.stopReason, "upload_refused");
  });

  it("--watch keeps polling the miss list and fetches each key once", async () => {
    const c = clock();
    const m1 = miss("POST", FILTERS_PATH, { filters: { sport: ["a"] } });
    const m2 = miss("POST", FILTERS_PATH, { filters: { sport: ["b"] } });
    const fake = fakeStub([[], [m1], [m1, m2], [m1, m2]]);
    let polls = 0;
    const r = await runRecordSession({
      ...base(c, { watch: true, pollMs: 3000 }),
      fake: { ...fake, misses: async (p) => (polls++, fake.misses(p)) },
      stopped: () => polls >= 5,
      bsc: async () => ({ kind: "response", status: 200, body: { aggregations: {} } }),
    });
    assert.equal(r.stopReason, "interrupted");
    assert.equal(r.recorded, 2);
    assert.equal(fake.uploads.length, 2);
  });
});

describe("bscCaller", () => {
  it("sends card-listing with no token, everything else with the API headers, once", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    };
    const call = bscCaller({ apiBase: "https://bsc.invalid", token: "secret-token", headers: (t) => ({ authorization: `Bearer ${t}` }), fetchImpl });
    await call(canonicalRequest({ method: "GET", path: "marketplace/card/c1/card-listing" }));
    await call(canonicalRequest({ method: "POST", path: FILTERS_PATH, body: { filters: {} } }));
    assert.equal(seen[0].url, "https://bsc.invalid/marketplace/card/c1/card-listing");
    assert.deepEqual(seen[0].init.headers, { Accept: "application/json" });
    assert.equal(seen[1].init.headers.authorization, "Bearer secret-token");
    assert.equal(seen[1].init.body, '{"filters":{}}');
    await assert.rejects(call(canonicalRequest({ method: "PUT", path: "seller/bulk-upload", body: {} })));
    assert.equal(seen.length, 2);
  });

  it("answers a 5xx once without retrying, and a thrown fetch as network", async () => {
    let n = 0;
    const call = bscCaller({ apiBase: "https://bsc.invalid", token: "t", headers: () => ({}), fetchImpl: async () => (n++, new Response("x", { status: 503 })) });
    assert.deepEqual(await call(canonicalRequest({ method: "POST", path: FILTERS_PATH, body: {} })), { kind: "response", status: 503, body: null });
    assert.equal(n, 1);
    const boom = bscCaller({ apiBase: "https://bsc.invalid", token: "t", headers: () => ({}), fetchImpl: async () => { throw new Error("ECONNRESET"); } });
    assert.deepEqual(await boom(canonicalRequest({ method: "POST", path: FILTERS_PATH, body: {} })), { kind: "network" });
  });
});

describe("credentials", () => {
  it("reads a Bitwarden item, a plain object, or two lines", () => {
    assert.deepEqual(parseCredentials(JSON.stringify({ name: "BSC", login: { username: "u@x.co", password: "p w" } })), { username: "u@x.co", password: "p w" });
    assert.deepEqual(parseCredentials('{"username":"u","password":"p"}'), { username: "u", password: "p" });
    assert.deepEqual(parseCredentials("u\np\n"), { username: "u", password: "p" });
  });

  it("never quotes the input in an error", () => {
    for (const bad of ['{"login":{"username":"hunter2-user"}}', "{not json hunter2", "one line hunter2"]) {
      assert.throws(() => parseCredentials(bad), (e) => !e.message.includes("hunter2"));
    }
  });

  it("reads piped stdin", async () => {
    const stdin = Readable.from([Buffer.from('{"login":{"username":"u","password":"p"}}')]);
    assert.deepEqual(await readCredentials(stdin, process.stderr), { username: "u", password: "p" });
  });

  it("refuses credentials as arguments", () => {
    for (const flag of ["--password", "--username", "--password=x"]) {
      assert.throws(() => parseArgs(["record", flag, "x"]), /stdin/);
    }
    const { command, flags } = parseArgs(["record", "--fake", "https://f.run.app", "--prefix", "abc-", "--watch"]);
    assert.equal(command, "record");
    assert.equal(flags.get("--watch"), true);
    assert.equal(flags.get("--prefix"), "abc-");
  });
});

describe("recorder end to end against the in-process fake (BSC mocked)", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("turns a live miss into a served recording", async () => {
    const body = resultsBody({ sport: ["baseball"], year: ["1996"] });
    const first = await fake.call("POST", `/api/${RESULTS_PATH}`, { bsc: `tok-${NS}`, body });
    assert.equal(first.status, 501);
    const client = new FakeClient({ baseUrl: fake.base, callerKey: CALLER_KEY, adminKey: ADMIN_KEY, idToken: async () => idToken(LOADER) });
    const c = clock();
    const result = await runRecordSession({
      ...base(c),
      fake: client,
      bsc: async () => ({ kind: "response", status: 200, body: [rawResultsRow("c1", "1", "Ken Griffey Jr.")] }),
    });
    assert.equal(result.recorded, 1, JSON.stringify(result));
    const again = await fake.call("POST", `/api/${RESULTS_PATH}`, { bsc: `tok-${NS}`, body });
    assert.equal(again.status, 200);
    assert.equal(again.body[0].players, "Ken Griffey Jr.");
    assert.equal(again.body[0].sellerId, undefined);
    assert.equal(again.body[0].seller, undefined);
  });

  it("is refused by the fake when it skips sanitising (the server re-applies the allowlist)", async () => {
    const client = new FakeClient({ baseUrl: fake.base, callerKey: CALLER_KEY, adminKey: ADMIN_KEY, idToken: async () => idToken(LOADER) });
    await assert.rejects(
      client.uploadRecording({
        request: { method: "POST", path: RESULTS_PATH, query: [], body: resultsBody({ sport: ["x"] }) },
        response: { status: 200, body: [rawResultsRow("c1", "1", "A")] },
      }),
      (e) => e.status === 400 && e.reason === "recording refused",
    );
  });
});

describe("capture-write", () => {
  let dir;
  before(async () => (dir = await mkdtemp(path.join(tmpdir(), "fake-bsc-capture-"))));
  after(() => rm(dir, { recursive: true, force: true }));

  it("loads only a known write endpoint", async () => {
    const good = path.join(dir, "put.json");
    await writeFile(good, JSON.stringify({ method: "PUT", path: "/seller/bulk-upload", body: { sellerId: "s", listings: [{ cardId: "c" }] } }));
    const req = await loadWriteRequest(good);
    assert.equal(req.endpoint, "PUT seller/bulk-upload");
    assert.equal(describeWrite(req), "PUT seller/bulk-upload: 1 listing row(s)");
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ method: "POST", path: "search/bulk-upload/results", body: {} }));
    await assert.rejects(loadWriteRequest(bad), /not a known BSC write endpoint/);
    const photo = path.join(dir, "photo.json");
    await writeFile(photo, JSON.stringify({ method: "POST", path: "common/card/undefined/product/undefined/attachment" }));
    await assert.rejects(loadWriteRequest(photo), /--file/);
  });

  it("sends exactly one write and uploads its shape only, never a value", async () => {
    let sends = 0;
    const captured = [];
    const r = await runCaptureWrite({
      request: { endpoint: "PUT seller/bulk-upload", method: "PUT", path: "seller/bulk-upload", json: { sellerId: "real-seller-id", listings: [] } },
      apiBase: "https://bsc.invalid",
      token: "t",
      headers: () => ({}),
      fetchImpl: async () => (sends++, new Response(JSON.stringify([{ cardId: "secret-card", sellerId: "real-seller-id", price: "9.99" }]), { status: 200 })),
      fake: { uploadCapture: async (c) => (captured.push(c), { verdict: "ok", paths: [] }) },
    });
    assert.equal(sends, 1);
    assert.equal(r.ok, true);
    const text = JSON.stringify(captured);
    for (const v of ["secret-card", "real-seller-id", "9.99"]) assert.ok(!text.includes(v), `leaked ${v}`);
    assert.deepEqual(captured[0].shape["[].price"], ["string"]);
  });

  it("does not retry a failed write", async () => {
    let sends = 0;
    const r = await runCaptureWrite({
      request: { endpoint: "PUT seller/bulk-upload", method: "PUT", path: "seller/bulk-upload", json: {} },
      apiBase: "https://bsc.invalid",
      token: "t",
      headers: () => ({}),
      fetchImpl: async () => (sends++, new Response("oops", { status: 500 })),
      fake: { uploadCapture: async () => ({ verdict: "shape_drift", paths: ["$status"] }) },
    });
    assert.equal(sends, 1);
    assert.equal(r.status, 500);
  });
});
