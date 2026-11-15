/**
 * NEO-552: per-deployment fake-BSC sessions in the browser service.
 *
 * Convex sends `buysportscards-credentials-fake-<convexSlug>-<clerkUserId>`
 * when its deployment uses the fake BSC; real keys stay
 * `<site>-credentials-<userId>`. What is pinned here:
 *
 *  1. Lifecycle. A fake key's secret is created with an expiry of now + 72 h,
 *     and every later write pushes it back to now + 72 h, BEFORE the version
 *     is added, so a secret in use never expires mid-run and an abandoned one
 *     does not live forever. The expiry is set as `expireTime` with update
 *     mask `expire_time` (never `ttl`; see extendFakeExpiry). Real keys never
 *     carry an expiry and never trigger an updateSecret.
 *  2. Key refusal. A fake key on a process talking to REAL BSC, or the fake
 *     form on any site but buysportscards, is "Invalid credential key format"
 *     (400 at the routes) before any Secret Manager call.
 *  3. Account guard. On the fake, a BSC sign-in or stored-session renewal for
 *     a username that is not `nb+<ns>@fake.invalid` is refused before any
 *     network call, in the adapter, in bscPasswordSignIn and in the probe.
 *     The recorder's forced-real call (fetchOptions.env = {}) is unaffected,
 *     and real mode is unchanged.
 *
 * The Secret Manager SDK is replaced in the require cache before any dist
 * module loads (as in secrets-manager.test.mjs), so no real client exists.
 */

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Fake @google-cloud/secret-manager, installed before the dist modules load
// ---------------------------------------------------------------------------

let activeClient = null;

class FakeSecretManagerServiceClient {
  constructor() {
    // Delegates per construction: each SecretsManagerService gets the spy
    // that is active for the current test.
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
const {
  SecretsManagerService,
  FAKE_CREDENTIAL_TTL_MS,
  isFakeCredentialKey,
} = require("../dist/services/secrets-manager");
const { createCredentialsRouter } = require("../dist/routes/credentials");
const { BSCAdapter } = require("../dist/adapters/bsc-adapter");
const { bscPasswordSignIn } = require("../dist/bsc-signin");
const { createBscProbeRouter } = require("../dist/routes/bsc-probe");
const { resetBscBreaker } = require("../dist/bsc-fetch");
const {
  FAKE_ONLY_ACCOUNT_ERROR,
  isFakeBscUsername,
  refuseNonFakeAccount,
} = require("../dist/bsc-endpoints");

const FAKE_KEY = "buysportscards-credentials-fake-happy-otter-123-user_2AbCdEf";
const REAL_KEY = "buysportscards-credentials-user_2AbCdEf";
const SECRET = (key) => `projects/neonbinder-test/secrets/${key}`;
const PROBE_USER = "nb+probe-ci@fake.invalid";
const FAKE_USER = "nb+happy-otter-123-0a1b2c3d4e5f@fake.invalid";
const REAL_USER = "seller@example.com";
const REAL_PASSWORD = "real-password-value-xyz";
const TTL_S = 72 * 60 * 60;

/** process.env keys these tests flip; restored after each test. */
const ENV_KEYS = ["NEONBINDER_FAKE_BSC_URL", "NEONBINDER_FAKE_BSC_KEY", "ENVIRONMENT"];
let savedEnv = {};

function fakeMode() {
  process.env.NEONBINDER_FAKE_BSC_URL = "http://127.0.0.1:9";
  process.env.NEONBINDER_FAKE_BSC_KEY = "caller-key";
  process.env.ENVIRONMENT = "dev";
}
function realMode() {
  delete process.env.NEONBINDER_FAKE_BSC_URL;
  delete process.env.NEONBINDER_FAKE_BSC_KEY;
}

function grpcError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * A spy client. Every call is recorded in `calls` in order as
 * `{op, req}`. Behaviours:
 *   secretExists  false: add/update answer NOT_FOUND until createSecret ran
 *   updateFails   a gRPC code updateSecret throws (other than NOT_FOUND)
 *   stored        the payload accessSecretVersion returns
 */
function makeClient({ secretExists = true, updateFails, stored, version = 5 } = {}) {
  const calls = [];
  let exists = secretExists;
  let nextVersion = version;
  const notFound = (key) => grpcError(5, `5 NOT_FOUND: Secret [${key}] not found.`);
  return {
    calls,
    ops: () => calls.map((c) => c.op),
    async listSecretVersions(req) {
      calls.push({ op: "list", req });
      throw new Error("never list");
    },
    async accessSecretVersion(req) {
      calls.push({ op: "access", req });
      if (!stored) throw notFound(req.name);
      return [{ name: `${req.name}`, payload: { data: Buffer.from(JSON.stringify(stored)) } }];
    },
    async updateSecret(req) {
      calls.push({ op: "update", req });
      if (!exists) throw notFound(req.secret.name);
      if (updateFails) throw grpcError(updateFails, `${updateFails} PERMISSION_DENIED on ${req.secret.name}`);
      return [{ name: req.secret.name }];
    },
    async addSecretVersion(req) {
      calls.push({ op: "add", req });
      if (!exists) throw notFound(req.parent);
      return [{ name: `${req.parent}/versions/${nextVersion++}` }];
    },
    async createSecret(req) {
      calls.push({ op: "create", req });
      exists = true;
      return [{ name: `${req.parent}/secrets/${req.secretId}` }];
    },
    async destroySecretVersion(req) {
      calls.push({ op: "destroy", req });
      return [{}];
    },
    async deleteSecret(req) {
      calls.push({ op: "delete", req });
      return [{}];
    },
  };
}

/** A client whose every method records and throws: proves "no client call". */
function tripwireClient() {
  const calls = [];
  const trip = (op) => async () => {
    calls.push(op);
    throw new Error(`Secret Manager must not be called (${op})`);
  };
  return {
    calls,
    listSecretVersions: trip("list"),
    accessSecretVersion: trip("access"),
    updateSecret: trip("update"),
    addSecretVersion: trip("add"),
    createSecret: trip("create"),
    destroySecretVersion: trip("destroy"),
    deleteSecret: trip("delete"),
  };
}

/** Install a global fetch stub; returns the recorded URLs. */
let realFetch;
function stubFetch() {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    throw new TypeError("fetch failed (stub)");
  };
  return urls;
}

let logged = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  realFetch = globalThis.fetch;
  logged = [];
  for (const level of ["log", "warn", "error"]) {
    console[level] = (...args) => logged.push(args.map(String).join(" "));
  }
  resetBscBreaker();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  mock.timers.reset();
  activeClient = null;
});

const CREDS = { username: FAKE_USER, token: "tok-value", expiresAt: 1 };

// ---------------------------------------------------------------------------
// 1. Lifecycle: expiry only on fake keys, reset on every write
// ---------------------------------------------------------------------------

describe("fake-key secret lifecycle (NEO-552)", () => {
  it("TTL is 72 hours", () => {
    assert.equal(FAKE_CREDENTIAL_TTL_MS, TTL_S * 1000);
    assert.equal(isFakeCredentialKey(FAKE_KEY), true);
    assert.equal(isFakeCredentialKey(REAL_KEY), false);
  });

  it("creates a fake key's secret with expireTime = now + 72 h (never ttl)", async () => {
    fakeMode();
    const now = 1_800_000_000_000;
    mock.timers.enable({ apis: ["Date"], now });
    activeClient = makeClient({ secretExists: false, version: 1 });

    await new SecretsManagerService().updateCredentials(FAKE_KEY, CREDS);

    const create = activeClient.calls.find((c) => c.op === "create");
    assert.ok(create, "the secret is created");
    assert.deepEqual(create.req.secret.expireTime, { seconds: now / 1000 + TTL_S });
    assert.equal("ttl" in create.req.secret, false);
    // The extend found no secret (NOT_FOUND, silent), then add → create → add.
    assert.deepEqual(activeClient.ops(), ["update", "add", "create", "add"]);
    assert.equal(logged.some((l) => /expiry/.test(l)), false, "NOT_FOUND on the extend is silent");
  });

  it("extends an existing fake secret to now + 72 h BEFORE adding the version", async () => {
    fakeMode();
    const now = 1_800_000_000_000;
    mock.timers.enable({ apis: ["Date"], now });
    activeClient = makeClient();

    await new SecretsManagerService().updateCredentials(FAKE_KEY, CREDS);

    assert.deepEqual(activeClient.ops(), ["update", "add", "destroy"]);
    const update = activeClient.calls[0].req;
    assert.deepEqual(update, {
      secret: { name: SECRET(FAKE_KEY), expireTime: { seconds: now / 1000 + TTL_S } },
      updateMask: { paths: ["expire_time"] },
    });
  });

  it("each write resets the expiry from that write's time", async () => {
    fakeMode();
    const t0 = 1_800_000_000_000;
    mock.timers.enable({ apis: ["Date"], now: t0 });
    activeClient = makeClient();
    const svc = new SecretsManagerService();

    await svc.updateCredentials(FAKE_KEY, CREDS);
    mock.timers.tick(10 * 60 * 60 * 1000); // an hourly refresh, ten hours on
    await svc.updateCredentials(FAKE_KEY, CREDS);

    const expiries = activeClient.calls
      .filter((c) => c.op === "update")
      .map((c) => c.req.secret.expireTime.seconds);
    assert.deepEqual(expiries, [t0 / 1000 + TTL_S, t0 / 1000 + 10 * 3600 + TTL_S]);
  });

  it("a failed extend never fails the write, and logs site, fake and code only (no id)", async () => {
    fakeMode();
    activeClient = makeClient({ updateFails: 7 });

    await new SecretsManagerService().updateCredentials(FAKE_KEY, CREDS);

    assert.deepEqual(activeClient.ops(), ["update", "add", "destroy"]);
    const line = logged.find((l) => l.includes("fake_secret_expiry_extend_failed"));
    assert.ok(line, "the failure is logged");
    assert.deepEqual(JSON.parse(line), {
      msg: "fake_secret_expiry_extend_failed",
      site: "buysportscards",
      fake: true,
      code: 7,
    });
    // Neither the slug nor the Clerk id (both in the key) reaches this log.
    for (const part of ["happy-otter-123", "user_2AbCdEf", "projects/"]) {
      assert.equal(line.includes(part), false, part);
    }
    assert.equal(logged.some((l) => l.includes("projects/")), false, "no resource name in any log");
  });

  it("a real key never gets an expiry or an updateSecret, in either mode", async () => {
    for (const mode of [realMode, fakeMode]) {
      mode();
      for (const secretExists of [true, false]) {
        activeClient = makeClient({ secretExists });
        await new SecretsManagerService().updateCredentials(REAL_KEY, { username: REAL_USER });
        assert.equal(activeClient.ops().includes("update"), false);
        const create = activeClient.calls.find((c) => c.op === "create");
        if (create) {
          assert.deepEqual(create.req.secret, { replication: { automatic: {} } });
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Key refusal before any Secret Manager call
// ---------------------------------------------------------------------------

describe("fake-key refusal (NEO-552)", () => {
  const ops = [
    ["getCredentials", (svc, key) => svc.getCredentials(key)],
    ["updateCredentials", (svc, key) => svc.updateCredentials(key, CREDS)],
    ["deleteCredentials", (svc, key) => svc.deleteCredentials(key)],
    ["credentialsExist", (svc, key) => svc.credentialsExist(key)],
  ];

  it("refuses a fake key on a real-BSC process, with no client call", async () => {
    realMode();
    for (const [name, run] of ops) {
      activeClient = tripwireClient();
      await assert.rejects(run(new SecretsManagerService(), FAKE_KEY), /^Error: Invalid credential key format$/, name);
      assert.deepEqual(activeClient.calls, [], `${name}: no Secret Manager call`);
    }
    // The log line names the reason, never the key.
    assert.ok(logged.some((l) => l.includes("fake_key_on_real_bsc_target")));
    assert.equal(logged.some((l) => l.includes(FAKE_KEY)), false);
  });

  it("refuses the fake form on any site but buysportscards, even on the fake", async () => {
    fakeMode();
    for (const key of [
      "sportlots-credentials-fake-happy-otter-123-user_x",
      "ebay-credentials-fake-happy-otter-123-user_x",
      "bsc-credentials-fake-happy-otter-123-user_x",
      "buysportscards-credentials-user_x-credentials-fake-y",
    ]) {
      activeClient = tripwireClient();
      await assert.rejects(new SecretsManagerService().getCredentials(key), /Invalid credential key format/, key);
      assert.deepEqual(activeClient.calls, [], key);
    }
    assert.ok(logged.some((l) => l.includes("fake_key_not_bsc")));
  });

  it("accepts a fake key on the fake, and real keys in both modes", async () => {
    fakeMode();
    activeClient = makeClient({ stored: { username: FAKE_USER } });
    assert.equal((await new SecretsManagerService().getCredentials(FAKE_KEY)).username, FAKE_USER);
    for (const mode of [realMode, fakeMode]) {
      mode();
      activeClient = makeClient({ stored: { username: REAL_USER } });
      assert.equal((await new SecretsManagerService().getCredentials(REAL_KEY)).username, REAL_USER);
    }
  });

  it("the credential routes answer 400 with a fixed body, no client call", async () => {
    realMode();
    activeClient = tripwireClient();
    const keyedRoutesClient = activeClient;
    const app = express();
    app.use(express.json());
    app.use(createCredentialsRouter());
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      for (const [method, path] of [
        ["GET", `/credentials/${FAKE_KEY}/metadata`],
        ["GET", `/credentials/${FAKE_KEY}/token`],
        ["DELETE", `/credentials/${FAKE_KEY}`],
      ]) {
        const res = await realFetch(`${base}${path}`, { method });
        assert.equal(res.status, 400, `${method} ${path}`);
        assert.deepEqual(await res.json(), { error: "Invalid credential key format" });
      }
      // POST /credentials/check: a refused fake key is a 400 even beside a
      // real key, with no Secret Manager call for the fake one.
      for (const keys of [[FAKE_KEY], [REAL_KEY, FAKE_KEY], [FAKE_KEY, REAL_KEY]]) {
        activeClient = tripwireClient();
        const res = await realFetch(`${base}/credentials/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keys }),
        });
        assert.equal(res.status, 400, keys.join(","));
        assert.deepEqual(await res.json(), { error: "Invalid credential key format" });
        assert.equal(activeClient.calls.length, keys.includes(REAL_KEY) ? 1 : 0, "only the real key reached the client");
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
    assert.deepEqual(keyedRoutesClient.calls, [], "the keyed routes made no client call");
  });
});

// ---------------------------------------------------------------------------
// 3. Account guard: real credentials never reach the fake
// ---------------------------------------------------------------------------

describe("fake-mode account guard (NEO-552)", () => {
  it("the username rule: nb+<lowercase ns>@fake.invalid only", () => {
    for (const ok of [PROBE_USER, FAKE_USER, "nb+a@fake.invalid", `nb+${"a".repeat(100)}@fake.invalid`]) {
      assert.equal(isFakeBscUsername(ok), true, ok);
    }
    for (const bad of [
      REAL_USER,
      "nb+@fake.invalid",
      `nb+${"a".repeat(101)}@fake.invalid`,
      "nb+Probe-CI@fake.invalid",
      "nb+probe_ci@fake.invalid",
      "nb+probe-ci@fake.invalid.evil.com",
      " nb+probe-ci@fake.invalid",
      "nb+probe-ci@fake.invalid\n",
      "xnb+probe-ci@fake.invalid",
      "nb+probe-ci@fakeXinvalid",
      undefined,
      null,
      42,
    ]) {
      assert.equal(isFakeBscUsername(bad), false, String(bad));
    }
  });

  it("refuseNonFakeAccount is false whatever the username against real BSC", () => {
    assert.equal(refuseNonFakeAccount(REAL_USER, {}), false);
    assert.equal(refuseNonFakeAccount(REAL_USER, { NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:9" }), true);
    assert.equal(refuseNonFakeAccount(PROBE_USER, { NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:9" }), false);
  });

  it("adapter: a real transient sign-in on the fake is refused with no fetch and no secret call", async () => {
    fakeMode();
    activeClient = tripwireClient();
    const urls = stubFetch();
    const adapter = new BSCAdapter(undefined);
    try {
      const r = await adapter.login(FAKE_KEY, {
        transientCredentials: { username: REAL_USER, password: REAL_PASSWORD },
      });
      assert.deepEqual(r, { success: false, error: FAKE_ONLY_ACCOUNT_ERROR, credentialRejected: true });
    } finally {
      await adapter.cleanup();
    }
    assert.deepEqual(urls, [], "no network call");
    assert.deepEqual(activeClient.calls, [], "no Secret Manager call");
    assert.equal(logged.some((l) => l.includes(REAL_USER) || l.includes(REAL_PASSWORD)), false);
  });

  it("adapter: a stored real session on the fake is never renewed (no fetch, no write)", async () => {
    fakeMode();
    const later = Date.now() + 3_600_000;
    activeClient = makeClient({
      stored: {
        username: REAL_USER,
        password: REAL_PASSWORD,
        token: "real-token-value",
        expiresAt: later,
        refreshToken: "real-refresh-value",
        refreshExpiresAt: later,
        ssoCookies: { "x-ms-cpim-sso:x": "sso-value" },
        ssoExpiresAt: later,
      },
    });
    const urls = stubFetch();
    const adapter = new BSCAdapter(undefined);
    try {
      for (const opts of [{}, { tokenRefused: true }, { canary: true }]) {
        const r = await adapter.login(REAL_KEY, opts);
        assert.equal(r.success, false);
        assert.equal(r.credentialRejected, true);
        assert.equal(r.error, FAKE_ONLY_ACCOUNT_ERROR);
      }
    } finally {
      await adapter.cleanup();
    }
    assert.deepEqual(urls, [], "no network call");
    assert.deepEqual([...new Set(activeClient.ops())], ["access"], "read only, never written");
  });

  it("adapter: the probe and namespace accounts pass the guard on the fake", async () => {
    fakeMode();
    for (const username of [PROBE_USER, FAKE_USER]) {
      activeClient = tripwireClient();
      const urls = stubFetch();
      const adapter = new BSCAdapter(undefined);
      try {
        const r = await adapter.login(FAKE_KEY, {
          transientCredentials: { username, password: "fake-bsc-password" },
        });
        assert.equal(r.success, false, "the stub fetch fails the sign-in");
        assert.notEqual(r.error, FAKE_ONLY_ACCOUNT_ERROR);
      } finally {
        await adapter.cleanup();
      }
      assert.ok(urls.length > 0, `${username}: the sign-in reached the network`);
      assert.ok(urls.every((u) => u.startsWith("http://127.0.0.1:9/")), "and went to the fake");
    }
  });

  it("adapter: real mode is unchanged, a real account signs in against real BSC", async () => {
    realMode();
    activeClient = tripwireClient();
    const urls = stubFetch();
    const adapter = new BSCAdapter(undefined);
    try {
      const r = await adapter.login(REAL_KEY, {
        transientCredentials: { username: REAL_USER, password: REAL_PASSWORD },
      });
      assert.notEqual(r.error, FAKE_ONLY_ACCOUNT_ERROR);
    } finally {
      await adapter.cleanup();
    }
    assert.ok(urls.length > 0, "the sign-in reached the network");
    assert.ok(urls.every((u) => !u.startsWith("http://127.0.0.1:9")), "real BSC, not the fake");
  });

  it("bscPasswordSignIn: refused on the fake for a real account, before any fetch", async () => {
    fakeMode();
    const urls = stubFetch();
    const r = await bscPasswordSignIn({ username: REAL_USER, password: REAL_PASSWORD });
    assert.deepEqual(r, { error: FAKE_ONLY_ACCOUNT_ERROR, credentialRejected: true });
    assert.deepEqual(urls, []);
  });

  it("bscPasswordSignIn: the recorder's forced-real call (env {}) is never refused", async () => {
    fakeMode(); // the process env says fake; the call's own env says real
    const urls = stubFetch();
    const r = await bscPasswordSignIn({
      username: REAL_USER,
      password: REAL_PASSWORD,
      fetchOptions: { env: {} },
    });
    assert.notEqual(r.error, FAKE_ONLY_ACCOUNT_ERROR);
    assert.ok(urls.length > 0, "reached the network");
    assert.ok(urls.every((u) => !u.startsWith("http://127.0.0.1:9")), "against real BSC");
  });

  it("bscPasswordSignIn: the probe account passes on the fake", async () => {
    fakeMode();
    const urls = stubFetch();
    const r = await bscPasswordSignIn({ username: PROBE_USER, password: "fake-bsc-password" });
    assert.notEqual(r.error, FAKE_ONLY_ACCOUNT_ERROR);
    assert.ok(urls.length > 0 && urls[0].startsWith("http://127.0.0.1:9/"));
  });

  it("probe route: a real account on the fake is a 400 and never signs in", async () => {
    const env = { ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:9", NEONBINDER_FAKE_BSC_KEY: "k" };
    const signIns = [];
    const router = createBscProbeRouter({
      env,
      log: () => {},
      signIn: async (input) => {
        signIns.push(input.username);
        return { error: "stub" };
      },
    });
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = await realFetch(`http://127.0.0.1:${server.address().port}/probe/bsc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: REAL_USER, password: REAL_PASSWORD }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.deepEqual(body, { error: "The fake BSC accepts only fake accounts", bscTarget: "fake" });
    } finally {
      await new Promise((r) => server.close(r));
    }
    assert.deepEqual(signIns, []);
  });
});
