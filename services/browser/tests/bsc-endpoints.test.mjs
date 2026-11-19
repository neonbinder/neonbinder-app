/**
 * NEO-552: the BSC seam (src/bsc-endpoints.ts), the 429 breaker and fake-mode
 * headers (src/bsc-fetch.ts), the value-free shape signature (src/bsc-shape.ts),
 * /health's bscTarget (src/routes/health.ts), and the rule that no BSC host
 * literal lives anywhere in src/ except bsc-endpoints.ts.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

const endpoints = require("../dist/bsc-endpoints");
const bscFetchMod = require("../dist/bsc-fetch");
const shape = require("../dist/bsc-shape");

const FAKE = "https://neonbinder-fake-bsc-abc123-uc.a.run.app";
const bscFetch = (...a) => bscFetchMod.bscFetch(...a);

describe("resolveBscEndpoints", () => {
  it("resolves the real hosts when the fake URL is unset or blank", () => {
    for (const env of [{}, { NEONBINDER_FAKE_BSC_URL: "" }, { NEONBINDER_FAKE_BSC_URL: "   " }]) {
      const e = endpoints.resolveBscEndpoints(env);
      assert.equal(e.target, "real");
      assert.match(e.authority, /^https:\/\/identity\.buysportscards\.com\/identity\.buysportscards\.com\/b2c_1a_signin$/);
      assert.equal(e.apiBase, "https://api-prod.buysportscards.com");
      assert.equal(e.fakeOrigin, undefined);
      assert.equal(endpoints.bscTarget(env), "real");
    }
  });

  it("mirrors the real path shape under <FAKE>/identity and <FAKE>/api", () => {
    const e = endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: `${FAKE}/` , ENVIRONMENT: "dev" });
    assert.equal(e.target, "fake");
    assert.equal(e.fakeOrigin, FAKE);
    assert.equal(e.authority, `${FAKE}/identity/identity.buysportscards.com/b2c_1a_signin`);
    assert.equal(e.apiBase, `${FAKE}/api`);
    assert.equal(e.homeUrl, FAKE);
    assert.equal(endpoints.bscTarget({ NEONBINDER_FAKE_BSC_URL: FAKE }), "fake");
  });

  it("allows plain http only on loopback", () => {
    assert.equal(endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:8099" }).target, "fake");
    assert.equal(endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: "http://localhost:8099" }).target, "fake");
    assert.throws(() => endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: "http://fake.example.com" }), /https/);
    assert.throws(() => endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: "not a url" }), /valid URL/);
  });

  it("pins the fake to the neonbinder-fake-bsc Cloud Run host (or loopback)", () => {
    for (const ok of [
      "https://neonbinder-fake-bsc-abc123-uc.a.run.app",
      "https://neonbinder-fake-bsc-123456789012.us-central1.run.app",
      "https://localhost:8443",
      "http://[::1]:8099",
    ]) {
      assert.equal(endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: ok }).target, "fake", ok);
    }
    for (const bad of [
      "https://fake.example.com",
      "https://some-other-service-abc123-uc.a.run.app",
      "https://neonbinder-browser-abc123-uc.a.run.app",
      "https://neonbinder-fake-bsc-abc123-uc.a.run.app.evil.example",
      "https://neonbinder-fake-bsc.evil.example/x.run.app",
      "https://evil.example/neonbinder-fake-bsc-x.run.app",
      "https://neonbinder-fake-bsc-abc123-uc.a.run.app:8443",
      "https://user:pw@neonbinder-fake-bsc-abc123-uc.a.run.app",
      "http://neonbinder-fake-bsc-abc123-uc.a.run.app",
      "https://xneonbinder-fake-bsc-abc123-uc.a.run.app",
      "https://pr-12---neonbinder-fake-bsc-abc123-uc.a.run.app",
    ]) {
      assert.throws(() => endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: bad }), /neonbinder-fake-bsc|valid URL/, bad);
      assert.throws(() => endpoints.assertBscTargetAllowed({ NEONBINDER_FAKE_BSC_URL: bad, ENVIRONMENT: "dev" }), undefined, bad);
    }
  });

  it("isFakeUrl is true only for the configured, pinned fake origin", () => {
    const e = endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: FAKE });
    assert.equal(endpoints.isFakeUrl(`${FAKE}/api/x`, e), true);
    assert.equal(endpoints.isFakeUrl("https://neonbinder-fake-bsc-other-uc.a.run.app/api/x", e), false);
    assert.equal(endpoints.isFakeUrl("https://evil.example/api/x", e), false);
    // A hand-built endpoints object pointing elsewhere is not trusted either.
    const forged = { ...e, fakeOrigin: "https://evil.example" };
    assert.equal(endpoints.isFakeUrl("https://evil.example/api/x", forged), false);
    assert.equal(endpoints.isFakeUrl("not a url", e), false);
  });

  it("never names the configured URL in an error", () => {
    try {
      endpoints.assertBscTargetAllowed({ NEONBINDER_FAKE_BSC_URL: "http://secret-host.internal", ENVIRONMENT: "dev" });
      assert.fail("should throw");
    } catch (err) {
      assert.ok(!String(err.message).includes("secret-host"));
    }
  });
});

describe("assertBscTargetAllowed (boot guard)", () => {
  it("refuses to boot prod pointed at the fake", () => {
    assert.throws(
      () => endpoints.assertBscTargetAllowed({ NEONBINDER_FAKE_BSC_URL: FAKE, ENVIRONMENT: "prod" }),
      /refusing to boot/,
    );
    assert.throws(() => endpoints.resolveBscEndpoints({ NEONBINDER_FAKE_BSC_URL: FAKE, ENVIRONMENT: "prod" }));
  });

  it("boots prod on the real target and dev on either", () => {
    endpoints.assertBscTargetAllowed({ ENVIRONMENT: "prod" });
    endpoints.assertBscTargetAllowed({ ENVIRONMENT: "prod", NEONBINDER_FAKE_BSC_URL: "" });
    endpoints.assertBscTargetAllowed({ ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: FAKE });
    endpoints.assertBscTargetAllowed({});
  });

  it("index.ts calls it before listening", () => {
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    const guard = index.indexOf("assertBscTargetAllowed(process.env)");
    assert.ok(guard > 0, "index.ts must call assertBscTargetAllowed");
    assert.ok(guard < index.lastIndexOf("app.listen(PORT"), "the guard runs before app.listen");
  });
});

describe("fakeBscCallerHeaders", () => {
  beforeEach(() => endpoints.clearFakeIdTokenCache());

  it("is empty for the real target", async () => {
    const h = await endpoints.fakeBscCallerHeaders(endpoints.resolveBscEndpoints({}), {
      env: { NEONBINDER_FAKE_BSC_KEY: "k" },
      mintIdToken: async () => assert.fail("must not mint for real BSC"),
    });
    assert.deepEqual(h, {});
  });

  it("sends the caller key and an ID token whose audience is the fake origin", async () => {
    const audiences = [];
    const env = { NEONBINDER_FAKE_BSC_URL: FAKE, NEONBINDER_FAKE_BSC_KEY: "caller-key" };
    const h = await endpoints.fakeBscCallerHeaders(endpoints.resolveBscEndpoints(env), {
      env,
      mintIdToken: async (aud) => {
        audiences.push(aud);
        return "id-token-1";
      },
    });
    assert.deepEqual(h, {
      "x-nb-fake-bsc-key": "caller-key",
      "X-Serverless-Authorization": "Bearer id-token-1",
      "x-nb-fake-id-token": "id-token-1",
    });
    assert.deepEqual(audiences, [FAKE]);
  });

  it("sends no ID token over plain http (a loopback fake)", async () => {
    const env = { NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:9", NEONBINDER_FAKE_BSC_KEY: "k" };
    const h = await endpoints.fakeBscCallerHeaders(endpoints.resolveBscEndpoints(env), {
      env,
      mintIdToken: async () => assert.fail("no ID token over http"),
    });
    assert.deepEqual(h, { "x-nb-fake-bsc-key": "k" });
  });

  it("refuses fake mode without a caller key", async () => {
    const env = { NEONBINDER_FAKE_BSC_URL: FAKE };
    await assert.rejects(
      endpoints.fakeBscCallerHeaders(endpoints.resolveBscEndpoints(env), { env, mintIdToken: async () => "t" }),
      /NEONBINDER_FAKE_BSC_KEY/,
    );
  });
});

describe("bscFetch", () => {
  let original;
  let calls;
  let answer;
  beforeEach(() => {
    bscFetchMod.resetBscBreaker();
    calls = [];
    answer = () => new Response("{}", { status: 200 });
    original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), headers: new Headers(init.headers) });
      return answer();
    };
  });
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("adds fake headers only to a request for the configured fake", async () => {
    const env = { NEONBINDER_FAKE_BSC_URL: FAKE, NEONBINDER_FAKE_BSC_KEY: "caller-key" };
    const opts = { env, mintIdToken: async () => "idt" };
    await bscFetch(`${FAKE}/api/marketplace/user/profile`, { headers: { Authorization: "Bearer bsc" } }, opts);
    await bscFetch("https://api-prod.buysportscards.com/marketplace/user/profile", {}, opts);
    assert.equal(calls[0].headers.get("x-nb-fake-bsc-key"), "caller-key");
    assert.equal(calls[0].headers.get("x-serverless-authorization"), "Bearer idt");
    assert.equal(calls[0].headers.get("x-nb-fake-id-token"), "idt");
    assert.equal(calls[0].headers.get("authorization"), "Bearer bsc", "the BSC bearer passes through");
    assert.equal(calls[1].headers.get("x-nb-fake-bsc-key"), null, "real BSC never gets the key");
    assert.equal(calls[1].headers.get("x-serverless-authorization"), null);
    assert.equal(calls[1].headers.get("x-nb-fake-id-token"), null);
  });

  it("opens a process-wide breaker on a real 429 for its Retry-After and sends nothing meanwhile", async () => {
    let t = 1_000_000;
    const now = () => t;
    answer = () => new Response("", { status: 429, headers: { "retry-after": "30" } });
    const first = await bscFetch("https://api-prod.buysportscards.com/a", {}, { env: {}, now });
    assert.equal(first.status, 429);
    answer = () => new Response("{}", { status: 200 });

    const blocked = await bscFetch("https://identity.buysportscards.com/b", {}, { env: {}, now, scope: "another-user" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("x-nb-bsc-breaker"), "open");
    assert.equal(blocked.headers.get("retry-after"), "30");
    assert.equal(calls.length, 1, "nothing was sent while open");
    assert.equal(bscFetchMod.bscBreakerRemainingMs({ env: {}, now }), 30_000);

    t += 30_001;
    const after = await bscFetch("https://api-prod.buysportscards.com/a", {}, { env: {}, now });
    assert.equal(after.status, 200);
    assert.equal(calls.length, 2);
  });

  it("scopes the breaker per caller against the fake, so one test's 429 does not stall others", async () => {
    const env = { NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:9", NEONBINDER_FAKE_BSC_KEY: "k" };
    answer = () => new Response("", { status: 429 });
    await bscFetch("http://127.0.0.1:9/api/x", {}, { env, scope: "ns-a" });
    answer = () => new Response("{}", { status: 200 });
    assert.equal((await bscFetch("http://127.0.0.1:9/api/x", {}, { env, scope: "ns-b" })).status, 200);
    assert.equal((await bscFetch("http://127.0.0.1:9/api/x", {}, { env, scope: "ns-a" })).status, 429);
    assert.equal(calls.length, 2);
  });

  it("clamps Retry-After and defaults to 60 s", () => {
    const n = 0;
    assert.equal(bscFetchMod.retryAfterMs(null, n), 60_000);
    assert.equal(bscFetchMod.retryAfterMs("0", n), 1_000);
    assert.equal(bscFetchMod.retryAfterMs("99999", n), 15 * 60_000);
    assert.equal(bscFetchMod.retryAfterMs(new Date(n + 120_000).toUTCString(), n), 120_000);
    assert.equal(bscFetchMod.retryAfterMs("soon", n), 60_000);
  });

  it("does not open on a 5xx (bounded retries live in the callers)", async () => {
    answer = () => new Response("", { status: 503 });
    await bscFetch("https://api-prod.buysportscards.com/a", {}, { env: {} });
    answer = () => new Response("{}", { status: 200 });
    assert.equal((await bscFetch("https://api-prod.buysportscards.com/a", {}, { env: {} })).status, 200);
  });
});

describe("shapeSignature / shapeMap", () => {
  it("keeps key paths and types, never values", () => {
    const body = {
      sellerProfile: { sellerId: "SELLER-SECRET-123", sellerStoreName: "My Store", active: true, rating: 4.5, note: null },
      results: [{ orderId: "o-1", total: 3 }, { orderId: "o-2", total: null }],
    };
    const sig = shape.shapeSignature(body);
    const text = JSON.stringify(sig);
    for (const v of ["SELLER-SECRET-123", "My Store", "o-1", "4.5"]) assert.ok(!text.includes(v), v);
    assert.deepEqual(shape.shapeMap(body), {
      $: "object",
      results: "array",
      "results[]": "object",
      "results[].orderId": "string",
      "results[].total": "null|number",
      sellerProfile: "object",
      "sellerProfile.active": "boolean",
      "sellerProfile.note": "null",
      "sellerProfile.rating": "number",
      "sellerProfile.sellerId": "string",
      "sellerProfile.sellerStoreName": "string",
    });
    assert.match(sig.hash, /^[0-9a-f]{16}$/);
  });

  it("collapses arrays of any length to one shape", () => {
    const a = shape.shapeSignature([{ x: 1 }]);
    const b = shape.shapeSignature([{ x: 1 }, { x: 2 }, { x: 3 }]);
    assert.equal(a.hash, b.hash);
  });

  it("collapses id-like and non-identifier map keys, which are data", () => {
    const m = shape.shapeMap({
      byId: { "96f9a87adeb7d02c275e117ef10d569c": { n: 1 }, "12345": { n: 2 } },
      byName: { "Wayne Gretzky": 1, "o'brien": 2 },
    });
    assert.ok(!JSON.stringify(m).includes("Gretzky"));
    assert.ok(!JSON.stringify(m).includes("96f9a87a"));
    assert.equal(m["byId.{*}.n"], "number");
    assert.equal(m["byName.{*}"], "number");
  });

  it("caps depth and line count", () => {
    let deep = 1;
    for (let i = 0; i < 40; i++) deep = { k: deep };
    assert.ok(shape.shapeSignature(deep).lines.length <= 14);
    const wide = {};
    for (let i = 0; i < 1000; i++) wide[`k${i}`] = i;
    const lines = shape.shapeSignature(wide).lines;
    assert.equal(lines[lines.length - 1], "…: truncated");
    assert.ok(lines.length <= 401);
  });

  it("canonicalJson sorts keys recursively and keeps array order", () => {
    assert.equal(
      JSON.stringify(shape.canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 2 } })),
      '{"a":{"c":2,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("GET /health bscTarget", () => {
  async function health(env) {
    const express = require("express");
    const { createHealthRouter } = require("../dist/routes/health");
    const app = express();
    app.use(createHealthRouter(env));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);
      return res.json();
    } finally {
      server.close();
    }
  }

  it("reports real by default, with the contract version", async () => {
    const { CONTRACT_VERSION } = require("../dist/contract-version");
    const body = await health({ ENVIRONMENT: "prod" });
    // NEO-555 added ebayFake and ebayTarget (additive; no contract bump).
    assert.deepEqual(body, {
      status: "ok",
      environment: "prod",
      contractVersion: CONTRACT_VERSION,
      bscTarget: "real",
      ebayFake: false,
      ebayTarget: null,
    });
  });

  it("reports fake when pointed at the fake, without the URL", async () => {
    const body = await health({ ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: FAKE });
    assert.equal(body.bscTarget, "fake");
    assert.ok(!JSON.stringify(body).includes("run.app"));
  });
});

describe("no BSC host literal outside src/bsc-endpoints.ts", () => {
  const HOST = /buysportscards\.(?:com|onmicrosoft\.com)|api-prod\./i;

  function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...walk(p));
      else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  it("finds none (comments included)", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      if (relative(SRC, file) === "bsc-endpoints.ts") continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (HOST.test(line)) offenders.push(`${relative(SRC, file)}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, [], `BSC host literal outside bsc-endpoints.ts: ${offenders.join(", ")}`);
  });

  it("the pattern does catch one (the test is live)", () => {
    assert.ok(HOST.test(readFileSync(join(SRC, "bsc-endpoints.ts"), "utf8")));
  });
});
