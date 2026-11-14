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

const base = (c, over = {}) => ({ prefix: "happy-cat-123-", watch: false, tokenExpiresAt: c.t + 3600_000, now: c.now, sleep: c.sleep, confirm: async () => true, ...over });
const CARD = "5f3a9c0e1b2d3e4f5a6b7c8d";

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
    const fake = fakeStub([[{ ...miss("GET", `marketplace/card/${CARD}/card-listing`), request: { method: "GET", path: `marketplace/card/${CARD}/card-listing`, query: [] } }]]);
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
    assert.equal(fetchableRequest({ ...miss("POST", FILTERS_PATH, { filters: {} }), key: "0".repeat(64) }), null);
    assert.ok(fetchableRequest(miss("POST", FILTERS_PATH, { filters: {} })));
    const put = miss("PUT", "seller/bulk-upload", { sellerId: "x", listings: [] });
    assert.equal(fetchableRequest(put), null);
    const c = clock();
    const fake = fakeStub([[put]]);
    let calls = 0;
    const r = await runRecordSession({ ...base(c), fake, bsc: async () => (calls++, { kind: "response", status: 200, body: {} }) });
    assert.equal(calls, 0);
    assert.equal(r.sent, 0);
    assert.deepEqual(r.refused.map((l) => l.split(" ")[0]), ["not_a_catalogue_request"]);
  });

  it("stops before sending with a token about to expire", async () => {
    const c = clock();
    const fake = fakeStub([[miss("POST", FILTERS_PATH, { filters: {} })]]);
    const r = await runRecordSession({ ...base(c, { tokenExpiresAt: c.t + 60_000 }), fake, bsc: async () => assert.fail("must not send") });
    assert.equal(r.stopReason, "token_expiring");
  });

  it("stops when the fake refuses an upload", async () => {
    const c = clock();
    const fake = { misses: async () => [miss("POST", FILTERS_PATH, { filters: {} })], uploadRecording: async () => { throw new Error("400"); } };
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

describe("--max (S2)", () => {
  const { readMax } = require("../dist/recorder/cli.js");
  it("accepts only a positive whole number, clamped to the session cap", () => {
    assert.equal(readMax(undefined), undefined);
    assert.equal(readMax("5"), 5);
    assert.equal(readMax("300"), MAX_REQUESTS_PER_SESSION);
    assert.equal(readMax("100000"), MAX_REQUESTS_PER_SESSION);
    for (const bad of ["abc", "0", "-5", "1.5", "1e3", "", " 5", "5x", "NaN", "Infinity", true]) {
      assert.throws(() => readMax(bad), /positive whole number/, String(bad));
    }
  });
  it("parses `--max abc` into an error, never an uncapped session", () => {
    const { flags } = parseArgs(["record", "--max", "abc"]);
    assert.throws(() => readMax(flags.get("--max")));
    assert.throws(() => readMax(parseArgs(["record", "--max"]).flags.get("--max")));
  });
});

describe("replay allowlist (S3)", () => {
  const { replayRefusal } = require("../dist/recorder/replay-allowlist.js");
  const { replayable, planMisses } = require("../dist/recorder/record.js");
  const req = (method, p, body, query) => canonicalRequest({ method, path: p, body, query });

  it("passes NB's own catalogue requests", () => {
    assert.equal(replayRefusal(req("POST", FILTERS_PATH, { filters: {} })), null);
    assert.equal(replayRefusal(req("POST", FILTERS_PATH, { filters: { sport: ["baseball"], year: ["1996"] } })), null);
    assert.equal(replayRefusal(req("POST", RESULTS_PATH, resultsBody({ sport: ["baseball"], setName: ["topps-chrome"], variantName: ["gold-refractor"] }))), null);
    assert.equal(replayRefusal(req("GET", `marketplace/card/${CARD}/card-listing`)), null);
  });

  it("refuses anything wider, with a reason and no value", () => {
    const cases = [
      [req("POST", FILTERS_PATH, {}), "filters_missing"],
      [req("POST", FILTERS_PATH, { filters: {}, condition: "all" }), "body_unknown_field"],
      [req("POST", FILTERS_PATH, { filters: { seller: ["x"] } }), "filters_unknown_facet"],
      [req("POST", FILTERS_PATH, { filters: { sport: [] } }), "filters_bad_list"],
      [req("POST", FILTERS_PATH, { filters: { sport: "baseball" } }), "filters_bad_list"],
      [req("POST", FILTERS_PATH, { filters: { sport: [{ $ne: 1 }] } }), "filters_bad_value"],
      [req("POST", FILTERS_PATH, { filters: { sport: ["a@b.com"] } }), "filters_bad_value"],
      [req("POST", FILTERS_PATH, { filters: { sport: ["base ball"] } }), "filters_bad_value"],
      [req("POST", FILTERS_PATH, { filters: { sport: ["x".repeat(101)] } }), "filters_bad_value"],
      [req("POST", FILTERS_PATH, { filters: { sport: Array.from({ length: 51 }, (_, i) => `s${i}`) } }), "filters_bad_list"],
      [req("POST", FILTERS_PATH, { filters: { sport: Array.from({ length: 50 }, () => "x".repeat(99)) } }), "body_too_large"],
      [req("POST", FILTERS_PATH, { filters: {} }, "sellerId=1"), "query_string"],
      [req("POST", RESULTS_PATH, { ...resultsBody({}), condition: "near_mint" }), "bad_condition"],
      [req("POST", RESULTS_PATH, { ...resultsBody({}), sort: "price" }), "bad_sort"],
      [req("POST", RESULTS_PATH, { ...resultsBody({}), page: 101 }), "bad_page"],
      [req("POST", RESULTS_PATH, { ...resultsBody({}), size: 5001 }), "bad_size"],
      [req("POST", RESULTS_PATH, { ...resultsBody({}), size: 1.5 }), "bad_size"],
      [req("POST", RESULTS_PATH, { ...resultsBody({}), sellerId: "x" }), "body_unknown_field"],
      [req("POST", RESULTS_PATH, [1]), "body_not_an_object"],
      [req("GET", "marketplace/card/not-hex-id/card-listing"), "card_id_not_hex"],
      [req("GET", "marketplace/card/c1/card-listing"), "card_id_not_hex"],
      [req("GET", `marketplace/card/${CARD}/card-listing`, undefined, "x=1"), "query_string"],
      [req("POST", "seller/bulk-upload/results", { filters: {} }), "not_a_catalogue_request"],
    ];
    for (const [r, reason] of cases) assert.equal(replayRefusal(r), reason, JSON.stringify(r));
  });

  it("refused and anonymous misses are never sent; labels carry no value", async () => {
    const evil = miss("POST", FILTERS_PATH, { filters: { sport: ["someone@example.com"] } });
    const anon = { ...miss("POST", FILTERS_PATH, { filters: { sport: ["anon"] } }), ns: null };
    const lane = { ...miss("POST", FILTERS_PATH, { filters: { sport: ["lane"] } }), ns: null, prefix: "happy-cat-" };
    const good = miss("POST", FILTERS_PATH, { filters: { sport: ["baseball"] } });
    assert.equal(replayable(evil).reason, "filters_bad_value");
    const c = clock();
    const fake = fakeStub([[evil, anon, lane, good]]);
    const sent = [];
    const r = await runRecordSession({ ...base(c), fake, bsc: async (q) => (sent.push(q.body.filters.sport[0]), { kind: "response", status: 200, body: { aggregations: {} } }) });
    assert.deepEqual(sent, ["lane", "baseball"]);
    assert.equal(r.anonSkipped, 1);
    assert.equal(r.refused.length, 1);
    assert.match(r.refused[0], /^filters_bad_value filters [0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(r).includes("someone"));
    const withAnon = planMisses([anon, good], { includeAnon: true });
    assert.equal(withAnon.todo.length, 2);
  });

  it("asks once, with the count, before the first send; no answer or no means nothing is sent", async () => {
    for (const confirm of [undefined, async () => false]) {
      const c = clock();
      const r = await runRecordSession({ ...base(c, { confirm }), fake: fakeStub([[miss("POST", FILTERS_PATH, { filters: {} })]]), bsc: async () => assert.fail("must not send") });
      assert.equal(r.stopReason, "declined");
      assert.equal(r.sent, 0);
    }
    const asked = [];
    const c = clock();
    const r = await runRecordSession({
      ...base(c, { confirm: async (n) => (asked.push(n), true) }),
      fake: fakeStub([[miss("POST", FILTERS_PATH, { filters: { sport: ["a"] } }), miss("POST", FILTERS_PATH, { filters: { sport: ["b"] } })]]),
      bsc: async () => ({ kind: "response", status: 200, body: { aggregations: {} } }),
    });
    assert.deepEqual(asked, [2]);
    assert.equal(r.sent, 2);
  });

  it("confirms only on the word yes", async () => {
    const { askYes } = require("../dist/recorder/confirm.js");
    const { PassThrough } = await import("node:stream");
    for (const [answer, want] of [["yes\n", true], ["YES\n", true], ["y\n", false], ["\n", false], ["", false]]) {
      const out = new PassThrough();
      const got = await askYes(Readable.from([answer]), out, "go? ");
      assert.equal(got, want, JSON.stringify(answer));
    }
  });
});

describe("fake client identity", () => {
  it("sends the ID token in both headers", async () => {
    const seen = [];
    const client = new FakeClient({
      baseUrl: "https://fake.example.run.app",
      callerKey: CALLER_KEY,
      adminKey: ADMIN_KEY,
      idToken: async () => "h.p.s",
      fetchImpl: async (_u, init) => (seen.push(init.headers), new Response(JSON.stringify({ misses: [] }), { status: 200 })),
    });
    await client.misses("abc-");
    assert.equal(seen[0]["x-nb-fake-id-token"], "h.p.s");
    assert.equal(seen[0]["X-Serverless-Authorization"], "Bearer h.p.s");
  });

  it("asks impersonated ADC for a token that carries the email", async () => {
    const { adcIdTokenMinter } = require("../dist/recorder/fake-client.js");
    const { Impersonated } = require("google-auth-library");
    const imp = new Impersonated({ targetPrincipal: "loader@example.iam.gserviceaccount.com" });
    const calls = [];
    imp.fetchIdToken = async (aud, opts) => (calls.push([aud, opts]), "tok");
    const mint = adcIdTokenMinter("https://fake.example.run.app", { getClient: async () => imp, getIdTokenClient: async () => assert.fail("not this path") });
    assert.equal(await mint(), "tok");
    assert.deepEqual(calls, [["https://fake.example.run.app", { includeEmail: true }]]);
    const other = adcIdTokenMinter("https://a.run.app", { getClient: async () => ({}), getIdTokenClient: async () => ({ idTokenProvider: { fetchIdToken: async (a) => `sa:${a}` } }) });
    assert.equal(await other(), "sa:https://a.run.app");
  });
});

describe("undo-write", () => {
  const { buildUndoRequest, describeUndo, runUndoWrite } = require("../dist/recorder/capture-write.js");
  const put = { endpoint: "PUT seller/bulk-upload", method: "PUT", path: "seller/bulk-upload", json: { sellerId: "s", listings: [{ cardId: "c", condition: "near_mint", availableQuantity: 3, price: 1 }] } };

  it("builds a quantity-0 PUT of the same rows, and nothing for a photo", () => {
    const undo = buildUndoRequest(put);
    assert.deepEqual(undo.json, { sellerId: "s", listings: [{ cardId: "c", condition: "near_mint", availableQuantity: 0, price: 1 }] });
    assert.equal(put.json.listings[0].availableQuantity, 3, "the original request is untouched");
    assert.match(describeUndo(undo), /1 listing row\(s\) set to quantity 0 \(a second real write\)/);
    assert.equal(buildUndoRequest({ endpoint: "POST common/card/undefined/product/undefined/attachment", method: "POST", path: "x", file: { bytes: Buffer.alloc(1), fileName: "a.jpg", contentType: "image/jpeg" } }), null);
    assert.equal(buildUndoRequest({ ...put, json: { sellerId: "s", listings: [] } }), null);
  });

  it("sends the undo exactly once", async () => {
    const bodies = [];
    const r = await runUndoWrite({ request: put, apiBase: "https://bsc.invalid", token: "t", headers: () => ({}), fetchImpl: async (_u, init) => (bodies.push(JSON.parse(init.body)), new Response("[]", { status: 200 })) });
    assert.deepEqual(r, { ok: true, status: 200 });
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].listings[0].availableQuantity, 0);
  });
});
