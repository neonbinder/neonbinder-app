/**
 * NEO-552 contract test: services/browser's REAL BSC sign-in code against the
 * fake BSC's REAL identity module (services/fake-bsc/src/identity/b2c.ts), in
 * process, over loopback HTTP. No stubbed fetch, no network beyond 127.0.0.1.
 *
 * What it proves:
 *   - bscPasswordSignIn() completes the four-step B2C exchange against the
 *     fake, both through NEONBINDER_FAKE_BSC_URL (fake mode, caller key sent)
 *     and with an explicit `authority` (the recorder's call shape);
 *   - wrong-password reads as BSC rejecting the credentials (422 path);
 *   - BSCAdapter.login() runs its whole ladder against the fake: password
 *     sign-in + write-back, the cached token, the refresh grant (rotation),
 *     and the silent SSO re-authorize past the 24h refresh window;
 *   - POST /probe/bsc answers outcome "ok" against the fake.
 *
 * The fake's identity is TypeScript in another service with its own
 * node_modules, so it is loaded the way that keeps this test independent of
 * that service's install and module type: both files are dependency-free (node
 * builtins only), so Node's own type stripper turns them into .mjs in a temp
 * dir and they are imported from there.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_IDENTITY_DIR = join(HERE, "..", "..", "fake-bsc", "src");

const USER = "nb+contract-test-w1@fake.invalid";
const NS = "contract-test-w1";
const CALLER_KEY = "contract-caller-key-0123456789abcdef";

let tmp;
async function loadFakeIdentity() {
  tmp = mkdtempSync(join(tmpdir(), "fake-bsc-identity-"));
  const strip = (file) => stripTypeScriptTypes(readFileSync(join(FAKE_IDENTITY_DIR, file), "utf8"));
  writeFileSync(join(tmp, "b2c.mjs"), strip("identity/b2c.ts"));
  writeFileSync(join(tmp, "namespace.mjs"), strip("namespace.ts"));
  const b2c = await import(pathToFileURL(join(tmp, "b2c.mjs")).href);
  const ns = await import(pathToFileURL(join(tmp, "namespace.mjs")).href);
  return { b2c, namespaceFromUsername: ns.namespaceFromUsername };
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * A loopback "fake BSC": the real identity module under /identity, and a tiny
 * API stand-in under /api that answers the profile and the probe's pinned
 * reads for a token the identity issued. Records which requests carried the
 * caller key.
 */
async function startFake(identity) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    seen.push({ path: url.pathname, key: req.headers["x-nb-fake-bsc-key"] ?? null, serverless: req.headers["x-serverless-authorization"] ?? null, idToken: req.headers["x-nb-fake-id-token"] ?? null });
    if (url.pathname.startsWith("/identity/")) {
      req.url = req.url.slice("/identity".length);
      identity.handle(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const ns = identity.namespaceForToken(req.headers.authorization ?? "");
      const send = (status, body) => {
        res.statusCode = status;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
      };
      const path = url.pathname.slice("/api/".length);
      await readJson(req);
      if (path.startsWith("marketplace/card/")) {
        return send(200, { teamName: "Halifax Mooseheads", playerAttribute: "" });
      }
      if (!ns) return send(401, { message: "Unauthorized" });
      switch (path) {
        case "marketplace/user/profile":
          return send(200, { sellerProfile: { sellerId: `seller-${ns}`, sellerStoreName: `Store ${ns}` } });
        case "search/bulk-upload/filters":
          return send(200, { aggregations: { setName: [{ label: "Halifax Mooseheads QMJHL", slug: "halifax-mooseheads-qmjhl", count: 26, active: false }] } });
        case "search/bulk-upload/results":
          return send(200, [{ id: "c1", cardNo: "1" }]);
        case "seller/bulk-upload/results":
          return send(200, [{ id: "c1", sellerSku: "" }]);
        case "seller/order/history":
          return send(200, { totalElements: 0, results: [] });
        default:
          return send(501, { message: "unrecorded" });
      }
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, seen };
}

function freshBrowserModules() {
  for (const m of [
    "../dist/bsc-endpoints",
    "../dist/bsc-fetch",
    "../dist/bsc-signin",
    "../dist/adapters/base-adapter",
    "../dist/adapters/bsc-adapter",
    "../dist/routes/bsc-probe",
  ]) {
    delete require.cache[require.resolve(m)];
  }
}

describe("browser sign-in against the fake BSC identity (contract)", () => {
  let fake;
  let identity;
  let clock;
  const savedEnv = {};
  const ENV_KEYS = ["NEONBINDER_FAKE_BSC_URL", "NEONBINDER_FAKE_BSC_KEY", "ENVIRONMENT"];

  before(async () => {
    const { b2c, namespaceFromUsername } = await loadFakeIdentity();
    clock = { offset: 0 };
    identity = b2c.createFakeIdentity({
      tokenSecret: "contract-secret-0123456789abcdef0123",
      namespaceFromUsername,
      now: () => Date.now() + clock.offset,
    });
    fake = await startFake(identity);
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  });

  after(() => {
    fake?.server.close();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.NEONBINDER_FAKE_BSC_URL = fake.origin;
    process.env.NEONBINDER_FAKE_BSC_KEY = CALLER_KEY;
    process.env.ENVIRONMENT = "dev";
    fake.seen.length = 0;
    freshBrowserModules();
  });

  it("bscPasswordSignIn signs in through NEONBINDER_FAKE_BSC_URL and sends the caller key", async () => {
    const { bscPasswordSignIn } = require("../dist/bsc-signin");
    const steps = [];
    const result = await bscPasswordSignIn({ username: USER, password: "fake-bsc-password", onStep: (s) => steps.push(s) });
    assert.ok("tokens" in result, JSON.stringify(result));
    assert.equal(identity.namespaceForToken(result.tokens.token), NS);
    assert.ok(result.tokens.refreshToken);
    assert.ok(result.tokens.ssoCookies && Object.keys(result.tokens.ssoCookies).some((k) => k.startsWith("x-ms-cpim-sso")));
    // expires_in 3600 and refresh_token_expires_in 86400 became absolute expiries.
    const atLeft = result.tokens.expiresAt - Date.now();
    assert.ok(atLeft > 3590_000 && atLeft <= 3600_000);
    const rtLeft = result.tokens.refreshExpiresAt - Date.now();
    assert.ok(rtLeft > 86390_000 && rtLeft <= 86400_000);

    assert.deepEqual(steps.map((s) => [s.step, s.status, s.parsed]), [
      ["authorize", 200, true],
      ["self_asserted", 200, true],
      ["confirmed", 302, true],
      ["token", 200, true],
    ]);
    // Every request to the fake carried the caller key; plain http on
    // loopback means no ID token is minted or sent.
    assert.ok(fake.seen.length >= 4);
    for (const r of fake.seen) {
      assert.equal(r.key, CALLER_KEY, r.path);
      assert.equal(r.serverless, null, r.path);
      assert.equal(r.idToken, null, r.path);
    }
  });

  it("bscPasswordSignIn with an explicit authority (the recorder's shape) needs no fake env and sends no key", async () => {
    delete process.env.NEONBINDER_FAKE_BSC_URL;
    delete process.env.NEONBINDER_FAKE_BSC_KEY;
    freshBrowserModules();
    const { bscPasswordSignIn } = require("../dist/bsc-signin");
    const authority = `${fake.origin}/identity/tenant.example/b2c_1a_signin`;
    const result = await bscPasswordSignIn({ username: USER, password: "fake-bsc-password", authority });
    assert.ok("tokens" in result);
    assert.equal(identity.namespaceForToken(result.tokens.token), NS);
    for (const r of fake.seen) assert.equal(r.key, null);
  });

  it("wrong-password is BSC rejecting the credentials, with a sanitized diagnostic", async () => {
    const { bscPasswordSignIn } = require("../dist/bsc-signin");
    const result = await bscPasswordSignIn({ username: USER, password: "wrong-password" });
    assert.equal(result.error, "Authentication failed");
    assert.equal(result.credentialRejected, true);
    assert.ok(!JSON.stringify(result).includes("wrong-password"));
  });

  it("BSCAdapter.login runs password, cache, refresh and silent SSO against the fake", async () => {
    let stored;
    const writes = [];
    const smPath = require.resolve("../dist/services/secrets-manager");
    const sm = require(smPath);
    const Original = sm.SecretsManagerService;
    sm.SecretsManagerService = class {
      async getCredentials() {
        if (!stored) throw new Error("not found");
        return stored;
      }
      async updateCredentials(_key, creds) {
        stored = creds;
        writes.push(creds);
      }
    };
    try {
      freshBrowserModules();
      const { BSCAdapter } = require("../dist/adapters/bsc-adapter");
      const key = "bsc-credentials-user_contract";

      // 1. Transient credentials: password sign-in, write-back, profile read.
      const first = await new BSCAdapter(undefined).login(key, {
        transientCredentials: { username: USER, password: "fake-bsc-password" },
      });
      assert.equal(first.success, true, JSON.stringify(first));
      assert.equal(first.sellerId, `seller-${NS}`);
      assert.equal(writes.length, 1);
      assert.equal(stored.password, undefined, "the password is never persisted");
      assert.ok(stored.refreshToken && stored.ssoCookies);

      // 2. Cached token, validated by the fake's profile endpoint.
      const cached = await new BSCAdapter(undefined).login(key);
      assert.equal(cached.success, true);
      assert.match(cached.message, /cached token/);
      assert.equal(writes.length, 1);

      // 3. Access token expired: the refresh grant rotates the refresh token.
      const firstRefresh = stored.refreshToken;
      stored = { ...stored, expiresAt: Date.now() - 1000 };
      const refreshed = await new BSCAdapter(undefined).login(key);
      assert.equal(refreshed.success, true, JSON.stringify(refreshed));
      assert.match(refreshed.message, /Refreshed/);
      assert.notEqual(stored.refreshToken, firstRefresh);
      assert.ok(stored.ssoCookies, "SSO cookies carried forward through the refresh write");
      assert.equal(identity.namespaceForToken(stored.token), NS);

      // 4. Past the absolute 24h window: refresh refused, silent SSO succeeds.
      clock.offset = 25 * 3600 * 1000;
      stored = { ...stored, expiresAt: Date.now() - 1000, refreshExpiresAt: undefined };
      const silent = await new BSCAdapter(undefined).login(key);
      assert.equal(silent.success, true, JSON.stringify(silent));
      assert.match(silent.message, /Silently re-authenticated/);
    } finally {
      clock.offset = 0;
      sm.SecretsManagerService = Original;
    }
  });

  it("POST /probe/bsc answers outcome ok against the fake, with shapes and no values", async () => {
    const express = require("express");
    const { createBscProbeRouter } = require("../dist/routes/bsc-probe");
    const app = express();
    app.use(express.json());
    app.use(createBscProbeRouter());
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/probe/bsc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: USER, password: "fake-bsc-password" }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.bscTarget, "fake");
      assert.equal(body.outcome, "ok", JSON.stringify(body.steps));
      assert.equal(body.signIn.ok, true);
      assert.deepEqual(body.catalogue, { ok: true, status: 200 });
      assert.equal(body.parser.ok, true);
      assert.equal(body.shapes["marketplace/user/profile"]["sellerProfile.sellerId"], "string");
      const text = JSON.stringify(body);
      assert.ok(!text.includes(`seller-${NS}`), "no seller id value");
      assert.ok(!text.includes("Halifax Mooseheads QMJHL"), "no catalogue label value");
    } finally {
      server.close();
    }
  });
});
