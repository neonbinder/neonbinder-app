/**
 * NEO-555 PR B1: the browser service routes a FAKE eBay session by its
 * credential key.
 *
 *   ebay-credentials-fake-<slug>-<uid>  -> the fake eBay under
 *       <NEONBINDER_FAKE_BSC_URL>/ebay/api|apiz, the fake's fixed public
 *       client id and secret, and the fake's caller headers on every call.
 *   ebay-credentials-<uid>              -> the process's configured eBay
 *       environment, unchanged.
 *
 * Covered here (the files are src/routes/ebay-oauth.ts,
 * src/services/ebay-oauth.ts, src/services/secrets-manager.ts,
 * src/routes/health.ts, src/services/ebay-notification.ts):
 *   1. A fake key is honoured only with a valid fake URL, the caller key, and
 *      outside prod. Prod, no URL, a bad URL and no caller key all refuse it
 *      with no eBay call, no store write and no fall-back to the real eBay.
 *   2. A bare key is unchanged, with or without a fake URL in the process.
 *   3. The 72 h expiry applies to a fake eBay secret and to nothing else.
 *   4. /health reports ebayFake and ebayTarget and nothing else changed.
 *   5. N3: the notification verifier never resolves or fetches the fake.
 *
 * Nothing here touches the network or Secret Manager. Placeholders only;
 * every credential-shaped value carries a SENTINEL so the leak checks search
 * raw text.
 */
import { describe, it, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Fake @google-cloud/secret-manager, installed before the dist modules load.
// The constructor delegates per call, so each test installs its own spy.
// ---------------------------------------------------------------------------

let activeClient = null;
class FakeSecretManagerServiceClient {
  constructor() {
    return activeClient;
  }
}
const sdkPath = require.resolve("@google-cloud/secret-manager");
require.cache[sdkPath] = {
  id: sdkPath,
  filename: sdkPath,
  loaded: true,
  exports: { SecretManagerServiceClient: FakeSecretManagerServiceClient },
};
process.env.GOOGLE_CLOUD_PROJECT = "neonbinder-test";

const express = require("express");
const { createEbayOAuthRouter, resolveEbayConfigForKey } = require("../dist/routes/ebay-oauth");
const { createHealthRouter } = require("../dist/routes/health");
const { CONTRACT_VERSION } = require("../dist/contract-version");
const { SecretsManagerService, FAKE_CREDENTIAL_TTL_MS } = require("../dist/services/secrets-manager");
const { EbayNotificationVerifier } = require("../dist/services/ebay-notification");
const { EbayOAuthError, resolveFakeEbayTarget } = require("../dist/services/ebay-oauth");
const { FAKE_EBAY_CLIENT_ID, FAKE_EBAY_CLIENT_SECRET, FAKE_EBAY_RU_NAME } = require("../dist/routes/ebay-probe");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_ORIGIN = "http://127.0.0.1:9";
const CALLER_KEY = "FAKE-CALLER-KEY-SENTINEL-0001";
const FAKE_KEY = "ebay-credentials-fake-happy-otter-123-user_2AbCdEf";
const BARE_KEY = "ebay-credentials-user_2AbCdEf";

const SBX_CLIENT_SECRET = "SBX-CLIENTSECRET-SENTINEL-0002";
const PROD_CLIENT_SECRET = "PRD-CLIENTSECRET-SENTINEL-0003";
const CODE = "v^1.1#i^1#CODE-SENTINEL-0001#r^1";
const ACCESS = "v^1.1#i^1#ACCESS-SENTINEL-0001#t^Ul4x";
const REFRESH = "v^1.1#i^1#REFRESH-SENTINEL-0001#r^1";
const SENTINELS = [CALLER_KEY, SBX_CLIENT_SECRET, PROD_CLIENT_SECRET, CODE, ACCESS, REFRESH, FAKE_EBAY_CLIENT_SECRET];

const NOW = Date.parse("2026-11-18T12:00:00Z");

const SANDBOX_ENV = {
  EBAY_ENVIRONMENT: "sandbox",
  EBAY_CLIENT_ID: "NeonBind-test-SBX-0000000000-00000000",
  EBAY_CLIENT_SECRET: SBX_CLIENT_SECRET,
  EBAY_RU_NAME: "Neon_Binder-sbx-runame",
};
const PRODUCTION_ENV = {
  EBAY_ENVIRONMENT: "production",
  EBAY_CLIENT_ID: "NeonBind-test-PRD-0000000000-00000000",
  EBAY_CLIENT_SECRET: PROD_CLIENT_SECRET,
  EBAY_RU_NAME: "Neon_Binder-prd-runame",
};
const FAKE_ENV = { NEONBINDER_FAKE_BSC_URL: FAKE_ORIGIN, NEONBINDER_FAKE_BSC_KEY: CALLER_KEY };

const KEY_PATTERN = /^[a-z0-9]+-credentials-[a-zA-Z0-9_-]+$/;
class InMemoryStore {
  constructor() {
    this.map = new Map();
    this.writes = 0;
  }
  _check(key) {
    if (!KEY_PATTERN.test(key)) throw new Error("Invalid credential key format");
  }
  async getCredentials(key) {
    this._check(key);
    const value = this.map.get(key);
    if (!value) throw new Error("Credentials not found");
    return { ...value };
  }
  async updateCredentials(key, credentials) {
    this._check(key);
    this.writes++;
    this.map.set(key, { ...credentials });
  }
  async credentialsExist(key) {
    this._check(key);
    return this.map.has(key);
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Records every call; answers like the eBay token endpoint and Commerce Identity. */
const calls = [];
async function stubFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  const call = {
    url: String(url),
    method: init.method,
    authorization: headers.get("authorization"),
    callerKey: headers.get("x-nb-fake-bsc-key"),
    serverless: headers.get("x-serverless-authorization"),
    fakeIdToken: headers.get("x-nb-fake-id-token"),
    form: typeof init.body === "string" ? new URLSearchParams(init.body) : null,
  };
  calls.push(call);
  if (call.url.endsWith("/identity/v1/oauth2/token")) {
    return json(200, {
      access_token: ACCESS,
      expires_in: 7200,
      refresh_token: REFRESH,
      refresh_token_expires_in: 47304000,
      token_type: "User Access Token",
    });
  }
  if (call.url.endsWith("/commerce/identity/v1/user/")) {
    return json(200, { userId: "abc123immutable", username: "neon_seller_1" });
  }
  return json(404, {});
}

const logs = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };
function captureConsole() {
  for (const level of ["log", "warn", "error"]) {
    console[level] = (...args) => logs.push(args.map(String).join(" "));
  }
}
function lines(msg) {
  return logs
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l))
    .filter((l) => l.msg === msg);
}

let server;
let baseUrl;
let store;
let env;
let mintIdToken;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "10kb" }));
  app.use(
    createEbayOAuthRouter({
      createStore: () => store,
      fetchImpl: stubFetch,
      env: () => env,
      now: () => NOW,
      mintIdToken: (aud) => mintIdToken(aud),
    }),
  );
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  Object.assign(console, realConsole);
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  store = new InMemoryStore();
  env = { ENVIRONMENT: "dev", ...SANDBOX_ENV, ...FAKE_ENV };
  mintIdToken = async () => {
    throw new Error("no ID token expected over http");
  };
  calls.length = 0;
  logs.length = 0;
  activeClient = null;
  captureConsole();
});

afterEach(() => {
  Object.assign(console, realConsole);
  mock.timers.reset();
  // Every test's log output is checked, not only the ones about logging.
  const text = logs.join("\n");
  for (const s of SENTINELS) assert.ok(!text.includes(s), "log output must not contain credential material");
  assert.ok(!text.includes(FAKE_KEY), "log output must not contain the credential key");
});

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, body: text ? JSON.parse(text) : null };
}

function assertNothingCalled(res, label) {
  assert.deepEqual(calls, [], `${label}: no eBay (real or fake) call`);
  assert.equal(store.writes, 0, `${label}: nothing stored`);
  for (const s of SENTINELS) assert.ok(!res.text.includes(s), `${label}: response must not contain credentials`);
  assert.ok(!res.text.includes(FAKE_KEY), `${label}: response must not echo the key`);
}

// ---------------------------------------------------------------------------
// 1. A fake key goes to the fake
// ---------------------------------------------------------------------------

describe("a fake key routes to the fake eBay", () => {
  const FAKE_BASIC = `Basic ${Buffer.from(`${FAKE_EBAY_CLIENT_ID}:${FAKE_EBAY_CLIENT_SECRET}`).toString("base64")}`;

  it("connect: token and identity calls go to <FAKE>/ebay/api and /ebay/apiz with the fake client and caller key", async () => {
    const res = await post("/oauth/ebay/connect", { key: FAKE_KEY, code: CODE });

    assert.equal(res.status, 200);
    assert.equal(res.body.username, "neon_seller_1");
    assert.equal(res.body.ebayUserId, "abc123immutable");
    assert.ok(!res.text.includes(ACCESS) && !res.text.includes(REFRESH) && !res.text.includes(CALLER_KEY));

    const [token, identity] = calls;
    assert.equal(calls.length, 2);
    assert.equal(token.url, `${FAKE_ORIGIN}/ebay/api/identity/v1/oauth2/token`);
    assert.equal(token.method, "POST");
    assert.equal(token.authorization, FAKE_BASIC, "the fake's fixed PUBLIC client id and secret, not the process's sandbox app");
    assert.equal(token.form.get("grant_type"), "authorization_code");
    assert.equal(token.form.get("redirect_uri"), FAKE_EBAY_RU_NAME);
    assert.equal(identity.url, `${FAKE_ORIGIN}/ebay/apiz/commerce/identity/v1/user/`);
    assert.equal(identity.authorization, `Bearer ${ACCESS}`);
    for (const c of calls) assert.equal(c.callerKey, CALLER_KEY, "the fake's caller key on every call");
    for (const c of calls) assert.ok(!c.url.includes("ebay.com"), "no real eBay host");

    assert.equal(store.map.get(FAKE_KEY).refreshToken, REFRESH);
    assert.equal(store.map.has(BARE_KEY), false);

    const [line] = lines("ebay_oauth_call");
    assert.equal(line.target, "fake");
    assert.equal(line.success, true);
  });

  it("never says production outward: connect answers environment \"fake\", and the log label is \"fake\" (S1)", async () => {
    const connect = await post("/oauth/ebay/connect", { key: FAKE_KEY, code: CODE });
    assert.equal(connect.status, 200);
    assert.equal(connect.body.environment, "fake");

    const seed = await post("/oauth/ebay/connect", { key: FAKE_KEY, refreshToken: REFRESH });
    assert.equal(seed.status, 200);
    assert.equal(seed.body.environment, "fake");

    store.map.set(FAKE_KEY, { username: "u", ebayUserId: "abc123immutable", token: "old", expiresAt: 1, refreshToken: REFRESH });
    const refresh = await post("/oauth/ebay/refresh", { key: FAKE_KEY });
    assert.equal(refresh.status, 200);

    for (const res of [connect, seed, refresh]) {
      assert.ok(!/production/i.test(res.text), "no response says production");
    }
    const outLines = lines("ebay_oauth_call");
    assert.equal(outLines.length, 3);
    for (const l of outLines) {
      assert.equal(l.environment, "fake");
      assert.equal(l.target, "fake");
    }
    assert.ok(!logs.some((l) => /"environment":"production"/.test(l)), "no log line labels the fake production");
  });

  it("connect over https adds the Cloud Run ID token headers (X-Serverless-Authorization and x-nb-fake-id-token)", async () => {
    const origin = "https://neonbinder-fake-bsc-abc123-uc.a.run.app";
    env = { ENVIRONMENT: "dev", ...SANDBOX_ENV, NEONBINDER_FAKE_BSC_URL: origin, NEONBINDER_FAKE_BSC_KEY: CALLER_KEY };
    const audiences = [];
    mintIdToken = async (aud) => {
      audiences.push(aud);
      return "ID-TOKEN-SENTINEL";
    };

    const res = await post("/oauth/ebay/connect", { key: FAKE_KEY, code: CODE });

    assert.equal(res.status, 200);
    assert.ok(audiences.length >= 1 && audiences.every((a) => a === origin), "the ID token audience is the fake's origin");
    assert.equal(calls[0].url, `${origin}/ebay/api/identity/v1/oauth2/token`);
    for (const c of calls) {
      assert.equal(c.serverless, "Bearer ID-TOKEN-SENTINEL");
      assert.equal(c.fakeIdToken, "ID-TOKEN-SENTINEL");
      assert.equal(c.callerKey, CALLER_KEY);
    }
    assert.ok(!logs.join("\n").includes("ID-TOKEN-SENTINEL"));
  });

  it("connect accepts the refresh-token seed form on a fake key (it is never production)", async () => {
    const res = await post("/oauth/ebay/connect", { key: FAKE_KEY, refreshToken: REFRESH });
    assert.equal(res.status, 200);
    assert.equal(calls[0].form.get("grant_type"), "refresh_token");
    assert.equal(calls[0].url, `${FAKE_ORIGIN}/ebay/api/identity/v1/oauth2/token`);
  });

  it("refresh: the grant goes to the fake with the caller key", async () => {
    store.map.set(FAKE_KEY, { username: "neon_seller_1", ebayUserId: "abc123immutable", token: "old", expiresAt: 1, refreshToken: REFRESH });

    const res = await post("/oauth/ebay/refresh", { key: FAKE_KEY });

    assert.equal(res.status, 200);
    assert.equal(res.body.token, ACCESS);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${FAKE_ORIGIN}/ebay/api/identity/v1/oauth2/token`);
    assert.equal(calls[0].authorization, FAKE_BASIC);
    assert.equal(calls[0].callerKey, CALLER_KEY);
    assert.equal(store.map.get(FAKE_KEY).token, ACCESS);
    assert.equal(lines("ebay_oauth_call")[0].target, "fake");
  });

  it("the fake and the sandbox are served side by side by the same process", async () => {
    await post("/oauth/ebay/connect", { key: FAKE_KEY, code: CODE });
    await post("/oauth/ebay/connect", { key: BARE_KEY, code: CODE });

    assert.deepEqual(
      calls.map((c) => c.url),
      [
        `${FAKE_ORIGIN}/ebay/api/identity/v1/oauth2/token`,
        `${FAKE_ORIGIN}/ebay/apiz/commerce/identity/v1/user/`,
        "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
        "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/",
      ],
    );
    assert.equal(calls[2].callerKey, null, "the fake's caller key never reaches real eBay");
    assert.equal(calls[3].callerKey, null);
  });

  it("a fake key works with no eBay app configured at all (it does not need one)", async () => {
    env = { ENVIRONMENT: "dev", ...FAKE_ENV };
    const res = await post("/oauth/ebay/connect", { key: FAKE_KEY, code: CODE });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// 2. A fake key is refused, loudly, unless the process may talk to the fake
// ---------------------------------------------------------------------------

describe("a fake key is refused", () => {
  const warned = (reason, operation) =>
    lines("ebay_fake_key_refused").some((l) => l.reason === reason && l.operation === operation);

  for (const [operation, path, body] of [
    ["connect", "/oauth/ebay/connect", { key: FAKE_KEY, code: CODE }],
    ["refresh", "/oauth/ebay/refresh", { key: FAKE_KEY }],
  ]) {
    it(`${operation} in prod: 400 bad_request, reason fake_key_in_prod, nothing called, no fall-back to production eBay`, async () => {
      // A prod revision with the production app configured AND (a mistake) a
      // fake URL. Both must be inert for a fake key.
      env = { ENVIRONMENT: "prod", ...PRODUCTION_ENV, ...FAKE_ENV };
      store.map.set(FAKE_KEY, { username: "u", refreshToken: REFRESH });
      store.writes = 0;

      const res = await post(path, body);

      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error_class: "bad_request" });
      assertNothingCalled(res, "prod");
      assert.ok(warned("fake_key_in_prod", operation), "refused loudly, with the reason");
      const [line] = lines("ebay_oauth_call");
      assert.equal(line.error_class, "fake_key_in_prod");
      assert.equal(line.success, false);
    });

    it(`${operation} in prod with NO fake URL is refused for being prod, not for the missing URL`, async () => {
      env = { ENVIRONMENT: "prod", ...PRODUCTION_ENV };
      const res = await post(path, body);
      assert.equal(res.status, 400);
      assert.ok(warned("fake_key_in_prod", operation));
      assertNothingCalled(res, "prod, no url");
    });

    it(`${operation} with no fake URL: 503 ebay_not_configured, nothing called, no fall-back to the configured eBay`, async () => {
      env = { ENVIRONMENT: "dev", ...SANDBOX_ENV };
      const res = await post(path, body);
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error_class: "ebay_not_configured" });
      assertNothingCalled(res, "no fake url");
      assert.ok(warned("fake_key_no_fake_url", operation));
    });

    it(`${operation} with a fake URL that is not the fake's own host: 503, nothing called`, async () => {
      env = { ENVIRONMENT: "dev", ...SANDBOX_ENV, NEONBINDER_FAKE_BSC_URL: "https://evil.example.com", NEONBINDER_FAKE_BSC_KEY: CALLER_KEY };
      const res = await post(path, body);
      assert.equal(res.status, 503);
      assertNothingCalled(res, "bad fake url");
      assert.ok(warned("fake_key_bad_fake_url", operation));
      assert.ok(!logs.join("\n").includes("evil.example.com"), "the URL is never logged");
    });

    it(`${operation} with no fake caller key: 503, nothing called`, async () => {
      env = { ENVIRONMENT: "dev", ...SANDBOX_ENV, NEONBINDER_FAKE_BSC_URL: FAKE_ORIGIN };
      const res = await post(path, body);
      assert.equal(res.status, 503);
      assertNothingCalled(res, "no caller key");
      assert.ok(warned("fake_key_no_caller_key", operation));
    });
  }

  it("a key that only CONTAINS the fake marker, or is another site's, is refused as malformed (400)", async () => {
    for (const key of [
      "ebay-credentials-user_x-credentials-fake-y",
      "buysportscards-credentials-fake-happy-otter-123-user_x",
    ]) {
      const res = await post("/oauth/ebay/refresh", { key });
      assert.equal(res.status, 400, key);
      assertNothingCalled(res, key);
    }
    assert.ok(lines("ebay_fake_key_refused").some((l) => l.reason === "fake_key_malformed"));
  });
});

describe("a fake key's refusal paths leak and write nothing", () => {
  const HTTPS_ORIGIN = "https://neonbinder-fake-bsc-abc123-uc.a.run.app";

  for (const [operation, path, body] of [
    ["connect", "/oauth/ebay/connect", { key: FAKE_KEY, code: CODE }],
    ["refresh", "/oauth/ebay/refresh", { key: FAKE_KEY }],
  ]) {
    it(`${operation}: an ID-token mint failure naming the audience is a fixed error, no token call, nothing stored`, async () => {
      env = { ENVIRONMENT: "dev", ...SANDBOX_ENV, NEONBINDER_FAKE_BSC_URL: HTTPS_ORIGIN, NEONBINDER_FAKE_BSC_KEY: CALLER_KEY };
      mintIdToken = async (aud) => {
        throw new Error(`could not mint an ID token for audience ${aud} (AUDIENCE-LEAK-SENTINEL)`);
      };
      store.map.set(FAKE_KEY, { username: "u", ebayUserId: "abc123immutable", token: "old", expiresAt: 1, refreshToken: REFRESH });
      const before = { ...store.map.get(FAKE_KEY) };
      store.writes = 0;

      const res = await post(path, body);

      assert.ok(res.status >= 400, "the call fails");
      assert.deepEqual(Object.keys(res.body), ["error_class"], "a fixed {error_class} body");
      assert.ok(!res.text.includes("run.app") && !res.text.includes("AUDIENCE-LEAK-SENTINEL") && !/audience/i.test(res.text));
      assert.deepEqual(calls, [], "no token (or any) call was made");
      assert.equal(store.writes, 0, "nothing written");
      assert.deepEqual(store.map.get(FAKE_KEY), before, "the stored session is untouched");
      const text = logs.join("\n");
      assert.ok(!text.includes("run.app") && !text.includes("AUDIENCE-LEAK-SENTINEL"), "nothing leaks into the logs either");
    });
  }

  it("a 300-character ebay-credentials-fake-... key is refused by connect with nothing called", async () => {
    const longKey = `ebay-credentials-fake-${"a".repeat(300 - "ebay-credentials-fake-".length)}`;
    assert.equal(longKey.length, 300);
    const res = await post("/oauth/ebay/connect", { key: longKey, code: CODE });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error_class: "bad_request" });
    assertNothingCalled(res, "300-char key");
    assert.ok(!res.text.includes(longKey));
    assert.ok(!logs.join("\n").includes(longKey));
  });

  it("ENVIRONMENT=\" prod \" (padded) is still prod: /health says ebayFake false and a fake key is refused as fake_key_in_prod", async () => {
    const padded = { ENVIRONMENT: " prod ", ...PRODUCTION_ENV, ...FAKE_ENV };
    assert.equal(resolveFakeEbayTarget(padded).ok, false);

    env = padded;
    const res = await post("/oauth/ebay/connect", { key: FAKE_KEY, code: CODE });
    assert.equal(res.status, 400);
    assertNothingCalled(res, "padded prod");
    assert.ok(lines("ebay_fake_key_refused").some((l) => l.reason === "fake_key_in_prod"));
    assert.equal(lines("ebay_oauth_call")[0].error_class, "fake_key_in_prod");
  });
});

// ---------------------------------------------------------------------------
// 3. A bare key is unchanged
// ---------------------------------------------------------------------------

describe("a bare key keeps the process's configured eBay", () => {
  it("sandbox: sandbox hosts, the process's app credentials, no fake header, with a fake URL present", async () => {
    const res = await post("/oauth/ebay/connect", { key: BARE_KEY, code: CODE });

    assert.equal(res.status, 200);
    assert.equal(res.body.environment, "sandbox");
    assert.equal(calls[0].url, "https://api.sandbox.ebay.com/identity/v1/oauth2/token");
    assert.equal(
      calls[0].authorization,
      `Basic ${Buffer.from(`${SANDBOX_ENV.EBAY_CLIENT_ID}:${SBX_CLIENT_SECRET}`).toString("base64")}`,
    );
    assert.equal(calls[1].url, "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/");
    for (const c of calls) {
      assert.equal(c.callerKey, null);
      assert.equal(c.serverless, null);
      assert.equal(c.fakeIdToken, null);
    }
    assert.equal(lines("ebay_oauth_call")[0].target, undefined, "an ordinary call is not tagged fake");
  });

  it("production in prod: production hosts, and a bare seed refresh-token is still refused", async () => {
    env = { ENVIRONMENT: "prod", ...PRODUCTION_ENV };
    const ok = await post("/oauth/ebay/connect", { key: BARE_KEY, code: CODE });
    assert.equal(ok.status, 200);
    assert.equal(calls[0].url, "https://api.ebay.com/identity/v1/oauth2/token");
    assert.equal(calls[1].url, "https://apiz.ebay.com/commerce/identity/v1/user/");

    calls.length = 0;
    const seed = await post("/oauth/ebay/connect", { key: "ebay-credentials-user_other", refreshToken: REFRESH });
    assert.equal(seed.status, 400);
    assert.deepEqual(calls, []);
  });

  it("with no eBay app configured it is 503 ebay_not_configured, even though a fake URL is set (never falls back to the fake)", async () => {
    env = { ENVIRONMENT: "dev", ...FAKE_ENV };
    for (const [path, body] of [
      ["/oauth/ebay/connect", { key: BARE_KEY, code: CODE }],
      ["/oauth/ebay/refresh", { key: BARE_KEY }],
    ]) {
      const res = await post(path, body);
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error_class: "ebay_not_configured" });
    }
    assert.deepEqual(calls, []);
  });

  it("resolveEbayConfigForKey: a bare or non-string key resolves exactly as readEbayOAuthConfig does", () => {
    for (const key of [BARE_KEY, undefined, 42, null]) {
      const r = resolveEbayConfigForKey(key, { ENVIRONMENT: "dev", ...SANDBOX_ENV, ...FAKE_ENV });
      assert.equal(r.kind, "config");
      assert.equal(r.fake, false);
      assert.equal(r.config.environment, "sandbox");
      assert.equal(r.config.fake, undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The 72 h TTL and key acceptance in Secret Manager
// ---------------------------------------------------------------------------

describe("fake eBay secrets in Secret Manager", () => {
  const TTL_S = 72 * 60 * 60;
  const CREDS = { username: "neon_seller_1", token: "tok", expiresAt: 1 };
  const grpcError = (code, message) => Object.assign(new Error(message), { code });

  function makeClient({ secretExists = true, stored } = {}) {
    const recorded = [];
    let exists = secretExists;
    const notFound = (n) => grpcError(5, `5 NOT_FOUND: ${n}`);
    return {
      recorded,
      ops: () => recorded.map((c) => c.op),
      async accessSecretVersion(req) {
        recorded.push({ op: "access", req });
        if (!stored) throw notFound(req.name);
        return [{ name: req.name, payload: { data: Buffer.from(JSON.stringify(stored)) } }];
      },
      async updateSecret(req) {
        recorded.push({ op: "update", req });
        if (!exists) throw notFound(req.secret.name);
        return [{ name: req.secret.name }];
      },
      async addSecretVersion(req) {
        recorded.push({ op: "add", req });
        if (!exists) throw notFound(req.parent);
        return [{ name: `${req.parent}/versions/5` }];
      },
      async createSecret(req) {
        recorded.push({ op: "create", req });
        exists = true;
        return [{ name: `${req.parent}/secrets/${req.secretId}` }];
      },
      async destroySecretVersion(req) {
        recorded.push({ op: "destroy", req });
        return [{}];
      },
      async deleteSecret(req) {
        recorded.push({ op: "delete", req });
        return [{}];
      },
    };
  }
  const trip = () => {
    const recorded = [];
    const t = (op) => async () => {
      recorded.push(op);
      throw new Error(`Secret Manager must not be called (${op})`);
    };
    return {
      recorded,
      accessSecretVersion: t("access"),
      updateSecret: t("update"),
      addSecretVersion: t("add"),
      createSecret: t("create"),
      destroySecretVersion: t("destroy"),
      deleteSecret: t("delete"),
    };
  };

  let saved;
  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, { ENVIRONMENT: "dev", ...FAKE_ENV });
  });
  afterEach(() => {
    for (const k of ["ENVIRONMENT", "NEONBINDER_FAKE_BSC_URL", "NEONBINDER_FAKE_BSC_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("the TTL is 72 hours", () => {
    assert.equal(FAKE_CREDENTIAL_TTL_MS, TTL_S * 1000);
  });

  it("a new fake eBay secret is created with expireTime = now + 72 h (never ttl)", async () => {
    const now = 1_800_000_000_000;
    mock.timers.enable({ apis: ["Date"], now });
    activeClient = makeClient({ secretExists: false });

    await new SecretsManagerService().updateCredentials(FAKE_KEY, CREDS);

    const create = activeClient.recorded.find((c) => c.op === "create");
    assert.ok(create, "the secret is created");
    assert.deepEqual(create.req.secret.expireTime, { seconds: now / 1000 + TTL_S });
    assert.equal("ttl" in create.req.secret, false);
  });

  it("each write to an existing fake eBay secret extends the expiry to now + 72 h, before adding the version", async () => {
    const now = 1_800_000_000_000;
    mock.timers.enable({ apis: ["Date"], now });
    activeClient = makeClient();

    await new SecretsManagerService().updateCredentials(FAKE_KEY, CREDS);

    assert.deepEqual(activeClient.ops().slice(0, 2), ["update", "add"]);
    assert.deepEqual(activeClient.recorded[0].req, {
      secret: { name: `projects/neonbinder-test/secrets/${FAKE_KEY}`, expireTime: { seconds: now / 1000 + TTL_S } },
      updateMask: { paths: ["expire_time"] },
    });
  });

  it("a bare eBay key never gets an expiry or an updateSecret", async () => {
    for (const secretExists of [true, false]) {
      activeClient = makeClient({ secretExists });
      await new SecretsManagerService().updateCredentials(BARE_KEY, CREDS);
      assert.equal(activeClient.ops().includes("update"), false);
      const create = activeClient.recorded.find((c) => c.op === "create");
      if (create) assert.deepEqual(create.req.secret, { replication: { automatic: {} } });
    }
  });

  it("reads a fake eBay key on a fake-wired process", async () => {
    activeClient = makeClient({ stored: { username: "neon_seller_1" } });
    assert.equal((await new SecretsManagerService().getCredentials(FAKE_KEY)).username, "neon_seller_1");
  });

  it("refuses a fake eBay key in prod and on a real-BSC process, with no client call", async () => {
    const cases = [
      ["fake_key_in_prod", { ENVIRONMENT: "prod" }],
      ["fake_key_on_real_bsc_target", { ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: "" }],
    ];
    for (const [reason, patch] of cases) {
      Object.assign(process.env, patch);
      logs.length = 0;
      activeClient = trip();
      await assert.rejects(new SecretsManagerService().getCredentials(FAKE_KEY), /^Error: Invalid credential key format$/, reason);
      assert.deepEqual(activeClient.recorded, [], reason);
      assert.ok(logs.some((l) => l.includes(reason)), reason);
      assert.ok(!logs.some((l) => l.includes(FAKE_KEY)));
      Object.assign(process.env, FAKE_ENV, { ENVIRONMENT: "dev" });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. /health
// ---------------------------------------------------------------------------

describe("GET /health reports ebayFake and ebayTarget", () => {
  async function health(e) {
    const app = express();
    app.use(createHealthRouter(e));
    const srv = createServer(app);
    await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/health`);
      return await res.json();
    } finally {
      await new Promise((resolve) => srv.close(resolve));
    }
  }

  it("dev with a fake URL, the caller key and a sandbox app: both fields, and the existing ones unchanged", async () => {
    const body = await health({ ENVIRONMENT: "dev", ...SANDBOX_ENV, ...FAKE_ENV });
    assert.deepEqual(body, {
      status: "ok",
      environment: "dev",
      contractVersion: CONTRACT_VERSION,
      bscTarget: "fake",
      ebayFake: true,
      ebayTarget: "sandbox",
    });
  });

  it("prod: ebayFake false, ebayTarget production", async () => {
    const body = await health({ ENVIRONMENT: "prod", ...PRODUCTION_ENV });
    assert.equal(body.ebayFake, false);
    assert.equal(body.ebayTarget, "production");
    assert.equal(body.bscTarget, "real");
  });

  it("prod with a stray fake URL: ebayFake is still false", async () => {
    const body = await health({ ENVIRONMENT: "prod", ...PRODUCTION_ENV, ...FAKE_ENV });
    assert.equal(body.ebayFake, false);
  });

  it("a padded ENVIRONMENT=\" prod \" with a fake URL and key: ebayFake false", async () => {
    const body = await health({ ENVIRONMENT: " prod ", ...PRODUCTION_ENV, ...FAKE_ENV });
    assert.equal(body.ebayFake, false);
    assert.equal(body.ebayTarget, "production");
  });

  it("no eBay app: ebayTarget null (a fake-only process serves fake keys and nothing else)", async () => {
    const body = await health({ ENVIRONMENT: "dev", ...FAKE_ENV });
    assert.equal(body.ebayTarget, null);
    assert.equal(body.ebayFake, true);
  });

  it("no fake URL, a bad fake URL, or no caller key: ebayFake false", async () => {
    for (const e of [
      { ENVIRONMENT: "dev", ...SANDBOX_ENV },
      { ENVIRONMENT: "dev", ...SANDBOX_ENV, NEONBINDER_FAKE_BSC_URL: "https://evil.example.com", NEONBINDER_FAKE_BSC_KEY: CALLER_KEY },
      { ENVIRONMENT: "dev", ...SANDBOX_ENV, NEONBINDER_FAKE_BSC_URL: FAKE_ORIGIN },
    ]) {
      assert.equal((await health(e)).ebayFake, false);
    }
  });

  it("never carries a credential, a client id or a URL", async () => {
    const body = await health({ ENVIRONMENT: "dev", ...SANDBOX_ENV, ...FAKE_ENV });
    const text = JSON.stringify(body);
    for (const s of [SBX_CLIENT_SECRET, CALLER_KEY, SANDBOX_ENV.EBAY_CLIENT_ID, "127.0.0.1"]) {
      assert.ok(!text.includes(s), s);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. N3: the notification never goes to the fake
// ---------------------------------------------------------------------------

describe("the eBay notification verifier never resolves or fetches the fake (N3)", () => {
  const header = Buffer.from(JSON.stringify({ alg: "ECDSA", kid: "kid-1", signature: "c2lnbmF0dXJl", digest: "SHA1" })).toString("base64");

  it("refuses a fake-key config outright, with no call", async () => {
    const verifier = new EbayNotificationVerifier({ fetchImpl: stubFetch, now: () => NOW });
    const target = resolveFakeEbayTarget({ ENVIRONMENT: "dev", ...FAKE_ENV });
    assert.equal(target.ok, true);
    const { config } = resolveEbayConfigForKey(FAKE_KEY, { ENVIRONMENT: "dev", ...FAKE_ENV });
    assert.ok(config.fake, "this is a fake-key config");

    await assert.rejects(verifier.verify(config, header, "{}"), (err) => err instanceof EbayOAuthError && err.kind === "client");
    assert.deepEqual(calls, []);
  });

  it("POST /webhooks/ebay/verify in a fake-wired process talks to the sandbox only, whatever the body carries", async () => {
    // The app-token call is answered; the public-key GET 404s, so the verdict
    // is {valid:false}. Either way, the only hosts are eBay's.
    const res = await post("/webhooks/ebay/verify", {
      signatureHeader: header,
      body: "{}",
      key: FAKE_KEY,
      fake: true,
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { valid: false });
    assert.ok(calls.length >= 1, "it did reach eBay");
    for (const c of calls) {
      assert.match(c.url, /^https:\/\/api\.sandbox\.ebay\.com\//);
      assert.equal(c.callerKey, null);
      assert.ok(!c.url.includes("127.0.0.1"), "never the fake");
    }
    assert.equal(lines("ebay_oauth_call")[0].target, undefined);
  });

  it("with no eBay app configured it is 503 and calls nothing, even with a fake URL set", async () => {
    env = { ENVIRONMENT: "dev", ...FAKE_ENV };
    const res = await post("/webhooks/ebay/verify", { signatureHeader: header, body: "{}" });
    assert.equal(res.status, 503);
    assert.deepEqual(calls, []);
  });
});
