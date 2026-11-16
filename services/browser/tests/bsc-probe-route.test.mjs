/**
 * NEO-552: POST /probe/bsc (src/routes/bsc-probe.ts) with the sign-in, the
 * pause lookup, the canary secret and fetch all stubbed. The contract test
 * (bsc-fake-identity-contract.test.mjs) runs it for real against the fake.
 *
 * Verdict vocabulary is .github/scripts/bsc-probe-verdict.sh's: ok,
 * skipped_paused, signin_failed, bsc_unavailable, catalogue_non_2xx,
 * parser_rejected.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const express = require("express");
const { createBscProbeRouter, FAKE_PROBE_USERNAME, PINNED_READS, SHAPE_PATHS } = require("../dist/routes/bsc-probe");
const { resetBscBreaker } = require("../dist/bsc-fetch");

const SELLER_ID = "SELLERID-VALUE-9f8e";
const ACCESS_TOKEN = "access-token-value-abc";
const CANARY = { username: "canary@example.com", password: "canary-pass-value" };

const GOOD = {
  "search/bulk-upload/filters": () => ({ aggregations: { setName: [{ label: "Halifax Mooseheads QMJHL", slug: "halifax-mooseheads-qmjhl", count: 26 }] } }),
  "search/bulk-upload/results": () => [{ id: "card-1", playerName: "A Player" }],
  "marketplace/card/96f9a87adeb7d02c275e117ef10d569c/card-listing": () => ({ teamName: "Halifax" }),
  "marketplace/user/profile": () => ({ sellerProfile: { sellerId: SELLER_ID, sellerStoreName: "Store Value" } }),
  "seller/bulk-upload/results": () => [{ id: "card-1" }],
  "seller/order/history": () => ({ totalElements: 0, results: [] }),
};

function okSignIn(calls) {
  return async (input) => {
    calls.push(input);
    for (const step of ["authorize", "self_asserted", "confirmed", "token"]) {
      input.onStep?.({ step, status: step === "confirmed" ? 302 : 200, ms: 1, parsed: true });
    }
    return { tokens: { token: ACCESS_TOKEN, expiresAt: Date.now() + 3600_000 } };
  };
}

async function call(router, body = {}) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/probe/bsc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
  } finally {
    server.close();
  }
}

describe("POST /probe/bsc", () => {
  let original;
  let apiCalls;
  let answers;
  let logs;
  const PROD = { ENVIRONMENT: "prod" };

  beforeEach(() => {
    resetBscBreaker();
    apiCalls = [];
    logs = [];
    answers = { ...GOOD };
    original = globalThis.fetch;
    const passThrough = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      // The test's own call to the route under test.
      if (u.pathname === "/probe/bsc") return passThrough(url, init);
      const path = u.pathname.replace(/^\/(api\/)?/, "");
      apiCalls.push({ path, init, headers: new Headers(init.headers) });
      const a = answers[path];
      if (typeof a === "function") return new Response(JSON.stringify(a()), { status: 200 });
      if (a && typeof a === "object" && "status" in a) return new Response(a.body ?? "", { status: a.status });
      if (a instanceof Error) throw a;
      return new Response("{}", { status: 501 });
    };
  });
  afterEach(() => {
    globalThis.fetch = original;
  });

  const prodRouter = (extra = {}) => {
    const signInCalls = [];
    const router = createBscProbeRouter({
      env: PROD,
      signIn: okSignIn(signInCalls),
      readCanaryCredentials: async () => CANARY,
      isPaused: async () => false,
      log: (l) => logs.push(l),
      ...extra,
    });
    return { router, signInCalls };
  };

  it("prod, all good: outcome ok, every leg true, shapes for every read, no values", async () => {
    const { router, signInCalls } = prodRouter();
    const r = await call(router, { username: "ignored@example.com", password: "ignored" });
    assert.equal(r.status, 200);
    assert.equal(r.body.bscTarget, "real");
    assert.equal(r.body.outcome, "ok");
    assert.deepEqual(r.body.signIn, { ok: true });
    assert.deepEqual(r.body.catalogue, { ok: true, status: 200 });
    assert.deepEqual(r.body.parser, { ok: true });
    assert.deepEqual(Object.keys(r.body.shapes).sort(), PINNED_READS.map((p) => p.template).sort());
    assert.equal(r.body.shapes["marketplace/user/profile"]["sellerProfile.sellerId"], "string");
    assert.deepEqual(Object.keys(r.body.requests).sort(), [
      "marketplace/card/:id/card-listing",
      "search/bulk-upload/filters",
      "search/bulk-upload/results",
    ]);
    // Canonical: keys sorted recursively.
    assert.equal(
      JSON.stringify(r.body.requests["search/bulk-upload/filters"]),
      '{"body":{"filters":{"sport":["hockey"],"year":["1995"]}},"method":"POST","path":"search/bulk-upload/filters","query":{}}',
    );
    assert.deepEqual(
      r.body.steps.map((s) => s.step),
      ["sign_in.authorize", "sign_in.self_asserted", "sign_in.confirmed", "sign_in.token", ...PINNED_READS.map((p) => p.step)],
    );

    // The body was ignored: the canary account signed in.
    assert.equal(signInCalls[0].username, CANARY.username);
    // Reads carry the token and Convex's header set.
    assert.equal(apiCalls[0].headers.get("authorization"), `Bearer ${ACCESS_TOKEN}`);
    assert.equal(apiCalls[0].headers.get("assumedrole"), "sellers");

    const everything = JSON.stringify(r.body) + JSON.stringify(logs);
    for (const v of [SELLER_ID, "Store Value", ACCESS_TOKEN, CANARY.password, CANARY.username, "A Player", "Halifax Mooseheads QMJHL"]) {
      assert.ok(!everything.includes(v), `leaked ${v}`);
    }
    assert.equal(logs.length, 1);
    assert.equal(logs[0].msg, "bsc_probe");
    assert.equal(logs[0].outcome, "ok");
  });

  it("reports only the parser-read paths: planted usernames, emails and hex keys never leave", async () => {
    // Data-shaped keys that the {*} rule alone would let through (short,
    // identifier-like) or collapse but still report, at several depths.
    const PLANTED = [
      "collector_joe",
      "jdoe1987",
      "buyer_jane",
      "a1b2c3d4",
      "deadbeefcafe",
      "jane.doe@example.com",
      "bob@example.org",
      "cardshop_mike",
      "Store Value",
      "Secret Buyer Name",
    ];
    answers["marketplace/user/profile"] = () => ({
      sellerProfile: {
        sellerId: SELLER_ID,
        sellerStoreName: "Store Value",
        sellerEmailId: "jane.doe@example.com",
        followers: { collector_joe: { since: 1 }, a1b2c3d4: 2 },
      },
      jdoe1987: { email: "bob@example.org" },
    });
    answers["seller/bulk-upload/results"] = () => [
      {
        card: { id: "card-1", cardNo: "1", buyer_jane: true },
        cardId: "card-1",
        condition: "near_mint",
        availableQuantity: 1,
        price: "1.00",
        watchers: { deadbeefcafe: 1, collector_joe: { name: "Secret Buyer Name" } },
      },
    ];
    answers["seller/order/history"] = () => ({
      totalElements: 1,
      results: [
        {
          orderId: "o-1",
          orderNo: "1001",
          orderStatus: "paid",
          orderDate: "2026-11-01",
          buyerName: "Secret Buyer Name",
          buyer_jane: { email: "jane.doe@example.com" },
          "jane.doe@example.com": 1,
        },
      ],
      buyers: { jdoe1987: 1 },
    });
    answers["marketplace/card/96f9a87adeb7d02c275e117ef10d569c/card-listing"] = () => ({
      id: "96f9a87adeb7d02c275e117ef10d569c",
      teamName: "Halifax",
      listings: [{ sellerStoreName: "Store Value", sellerId: SELLER_ID }],
      sellers: { cardshop_mike: 3 },
    });
    answers["search/bulk-upload/results"] = () => [{ id: "card-1", setName: "S", cardshop_mike: 1 }];
    answers["search/bulk-upload/filters"] = () => ({
      aggregations: {
        setName: [{ label: "L", slug: "s", count: 1, collector_joe: "x" }],
        sellers: [{ label: "cardshop_mike", slug: "cardshop_mike" }],
      },
      buyer_jane: 1,
    });
    const { router } = prodRouter();
    const r = await call(router);
    assert.equal(r.body.outcome, "ok", r.body.detail);

    const everything = JSON.stringify(r.body) + JSON.stringify(logs);
    for (const v of PLANTED) assert.ok(!everything.includes(v), `leaked ${v}`);
    assert.ok(!everything.includes("{*}"), "no collapsed data key is reported at all");

    assert.deepEqual(r.body.shapes["marketplace/user/profile"], {
      $: "object",
      sellerProfile: "object",
      "sellerProfile.sellerId": "string",
      "sellerProfile.sellerStoreName": "string",
    });
    assert.deepEqual(r.body.shapes["seller/order/history"], {
      $: "object",
      totalElements: "number",
      results: "array",
      "results[]": "object",
      "results[].orderId": "string",
      "results[].orderNo": "string",
      "results[].orderStatus": "string",
      "results[].orderDate": "string",
    });
    // Every reported path is an allowlisted one or an ancestor of one.
    const byTemplate = Object.fromEntries(PINNED_READS.map((p) => [p.template, p.shapePaths]));
    for (const [template, shape] of Object.entries(r.body.shapes)) {
      const allowed = new Set(["$"]);
      for (const path of byTemplate[template]) {
        let q = path;
        while (q) {
          allowed.add(q);
          q = q.endsWith("[]") ? q.slice(0, -2) : q.includes(".") ? q.slice(0, q.lastIndexOf(".")) : "";
        }
      }
      for (const path of Object.keys(shape)) assert.ok(allowed.has(path), `${template}: ${path} is not allowlisted`);
    }
  });

  it("refuses a real-BSC probe outside prod and calls nobody", async () => {
    const signInCalls = [];
    const router = createBscProbeRouter({ env: { ENVIRONMENT: "dev" }, signIn: okSignIn(signInCalls) });
    const r = await call(router);
    assert.equal(r.status, 409);
    assert.equal(r.body.bscTarget, "real");
    assert.equal(signInCalls.length, 0);
    assert.equal(apiCalls.length, 0);
  });

  it("runs at most once a minute", async () => {
    let t = 10_000_000;
    const { router } = prodRouter({ now: () => t });
    assert.equal((await call(router)).status, 200);
    t += 30_000;
    const second = await call(router);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "30");
    t += 30_000;
    assert.equal((await call(router)).status, 200);
  });

  it("honours the BSC pause flag: skipped_paused, no sign-in", async () => {
    const { router, signInCalls } = prodRouter({ isPaused: async () => true });
    const r = await call(router);
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, "skipped_paused");
    assert.equal(signInCalls.length, 0);
    assert.equal(apiCalls.length, 0);
  });

  it("an unreadable canary secret is signin_failed, naming no secret", async () => {
    const { router } = prodRouter({
      readCanaryCredentials: async () => {
        throw new Error("PERMISSION_DENIED on projects/x/secrets/bsc-credentials-canary");
      },
    });
    const r = await call(router);
    assert.equal(r.body.outcome, "signin_failed");
    assert.ok(!JSON.stringify(r.body).includes("projects/"));
  });

  it("credentials B2C rejected are signin_failed; a throttled or down step is bsc_unavailable", async () => {
    const rejected = createBscProbeRouter({
      env: PROD,
      readCanaryCredentials: async () => CANARY,
      isPaused: async () => false,
      log: () => {},
      signIn: async (input) => {
        input.onStep({ step: "authorize", status: 200, ms: 1, parsed: true });
        input.onStep({ step: "self_asserted", status: 200, ms: 1, parsed: true });
        return { error: "Authentication failed", credentialRejected: true };
      },
    });
    const a = await call(rejected);
    assert.equal(a.body.outcome, "signin_failed");
    assert.equal(a.body.signIn.ok, false);
    assert.match(a.body.detail, /self_asserted/);

    for (const failing of [
      { step: "authorize", status: 429, ms: 1, parsed: false },
      { step: "token", status: 503, ms: 1, parsed: false },
      { step: "confirmed", status: 0, ms: 1, parsed: false, failure: "timeout" },
    ]) {
      const router = createBscProbeRouter({
        env: PROD,
        readCanaryCredentials: async () => CANARY,
        isPaused: async () => false,
        log: () => {},
        signIn: async (input) => {
          input.onStep(failing);
          return { error: "Authentication failed" };
        },
      });
      const r = await call(router);
      assert.equal(r.body.outcome, "bsc_unavailable", JSON.stringify(failing));
    }
    assert.equal(apiCalls.length, 0, "no read after a failed sign-in");
  });

  it("a 5xx catalogue read is bsc_unavailable and stops further reads", async () => {
    answers["search/bulk-upload/filters"] = { status: 503 };
    const { router } = prodRouter();
    const r = await call(router);
    assert.equal(r.body.outcome, "bsc_unavailable");
    assert.deepEqual(r.body.catalogue, { ok: false, status: 503 });
    assert.equal(apiCalls.length, 1);
    assert.ok(r.body.steps.filter((s) => s.failure === "skipped").length === PINNED_READS.length - 1);
  });

  it("a non-2xx read is catalogue_non_2xx and names the step", async () => {
    answers["seller/order/history"] = { status: 403 };
    const { router } = prodRouter();
    const r = await call(router);
    assert.equal(r.body.outcome, "catalogue_non_2xx");
    assert.deepEqual(r.body.catalogue, { ok: false, status: 403 });
    assert.match(r.body.detail, /order_history/);
  });

  it("a 2xx body the parser does not accept is parser_rejected", async () => {
    answers["search/bulk-upload/filters"] = () => ({ aggregations: {} });
    const { router } = prodRouter();
    const r = await call(router);
    assert.equal(r.body.outcome, "parser_rejected");
    assert.deepEqual(r.body.catalogue, { ok: true, status: 200 });
    assert.equal(r.body.parser.ok, false);
    // The shape of what BSC sent is still reported, for the drift diff.
    assert.ok(r.body.shapes["search/bulk-upload/filters"]);
  });

  it("an open 429 breaker short-circuits the reads as bsc_unavailable", async () => {
    answers["search/bulk-upload/filters"] = { status: 429 };
    const { router } = prodRouter();
    const r = await call(router);
    assert.equal(r.body.outcome, "bsc_unavailable");
    assert.equal(apiCalls.length, 1);
  });

  describe("fake target", () => {
    const FAKE_ENV = { ENVIRONMENT: "dev", NEONBINDER_FAKE_BSC_URL: "http://127.0.0.1:9", NEONBINDER_FAKE_BSC_KEY: "k" };

    it("uses the body's credentials, or the fake's constant probe account", async () => {
      const calls = [];
      const r1 = await call(createBscProbeRouter({ env: FAKE_ENV, signIn: okSignIn(calls), log: () => {} }), {
        username: "nb+probe-ci@fake.invalid",
        password: "fake-bsc-password",
      });
      assert.equal(r1.body.bscTarget, "fake");
      assert.equal(r1.body.outcome, "ok");
      const r2 = await call(createBscProbeRouter({ env: FAKE_ENV, signIn: okSignIn(calls), log: () => {} }));
      assert.equal(r2.body.outcome, "ok");
      assert.deepEqual(calls.map((c) => c.username), ["nb+probe-ci@fake.invalid", FAKE_PROBE_USERNAME]);
      // Fake reads carry the caller key.
      assert.equal(apiCalls[0].headers.get("x-nb-fake-bsc-key"), "k");
    });

    it("rejects half a credential pair", async () => {
      const r = await call(createBscProbeRouter({ env: FAKE_ENV, signIn: okSignIn([]) }), { username: "x" });
      assert.equal(r.status, 400);
    });

    it("never consults the pause flag or the canary secret", async () => {
      const r = await call(
        createBscProbeRouter({
          env: FAKE_ENV,
          signIn: okSignIn([]),
          log: () => {},
          isPaused: async () => assert.fail("no pause lookup on the fake"),
          readCanaryCredentials: async () => assert.fail("no canary secret on the fake"),
        }),
      );
      assert.equal(r.body.outcome, "ok");
    });
  });
});

// The probe's allowlists must name the same paths the fake compares, or the
// daily drift check either misses drift or reports allowlist noise as drift.
describe("SHAPE_PATHS parity with the fake's comparison lists", () => {
  const FAKE_SRC = join(dirname(fileURLToPath(import.meta.url)), "../../fake-bsc/src");
  let tmp;
  let sanitise;
  const specPaths = (spec, path) => {
    switch (spec.kind) {
      case "leaf":
        return [path];
      case "object":
        return Object.entries(spec.fields).flatMap(([k, v]) => specPaths(v, path ? `${path}.${k}` : k));
      case "array":
        return specPaths(spec.items, `${path}[]`);
      case "oneOf":
        return spec.options.flatMap((o) => specPaths(o, path));
      default:
        throw new Error(`unknown spec kind ${spec.kind}`);
    }
  };
  // Leaf paths only: drop any path that is an ancestor of another.
  const leaves = (paths) => {
    const set = [...new Set(paths)];
    return set.filter((p) => !set.some((q) => q !== p && (q.startsWith(`${p}.`) || q.startsWith(`${p}[]`)))).sort();
  };

  it("catalogue reads match services/fake-bsc/src/sanitise.ts SPECS", async () => {
    tmp = mkdtempSync(join(tmpdir(), "fake-bsc-sanitise-"));
    try {
      writeFileSync(join(tmp, "sanitise.mjs"), stripTypeScriptTypes(readFileSync(join(FAKE_SRC, "sanitise.ts"), "utf8")));
      sanitise = await import(pathToFileURL(join(tmp, "sanitise.mjs")).href);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    assert.deepEqual(leaves(SHAPE_PATHS.filters), leaves(specPaths(sanitise.SPECS.filters, "")));
    assert.deepEqual(leaves(SHAPE_PATHS.results), leaves(specPaths(sanitise.SPECS.results, "")));
    assert.deepEqual(leaves(SHAPE_PATHS.cardListing), leaves(specPaths(sanitise.SPECS.cardListing, "")));
  });

  it("seller reads match services/fake-bsc/src/drift.ts READ_PATHS", () => {
    const src = readFileSync(join(FAKE_SRC, "drift.ts"), "utf8");
    const list = (name) => {
      const m = new RegExp(`\\n\\s*${name}:\\s*\\[((?:\\s*"[^"]*"\\s*,?)*)\\s*\\]`).exec(src);
      assert.ok(m, `READ_PATHS.${name} not found in drift.ts`);
      return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).filter((p) => p !== "");
    };
    assert.deepEqual(leaves(SHAPE_PATHS.profile), leaves(list("profile")));
    assert.deepEqual(leaves(SHAPE_PATHS.orderHistory), leaves(list("orderHistory")));
    // The probe also accepts BSC's {results: [...]} wrapping of the sheet; the
    // fake compares the bare-array form.
    assert.deepEqual(
      leaves(SHAPE_PATHS.sellerSheet.filter((p) => p.startsWith("[]"))),
      leaves(list("sheet")),
    );
  });
});
