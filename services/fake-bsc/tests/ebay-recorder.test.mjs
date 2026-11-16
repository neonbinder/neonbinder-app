// The eBay recorder against a STUBBED eBay: every eBay answer here is a stub
// function, so nothing reaches eBay. Covers the client's pacing, cap and
// stop rules, the credentials file checks, ebay-record, the sandbox capture,
// the production capture's guards and ebay-undo.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, chmod, symlink, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { EbayApi, EbayStop, EBAY_SCOPES, MIN_EBAY_INTERVAL_MS } = require("../dist/recorder/ebay-api.js");
const { readCredsFile, readProductionCreds } = require("../dist/recorder/ebay-credentials.js");
const { ebayRecordPlan, runEbayRecord } = require("../dist/recorder/ebay-record.js");
const { runProdCapture, runSandboxCapture, runEbayUndo, prodPlanLines, prodFailureLines, checkCaptureSku, captureSku } = require("../dist/recorder/ebay-capture.js");
const { ebayCapture, ebayUndo, parseArgs } = require("../dist/recorder/cli.js");
const { canonicalRequest, requestKey } = require("../dist/src/requestKey.js");

const REFRESH = "v^1.1#i^1#REFRESH-TOKEN-VALUE-never-printed";
const CERT = "PRD-cert-id-value-never-printed";
const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const PRD_SKU = "NBCAPTURE-PRD-20261116";
const SBX_SKU = "NBCAPTURE-SBX-20261116";

/**
 * A stub eBay. `routes` maps "METHOD /path" (no query) to a handler returning
 * {status, body?, location?}; unmatched requests answer 404. Every request is
 * recorded (method, path, query, body text) for assertions.
 */
function stubEbay(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    let bodyText = "";
    if (typeof init.body === "string") bodyText = init.body;
    else if (init.body instanceof FormData) bodyText = "<multipart>";
    calls.push({ method, host: u.hostname, path: u.pathname, query: Object.fromEntries(u.searchParams), body: bodyText, headers: init.headers });
    const key = `${method} ${u.pathname}`;
    const h = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
    const out = h ? h({ method, path: u.pathname, query: u.searchParams, body: bodyText, calls }) : { status: 404, body: { errors: [{ errorId: 25710 }] } };
    if (out instanceof Error) throw out;
    const headers = new Headers(out.location ? { location: out.location } : {});
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status, headers });
  };
  return { calls, fetchImpl };
}

const tokenOk = () => ({ status: 200, body: { access_token: "v^1.1#ACCESS", expires_in: 7200, token_type: "User Access Token" } });

function api(env, routes, over = {}) {
  const stub = stubEbay({ "POST /identity/v1/oauth2/token": tokenOk, ...routes });
  let t = NOW;
  const sleeps = [];
  const a = new EbayApi({
    env,
    creds: { clientId: "NB-app-id", certId: CERT, refreshToken: REFRESH },
    fetchImpl: stub.fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    ...over,
  });
  return { api: a, stub, sleeps };
}

/** Requests that change the account: anything but GET and the token endpoint. */
const writesOf = (calls) => calls.filter((c) => c.method !== "GET" && c.path !== "/identity/v1/oauth2/token");

describe("eBay recorder client", () => {
  it("paces calls a second apart, and the refresh grant asks for NB's scopes only", async () => {
    const { api: a, stub, sleeps } = api("sandbox", { "GET /x": () => ({ status: 200, body: {} }) });
    await a.grantUser();
    await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" });
    await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" });
    assert.deepEqual(sleeps, [MIN_EBAY_INTERVAL_MS, MIN_EBAY_INTERVAL_MS]);
    const grant = new URLSearchParams(stub.calls[0].body);
    assert.equal(stub.calls[0].host, "api.sandbox.ebay.com");
    assert.equal(grant.get("grant_type"), "refresh_token");
    assert.equal(grant.get("scope"), EBAY_SCOPES.join(" "));
  });

  it("never sends an authorization-code grant, and only one refresh grant a run", async () => {
    const { api: a, stub } = api("sandbox", {});
    await a.grantUser();
    await assert.rejects(() => a.grantUser(), /one refresh grant/);
    await a.grantApp();
    await assert.rejects(() => a.grantApp(), /one app token/);
    assert.ok(stub.calls.every((c) => !c.body.includes("authorization_code")));
  });

  for (const [status, reason] of [
    [401, "unauthorized"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ]) {
    it(`stops on the first ${status}, without retrying`, async () => {
      const { api: a, stub } = api("sandbox", { "GET /x": () => ({ status, body: { errors: [{ errorId: 1001 }] } }) });
      await a.grantUser();
      const err = await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" }).catch((e) => e);
      assert.ok(err instanceof EbayStop);
      assert.equal(err.reason, reason);
      assert.equal(stub.calls.filter((c) => c.path === "/x").length, 1);
    });
  }

  it("stops at the call cap", async () => {
    const { api: a } = api("sandbox", { "GET /x": () => ({ status: 200, body: {} }) }, { maxCalls: 2 });
    await a.grantUser();
    await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" });
    const err = await a.call({ label: "GET x", method: "GET", host: "api", path: "/x", token: "user" }).catch((e) => e);
    assert.equal(err.reason, "cap");
  });

  it("a refused grant or a network error stops the run and never names a credential", async () => {
    const refused = api("sandbox", { "POST /identity/v1/oauth2/token": () => ({ status: 400, body: { error: "invalid_grant", error_description: REFRESH } }) });
    const e1 = await refused.api.grantUser().catch((e) => e);
    assert.equal(e1.reason, "token_refused");
    assert.ok(!e1.message.includes(REFRESH) && !e1.message.includes(CERT));
    const down = api("sandbox", { "POST /identity/v1/oauth2/token": () => new TypeError(`fetch failed ${REFRESH}`) });
    const e2 = await down.api.grantUser().catch((e) => e);
    assert.equal(e2.reason, "network");
    assert.ok(!e2.message.includes(REFRESH));
  });

  it("forget() drops every credential", async () => {
    const { api: a, stub } = api("sandbox", {});
    a.forget();
    await a.grantUser();
    // The grant went out with emptied credentials: nothing is held after forget.
    const sent = JSON.stringify(stub.calls[0]);
    assert.ok(!sent.includes(REFRESH));
    assert.ok(!sent.includes(Buffer.from(`NB-app-id:${CERT}`).toString("base64")));
    assert.equal(new URLSearchParams(stub.calls[0].body).get("refresh_token"), "");
  });
});

describe("eBay recorder credentials", () => {
  let dir;
  before(async () => (dir = await mkdtemp(path.join(tmpdir(), "nb-ebay-creds-"))));
  after(() => rm(dir, { recursive: true, force: true }));

  const good = JSON.stringify({ clientId: "NB-app-id", certId: CERT, refreshToken: REFRESH });

  it("reads a mode-600 file outside any checkout", async () => {
    const f = path.join(dir, "ok.json");
    await writeFile(f, good, { mode: 0o600 });
    const c = await readCredsFile(f);
    assert.equal(c.clientId, "NB-app-id");
  });

  it("refuses a file others can read, a link, a file in a git checkout, and bad JSON without quoting it", async () => {
    const loose = path.join(dir, "loose.json");
    await writeFile(loose, good);
    await chmod(loose, 0o644);
    await assert.rejects(() => readCredsFile(loose), /chmod 600/);
    const link = path.join(dir, "link.json");
    await writeFile(path.join(dir, "target.json"), good, { mode: 0o600 });
    await symlink(path.join(dir, "target.json"), link);
    await assert.rejects(() => readCredsFile(link), /link/);
    const repo = path.join(dir, "repo");
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await writeFile(path.join(repo, "c.json"), good, { mode: 0o600 });
    await assert.rejects(() => readCredsFile(path.join(repo, "c.json")), /git checkout/);
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, `{"certId": "${CERT}"`, { mode: 0o600 });
    const err = await readCredsFile(bad).catch((e) => e);
    assert.match(err.message, /not valid JSON/);
    assert.ok(!err.message.includes(CERT));
    await assert.rejects(() => readCredsFile(path.join(dir, "ok.json"), { uid: 999999 }), /not owned by you/);
  });

  it("production: reads the Cert ID and the stored session's refresh token through the secret reader", async () => {
    const asked = [];
    const read = async (name, project) => {
      asked.push([name, project]);
      return name === "cert" ? `${CERT}\n` : JSON.stringify({ username: "u", token: "t", refreshToken: REFRESH });
    };
    const c = await readProductionCreds({ clientId: "NB-app-id", certSecret: "cert", sessionSecret: "session", project: "proj-1234", read });
    assert.equal(c.certId, CERT);
    assert.equal(c.refreshToken, REFRESH);
    assert.deepEqual(asked, [["cert", "proj-1234"], ["session", "proj-1234"]]);
    await assert.rejects(() => readProductionCreds({ clientId: "x", certSecret: "c", sessionSecret: "s", project: "p-1234", read: async (n) => (n === "c" ? CERT : "{}") }), /refreshToken/);
  });

  it("refuses credential values as flags", async () => {
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--refresh-token", "x"]).flags), /not accepted/);
  });
});

describe("ebay-record", () => {
  const shipBody = { shippingServices: [{ shippingService: "USPSGroundAdvantage", description: "x", sellerOnlyField: "drop me" }] };

  it("plans both pinned reads, or only the pinned ones missed; refuses any other eBay miss", () => {
    assert.equal(ebayRecordPlan(null).todo.length, 2);
    const req = canonicalRequest({ method: "GET", path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", query: "category_id=261328" });
    const other = canonicalRequest({ method: "GET", path: "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", query: "category_id=1" });
    const bsc = canonicalRequest({ method: "GET", path: "marketplace/card/abc/card-listing" });
    const m = (r) => ({ ns: "x", key: requestKey(r), kind: "catalogue", method: "GET", path: r.path, request: r, count: 1 });
    const plan = ebayRecordPlan([m(req), m(other), m(bsc)]);
    assert.deepEqual(plan.todo.map((p) => p.endpoint), ["ebayItemAspects"]);
    assert.equal(plan.refused.length, 1);
    assert.match(plan.refused[0], /ebay_query_not_pinned/);
  });

  it("reads the sandbox with one user token, sanitises and uploads; only GETs go to eBay", async () => {
    const { api: a, stub } = api("sandbox", {
      "GET /sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services": () => ({ status: 200, body: shipBody }),
      "GET /commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category": () => ({ status: 200, body: { aspects: [{ localizedAspectName: "Sport", aspectValues: [{ localizedValue: "Baseball" }] }] } }),
    });
    const uploads = [];
    const report = [];
    const r = await runEbayRecord({ api: a, fake: { uploadRecording: async (x) => uploads.push(x) }, todo: ebayRecordPlan(null).todo, report: (l) => report.push(l) });
    assert.equal(r.recorded, 2);
    assert.deepEqual(uploads[0].response.body, { shippingServices: [{ shippingService: "USPSGroundAdvantage", description: "x" }] });
    assert.equal(uploads[1].request.path, "ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category");
    assert.deepEqual(uploads[1].request.query, [["category_id", "261328"]]);
    assert.ok(report.some((l) => l.includes("aspectValues")));
    assert.deepEqual(writesOf(stub.calls), []);
    assert.equal(stub.calls.find((c) => c.path.includes("get_item_aspects")).query.category_id, "261328");
  });
});

// ── Production capture ────────────────────────────────────────────────────

const PICTURE = { filename: "front.jpg", contentType: "image/jpeg", bytes: Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex") };

/** A production account where everything works; `over` replaces routes. */
function prodRoutes(over = {}) {
  const state = { item: false, offer: false, live: false };
  const routes = {
    [`GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => (state.item ? { status: 200, body: { sku: PRD_SKU } } : { status: 404, body: { errors: [{ errorId: 25710 }] } }),
    "GET /sell/inventory/v1/offer": () => (state.offer ? { status: 200, body: { offers: [{ offerId: "777", sku: PRD_SKU, status: state.live ? "PUBLISHED" : "UNPUBLISHED" }] } } : { status: 404, body: { errors: [{ errorId: 25713 }] } }),
    "GET /sell/account/v1/payment_policy": () => ({ status: 200, body: { total: 1, paymentPolicies: [{ paymentPolicyId: "11", name: "p" }] } }),
    "GET /sell/account/v1/return_policy": () => ({ status: 200, body: { total: 1, returnPolicies: [{ returnPolicyId: "22", name: "r" }] } }),
    "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, body: { total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "33", name: "f" }] } }),
    "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 200, body: { merchantLocationKey: "neonbinder-main", merchantLocationStatus: "ENABLED" } }),
    "POST /commerce/media/v1_beta/image/create_image_from_file": () => ({ status: 201, body: { imageUrl: "https://i.ebayimg.com/x.jpg", expirationDate: "2026-12-16T00:00:00.000Z" }, location: "https://apim.ebay.com/commerce/media/v1_beta/image/IMG1" }),
    "GET /commerce/media/v1_beta/image/IMG1": () => ({ status: 200, body: { imageUrl: "https://i.ebayimg.com/x.jpg", expirationDate: "2026-12-16T00:00:00.000Z" } }),
    "POST /sell/inventory/v1/bulk_create_or_replace_inventory_item": () => {
      state.item = true;
      return { status: 200, body: { responses: [{ statusCode: 200, sku: PRD_SKU, locale: "en_US" }] } };
    },
    "POST /sell/inventory/v1/bulk_create_offer": () => {
      state.offer = true;
      return { status: 200, body: { responses: [{ statusCode: 201, sku: PRD_SKU, offerId: "777" }] } };
    },
    "POST /sell/inventory/v1/offer/777/publish": () => {
      state.live = true;
      return { status: 200, body: { listingId: "110000000001", warnings: [] } };
    },
    "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 200, body: { responses: [{ statusCode: 200, sku: PRD_SKU, offerId: "777" }] } }),
    "POST /sell/inventory/v1/offer/777/withdraw": () => {
      if (!state.live) return { status: 404, body: { errors: [{ errorId: 25713 }] } };
      state.live = false;
      return { status: 200, body: { listingId: "110000000001", warnings: [] } };
    },
    [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => {
      if (!state.item) return { status: 404 };
      state.item = false;
      state.offer = false;
      return { status: 204 };
    },
  };
  for (const [k, v] of Object.entries(over)) routes[k] = typeof v === "function" ? (ctx) => v(ctx, state, routes) : v;
  return { routes, state };
}

function sink() {
  const stored = [];
  return { stored, uploadCapture: async (c) => (stored.push(c), { verdict: "ok", paths: [] }) };
}

describe("ebay-capture --prod: the plan", () => {
  it("the dry run prints exactly 7 requests that change the account, and sends nothing", async () => {
    const lines = prodPlanLines(PRD_SKU);
    assert.equal(lines.filter((l) => /^\d+\. /.test(l)).length, 7);
    assert.deepEqual(lines.filter((l) => /^\d+\. /.test(l)).map((l) => l.split(".")[0]), ["1", "2", "3", "4", "5", "6", "7"]);
    // Through the CLI: no credentials read, no fake called, nothing sent.
    const out = [];
    const write = process.stderr.write;
    process.stderr.write = (s) => (out.push(String(s)), true);
    try {
      const code = await ebayCapture(parseArgs(["ebay-capture", "--prod"]).flags, () => NOW);
      assert.equal(code, 0);
    } finally {
      process.stderr.write = write;
    }
    const numbered = out.join("").split("\n").filter((l) => /^\s+\d+\. /.test(l));
    assert.equal(numbered.length, 7);
    assert.match(out.join(""), /dry run: nothing sent/);
  });

  it("refuses any SKU but today's NBCAPTURE-PRD-<yyyymmdd>", async () => {
    assert.equal(captureSku("production", NOW), PRD_SKU);
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--prod", "--sku", "NB2-realcard-NM"]).flags, () => NOW), /refusing SKU/);
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--prod", "--sku", SBX_SKU]).flags, () => NOW), /refusing SKU/);
    const { api: a } = api("production", prodRoutes().routes);
    await assert.rejects(() => runProdCapture({ api: a, sink: null, sku: SBX_SKU, picture: PICTURE, report: () => {} }), /refusing SKU/);
    await assert.rejects(() => runProdCapture({ api: a, sink: null, sku: "NBCAPTURE-PRD-x", picture: PICTURE, report: () => {} }), /refusing SKU/);
    assert.throws(() => checkCaptureSku("production", "NB2-abc-NM"), /refusing SKU/);
  });
});

describe("ebay-capture --prod: the run", () => {
  it("happy path: the seven writes in order, the listing ended and deleted, captures stored after the cleanup", async () => {
    const { routes } = prodRoutes();
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(
      writesOf(stub.calls).map((c) => `${c.method} ${c.path}`),
      [
        "POST /commerce/media/v1_beta/image/create_image_from_file",
        "POST /sell/inventory/v1/bulk_create_or_replace_inventory_item",
        "POST /sell/inventory/v1/bulk_create_offer",
        "POST /sell/inventory/v1/offer/777/publish",
        "POST /sell/inventory/v1/bulk_update_price_quantity",
        "POST /sell/inventory/v1/offer/777/withdraw",
        `DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`,
      ],
    );
    assert.ok(stub.calls.every((c) => c.host.endsWith("ebay.com") && !c.host.includes("sandbox")));
    const priceBody = JSON.parse(writesOf(stub.calls)[4].body);
    assert.deepEqual(priceBody, { requests: [{ sku: PRD_SKU, offers: [{ offerId: "777", price: { value: "999.98", currency: "USD" } }] }] });
    const offerBody = JSON.parse(writesOf(stub.calls)[2].body).requests[0];
    assert.equal(offerBody.pricingSummary.price.value, "999.99");
    assert.equal(offerBody.availableQuantity, 1);
    const itemBody = JSON.parse(writesOf(stub.calls)[1].body).requests[0];
    assert.equal(itemBody.product.title, "NB capture test listing - not for sale");
    assert.equal(itemBody.availability.shipToLocationAvailability.quantity, 1);
    assert.deepEqual(
      s.stored.map((c) => c.endpoint),
      [
        "POST ebay/apim/commerce/media/v1_beta/image/create_image_from_file",
        "GET ebay/apim/commerce/media/v1_beta/image/:imageId",
        "POST ebay/api/sell/inventory/v1/bulk_create_or_replace_inventory_item",
        "POST ebay/api/sell/inventory/v1/bulk_create_offer",
        "POST ebay/api/sell/inventory/v1/offer/:offerId/publish",
        "POST ebay/api/sell/inventory/v1/bulk_update_price_quantity",
        "POST ebay/api/sell/inventory/v1/offer/:offerId/withdraw",
        "DELETE ebay/api/sell/inventory/v1/inventory_item/:sku",
      ],
    );
    // Shapes only: no value from eBay reaches the fake.
    const blob = JSON.stringify(s.stored);
    for (const v of ["110000000001", "777", "i.ebayimg.com", PRD_SKU]) assert.ok(!blob.includes(v), v);
  });

  for (const [what, over, reason] of [
    ["the SKU already has an item", { [`GET /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 200, body: { sku: PRD_SKU } }) }, /already exists/],
    ["the SKU already has an offer", { "GET /sell/inventory/v1/offer": () => ({ status: 200, body: { offers: [{ offerId: "1", status: "UNPUBLISHED" }] } }) }, /offer .* already exists/],
    ["the account has no fulfillment policy", { "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, body: { total: 0, fulfillmentPolicies: [] } }) }, /policy/],
    ["the location is disabled", { "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 200, body: { merchantLocationStatus: "DISABLED" } }) }, /location/],
    ["the location is missing", { "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 404, body: { errors: [{ errorId: 25804 }] } }) }, /location/],
  ]) {
    it(`the pre-check refuses, with nothing written, when ${what}`, async () => {
      const { routes } = prodRoutes(over);
      const { api: a, stub } = api("production", routes);
      const s = sink();
      const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
      assert.equal(out.ok, false);
      assert.equal(out.stage, "precheck");
      assert.match(out.reason, reason);
      assert.equal(out.writes, 0);
      assert.deepEqual(writesOf(stub.calls), []);
      assert.deepEqual(s.stored, []);
      assert.deepEqual(prodFailureLines(out, PRD_SKU), [`nothing written: ${out.reason}`]);
    });
  }

  it("the finally block withdraws and deletes after a later failure (price update refused), and stores nothing", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: { errors: [{ errorId: 25709 }] } }) });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    const w = writesOf(stub.calls).map((c) => `${c.method} ${c.path}`);
    assert.ok(w.includes("POST /sell/inventory/v1/offer/777/withdraw"));
    assert.ok(w.includes(`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`));
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.deepEqual(s.stored, []);
  });

  it("a 5xx after publish stops the run, and the cleanup still withdraws and deletes", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 503 }) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
  });

  it("a failure before publish deletes the item without a withdraw", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_create_offer": () => ({ status: 400, body: { responses: [{ statusCode: 400, errors: [{ errorId: 25709 }] }] } }) });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.cleanedUp, true);
    assert.equal(state.item, false);
    assert.ok(!writesOf(stub.calls).some((c) => c.path.endsWith("/withdraw")));
  });

  it("the cleanup tries at most three times, with one re-grant on a 401", async () => {
    let tries = 0;
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }),
      "POST /sell/inventory/v1/offer/777/withdraw": (_ctx, st) => {
        tries += 1;
        if (tries === 1) return { status: 401, body: { errors: [{ errorId: 1001 }] } };
        if (tries === 2) return { status: 500 };
        st.live = false;
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(tries, 3);
    assert.equal(stub.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length, 2, "the run's grant plus one re-grant");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
  });

  it("a withdraw that keeps failing is covered by the item delete, which ends the listing too", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }),
      "POST /sell/inventory/v1/offer/777/withdraw": () => ({ status: 500 }),
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.item, false);
    assert.equal(state.offer, false);
  });

  it("a cleanup that cannot finish exits with the listing id, the undo command and Seller Hub", async () => {
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }),
      "POST /sell/inventory/v1/offer/777/withdraw": () => ({ status: 500 }),
      // eBay's item delete also ends the item's offers and listing, so the
      // cleanup only fails to finish when both of its calls fail.
      [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 500 }),
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "cleanup");
    assert.equal(stub.calls.filter((c) => c.method === "DELETE").length, 3);
    assert.equal(out.cleanedUp, false);
    assert.equal(stub.calls.filter((c) => c.path.endsWith("/withdraw")).length, 3);
    const text = prodFailureLines(out, PRD_SKU).join("\n");
    assert.match(text, /110000000001/);
    assert.match(text, new RegExp(`ebay-undo --prod --sku ${PRD_SKU} --yes`));
    assert.match(text, /Seller Hub/);
  });
});

// ── Sandbox capture and undo ──────────────────────────────────────────────

function sandboxRoutes(over = {}) {
  const deleted = [];
  const routes = {
    "GET /commerce/identity/v1/user/": () => ({ status: 200, body: { userId: "u1", username: "sbx" } }),
    "GET /sell/account/v1/program/get_opted_in_programs": () => ({ status: 200, body: { programs: [{ programType: "SELLING_POLICY_MANAGEMENT" }] } }),
    "POST /sell/account/v1/program/opt_in": () => ({ status: 409, body: { errors: [{ errorId: 20409 }] } }),
    "GET /sell/account/v1/payment_policy": () => ({ status: 200, body: { total: 0, paymentPolicies: [] } }),
    "GET /sell/account/v1/return_policy": () => ({ status: 200, body: { total: 0, returnPolicies: [] } }),
    "GET /sell/account/v1/fulfillment_policy": () => ({ status: 200, body: { total: 1, fulfillmentPolicies: [{ fulfillmentPolicyId: "33", name: "f" }] } }),
    "POST /sell/account/v1/payment_policy": () => ({ status: 201, body: { paymentPolicyId: "41", name: "NBCAPTURE-SBX-20261116-pay" } }),
    "POST /sell/account/v1/return_policy": () => ({ status: 201, body: { returnPolicyId: "42", name: "NBCAPTURE-SBX-20261116-ret" } }),
    "POST /sell/inventory/v1/location/nbcapture-sbx-20261116": () => ({ status: 204 }),
    "POST /sell/inventory/v1/location/nbcapture-sbx-20261116/update_location_details": () => ({ status: 204 }),
    "POST /sell/inventory/v1/location/nbcapture-sbx-20261116/enable": () => ({ status: 200, body: {} }),
    "GET /sell/inventory/v1/location/nbcapture-sbx-20261116": () => ({ status: 200, body: { merchantLocationKey: "nbcapture-sbx-20261116", merchantLocationStatus: "ENABLED" } }),
    "POST /sell/inventory/v1/bulk_create_or_replace_inventory_item": () => ({ status: 200, body: { responses: [{ statusCode: 200, sku: SBX_SKU }] } }),
    "POST /sell/inventory/v1/bulk_create_offer": () => ({ status: 200, body: { responses: [{ statusCode: 201, sku: SBX_SKU, offerId: "9" }] } }),
    "PUT /sell/inventory/v1/offer/9": () => ({ status: 204 }),
    "GET /sell/inventory/v1/offer": () => ({ status: 200, body: { offers: [{ offerId: "9", sku: SBX_SKU, status: "UNPUBLISHED" }] } }),
    "POST /sell/inventory/v1/offer/9/publish": () => ({ status: 400, body: { errors: [{ errorId: 25007 }] } }),
    "GET /sell/fulfillment/v1/order": () => ({ status: 200, body: { total: 0, orders: [] } }),
    "GET /sell/inventory/v1/inventory_item": () => ({ status: 200, body: { total: 0, inventoryItems: [] } }),
    [`DELETE /sell/inventory/v1/inventory_item/${SBX_SKU}`]: () => (deleted.push("item"), { status: 204 }),
    "DELETE /sell/account/v1/payment_policy/41": () => (deleted.push("pay"), { status: 204 }),
    "DELETE /sell/account/v1/return_policy/42": () => (deleted.push("ret"), { status: 204 }),
    "DELETE /sell/inventory/v1/location/nbcapture-sbx-20261116": () => (deleted.push("loc"), { status: 204 }),
    ...over,
  };
  return { routes, deleted };
}

describe("ebay-capture (sandbox)", () => {
  it("captures reads and the writes the sandbox accepts, files the publish refusal as #25002, and removes everything", async () => {
    const { routes, deleted } = sandboxRoutes();
    const { api: a, stub } = api("sandbox", routes);
    const s = sink();
    const out = await runSandboxCapture({ api: a, sink: s, now: NOW, publicKeyId: null, report: () => {} });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(deleted.sort(), ["item", "loc", "pay", "ret"]);
    const names = s.stored.map((c) => c.endpoint);
    for (const n of [
      "POST ebay/api/identity/v1/oauth2/token #refresh_token",
      "POST ebay/api/identity/v1/oauth2/token #client_credentials",
      "POST ebay/api/sell/account/v1/program/opt_in #409",
      "POST ebay/api/sell/inventory/v1/offer/:offerId/publish #25002",
      "PUT ebay/api/sell/inventory/v1/offer/:offerId",
      "DELETE ebay/api/sell/inventory/v1/inventory_item/:sku",
      "GET ebay/api/sell/fulfillment/v1/order",
    ]) {
      assert.ok(names.includes(n), n);
    }
    assert.ok(stub.calls.every((c) => c.host.includes("sandbox")));
    assert.ok(!JSON.stringify(s.stored).includes("ACCESS"), "a token value never reaches the fake");
    assert.equal(stub.calls.find((c) => c.path === "/sell/fulfillment/v1/order").query.limit, "1");
  });

  it("stops on the first 401, still removes what it made, and stores nothing", async () => {
    const { routes, deleted } = sandboxRoutes({ "GET /sell/inventory/v1/location/nbcapture-sbx-20261116": () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }) });
    const { api: a } = api("sandbox", routes);
    const s = sink();
    const out = await runSandboxCapture({ api: a, sink: s, now: NOW, publicKeyId: null, report: () => {} });
    assert.equal(out.ok, false);
    assert.match(out.reason, /unauthorized/);
    assert.deepEqual(s.stored, []);
    assert.deepEqual(deleted.sort(), ["loc", "pay", "ret"]);
  });
});

describe("ebay-undo", () => {
  it("refuses a SKU outside the environment's capture prefix", async () => {
    const { api: prod } = api("production", {});
    await assert.rejects(() => runEbayUndo(prod, SBX_SKU), /refusing SKU/);
    await assert.rejects(() => runEbayUndo(prod, "NB2-realcard-NM"), /refusing SKU/);
    const { api: sbx } = api("sandbox", {});
    await assert.rejects(() => runEbayUndo(sbx, PRD_SKU), /refusing SKU/);
    await assert.rejects(() => ebayUndo(parseArgs(["ebay-undo", "--prod", "--sku", "NB2-x-NM"]).flags), /refusing SKU/);
    await assert.rejects(() => ebayUndo(parseArgs(["ebay-undo", "--sku", PRD_SKU]).flags), /exactly one of/);
  });

  it("withdraws the live offer, deletes the item, and verifies", async () => {
    const { routes, state } = prodRoutes();
    state.item = true;
    state.offer = true;
    state.live = true;
    const { api: a } = api("production", routes);
    const out = await runEbayUndo(a, PRD_SKU);
    assert.equal(out.ok, true, out.lines.join("\n"));
    assert.equal(state.live, false);
    assert.equal(state.item, false);
  });
});

// ── Adversarial pass (NEO-555 PR A): the production capture ────────────────

describe("ebay-capture --prod (adversarial): the SKU gate", () => {
  const bypasses = [
    ["lower case", "nbcapture-prd-20261116"],
    ["leading space", ` ${PRD_SKU}`],
    ["trailing space", `${PRD_SKU} `],
    ["trailing newline", `${PRD_SKU}\n`],
    ["trailing NUL", `${PRD_SKU}\u0000`],
    ["no-break space", `${PRD_SKU} `],
    ["zero-width space inside", "NBCAPTURE-​PRD-20261116"],
    ["full-width digits", "NBCAPTURE-PRD-２０２６１１１６"],
    ["Arabic-Indic digits", "NBCAPTURE-PRD-٢٠٢٦١١١٦"],
    ["Cyrillic B", "NВCAPTURE-PRD-20261116"],
    ["seven digits", "NBCAPTURE-PRD-2026111"],
    ["nine digits", "NBCAPTURE-PRD-202611161"],
    ["suffix", `${PRD_SKU}-x`],
    ["prefix", `x${PRD_SKU}`],
    ["a path", `${PRD_SKU}/../NB2-realcard-NM`],
    ["a query", `${PRD_SKU}?x=1`],
    ["the sandbox form", SBX_SKU],
    ["an NB listing SKU", "NB2-realcard-NM"],
    ["empty", ""],
  ];

  it("refuses every look-alike in the prod capture and the prod undo, and sends nothing", async () => {
    for (const [what, sku] of bypasses) {
      const { routes } = prodRoutes();
      const { api: a, stub } = api("production", routes);
      await assert.rejects(() => runProdCapture({ api: a, sink: null, sku, picture: PICTURE, report: () => {} }), /refusing SKU/, what);
      await assert.rejects(() => runEbayUndo(a, sku), /refusing SKU/, what);
      assert.throws(() => checkCaptureSku("production", sku), /refusing SKU/, what);
      assert.equal(stub.calls.length, 0, `${what}: a request was sent`);
    }
  });

  it("the sandbox form is refused on production and the production form on the sandbox", () => {
    assert.throws(() => checkCaptureSku("production", SBX_SKU), /refusing SKU/);
    assert.throws(() => checkCaptureSku("sandbox", PRD_SKU), /refusing SKU/);
    assert.doesNotThrow(() => checkCaptureSku("production", PRD_SKU));
    assert.doesNotThrow(() => checkCaptureSku("sandbox", SBX_SKU));
  });

  it("the CLI refuses a --sku that is not today's, even a well-formed capture SKU from another day", async () => {
    await assert.rejects(() => ebayCapture(parseArgs(["ebay-capture", "--prod", "--sku", "NBCAPTURE-PRD-20250101", "--yes"]).flags, () => NOW), /refusing SKU/);
  });
});

describe("ebay-capture --prod (adversarial): at most one listing, always cleaned up", () => {
  const publishesOf = (calls) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/publish"));

  it("the happy path sends exactly one publish and one bulk_create_offer", async () => {
    const { routes } = prodRoutes();
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, true);
    assert.equal(publishesOf(stub.calls).length, 1);
    assert.equal(stub.calls.filter((c) => c.path.endsWith("/bulk_create_offer")).length, 1);
  });

  it("a publish that answers 200 with no listingId still gets the offer withdrawn and the item deleted", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), { status: 200, body: { warnings: [] } }),
    });
    const { api: a, stub } = api("production", routes);
    const s = sink();
    const out = await runProdCapture({ api: a, sink: s, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false, "the listing is still live");
    assert.equal(state.item, false);
    assert.equal(publishesOf(stub.calls).length, 1);
    assert.deepEqual(s.stored, []);
  });

  it("a publish with an empty body (2xx) is the same", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), { status: 200 }) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
  });

  it("a timeout AFTER eBay published (the answer never arrives) still ends the listing", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), Object.assign(new Error("timed out"), { name: "TimeoutError" })),
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false, "the listing is still live");
    assert.equal(state.item, false);
    assert.equal(publishesOf(stub.calls).length, 1, "the publish was not retried");
  });

  it("a network drop on the publish answer is the same", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/offer/777/publish": (_c, st) => ((st.live = true), new TypeError("fetch failed")) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
  });

  it("a 401 on the main-path withdraw is recovered by the cleanup's one re-grant", async () => {
    const { routes, state } = prodRoutes({
      "POST /sell/inventory/v1/offer/777/withdraw": (ctx, st) => {
        const grants = ctx.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length;
        if (grants < 2) return { status: 401, body: { errors: [{ errorId: 1001 }] } };
        st.live = false;
        return { status: 200, body: { listingId: "110000000001" } };
      },
    });
    const { api: a, stub } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.stage, "write");
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
    assert.equal(stub.calls.filter((c) => c.path === "/identity/v1/oauth2/token").length, 2);
    assert.equal(publishesOf(stub.calls).length, 1);
  });

  it("a 401 on the withdraw with a re-grant eBay refuses ends in an unverified cleanup carrying the listing id", async () => {
    let grants = 0;
    const { routes } = prodRoutes({
      "POST /identity/v1/oauth2/token": () => (++grants === 1 ? tokenOk() : { status: 400, body: { error: "invalid_grant" } }),
      "POST /sell/inventory/v1/offer/777/withdraw": () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }),
      [`DELETE /sell/inventory/v1/inventory_item/${PRD_SKU}`]: () => ({ status: 401, body: { errors: [{ errorId: 1001 }] } }),
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: () => {} });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, false);
    assert.equal(out.listingId, "110000000001");
    assert.match(prodFailureLines(out, PRD_SKU).join("\n"), /COULD NOT BE VERIFIED/);
  });

  it("a report callback that throws (a closed stdout) cannot skip the cleanup", async () => {
    const { routes, state } = prodRoutes({ "POST /sell/inventory/v1/bulk_update_price_quantity": () => ({ status: 400, body: {} }) });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({
      api: a,
      sink: sink(),
      sku: PRD_SKU,
      picture: PICTURE,
      report: () => {
        throw new Error("EPIPE");
      },
    });
    assert.equal(out.ok, false);
    assert.equal(out.cleanedUp, true);
    assert.equal(state.live, false);
    assert.equal(state.item, false);
  });

  it("a stop signal during the run is held off until the cleanup is done, and the handlers are removed after", async () => {
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
    const before = signals.map((s) => process.listenerCount(s));
    let during = null;
    const lines = [];
    const { routes } = prodRoutes({
      "POST /sell/inventory/v1/bulk_update_price_quantity": () => {
        during = signals.map((s) => process.listenerCount(s));
        process.emit("SIGINT");
        return { status: 200, body: { responses: [{ statusCode: 200 }] } };
      },
    });
    const { api: a } = api("production", routes);
    const out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l) });
    assert.equal(out.ok, true);
    assert.deepEqual(during, before.map((n) => n + 1));
    assert.ok(lines.some((l) => /interrupt ignored/.test(l)));
    assert.deepEqual(signals.map((s) => process.listenerCount(s)), before);
  });

  it("the handlers are removed even when the run throws", async () => {
    const before = process.listenerCount("SIGINT");
    const { routes } = prodRoutes({ "GET /sell/inventory/v1/location/neonbinder-main": () => ({ status: 401, body: {} }) });
    const { api: a } = api("production", routes);
    await assert.rejects(() => runProdCapture({ api: a, sink: null, sku: PRD_SKU, picture: PICTURE, report: () => {} }));
    assert.equal(process.listenerCount("SIGINT"), before);
  });
});

describe("ebay-capture --prod (adversarial): nothing secret in reports or errors", () => {
  const SECRETS = [REFRESH, CERT, "ACCESS", Buffer.from(`NB-app-id:${CERT}`).toString("base64")];
  const leaky = () =>
    Object.assign(new TypeError(`fetch failed: Bearer v^1.1#ACCESS ${REFRESH} ${CERT}`), {
      cause: Object.assign(new Error(`${REFRESH} ${CERT}`), { request: { headers: { authorization: "Bearer v^1.1#ACCESS" } } }),
    });
  const body = (t) => `${t.map(String).join("\n")}`;

  async function runAndCollect(routes, over = {}) {
    const { api: a } = api("production", routes, over);
    const lines = [];
    let out;
    let thrown = null;
    try {
      out = await runProdCapture({ api: a, sink: sink(), sku: PRD_SKU, picture: PICTURE, report: (l) => lines.push(l) });
    } catch (err) {
      thrown = err;
    }
    const failure = out && !out.ok ? prodFailureLines(out, PRD_SKU) : [];
    const text = [...lines, ...failure, thrown ? `${thrown.name}: ${thrown.message}` : "", JSON.stringify(out ?? {})].join("\n");
    a.forget();
    return text;
  }

  it("a fetch error whose message and cause carry the token, cert and refresh token is reduced to a class", async () => {
    for (const path of ["bulk_create_offer", "offer/777/publish", "offer/777/withdraw", "bulk_update_price_quantity"]) {
      const { routes } = prodRoutes({ [`POST /sell/inventory/v1/${path}`]: (_c, st) => ((st.live = path.includes("publish") ? true : st.live), leaky()) });
      const text = await runAndCollect(routes);
      for (const v of SECRETS) assert.ok(!text.includes(v), `${path}: leaked ${v.slice(0, 8)}`);
      assert.match(text, /network/);
    }
  });

  it("a response body that fails mid-read (its error names the secrets) is a stop, not a raw error", async () => {
    const { routes } = prodRoutes();
    const stub = stubEbay({ "POST /identity/v1/oauth2/token": tokenOk, ...routes });
    const fetchImpl = async (url, init) => {
      if (new URL(url).pathname.endsWith("/publish")) {
        return { status: 200, headers: new Headers(), arrayBuffer: async () => Promise.reject(new Error(`terminated ${REFRESH} ${CERT} Bearer v^1.1#ACCESS`)) };
      }
      return stub.fetchImpl(url, init);
    };
    const text = await runAndCollect(routes, { fetchImpl });
    for (const v of SECRETS) assert.ok(!text.includes(v), `leaked ${v.slice(0, 8)}`);
    assert.match(text, /network/);
  });

  it("a refused token grant names a status and nothing else", async () => {
    const { routes } = prodRoutes({ "POST /identity/v1/oauth2/token": () => ({ status: 400, body: { error: "invalid_grant", error_description: `bad ${REFRESH}` } }) });
    const { api: a } = api("production", routes);
    let msg = "";
    try {
      await runProdCapture({ api: a, sink: null, sku: PRD_SKU, picture: PICTURE, report: () => {} });
    } catch (err) {
      msg = String(err.message);
    }
    assert.match(msg, /token_refused/);
    for (const v of SECRETS) assert.ok(!msg.includes(v));
    void body;
  });

  it("the production credential reader never quotes a value, even when the stored session is malformed", async () => {
    const reads = [CERT, `{"refreshToken": "${REFRESH}" broken`];
    let i = 0;
    await assert.rejects(
      () => readProductionCreds({ clientId: "NB-app-id", certSecret: "cert-secret", sessionSecret: "session-secret", project: "some-project-1", read: async () => reads[i++] }),
      (err) => !SECRETS.some((v) => String(err.message).includes(v)) && /not JSON/.test(err.message),
    );
    for (const bad of ['{"refreshToken": "has space"}', '{"refreshToken": 7}', '{"refreshToken": ""}', "[]", "null"]) {
      let n = 0;
      await assert.rejects(
        () => readProductionCreds({ clientId: "NB-app-id", certSecret: "cert-secret", sessionSecret: "session-secret", project: "some-project-1", read: async () => (n++ === 0 ? CERT : bad) }),
        (err) => !SECRETS.some((v) => String(err.message).includes(v)),
        bad,
      );
    }
  });
});
