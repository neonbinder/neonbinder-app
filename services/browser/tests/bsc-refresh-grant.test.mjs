/**
 * NEO-552: `bscRefreshGrant` (src/bsc-signin.ts), the one B2C refresh grant
 * shared by the BSC adapter and the fake-BSC recorder. The adapter's login
 * paths are covered in bsc-adapter.test.mjs; this pins the helper itself:
 * the exact body, one request, the status classification, and that no token
 * reaches a log line. `fetch` is stubbed; nothing leaves the process.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { bscRefreshGrant } = require("../dist/bsc-signin");
const { BSC_B2C_CLIENT, resolveBscEndpoints } = require("../dist/bsc-endpoints");
const { resetBscBreaker } = require("../dist/bsc-fetch");

const RT = "rt-presented-secret";
const REAL = { env: {} };

describe("bscRefreshGrant", () => {
  let realFetch;
  let calls;
  let logged;
  let realLog;
  let realWarn;
  const answer = (fn) => {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return fn();
    };
  };

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realLog = console.log;
    realWarn = console.warn;
    calls = [];
    logged = [];
    console.log = (...a) => logged.push(a.join(" "));
    console.warn = (...a) => logged.push(a.join(" "));
    resetBscBreaker();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.warn = realWarn;
    resetBscBreaker();
  });

  it("sends the public client's refresh grant once, to the resolved authority, and returns the rotated set", async () => {
    answer(() => new Response(JSON.stringify({ access_token: "at-new-secret", expires_in: 3600, refresh_token: "rt-rotated-secret", refresh_token_expires_in: 86400 }), { status: 200 }));
    const r = await bscRefreshGrant({ refreshToken: RT, fetchOptions: REAL });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${resolveBscEndpoints({}).authority}/oauth2/v2.0/token`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].init.body)), {
      client_id: BSC_B2C_CLIENT.clientId,
      grant_type: "refresh_token",
      refresh_token: RT,
      scope: BSC_B2C_CLIENT.scope,
    });
    assert.equal(r.ok, true);
    assert.equal(r.tokens.token, "at-new-secret");
    assert.equal(r.tokens.refreshToken, "rt-rotated-secret");
    assert.ok(r.tokens.expiresAt > Date.now());
    assert.ok(!logged.join("\n").includes("secret"), "no token in any log line");
  });

  it("classifies a refusal, throttling, an outage and a missing access token; one request each", async () => {
    for (const [status, body, reason, reauthRequired] of [
      [400, { error: "invalid_grant", error_description: RT }, "refused", true],
      [401, {}, "refused", true],
      [429, {}, "rate_limited", false],
      [503, {}, "server_error", false],
      [200, { token_type: "Bearer" }, "no_access_token", false],
    ]) {
      calls = [];
      resetBscBreaker();
      answer(() => new Response(JSON.stringify(body), { status }));
      const r = await bscRefreshGrant({ refreshToken: RT, fetchOptions: REAL });
      assert.deepEqual(r, { ok: false, status, reason, reauthRequired }, String(status));
      assert.equal(calls.length, 1, `${status}: never retried`);
    }
    assert.ok(!logged.join("\n").includes(RT), "the presented refresh token is never logged");
  });

  it("lets a network failure propagate, after one attempt", async () => {
    globalThis.fetch = async () => {
      calls.push(1);
      throw new TypeError("fetch failed");
    };
    await assert.rejects(bscRefreshGrant({ refreshToken: RT, fetchOptions: REAL }), TypeError);
    assert.equal(calls.length, 1);
  });
});
