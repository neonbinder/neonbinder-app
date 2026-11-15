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
const { runRefreshGrant, bscSession, loadBrowserModules, defaultBrowserDist } = require("../dist/recorder/bsc.js");
import { existsSync } from "node:fs";

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
    assert.equal(r.left, 1);
    assert.equal(r.renewals, 0);
  });

  it("renews the token once when it nears expiry, paced at 1 a second and outside the cap, then carries on", async () => {
    const c = clock();
    const m = (s) => miss("POST", FILTERS_PATH, { filters: { sport: [s] } });
    const fake = fakeStub([[m("a"), m("b"), m("c")]]);
    const events = [];
    let renews = 0;
    const r = await runRecordSession({
      // Checked before each read: at t and t+50 ms the token has 2 min left; at
      // t+1050 ms it is inside the margin, so: renew (t+2 s), then read (t+3 s).
      ...base(c, { tokenExpiresAt: c.t + 2 * 60_000 + 1040 }),
      maxRequests: 3,
      fake,
      bsc: async () => {
        events.push(["bsc", c.t]);
        c.t += 50;
        return { kind: "response", status: 200, body: { aggregations: {} } };
      },
      renewToken: async () => {
        renews += 1;
        events.push(["renew", c.t]);
        c.t += 200;
        return { ok: true, expiresAt: c.t + 3600_000 };
      },
    });
    assert.equal(r.stopReason, "done", JSON.stringify(r));
    assert.equal(renews, 1, "exactly one refresh");
    assert.equal(r.renewals, 1);
    // The refresh counts against nothing: all three catalogue reads still went, under a cap of 3.
    assert.equal(r.sent, 3);
    assert.equal(r.recorded, 3);
    assert.equal(r.left, 0);
    assert.deepEqual(events.map(([k]) => k), ["bsc", "bsc", "renew", "bsc"]);
    for (let i = 1; i < events.length; i++) assert.ok(events[i][1] - events[i - 1][1] >= 1000, `paced: ${JSON.stringify(events)}`);
  });

  it("renews before the first send when the token is already inside the margin", async () => {
    const c = clock();
    const fake = fakeStub([[miss("POST", FILTERS_PATH, { filters: { sport: ["a"] } })]]);
    const order = [];
    const r = await runRecordSession({
      ...base(c, { tokenExpiresAt: c.t + 60_000 }),
      fake,
      bsc: async () => (order.push(["bsc", c.t]), { kind: "response", status: 200, body: { aggregations: {} } }),
      renewToken: async () => (order.push(["renew", c.t]), { ok: true, expiresAt: c.t + 3600_000 }),
    });
    assert.equal(r.stopReason, "done");
    assert.deepEqual(order.map(([k]) => k), ["renew", "bsc"]);
    assert.ok(order[1][1] - order[0][1] >= 1000, "the read after a refresh waits its second");
    assert.equal(r.sent, 1);
  });

  it("a failed renewal stops cleanly: one attempt, nothing more sent, the reason reported", async () => {
    for (const reason of ["refused", "rate_limited", "server_error", "timeout", "network", "no_refresh_token", "refresh_expired"]) {
      const c = clock();
      const fake = fakeStub([[miss("POST", FILTERS_PATH, { filters: { sport: ["a"] } }), miss("POST", FILTERS_PATH, { filters: { sport: ["b"] } })]]);
      let renews = 0;
      const r = await runRecordSession({
        ...base(c, { tokenExpiresAt: c.t + 60_000 }),
        fake,
        bsc: async () => assert.fail("must not send"),
        renewToken: async () => (renews++, { ok: false, reason }),
      });
      assert.equal(r.stopReason, "refresh_failed", reason);
      assert.equal(r.refreshFailure, reason);
      assert.equal(renews, 1, "never retried");
      assert.equal(r.sent, 0);
      assert.equal(r.left, 2);
      assert.equal(fake.uploads.length, 0);
    }
  });

  it("a renewal that comes back short-lived stops rather than renewing again", async () => {
    const c = clock();
    const fake = fakeStub([[miss("POST", FILTERS_PATH, { filters: {} })]]);
    let renews = 0;
    const r = await runRecordSession({
      ...base(c, { tokenExpiresAt: c.t + 60_000 }),
      fake,
      bsc: async () => assert.fail("must not send"),
      renewToken: async () => (renews++, { ok: true, expiresAt: c.t + 30_000 }),
    });
    assert.equal(r.stopReason, "token_expiring");
    assert.equal(renews, 1);
  });

  it("Ctrl-C between the refresh and the read sends nothing more", async () => {
    const c = clock();
    const fake = fakeStub([[miss("POST", FILTERS_PATH, { filters: {} })]]);
    let interrupted = false;
    const r = await runRecordSession({
      ...base(c, { tokenExpiresAt: c.t + 60_000 }),
      fake,
      stopped: () => interrupted,
      bsc: async () => assert.fail("must not send"),
      renewToken: async () => ((interrupted = true), { ok: true, expiresAt: c.t + 3600_000 }),
    });
    assert.equal(r.stopReason, "interrupted");
    assert.equal(r.left, 1);
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

describe("BSC session renewal (refresh grant)", () => {
  it("keeps only the token fields from services/browser's grant", async () => {
    const r = await runRefreshGrant(async () => ({ ok: true, tokens: { token: "at-new", expiresAt: 5_000_000, refreshToken: "rt-rotated", refreshExpiresAt: 9_000_000, ssoCookies: { x: "y" } } }));
    assert.deepEqual(r, { ok: true, tokens: { token: "at-new", expiresAt: 5_000_000, refreshToken: "rt-rotated", refreshExpiresAt: 9_000_000 } });
  });

  it("maps every failure to a fixed reason, once, with no token or text in it", async () => {
    const named = (name, message) => Object.assign(new Error(message), { name });
    for (const [grant, reason] of [
      [async () => ({ ok: false, status: 400, reason: "refused", reauthRequired: true }), "refused"],
      [async () => ({ ok: false, status: 429, reason: "rate_limited", reauthRequired: false }), "rate_limited"],
      [async () => ({ ok: false, status: 503, reason: "server_error", reauthRequired: false }), "server_error"],
      [async () => ({ ok: false, status: 302, reason: "unexpected_status", reauthRequired: false }), "unexpected_status"],
      [async () => ({ ok: false, status: 200, reason: "no_access_token", reauthRequired: false }), "bad_body"],
      [async () => ({ ok: true, tokens: { expiresAt: 1 } }), "bad_body"],
      [async () => { throw named("TimeoutError", "rt-secret timed out"); }, "timeout"],
      [async () => { throw named("SyntaxError", "rt-secret is not JSON"); }, "bad_body"],
      [async () => { throw new TypeError("fetch failed rt-secret"); }, "network"],
    ]) {
      let n = 0;
      const r = await runRefreshGrant(async () => (n++, grant()));
      assert.deepEqual(r, { ok: false, reason });
      assert.equal(n, 1, `${reason}: never retried`);
      assert.ok(!JSON.stringify(r).includes("rt-secret"), "no token or text in the outcome");
    }
  });

  it("a session swaps in the renewed token and the rotated refresh token", async () => {
    const presented = [];
    let n = 0;
    const session = bscSession({ token: "at-1", expiresAt: 100, refreshToken: "rt-1", refreshExpiresAt: 10_000 }, async (rt) => {
      presented.push(rt);
      n += 1;
      return { ok: true, tokens: { token: `at-${n + 1}`, expiresAt: 100 + n, ...(n === 1 ? { refreshToken: "rt-2", refreshExpiresAt: 10_000 } : {}) } };
    }, () => 50);
    assert.equal(session.token(), "at-1");
    assert.deepEqual(await session.renew(), { ok: true, expiresAt: 101 });
    assert.equal(session.token(), "at-2");
    assert.equal(session.expiresAt(), 101);
    // No rotation in the answer: the last refresh token is kept.
    assert.deepEqual(await session.renew(), { ok: true, expiresAt: 102 });
    await session.renew();
    assert.deepEqual(presented, ["rt-1", "rt-2", "rt-2"]);
  });

  it("a session without a live refresh token fails without a request; a failed grant keeps the old token", async () => {
    const never = async () => assert.fail("must not refresh");
    assert.deepEqual(await bscSession({ token: "t", expiresAt: 1 }, never).renew(), { ok: false, reason: "no_refresh_token" });
    assert.deepEqual(await bscSession({ token: "t", expiresAt: 1, refreshToken: "r", refreshExpiresAt: 10 }, never, () => 10).renew(), { ok: false, reason: "refresh_expired" });
    const s = bscSession({ token: "t", expiresAt: 1, refreshToken: "r" }, async () => ({ ok: false, reason: "refused" }));
    assert.deepEqual(await s.renew(), { ok: false, reason: "refused" });
    assert.equal(s.token(), "t");
  });

  it("bscCaller sends whatever token the session holds now", async () => {
    let token = "at-1";
    const seen = [];
    const call = bscCaller({ apiBase: "https://bsc.invalid", token: () => token, headers: (t) => ({ authorization: `Bearer ${t}` }), fetchImpl: async (_u, init) => (seen.push(init.headers.authorization), new Response("{}", { status: 200 })) });
    await call(canonicalRequest({ method: "POST", path: FILTERS_PATH, body: { filters: {} } }));
    token = "at-2";
    await call(canonicalRequest({ method: "POST", path: FILTERS_PATH, body: { filters: {} } }));
    assert.deepEqual(seen, ["Bearer at-1", "Bearer at-2"]);
  });

  it("loadBrowserModules refreshes through services/browser's bscRefreshGrant, forced to the real target", async () => {
    // Stub modules in place of services/browser/dist: nothing reaches BSC.
    const dir = await mkdtemp(path.join(tmpdir(), "fake-browser-dist-"));
    try {
      await writeFile(path.join(dir, "bsc-signin.js"), `
        exports.calls = [];
        exports.bscPasswordSignIn = async () => ({ tokens: { token: "at", expiresAt: 1, refreshToken: "rt", refreshExpiresAt: 2, ssoCookies: { x: "y" } } });
        exports.bscRefreshGrant = async (input) => { exports.calls.push(input); return { ok: true, tokens: { token: "at-new", expiresAt: 42, refreshToken: "rt-new", ssoCookies: { x: "y" } } }; };`);
      await writeFile(path.join(dir, "bsc-endpoints.js"), `
        exports.resolveBscEndpoints = (env) => (env && Object.keys(env).length === 0 ? { target: "real", apiBase: "https://api.invalid" } : { target: "fake" });
        exports.bscApiHeaders = (t) => ({ authorization: "Bearer " + t });`);
      const mods = loadBrowserModules(dir);
      assert.deepEqual(await mods.signIn("u", "p"), { token: "at", expiresAt: 1, refreshToken: "rt", refreshExpiresAt: 2 });
      assert.deepEqual(await mods.refresh("rt"), { ok: true, tokens: { token: "at-new", expiresAt: 42, refreshToken: "rt-new" } });
      const { calls } = require(path.join(dir, "bsc-signin.js"));
      assert.deepEqual(calls, [{ refreshToken: "rt", fetchOptions: { env: {} } }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a services/browser dist without bscRefreshGrant", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "old-browser-dist-"));
    try {
      await writeFile(path.join(dir, "bsc-signin.js"), "exports.bscPasswordSignIn = async () => ({});");
      await writeFile(path.join(dir, "bsc-endpoints.js"), "exports.resolveBscEndpoints = () => ({ target: 'real' }); exports.bscApiHeaders = () => ({});");
      assert.throws(() => loadBrowserModules(dir), /bscRefreshGrant/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Against the built services/browser (fetch stubbed): skipped where it is not
  // built, e.g. this package's own CI job, which builds fake-bsc only.
  it("the built services/browser grant goes to the real authority with the refresh body", { skip: !existsSync(path.join(defaultBrowserDist(), "bsc-signin.js")) && "services/browser is not built" }, async () => {
    const realFetch = globalThis.fetch;
    const realLog = console.log;
    const calls = [];
    console.log = () => {};
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init.body) });
      return new Response(JSON.stringify({ access_token: "at-new", expires_in: 3600, refresh_token: "rt-new" }), { status: 200 });
    };
    try {
      const r = await loadBrowserModules().refresh("rt-old");
      assert.equal(r.ok, true);
      assert.equal(r.tokens.token, "at-new");
      assert.equal(r.tokens.refreshToken, "rt-new");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /^https:\/\/[^/]+\/.+\/oauth2\/v2\.0\/token$/);
      assert.ok(!calls[0].url.includes("127.0.0.1") && !calls[0].url.includes("fake"), "the real authority, never a fake");
      const body = new URLSearchParams(calls[0].body);
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "rt-old");
    } finally {
      globalThis.fetch = realFetch;
      console.log = realLog;
    }
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

  it("a confirmed miss that is never sent stays on the fake's miss list, through a reset, until it is recorded", async () => {
    const client = new FakeClient({ baseUrl: fake.base, callerKey: CALLER_KEY, adminKey: ADMIN_KEY, idToken: async () => idToken(LOADER) });
    const ok = async () => ({ kind: "response", status: 200, body: { aggregations: {} } });
    const stops = [
      ["token expiry", { tokenExpiresAt: 0 }, ok, "token_expiring", 0],
      ["a failed refresh", { tokenExpiresAt: 0, renewToken: async () => ({ ok: false, reason: "refused" }) }, ok, "refresh_failed", 0],
      ["Ctrl-C", { stoppedAfter: 1 }, ok, "interrupted", 1],
      ["the cap", { maxRequests: 1 }, ok, "cap", 1],
      ["a BSC 429", {}, async () => ({ kind: "response", status: 429, body: null }), "rate_limited", 0],
    ];
    for (const [i, [label, over, bsc, reason, recorded]] of stops.entries()) {
      // Each stop on its own deployment prefix, so one case's leftovers stay out of the next.
      const prefix = `case${i}-slug-`;
      const ns = `${prefix}w0`;
      const listed = async () => (await fake.call("GET", `/__fake/misses?prefix=${prefix}`)).body.misses.filter((m) => m.kind === "catalogue").map((m) => m.key).sort();
      const keys = [];
      // Catalogue keys are global: each case asks for its own facets.
      for (const variant of [`parallel${i}`, `insert${i}`]) {
        const body = { filters: { sport: ["baseball"], variant: [variant] } };
        assert.equal((await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: `tok-${ns}`, body })).status, 501);
        keys.push(requestKey(canonicalRequest({ method: "POST", path: FILTERS_PATH, body })));
      }
      const c = clock();
      let sent = 0;
      const { stoppedAfter, ...rest } = over;
      const r = await runRecordSession({
        ...base(c),
        prefix,
        ...rest,
        // The operator confirmed both (the plan), so only the stop keeps them back.
        confirmedKeys: new Set(keys),
        confirm: async () => assert.fail("already confirmed"),
        fake: client,
        stopped: () => stoppedAfter !== undefined && sent >= stoppedAfter,
        bsc: async (req) => (sent++, bsc(req)),
      });
      assert.equal(r.stopReason, reason, label);
      assert.equal(r.recorded, recorded, label);
      assert.equal(r.left, 2 - recorded, label);
      // The first request is the one recorded (when any is); the rest stay listed.
      const unsent = keys.slice(recorded).sort();
      assert.deepEqual(await listed(), unsent, `${label}: unsent misses stay listed`);
      // The next E2E seed's resets do not drop them either.
      await fake.call("POST", "/__fake/reset", { body: { prefix } });
      await fake.call("POST", "/__fake/reset", { body: { ns } });
      assert.deepEqual(await listed(), unsent, `${label}: kept through a reset`);
      // A later session picks them up, and only then does the list empty.
      const again = await runRecordSession({ ...base(clock()), prefix, fake: client, bsc: ok });
      assert.equal(again.recorded, unsent.length, label);
      assert.equal(again.left, 0);
      assert.deepEqual(await listed(), [], label);
    }
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
  const cw = require("../dist/recorder/capture-write.js");
  const { readSellerId, readCardSheetRow, readCappedText, describeUndo, runUndoWrite, CAPTURE_SKU_RE } = cw;
  const { captureOutcomeLines, undoOutcomeLines, undoSucceeded, captureWrite, undoWrite } = require("../dist/recorder/cli.js");
  const CARD = "96f9a87adeb7d02c275e117ef10d569c";
  const SELLER = "SECRET-seller_42";
  const FILTERS = { sport: ["hockey"], year: ["1995"], setName: ["halifax-mooseheads-qmjhl"], variant: ["base"] };
  const SKU = "NBCAPTURE-neo552-test";
  const PHOTO = "common/card/undefined/product/undefined/attachment";
  const intentFile = { method: "PUT", path: "seller/bulk-upload", listing: { cardId: CARD, filters: FILTERS, condition: "near_mint", price: 999, sellerSku: SKU } };
  const intent = { cardId: CARD, filters: FILTERS, condition: "near_mint", quantity: 1, priceCents: 99_900, sellerSku: SKU };
  const putRequest = { endpoint: "PUT seller/bulk-upload", method: "PUT", path: "seller/bulk-upload", intent };
  const photoRequest = { endpoint: "POST " + PHOTO, method: "POST", path: PHOTO, file: { bytes: Buffer.from("x"), fileName: "capture.jpg", contentType: "image/jpeg" } };

  /** A seller-sheet row as BSC's template sends it, with values that must never leak. */
  function sheetRow(over = {}) {
    return {
      productId: "SECRET-product-1",
      productType: "raw",
      cardId: CARD,
      price: "0",
      condition: "near_mint",
      availableQuantity: 0,
      active: false,
      sellerId: SELLER,
      sellerSku: null,
      sellerImgFront: "/Images/DefaultFront.gif",
      sellerImgBack: "/Images/DefaultBack.gif",
      updatedTimestamp: "2026-11-14T10:00:00.000000",
      somethingNbDoesNotRead: { nested: "SECRET-extra" },
      card: { id: CARD, cardNo: "1", players: "SECRET Player" },
      ...over,
    };
  }
  const otherRow = () => sheetRow({ cardId: "othercard", card: { id: "othercard", cardNo: "2" }, productId: "p2" });
  const listedRow = (over = {}) => sheetRow({ productId: "live-product", availableQuantity: 1, price: "999.00", sellerSku: SKU, active: true, ...over });

  /** A body larger than `bytes`, streamed with no Content-Length. */
  const bigStream = (bytes) =>
    new ReadableStream({
      start(c) {
        const chunk = new Uint8Array(1024 * 1024).fill(32);
        for (let n = 0; n <= bytes; n += chunk.length) c.enqueue(chunk);
        c.close();
      },
    });

  /**
   * A stubbed BSC: answers the profile, the sheet (one answer per read, the
   * last repeated) and the write. `write` is "ok", a status number, "hang",
   * "network" or "big".
   */
  function bscStub({ profile = { userId: "u", sellerProfile: { sellerId: SELLER, sellerStoreName: "SECRET store" } }, sheets = [[otherRow(), sheetRow()]], write = "ok" } = {}) {
    const calls = [];
    let sheetReads = 0;
    const fetchImpl = async (url, init) => {
      const p = new URL(url).pathname.slice(1);
      calls.push({ method: init.method, path: p, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
      if (init.method === "GET" && p === "marketplace/user/profile") return new Response(JSON.stringify(profile), { status: 200 });
      if (init.method === "POST" && p === "seller/bulk-upload/results") return new Response(JSON.stringify(sheets[Math.min(sheetReads++, sheets.length - 1)]), { status: 200 });
      if ((init.method === "PUT" && p === "seller/bulk-upload") || (init.method === "POST" && p === PHOTO)) {
        if (write === "hang") {
          // AbortSignal.timeout's timer does not hold the event loop open (a real socket does), so this one does.
          return new Promise((_r, reject) => {
            const keepAlive = setTimeout(() => reject(new Error("the stub hung past the test")), 5000);
            init.signal.addEventListener("abort", () => (clearTimeout(keepAlive), reject(init.signal.reason)));
          });
        }
        if (write === "network") throw new TypeError("fetch failed");
        if (write === "big") return new Response(bigStream(cw.MAX_BYTES.put), { status: 200 });
        const body = p === PHOTO ? { objectKey: "/prod/x.jpg" } : [{ productId: "SECRET-product-1", cardId: CARD, sellerId: SELLER, price: "999.00", availableQuantity: 1 }];
        return new Response(JSON.stringify(body), { status: write === "ok" ? 200 : write });
      }
      throw new Error(`unexpected ${init.method} ${p}`);
    };
    return { calls, fetchImpl, deps: { apiBase: "https://bsc.invalid", token: "t", headers: () => ({}), fetchImpl, timeoutMs: 200 } };
  }
  const writes = (bsc) => bsc.calls.filter((c) => c.method === "PUT" || c.path === PHOTO);
  const SECRETS = [SELLER, "SECRET"];
  const assertNoSecrets = (value, what) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const s of SECRETS) assert.ok(!text.includes(s), `${what} leaked ${s}`);
  };
  const okFake = { uploadCapture: async () => ({ verdict: "ok", paths: [] }) };
  const noUpload = { uploadCapture: async () => assert.fail("no upload") };

  let dir;
  before(async () => (dir = await mkdtemp(path.join(tmpdir(), "fake-bsc-capture-"))));
  after(() => rm(dir, { recursive: true, force: true }));
  const writeJson = async (name, v) => {
    const f = path.join(dir, name);
    await writeFile(f, JSON.stringify(v));
    return f;
  };

  it("loads a listing intent, and lists every request it would send", async () => {
    const req = await loadWriteRequest(await writeJson("put.json", { ...intentFile, path: "/seller/bulk-upload" }));
    assert.equal(req.endpoint, "PUT seller/bulk-upload");
    assert.deepEqual(req.intent, intent);
    const plan = describeWrite(req);
    assert.equal(plan.length, 3);
    assert.match(plan[0], /^GET marketplace\/user\/profile/);
    assert.match(plan[1], /^POST seller\/bulk-upload\/results/);
    assert.match(plan[2], /^PUT seller\/bulk-upload: 1 listing row, quantity 1 \(REAL WRITE\)/);
    const undo = describeUndo(req);
    assert.equal(undo.length, 4);
    assert.match(undo[3], /^POST seller\/bulk-upload\/results: .*check the row is down/);
    for (const line of [...plan, ...undo]) assert.ok(!line.includes(CARD), "the plan names no card id");
    // An explicit quantity of 1 is accepted too.
    assert.equal((await loadWriteRequest(await writeJson("q1.json", { ...intentFile, listing: { ...intentFile.listing, quantity: 1 } }))).intent.quantity, 1);
  });

  it("refuses a PUT with a hand-written body, and an intent a capture must never send", async () => {
    await assert.rejects(loadWriteRequest(await writeJson("body.json", { method: "PUT", path: "seller/bulk-upload", body: { sellerId: "s", listings: [] } })), /names the listing, not a body/);
    const bad = async (over, re) => assert.rejects(loadWriteRequest(await writeJson("bad.json", { ...intentFile, listing: { ...intentFile.listing, ...over } })), re);
    await bad({ price: 999.99 }, /500 to 999/);
    await bad({ price: 499.99 }, /500 to 999/);
    await bad({ price: 1 }, /500 to 999/);
    await bad({ price: 600.001 }, /whole cents/);
    await bad({ quantity: 2 }, /exactly 1 copy/);
    await bad({ quantity: 0 }, /exactly 1 copy/);
    await bad({ condition: "nm-mint" }, /raw conditions/);
    await bad({ filters: { sport: ["hockey", "baseball"] } }, /exactly one value/);
    await bad({ filters: {} }, /filters/);
    await bad({ cardId: "../x" }, /cardId/);
    await bad({ sellerSku: "" }, /capture SKU/);
    await bad({ sellerSku: "NBCAPTURE-" }, /capture SKU/);
    await bad({ sellerSku: `NBCAPTURE-${"a".repeat(81)}` }, /capture SKU/);
    await assert.rejects(loadWriteRequest(await writeJson("search.json", { method: "POST", path: "search/bulk-upload/results", body: {} })), /not a known BSC write endpoint/);
  });

  it("refuses an NB listing SKU: NB1- or NB-", async () => {
    const bad = async (sku) => assert.rejects(loadWriteRequest(await writeJson("nbsku.json", { ...intentFile, listing: { ...intentFile.listing, sellerSku: sku } })), /capture SKU/);
    await bad("NB1-k17abcdefghijklmnopqrstuvwxyz12-NM-k17abcdefghijklmnopqrstuvwxyz12");
    await bad("NB1-capture-NM-test");
    await bad("NB-capture");
    await bad("nbcapture-lowercase");
  });

  it("accepts only the literal photo path, and never sends the image's own file name", async () => {
    const img = path.join(dir, "IMG_1234 my card.JPG");
    await writeFile(img, Buffer.from([0xff, 0xd8, 0xff]));
    const req = await loadWriteRequest(await writeJson("photo.json", { method: "POST", path: PHOTO }), img);
    assert.equal(req.file.fileName, "capture.jpg");
    assert.equal(req.file.contentType, "image/jpeg");
    await assert.rejects(loadWriteRequest(await writeJson("photo2.json", { method: "POST", path: "common/card/abc/product/def/attachment" }), img), /photo upload goes to common\/card\/undefined\/product\/undefined\/attachment exactly/);
    await assert.rejects(loadWriteRequest(await writeJson("photo3.json", { method: "POST", path: PHOTO })), /--file/);
  });

  it("reads the seller id and the sheet, then PUTs the row exactly as planBscSheet builds it", async () => {
    const bsc = bscStub();
    const captured = [];
    const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: { uploadCapture: async (c) => (captured.push(c), { verdict: "ok", paths: [] }) } });
    assert.equal(r.ok, true);
    assert.equal(r.writeSent, true);
    assert.equal(r.sent, 3);
    assert.deepEqual(bsc.calls.map((c) => `${c.method} ${c.path}`), ["GET marketplace/user/profile", "POST seller/bulk-upload/results", "PUT seller/bulk-upload"]);
    // The sheet read is readBscSellerSheet's body.
    assert.deepEqual(bsc.calls[1].body, { condition: "near_mint", currentListings: true, productType: "raw", page: 0, size: 5000, sort: "default", filters: FILTERS });
    // {...raw, condition, availableQuantity, price (dollar number), sellerSku}; the raw row's other keys ride along untouched.
    assert.deepEqual(bsc.calls[2].body, { sellerId: SELLER, listings: [{ ...sheetRow(), condition: "near_mint", availableQuantity: 1, price: 999, sellerSku: SKU }] });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].endpoint, "PUT seller/bulk-upload");
    assertNoSecrets(captured, "the fake upload");
    assertNoSecrets(r, "the result");
  });

  it("never logs the seller id or a row value", async () => {
    const bsc = bscStub();
    const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: { uploadCapture: async () => ({ verdict: "shape_drift", paths: ["[].price"] }) } });
    assert.equal(bsc.calls[2].body.sellerId, SELLER, "the PUT carries the looked-up seller id");
    const lines = [...captureOutcomeLines(r, "/tmp/put.json", true)];
    // The stored shape is printed: key paths and types, never a value.
    assert.ok(lines.includes(`stored shape (${r.paths} path(s), no values):`));
    assert.ok(lines.includes("  (root): array"));
    assert.ok(lines.includes("  [].sellerId: string"));
    assert.ok(lines.includes("  [].price: string"));
    lines.push(...captureOutcomeLines({ ok: false, sent: 2, writeSent: false, reason: "already_listed" }, "f", true));
    for (const reason of ["timeout", "upload_refused"]) lines.push(...captureOutcomeLines({ ok: false, sent: 3, writeSent: true, reason }, "f", true));
    for (const refusal of [{ step: "profile", reason: "no_seller_id" }, { step: "sheet", reason: "card_on_sheet_more_than_once", rows: 2 }, { step: "sheet", reason: "http", status: 500 }, { step: "sheet", reason: "oversized_row" }]) {
      lines.push(...captureOutcomeLines({ ok: false, sent: 2, writeSent: false, reason: "read_refused", refusal }, "f", true));
      lines.push(...undoOutcomeLines({ ok: false, sent: 2, writeSent: false, reason: "read_refused", refusal }));
      lines.push(...undoOutcomeLines({ ok: true, sent: 4, writeSent: true, status: 200, check: { state: "unchecked", refusal } }));
    }
    for (const state of ["down", "down_other_sku", "still_listed", "listed_other_sku"]) lines.push(...undoOutcomeLines({ ok: true, sent: 4, writeSent: true, status: 200, check: { state } }));
    lines.push(...undoOutcomeLines({ ok: false, sent: 2, writeSent: false, reason: "not_ours" }));
    assert.ok(lines.length > 20);
    assertNoSecrets(lines.join("\n"), "the printed lines");
    assert.ok(!lines.join("\n").includes(CARD));
  });

  it("refuses to write when the card is already listed", async () => {
    const bsc = bscStub({ sheets: [[sheetRow({ availableQuantity: 2, price: "5.00", sellerSku: "theirs" })]] });
    const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: noUpload });
    assert.deepEqual(r, { ok: false, sent: 2, writeSent: false, reason: "already_listed" });
    assert.equal(writes(bsc).length, 0, "no PUT sent");
    assert.ok(!captureOutcomeLines(r, "f", true).some((l) => /REAL WRITE/.test(l)));
  });

  it("refuses to write unless the sheet holds exactly one readable row for the card", async () => {
    const huge = sheetRow({ padding: "x".repeat(cw.MAX_SHEET_ROW_BYTES) });
    for (const [sheet, reason, rows] of [
      [[otherRow()], "card_not_on_sheet"],
      [[], "card_not_on_sheet"],
      [[sheetRow(), sheetRow({ productId: "p9" })], "card_on_sheet_more_than_once", 2],
      [{ results: [sheetRow(), sheetRow()] }, "card_on_sheet_more_than_once", 2],
      [[sheetRow({ condition: "excellent" })], "card_not_on_sheet"],
      [[sheetRow({ productType: "graded" })], "card_not_on_sheet"],
      [[sheetRow({ cardId: "different" })], "card_not_on_sheet"],
      [[otherRow(), huge], "oversized_row"],
      [[sheetRow({ availableQuantity: "1" })], "unreadable_row"],
      [{ nope: true }, "unreadable_sheet"],
    ]) {
      const bsc = bscStub({ sheets: [sheet] });
      const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: noUpload });
      assert.equal(r.reason, "read_refused", reason);
      assert.equal(r.writeSent, false);
      assert.deepEqual(r.refusal, rows ? { step: "sheet", reason, rows } : { step: "sheet", reason });
      assert.equal(writes(bsc).length, 0, `${reason}: no PUT sent`);
    }
    // Another card's oversized row is dropped, not fatal.
    const r = await readCardSheetRow(bscStub({ sheets: [[otherRow(), { ...otherRow(), padding: "x".repeat(cw.MAX_SHEET_ROW_BYTES) }, sheetRow()]] }).deps, intent);
    assert.equal(r.ok, true);
  });

  it("stops before the sheet when the profile carries no usable seller id", async () => {
    for (const profile of [{ sellerProfile: {} }, { sellerProfile: { sellerId: "has space" } }, {}]) {
      const bsc = bscStub({ profile });
      const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: noUpload });
      assert.deepEqual(r, { ok: false, sent: 1, writeSent: false, reason: "read_refused", refusal: { step: "profile", reason: "no_seller_id" } });
      assert.equal(bsc.calls.length, 1);
    }
    assert.deepEqual(await readSellerId(bscStub().deps), { ok: true, sellerId: SELLER });
  });

  it("does not retry a failed write", async () => {
    const bsc = bscStub({ write: 500 });
    const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: { uploadCapture: async () => ({ verdict: "shape_drift", paths: ["$status"] }) } });
    assert.equal(r.status, 500);
    assert.equal(writes(bsc).length, 1);
  });

  it("after the PUT went out, every failure says it may have been a real write and how to undo it", async () => {
    for (const [write, reason] of [["hang", "timeout"], ["network", "network"], ["big", "too_large"]]) {
      const bsc = bscStub({ write });
      const r = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: noUpload });
      assert.deepEqual(r, { ok: false, sent: 3, writeSent: true, reason }, write);
      assert.equal(writes(bsc).length, 1, `${write}: sent once, never retried`);
      const out = captureOutcomeLines(r, "/tmp/put.json", true).join("\n");
      assert.match(out, /THIS MAY HAVE BEEN A REAL WRITE/);
      assert.match(out, /undo-write --request \/tmp\/put\.json/);
    }
    const bsc = bscStub();
    const refused = await runCaptureWrite({ ...bsc.deps, request: putRequest, fake: { uploadCapture: async () => { throw new Error("403"); } } });
    assert.deepEqual(refused, { ok: false, sent: 3, writeSent: true, reason: "upload_refused" });
    const out = captureOutcomeLines(refused, "/tmp/put.json", true).join("\n");
    assert.match(out, /THIS WAS A REAL WRITE/);
    assert.match(out, /undo-write --request \/tmp\/put\.json/);
  });

  it("sends a photo upload as one request; a failure after it says there is no API undo", async () => {
    const ok = bscStub();
    const r = await runCaptureWrite({ ...ok.deps, request: photoRequest, fake: okFake });
    assert.equal(r.ok, true);
    assert.equal(r.sent, 1);
    assert.ok(ok.calls[0].body instanceof FormData);
    assert.equal(ok.calls[0].body.get("attachment").name, "capture.jpg");
    const hung = bscStub({ write: "hang" });
    const failed = await runCaptureWrite({ ...hung.deps, request: photoRequest, fake: noUpload });
    assert.deepEqual(failed, { ok: false, sent: 1, writeSent: true, reason: "timeout" });
    const out = captureOutcomeLines(failed, "f", false).join("\n");
    assert.match(out, /THIS MAY HAVE BEEN A REAL PHOTO UPLOAD.*no API undo/);
    assert.ok(!out.includes("undo-write"));
  });

  it("reads answers with a streamed byte cap", async () => {
    assert.equal(await readCappedText(new Response("abc"), 3), "abc");
    assert.equal(await readCappedText(new Response(bigStream(2 * 1024 * 1024)), 1024 * 1024), null);
    assert.equal(await readCappedText(new Response("x", { headers: { "content-length": "999999" } }), 10), null);
    const big = bscStub({ sheets: [[]] });
    big.deps.fetchImpl = async () => new Response(bigStream(cw.MAX_BYTES.profile), { status: 200 });
    assert.deepEqual(await readSellerId(big.deps), { ok: false, refusal: { step: "profile", reason: "too_large" } });
  });

  it("dry runs send nothing and read no credentials", async () => {
    const file = await writeJson("dry.json", intentFile);
    const realFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => (fetches++, assert.fail("a dry run must not fetch"));
    const out = [];
    const realWrite = process.stderr.write;
    process.stderr.write = (chunk) => (out.push(String(chunk)), true);
    try {
      assert.equal(await captureWrite(parseArgs(["capture-write", "--request", file]).flags), 0);
      assert.equal(await undoWrite(parseArgs(["undo-write", "--request", file]).flags), 0);
    } finally {
      process.stderr.write = realWrite;
      globalThis.fetch = realFetch;
    }
    assert.equal(fetches, 0);
    const text = out.join("");
    assert.match(text, /send 3 request\(s\)/);
    assert.match(text, /send 4 request\(s\)/);
    assert.match(text, /dry run: nothing sent/);
    assert.ok(!text.includes(CARD));
  });

  it("mirrors NB's delist on undo: a fresh read, that row at quantity 0, then one check read", async () => {
    const live = listedRow();
    const bsc = bscStub({ sheets: [[otherRow(), live], [otherRow(), sheetRow({ productId: "new-template" })]] });
    const r = await runUndoWrite({ ...bsc.deps, request: putRequest });
    assert.deepEqual(r, { ok: true, sent: 4, writeSent: true, status: 200, check: { state: "down" } });
    assert.ok(undoSucceeded(r));
    assert.deepEqual(bsc.calls.map((c) => `${c.method} ${c.path}`), ["GET marketplace/user/profile", "POST seller/bulk-upload/results", "PUT seller/bulk-upload", "POST seller/bulk-upload/results"]);
    assert.deepEqual(bsc.calls[2].body, { sellerId: SELLER, listings: [{ ...live, condition: "near_mint", availableQuantity: 0 }] });
  });

  it("tells the operator when the check read finds the row still up, under another SKU, or cannot read it", async () => {
    for (const [after, state, ok] of [
      [[listedRow()], "still_listed", false],
      [[listedRow({ sellerSku: "someone-else" })], "listed_other_sku", false],
      [[sheetRow({ sellerSku: "someone-else" })], "down_other_sku", true],
    ]) {
      const bsc = bscStub({ sheets: [[listedRow()], after] });
      const r = await runUndoWrite({ ...bsc.deps, request: putRequest });
      assert.deepEqual(r.check, { state }, state);
      assert.equal(undoSucceeded(r), ok, state);
      assert.equal(bsc.calls.filter((c) => c.path === "seller/bulk-upload/results").length, 2, "one check read, no retry");
    }
    const gone = bscStub({ sheets: [[listedRow()], []] });
    const r = await runUndoWrite({ ...gone.deps, request: putRequest });
    assert.deepEqual(r.check, { state: "unchecked", refusal: { step: "sheet", reason: "card_not_on_sheet" } });
    assert.equal(undoSucceeded(r), false);
    assert.match(undoOutcomeLines(r).join("\n"), /NOT CHECKED/);
    // The undo's PUT timing out still gets its check read.
    const hung = bscStub({ sheets: [[listedRow()], [sheetRow()]], write: "hang" });
    const h = await runUndoWrite({ ...hung.deps, request: putRequest });
    assert.deepEqual(h, { ok: false, sent: 4, writeSent: true, reason: "timeout", check: { state: "down" } });
    assert.equal(writes(hung).length, 1);
  });

  it("undo refuses a row that is not listed, or not the capture's", async () => {
    const unlisted = bscStub();
    assert.deepEqual(await runUndoWrite({ ...unlisted.deps, request: putRequest }), { ok: false, sent: 2, writeSent: false, reason: "not_listed" });
    for (const sku of ["someone-else", "NB1-k17abcdefghijklmnopqrstuvwxyz12-NM-k17abcdefghijklmnopqrstuvwxyz12", "NBCAPTURE-another-capture", null]) {
      const theirs = bscStub({ sheets: [[listedRow({ availableQuantity: 4, sellerSku: sku })]] });
      assert.deepEqual(await runUndoWrite({ ...theirs.deps, request: putRequest }), { ok: false, sent: 2, writeSent: false, reason: "not_ours" }, String(sku));
      assert.equal(writes(theirs).length, 0);
    }
    assert.equal(writes(unlisted).length, 0);
    assert.deepEqual(await runUndoWrite({ ...unlisted.deps, request: photoRequest }), { ok: false, sent: 0, writeSent: false, reason: "nothing_to_undo" });
  });

  it("keeps its copies of NB's rules in step with apps/web, and its SKU out of NB's", async () => {
    const { readFile } = await import("node:fs/promises");
    const web = path.resolve(import.meta.dirname, "..", "..", "..", "apps", "web", "convex");
    const seller = await readFile(path.join(web, "adapters", "bscSeller.ts"), "utf8");
    assert.ok(seller.includes(`const SELLER_ID_RE = ${cw.SELLER_ID_RE.toString()};`), "SELLER_ID_RE");
    assert.ok(seller.includes(`const SHEET_MAX_ROWS = ${cw.SHEET_MAX_ROWS};`), "SHEET_MAX_ROWS");
    for (const [k, v] of Object.entries(cw.MAX_BYTES)) {
      const mb = v % (1024 * 1024) === 0 ? `${v / (1024 * 1024)} * 1024 * 1024` : `${v / 1024} * 1024`;
      assert.ok(seller.includes(`${k}: ${mb},`), `BSC_SELLER_MAX_BYTES.${k}`);
    }
    const money = await readFile(path.join(web, "lib", "bscMoney.ts"), "utf8");
    assert.ok(money.includes(`BSC_MAX_PRICE_CENTS = ${cw.BSC_MAX_PRICE_CENTS.toLocaleString("en-US").replace(/,/g, "_")};`), "max price");
    const plan = await readFile(path.join(web, "lib", "bscSheetPlan.ts"), "utf8");
    assert.ok(plan.includes(`MAX_SHEET_ROW_BYTES = ${cw.MAX_SHEET_ROW_BYTES / 1024} * 1024;`), "MAX_SHEET_ROW_BYTES");
    const conditions = await readFile(path.join(web, "lib", "bscConditions.ts"), "utf8");
    const listed = [...conditions.matchAll(/RAW_CONDITIONS = \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    assert.deepEqual([...listed].sort(), [...cw.BSC_RAW_CONDITIONS].sort());
    // NB's own SKU shape can never match a capture SKU, and a capture SKU never an NB one.
    const skuSrc = await readFile(path.join(web, "lib", "listingSku.ts"), "utf8");
    const shape = new RegExp(/const SKU_SHAPE = \/(.+)\/;/.exec(skuSrc)[1]);
    assert.ok(skuSrc.includes('LISTING_SKU_PREFIX = "NB1"'));
    for (const sku of [SKU, "NBCAPTURE-NB1-k17abcdefghijklmnopqrstuvwxyz12-NM-k17abcdefghijklmnopqrstuvwxyz12"]) {
      assert.ok(CAPTURE_SKU_RE.test(sku));
      assert.ok(!shape.test(sku.trim()), `NB's SKU_SHAPE accepts ${sku}`);
    }
    assert.ok(!CAPTURE_SKU_RE.test("NB1-k17abcdefghijklmnopqrstuvwxyz12-NM-k17abcdefghijklmnopqrstuvwxyz12"));
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
  const { replayable, planMisses, describeRequest } = require("../dist/recorder/record.js");
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
      ...base(c, { confirm: async (items) => (asked.push(items), true) }),
      fake: fakeStub([[miss("POST", FILTERS_PATH, { filters: { sport: ["a"], year: ["1996"] } }), miss("GET", `marketplace/card/${CARD}/card-listing`)]]),
      bsc: async () => ({ kind: "response", status: 200, body: { aggregations: {} } }),
    });
    assert.deepEqual(asked, [["filters sport=a year=1996", `cardListing ${CARD}`]]);
    assert.equal(r.sent, 2);
  });

  it("asks again for any miss outside the confirmed plan, and for every new --watch batch", async () => {
    const a = miss("POST", FILTERS_PATH, { filters: { sport: ["a"] } });
    const b = miss("POST", FILTERS_PATH, { filters: { sport: ["b"] } });
    const late = miss("POST", RESULTS_PATH, resultsBody({ sport: ["late"] }));
    const sent = [];
    const bsc = async (q) => (sent.push(describeRequest(q)), { kind: "response", status: 200, body: q.path === RESULTS_PATH ? [] : { aggregations: {} } });

    // The plan confirmed only `a`; `b` arrived between the plan and the session.
    let c = clock();
    const asked = [];
    let r = await runRecordSession({ ...base(c, { confirmedKeys: new Set([a.key]), confirm: async (items) => (asked.push(items), true) }), fake: fakeStub([[a, b]]), bsc });
    assert.deepEqual(asked, [["filters sport=b"]]);
    assert.equal(r.sent, 2);

    // Declining the newcomer sends nothing of that pass, the confirmed one included.
    c = clock();
    sent.length = 0;
    r = await runRecordSession({ ...base(c, { confirmedKeys: new Set([a.key]), confirm: async () => false }), fake: fakeStub([[a, b]]), bsc });
    assert.equal(r.stopReason, "declined");
    assert.deepEqual(sent, []);

    // --watch: each new batch is asked about before it goes out.
    c = clock();
    sent.length = 0;
    const batches = [];
    let polls = 0;
    const fake = fakeStub([[a], [a, b], [a, b, late], [a, b, late]]);
    r = await runRecordSession({
      ...base(c, { watch: true, pollMs: 3000, confirmedKeys: new Set([a.key]), confirm: async (items) => (batches.push([...items]), true) }),
      fake: { ...fake, misses: async (p) => (polls++, fake.misses(p)) },
      stopped: () => polls >= 4,
      bsc,
    });
    assert.deepEqual(batches, [["filters sport=b"], ["results sport=late"]]);
    assert.deepEqual(sent, ["filters sport=a", "filters sport=b", "results sport=late"]);
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
