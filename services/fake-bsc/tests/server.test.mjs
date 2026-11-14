// The fake over real HTTP on a loopback port: auth, replay and misses,
// recording uploads, synthesis, faults, write captures and drift.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  ADMIN_KEY,
  AUDIENCE,
  CALLER,
  CALLER_KEY,
  FILTERS_PATH,
  LOADER,
  RESULTS_PATH,
  STRANGER,
  idToken,
  rawResultsRow,
  resultsBody,
  startFake,
} from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { requestKey } = require("../dist/src/requestKey.js");
const { sanitiseCatalogue, SANITISE_ALLOWLIST_VERSION } = require("../dist/src/sanitise.js");
const { checkCapture, synthesisedWrite } = require("../dist/src/captures.js");
const { shapeOf } = require("../dist/src/shape.js");
const { readHeaderScope } = require("../dist/src/namespace.js");

const NS = "happy-cat-123-w0";
const BSC = `tok-${NS}`;
const FILTERS = { sport: ["baseball"], year: ["1996"], setName: ["score"] };

function recording(path, method, body, responseBody, status = 200) {
  return { request: { method, path, query: [], body }, response: { status, body: responseBody }, allowlistVersion: SANITISE_ALLOWLIST_VERSION };
}

function cleanRows() {
  return sanitiseCatalogue("results", [rawResultsRow("c1", "1", "Ken Griffey Jr."), rawResultsRow("c2", "2", "Cal Ripken Jr.")]).value;
}

describe("auth", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("refuses a missing or wrong caller key", async () => {
    let res = await fetch(`${fake.base}/healthz`);
    assert.equal(res.status, 401);
    res = await fetch(`${fake.base}/healthz`, { headers: { "x-nb-fake-bsc-key": "nope".repeat(10), "x-nb-fake-id-token": idToken(CALLER) } });
    assert.equal(res.status, 401);
  });

  it("refuses a missing, unverified, expired, wrong-audience or unverified-email ID token", async () => {
    const cases = [
      undefined,
      `Bearer ${idToken(CALLER, { sig: "forged" })}`,
      `Bearer ${idToken(CALLER, { exp: 1 })}`,
      `Bearer ${idToken(CALLER, { aud: "https://other.run.app" })}`,
      `Bearer ${idToken(CALLER, { iss: "https://evil.example" })}`,
      `Bearer ${idToken(CALLER, { verified: false })}`,
      // Unsigned (the shape Cloud Run forwards in X-Serverless-Authorization).
      `Bearer ${idToken(CALLER, { sig: "" })}`,
      idToken(CALLER, { sig: "" }).replace(/\.$/, ""),
      "Bearer not-a-jwt",
    ];
    for (const h of cases) {
      const res = await fetch(`${fake.base}/healthz`, { headers: { "x-nb-fake-bsc-key": CALLER_KEY, ...(h ? { "x-nb-fake-id-token": h } : {}) } });
      assert.equal(res.status, 401, String(h));
    }
  });

  it("refuses a verified caller who is not on the allowed list", async () => {
    const r = await fake.call("GET", "/healthz", { email: STRANGER });
    assert.equal(r.status, 403);
  });

  it("answers health to an allowed caller", async () => {
    const r = await fake.call("GET", "/healthz");
    assert.equal(r.status, 200);
    assert.equal(r.body.instanceId, "test-instance");
    assert.equal(r.body.allowlistVersion, SANITISE_ALLOWLIST_VERSION);
  });

  it("needs the admin key AND an admin caller for admin endpoints", async () => {
    assert.equal((await fake.call("GET", "/__fake/recordings", { email: CALLER })).status, 403);
    assert.equal((await fake.call("GET", "/__fake/recordings", { email: CALLER, admin: true })).status, 403);
    assert.equal((await fake.call("GET", "/__fake/recordings", { email: LOADER })).status, 403);
    assert.equal((await fake.call("GET", "/__fake/recordings", { email: LOADER, admin: true })).status, 200);
  });

  it("lets a plain caller read misses by prefix, and nothing broader", async () => {
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=happy-cat-123-")).status, 200);
    assert.equal((await fake.call("GET", "/__fake/misses")).status, 400);
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=h")).status, 400);
  });

  it("answers 401 to a seller call with no fake BSC token", async () => {
    assert.equal((await fake.call("GET", "/api/marketplace/user/profile")).status, 401);
    assert.equal((await fake.call("GET", "/api/marketplace/user/profile", { bsc: "not-ours" })).status, 401);
  });
});

describe("cloud run identity", () => {
  // As deployed: K_SERVICE set. IAM is the outer layer, but the fake never
  // trusts X-Serverless-Authorization (its signature is stripped, so its
  // claims are forgeable if IAM is ever loosened).
  let fake;
  before(async () => (fake = await startFake({ configOver: { K_SERVICE: "fake-bsc", FAKE_BSC_BUCKET: "b" } })));
  after(() => fake.close());
  const health = (headers) => fetch(`${fake.base}/healthz`, { headers: { "x-nb-fake-bsc-key": CALLER_KEY, ...headers } });

  it("refuses a forged unsigned token in either header", async () => {
    const forged = idToken(CALLER, { sig: "" });
    assert.equal((await health({ "X-Serverless-Authorization": `Bearer ${forged}` })).status, 401);
    assert.equal((await health({ "x-nb-fake-id-token": forged })).status, 401);
    assert.equal((await health({ "x-nb-fake-id-token": forged.replace(/\.$/, "") })).status, 401);
  });

  it("refuses a call with no x-nb-fake-id-token, whatever X-Serverless-Authorization says", async () => {
    assert.equal((await health({ "X-Serverless-Authorization": `Bearer ${idToken(CALLER)}` })).status, 401);
  });

  it("takes the caller only from the verified x-nb-fake-id-token", async () => {
    // A stranger's verified token with an allowed caller's unsigned header: refused.
    const r = await health({ "x-nb-fake-id-token": idToken(STRANGER), "X-Serverless-Authorization": `Bearer ${idToken(CALLER, { sig: "" })}` });
    assert.equal(r.status, 403);
    assert.equal((await health({ "x-nb-fake-id-token": `Bearer ${idToken(CALLER)}` })).status, 200);
  });

  it("verifies every token against the audience, and has none to verify without one", async () => {
    const { callerIdentity } = require("../dist/src/auth.js");
    let asked = null;
    const spy = async (token, aud) => {
      asked = aud;
      return token.endsWith(".valid") ? JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) : null;
    };
    assert.deepEqual(await callerIdentity(idToken(CALLER), { audience: AUDIENCE }, spy), { ok: true, email: CALLER });
    assert.equal(asked, AUDIENCE);
    assert.equal((await callerIdentity(idToken(CALLER), { audience: null }, spy)).reason, "no_audience_configured");
    assert.equal((await callerIdentity(idToken(CALLER, { sig: "" }), { audience: AUDIENCE }, spy)).reason, "malformed_id_token");
  });
});

describe("config fails closed", () => {
  const { readConfig } = require("../dist/src/config.js");
  const base = {
    FAKE_BSC_CALLER_KEY: CALLER_KEY,
    FAKE_BSC_ADMIN_KEY: ADMIN_KEY,
    FAKE_BSC_ALLOWED_CALLERS: CALLER,
  };
  it("refuses the local bypass on Cloud Run", () => {
    assert.throws(() => readConfig({ ...base, FAKE_BSC_LOCAL_DEV_BYPASS: "1", K_SERVICE: "fake-bsc", FAKE_BSC_BUCKET: "b" }), /K_SERVICE/);
  });
  it("refuses short or equal keys, an empty caller list, and Cloud Run without a bucket", () => {
    assert.throws(() => readConfig({ ...base, FAKE_BSC_CALLER_KEY: "short" }));
    assert.throws(() => readConfig({ ...base, FAKE_BSC_ADMIN_KEY: CALLER_KEY }));
    assert.throws(() => readConfig({ ...base, FAKE_BSC_ALLOWED_CALLERS: "" }));
    assert.throws(() => readConfig({ ...base, K_SERVICE: "fake-bsc", FAKE_BSC_AUDIENCE: AUDIENCE }), /BUCKET/);
    assert.throws(() => readConfig({ ...base, FAKE_BSC_ADMIN_CALLERS: STRANGER }));
  });
  it("requires FAKE_BSC_AUDIENCE as an origin, on Cloud Run too", () => {
    assert.throws(() => readConfig({ ...base, K_SERVICE: "fake-bsc", FAKE_BSC_BUCKET: "b" }), /AUDIENCE/);
    assert.throws(() => readConfig(base), /AUDIENCE/);
    assert.throws(() => readConfig({ ...base, FAKE_BSC_AUDIENCE: "https://x.run.app/api" }), /origin/);
    assert.equal(readConfig({ ...base, K_SERVICE: "fake-bsc", FAKE_BSC_BUCKET: "b", FAKE_BSC_AUDIENCE: AUDIENCE }).audience, AUDIENCE);
  });
  it("allows the bypass locally", () => {
    const c = readConfig({ ...base, FAKE_BSC_ALLOWED_CALLERS: "", FAKE_BSC_LOCAL_DEV_BYPASS: "1" });
    assert.equal(c.localDevBypass, true);
  });
});

describe("replay, misses and uploads", () => {
  let fake;
  beforeEach(async () => {
    if (fake) await fake.close();
    fake = await startFake();
  });
  after(() => fake.close());

  it("answers 501 + x-nb-fake: unrecorded and lists the miss under the namespace", async () => {
    const r = await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body: { filters: { sport: ["baseball"] } } });
    assert.equal(r.status, 501);
    assert.equal(r.headers.get("x-nb-fake"), "unrecorded");
    const m = await fake.call("GET", `/__fake/misses?prefix=happy-cat-`);
    assert.equal(m.body.misses.length, 1);
    const miss = m.body.misses[0];
    assert.equal(miss.ns, NS);
    assert.equal(miss.kind, "catalogue");
    assert.equal(miss.endpoint, "filters");
    assert.equal(miss.key, requestKey({ method: "POST", path: FILTERS_PATH, body: { filters: { sport: ["baseball"] } } }));
    assert.deepEqual(miss.request.body, { filters: { sport: ["baseball"] } });
    // A second identical miss counts, not duplicates.
    await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body: { filters: { sport: ["baseball"] } } });
    assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses[0].count, 2);
    // Other namespaces don't see it.
    assert.equal((await fake.call("GET", `/__fake/misses?prefix=other-slug-`)).body.misses.length, 0);
  });

  it("serves an uploaded recording and clears its miss; shows a near-miss diff as paths", async () => {
    const body = { filters: { sport: ["baseball"] } };
    await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body });
    const answer = { aggregations: { year: [{ label: "1996", slug: "1996", count: 4, active: false }] } };
    const up = await fake.call("POST", "/__fake/recordings", { email: LOADER, admin: true, body: { recordings: [recording(FILTERS_PATH, "POST", body, answer)] } });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.manifestVersion, 1);
    const r = await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, answer);
    assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses.length, 0);

    await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body: { filters: { sport: ["football"] } } });
    const miss = (await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses[0];
    assert.deepEqual(miss.nearMiss.diffPaths, ["body.filters.sport"]);
  });

  it("refuses an upload carrying anything outside the allowlist, naming paths only", async () => {
    const body = resultsBody(FILTERS);
    const raw = [rawResultsRow("c1", "1", "Ken Griffey Jr.")];
    const up = await fake.call("POST", "/__fake/recordings", { email: LOADER, admin: true, body: { recordings: [recording(RESULTS_PATH, "POST", body, raw)] } });
    assert.equal(up.status, 400);
    assert.equal(up.body.reason, "outside_allowlist");
    assert.deepEqual(up.body.droppedPaths, ["[].imgFront", "[].seller", "[].sellerId"]);
    assert.ok(!JSON.stringify(up.body).includes("someone@example.com"));
    assert.equal(fake.catalogue.size, 0);
  });

  it("refuses nested PII hidden under an allowed name on upload", async () => {
    const answer = { teamName: { name: "Mariners", owner: { email: "x@y.co" } } };
    const up = await fake.call("POST", "/__fake/recordings", {
      email: LOADER,
      admin: true,
      body: { recordings: [recording("marketplace/card/c1/card-listing", "GET", undefined, answer)] },
    });
    assert.equal(up.status, 400);
    assert.deepEqual(up.body.droppedPaths, ["teamName"]);
  });

  it("refuses a non-catalogue endpoint, a wrong key, a wrong allowlist version and a 5xx", async () => {
    const bad = [
      recording("seller/bulk-upload/results", "POST", {}, []),
      { ...recording(FILTERS_PATH, "POST", {}, {}), key: "0".repeat(64) },
      { ...recording(FILTERS_PATH, "POST", {}, {}), allowlistVersion: SANITISE_ALLOWLIST_VERSION + 1 },
      recording(FILTERS_PATH, "POST", {}, null, 503),
    ];
    const reasons = [];
    for (const rec of bad) {
      const up = await fake.call("POST", "/__fake/recordings", { email: LOADER, admin: true, body: { recordings: [rec] } });
      assert.equal(up.status, 400);
      reasons.push(up.body.reason);
    }
    assert.deepEqual(reasons, ["not_a_catalogue_endpoint", "key_mismatch", "allowlist_version", "status_not_recordable"]);
  });

  it("serves card-listing without a BSC token, and a recorded 404 as a 404", async () => {
    await fake.call("POST", "/__fake/recordings", {
      email: LOADER,
      admin: true,
      body: { recordings: [recording("marketplace/card/c1/card-listing", "GET", undefined, { teamName: "Seattle Mariners" }), recording("marketplace/card/gone/card-listing", "GET", undefined, null, 404)] },
    });
    const r = await fake.call("GET", "/api/marketplace/card/c1/card-listing");
    assert.deepEqual(r.body, { teamName: "Seattle Mariners" });
    assert.equal((await fake.call("GET", "/api/marketplace/card/gone/card-listing")).status, 404);
    // An anonymous miss is listed under every prefix.
    await fake.call("GET", "/api/marketplace/card/c9/card-listing");
    const misses = (await fake.call("GET", "/__fake/misses?prefix=any-slug-")).body.misses;
    assert.equal(misses.length, 1);
    assert.equal(misses[0].ns, null);
  });

  it("lists an unmodelled endpoint as needs-model, keeping no body", async () => {
    const r = await fake.call("POST", "/api/seller/something/new", { bsc: BSC, body: { secret: "do-not-keep" } });
    assert.equal(r.status, 501);
    assert.equal(r.headers.get("x-nb-fake"), "unrecorded");
    const m = (await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses[0];
    assert.equal(m.kind, "needs-model");
    assert.equal(m.request, undefined);
    assert.ok(!JSON.stringify(m).includes("do-not-keep"));
  });
});

describe("seller synthesis", () => {
  let fake;
  const sellerId = async () => (await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC })).body.sellerProfile.sellerId;
  const sheet = (condition) =>
    fake.call("POST", "/api/seller/bulk-upload/results", {
      bsc: BSC,
      body: { condition, currentListings: true, productType: "raw", page: 0, size: 5000, sort: "default", filters: FILTERS },
    });

  beforeEach(async () => {
    if (fake) await fake.close();
    fake = await startFake();
  });
  after(() => fake.close());

  it("synthesises a stable per-namespace profile in the shape NB reads", async () => {
    const p = (await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC })).body;
    assert.match(p.sellerProfile.sellerId, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(typeof p.sellerProfile.sellerStoreName, "string");
    const other = (await fake.call("GET", "/api/marketplace/user/profile", { bsc: "tok-other-slug-w1" })).body;
    assert.notEqual(other.sellerProfile.sellerId, p.sellerProfile.sellerId);
    assert.equal(await sellerId(), p.sellerProfile.sellerId);
  });

  it("asks for the catalogue recording when the sheet's filters are unrecorded", async () => {
    const r = await sheet("near_mint");
    assert.equal(r.status, 501);
    const miss = (await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses[0];
    assert.equal(miss.endpoint, "results");
    assert.equal(miss.key, requestKey({ method: "POST", path: RESULTS_PATH, body: resultsBody(FILTERS) }));
  });

  it("answers BSC's 500 for a sheet with no condition", async () => {
    const r = await fake.call("POST", "/api/seller/bulk-upload/results", { bsc: BSC, body: { filters: FILTERS } });
    assert.equal(r.status, 500);
  });

  it("builds the sheet from the recorded catalogue, overlays listings, and mints template productIds per read", async () => {
    fake.catalogue.primeForTests([
      { key: requestKey({ method: "POST", path: RESULTS_PATH, body: resultsBody(FILTERS) }), allowlistVersion: 1, endpoint: "results", request: { method: "POST", path: RESULTS_PATH, query: [], body: resultsBody(FILTERS) }, response: { status: 200, body: cleanRows() }, recordedAt: new Date().toISOString() },
    ]);
    const first = (await sheet("near_mint")).body;
    assert.equal(first.length, 2);
    for (const row of first) {
      assert.equal(row.card.id, row.cardId);
      assert.equal(row.availableQuantity, 0);
      assert.equal(row.price, "0");
      assert.equal(row.condition, "near_mint");
      assert.ok(row.sellerImgFront.includes("Default"));
    }
    const again = (await sheet("near_mint")).body;
    assert.notEqual(again[0].productId, first[0].productId, "a template mints a new productId on each read");

    const id = await sellerId();
    const put = await fake.call("PUT", "/api/seller/bulk-upload", {
      bsc: BSC,
      body: { sellerId: id, listings: [{ ...first[0], availableQuantity: 3, price: 0.5, sellerSku: "303|1" }] },
    });
    assert.equal(put.status, 200);
    const after = (await sheet("near_mint")).body;
    const listed = after.find((r) => r.cardId === "c1");
    assert.equal(listed.availableQuantity, 3);
    assert.equal(listed.price, "0.50");
    assert.equal(listed.sellerSku, "303|1");
    assert.equal(listed.card.cardNo, "1");
    const stable = (await sheet("near_mint")).body.find((r) => r.cardId === "c1");
    assert.equal(stable.productId, listed.productId, "a listing keeps its productId");
    // Another condition, and "all", do not show it.
    assert.equal((await sheet("excellent")).body.find((r) => r.cardId === "c1").availableQuantity, 0);
    assert.equal((await sheet("all")).body.find((r) => r.cardId === "c1").availableQuantity, 0);

    // Quantity 0 removes it: the card is a template again.
    await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId: id, listings: [{ ...listed, availableQuantity: 0 }] } });
    assert.equal((await sheet("near_mint")).body.find((r) => r.cardId === "c1").availableQuantity, 0);
    // State is per namespace.
    const otherSheet = await fake.call("POST", "/api/seller/bulk-upload/results", { bsc: "tok-other-slug-w1", body: { condition: "near_mint", filters: FILTERS } });
    assert.equal(otherSheet.status, 200);
  });

  it("refuses a PUT for another seller, a bad row, and too many rows", async () => {
    const id = await sellerId();
    const row = { cardId: "c1", condition: "near_mint", availableQuantity: 1, price: "0.25" };
    assert.equal((await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId: "someone-else", listings: [row] } })).status, 403);
    assert.equal((await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId: id, listings: [{ ...row, availableQuantity: -1 }] } })).status, 400);
    assert.equal((await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId: id, listings: Array(101).fill(row) } })).status, 400);
    assert.equal(fake.state.get(NS).listings.size, 0);
  });

  it("answers a repeated (card, condition) in one PUT with BSC's half-applied 500", async () => {
    const id = await sellerId();
    const a = { cardId: "c1", condition: "near_mint", availableQuantity: 1, price: "0.25" };
    const b = { cardId: "c2", condition: "near_mint", availableQuantity: 2, price: "0.25" };
    const r = await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId: id, listings: [a, b, { ...a, availableQuantity: 5 }] } });
    assert.equal(r.status, 500);
    const listings = fake.state.get(NS).listings;
    assert.equal(listings.size, 2);
    assert.equal(listings.get("c1|near_mint").availableQuantity, 1);
  });

  it("takes a multipart photo and answers an object key", async () => {
    const form = new FormData();
    form.append("attachment", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "front.jpg");
    const res = await fetch(`${fake.base}/api/common/card/undefined/product/undefined/attachment`, { method: "POST", headers: fake.headers(CALLER, { bsc: BSC }), body: form });
    assert.equal(res.status, 200);
    const { objectKey } = await res.json();
    assert.match(objectKey, /^[A-Za-z0-9._\-/]{1,300}$/);
    const bad = await fetch(`${fake.base}/api/common/card/undefined/product/undefined/attachment`, { method: "POST", headers: { ...fake.headers(CALLER, { bsc: BSC }), "content-type": "application/json" }, body: "{}" });
    assert.equal(bad.status, 400);
  });

  it("starts with no orders and serves injected ones in BSC's wire shape, lowering listings", async () => {
    const empty = (await fake.call("POST", "/api/seller/order/history", { bsc: BSC, body: { page: 0, size: 50, status: [] } })).body;
    assert.deepEqual(empty, { totalElements: 0, results: [] });
    const id = await sellerId();
    await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId: id, listings: [{ cardId: "c1", condition: "near_mint", availableQuantity: 3, price: "0.50", sellerSku: "303|1" }] } });

    const add = await fake.call("POST", "/__fake/orders", { body: { ns: NS, order: { items: [{ cardId: "c1", condition: "near_mint", quantity: 2 }] } } });
    assert.equal(add.status, 200);
    const { orderId } = add.body.orders[0];
    assert.equal(add.body.orderId, orderId);
    assert.deepEqual(add.body.orderIds, [orderId]);
    assert.deepEqual(add.body.orders[0].items, [{ cardId: "c1", condition: "near_mint", quantity: 2, priceCents: 50, sellerSku: "303|1" }]);
    assert.equal(add.body.orders[0].status, "READY_TO_SHIP");
    const hist = (await fake.call("POST", "/api/seller/order/history", { bsc: BSC, body: { page: 0, size: 50, status: [] } })).body;
    assert.equal(hist.totalElements, 1);
    assert.equal(hist.results[0].orderId, orderId);
    assert.equal(hist.results[0].orderStatus, "READY_TO_SHIP");
    assert.match(hist.results[0].orderDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const detail = (await fake.call("GET", `/api/seller/order/${orderId}`, { bsc: BSC })).body;
    assert.equal(detail.orderItems[0].card.id, "c1");
    assert.equal(detail.orderItems[0].cardId, "c1");
    assert.equal(detail.orderItems[0].orderQuantity, 2);
    assert.equal(detail.orderItems[0].price, "0.50");
    assert.equal(detail.orderItems[0].sellerSku, "303|1");
    assert.equal(detail.orderItems[0].productType, "raw");
    assert.match(detail.orderDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/);
    for (const k of ["buyer", "shippingAddress", "billingAddress", "stripePaymentId"]) assert.equal(detail[k], undefined);
    assert.equal(fake.state.get(NS).listings.get("c1|near_mint").availableQuantity, 1);
    assert.equal((await fake.call("GET", "/api/seller/order/nope", { bsc: BSC })).status, 404);
    // Another namespace sees none of it.
    assert.equal((await fake.call("GET", `/api/seller/order/${orderId}`, { bsc: "tok-other-slug-w1" })).status, 404);
    // A cancelled order lowers nothing.
    await fake.call("POST", "/__fake/orders", { body: { ns: NS, order: { status: "CANCELLED", items: [{ cardId: "c1", condition: "near_mint", quantity: 1 }] } } });
    assert.equal(fake.state.get(NS).listings.get("c1|near_mint").availableQuantity, 1);
  });

  it("refuses a malformed order", async () => {
    for (const order of [{}, { items: [] }, { items: [{ cardId: "../x", condition: "nm", quantity: 1 }] }, { items: [{ cardId: "c1", condition: "nm", quantity: 0 }] }, { status: "lower", items: [{ cardId: "c1", condition: "nm", quantity: 1 }] }]) {
      assert.equal((await fake.call("POST", "/__fake/orders", { body: { ns: NS, order } })).status, 400, JSON.stringify(order));
    }
    assert.equal((await fake.call("POST", "/__fake/orders", { body: { ns: "Bad NS", order: { items: [{ cardId: "c1", condition: "nm", quantity: 1 }] } } })).status, 400);
  });
});

describe("faults and resets", () => {
  let fake;
  let clock;
  let slept;
  beforeEach(async () => {
    if (fake) await fake.close();
    clock = { t: Date.parse("2026-11-14T12:00:00Z") };
    slept = [];
    fake = await startFake({ now: () => clock.t, sleep: async (ms) => slept.push(ms) });
  });
  after(() => fake.close());

  const setFaults = (rules, ns = NS) => fake.call("POST", "/__fake/faults", { body: { ns, rules } });

  it("answers a 429 with Retry-After for `times` requests, then passes", async () => {
    assert.equal((await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "429", retryAfterS: 30, times: 2 }])).status, 200);
    for (let i = 0; i < 2; i++) {
      const r = await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC });
      assert.equal(r.status, 429);
      assert.equal(r.headers.get("retry-after"), "30");
    }
    assert.equal((await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC })).status, 200);
  });

  it("expires a rule after its TTL (default 10 minutes)", async () => {
    await setFaults([{ match: { method: "*", pathTemplate: "seller/order/history" }, kind: "503" }]);
    assert.equal((await fake.call("POST", "/api/seller/order/history", { bsc: BSC, body: {} })).status, 503);
    clock.t += 10 * 60 * 1000 + 1;
    assert.equal((await fake.call("POST", "/api/seller/order/history", { bsc: BSC, body: {} })).status, 200);
  });

  it("delays, then answers normally", async () => {
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "delay", delayMs: 4000 }]);
    assert.equal((await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC })).status, 200);
    assert.deepEqual(slept, [4000]);
  });

  it("drops the connection on reset", async () => {
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "reset", times: 1 }]);
    await assert.rejects(fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC }));
  });

  it("hangs until the client gives up", async () => {
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "hang", times: 1 }]);
    await assert.rejects(
      fetch(`${fake.base}/api/marketplace/user/profile`, { headers: fake.headers(CALLER, { bsc: BSC }), signal: AbortSignal.timeout(200) }),
    );
  });

  it("stalls a card id for an anonymous card-listing call (the stall-ids replacement)", async () => {
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/card/:id/card-listing", cardId: "stallme" }, kind: "503" }]);
    assert.equal((await fake.call("GET", "/api/marketplace/card/stallme/card-listing")).status, 503);
    assert.equal((await fake.call("GET", "/api/marketplace/card/other/card-listing")).status, 501);
  });

  it("caps hangs at 2 minutes and 4 held sockets per scope; past that, 503 at once", async () => {
    const { HANG_CAP_MS, MAX_HUNG_PER_SCOPE } = require("../dist/src/faults.js");
    assert.equal(HANG_CAP_MS, 2 * 60 * 1000);
    assert.equal(MAX_HUNG_PER_SCOPE, 4);
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "hang" }]);
    const ctl = new AbortController();
    const held = Array.from({ length: 4 }, () =>
      fetch(`${fake.base}/api/marketplace/user/profile`, { headers: fake.headers(CALLER, { bsc: BSC }), signal: ctl.signal }).catch(() => "aborted"),
    );
    // Let the four reach the fault before the fifth.
    await new Promise((r) => setTimeout(r, 100));
    const fifth = await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC });
    assert.equal(fifth.status, 503);
    // Another scope still gets its own hang (it is not refused at once).
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/user/profile" }, kind: "hang" }], "other-slug-w1");
    await assert.rejects(
      fetch(`${fake.base}/api/marketplace/user/profile`, { headers: fake.headers(CALLER, { bsc: "tok-other-slug-w1" }), signal: AbortSignal.timeout(150) }),
    );
    ctl.abort();
    assert.deepEqual(await Promise.all(held), ["aborted", "aborted", "aborted", "aborted"]);
    // Freed: the next one hangs again rather than answering 503.
    await new Promise((r) => setTimeout(r, 100));
    await assert.rejects(
      fetch(`${fake.base}/api/marketplace/user/profile`, { headers: fake.headers(CALLER, { bsc: BSC }), signal: AbortSignal.timeout(150) }),
    );
  });

  it("limits request bodies to what NB's BSC traffic needs", async () => {
    const { PUT_BODY_LIMIT, API_BODY_LIMIT, PHOTO_BODY_LIMIT } = require("../dist/src/routes/api.js");
    assert.deepEqual([PUT_BODY_LIMIT, API_BODY_LIMIT, PHOTO_BODY_LIMIT], [2 * 1024 * 1024, 64 * 1024, 4 * 1024 * 1024]);
    const big = { filters: { sport: ["x".repeat(70 * 1024)] } };
    assert.equal((await fake.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body: big })).status, 413);
    // 100 rows of ~15 KB (the most NB's sheet parser passes) fit a PUT.
    const sellerId = (await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC })).body.sellerProfile.sellerId;
    const listings = Array.from({ length: 100 }, (_, i) => ({ cardId: `c${i}`, condition: "near_mint", availableQuantity: 1, price: 1, sellerSku: null, pad: "p".repeat(15_000) }));
    const put = await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId, listings } });
    assert.notEqual(put.status, 413);
    const tooBig = await fake.call("PUT", "/api/seller/bulk-upload", { bsc: BSC, body: { sellerId, listings: listings.map((l) => ({ ...l, pad: "p".repeat(25_000) })) } });
    assert.equal(tooBig.status, 413);
  });

  it("x-nb-fake-ns ending in '-' stalls only card-scoped rules under that prefix", async () => {
    const card = { method: "GET", pathTemplate: "marketplace/card/:id/card-listing" };
    await setFaults([{ match: { ...card, cardId: "mine" }, kind: "503" }]);
    // Another deployment's run stalls a different card, and a non-card rule.
    await setFaults([{ match: { ...card, cardId: "theirs" }, kind: "429" }, { match: card, kind: "429" }], "other-slug-w1");
    const lane = { extra: { "x-nb-fake-ns": "happy-cat-" } };
    assert.equal((await fake.call("GET", "/api/marketplace/card/mine/card-listing", lane)).status, 503);
    // Not under the prefix, and no card id in the rule: neither applies.
    assert.equal((await fake.call("GET", "/api/marketplace/card/theirs/card-listing", lane)).status, 501);
    assert.equal((await fake.call("GET", "/api/marketplace/card/plain/card-listing", lane)).status, 501);
    // The same rule read as an exact namespace would never fire.
    assert.equal((await fake.call("GET", "/api/marketplace/card/mine/card-listing", { extra: { "x-nb-fake-ns": "happy-cat-123-w9" } })).status, 501);
    // An exact namespace header still gets every rule of that namespace.
    assert.equal((await fake.call("GET", "/api/marketplace/card/plain/card-listing", { extra: { "x-nb-fake-ns": "other-slug-w1" } })).status, 429);
  });

  it("records a prefix-scoped miss under the prefix, and a reset of the prefix clears it", async () => {
    const lane = { extra: { "x-nb-fake-ns": "happy-cat-" } };
    await fake.call("GET", "/api/marketplace/card/c7/card-listing", lane);
    await fake.call("GET", "/api/marketplace/card/c8/card-listing", { extra: { "x-nb-fake-ns": "other-slug-" } });
    const mine = (await fake.call("GET", "/__fake/misses?prefix=happy-cat-")).body.misses;
    assert.deepEqual(mine.map((m) => [m.ns, m.prefix, m.path]), [[null, "happy-cat-", "marketplace/card/c7/card-listing"]]);
    assert.ok(mine[0].request, "a prefix miss carries the request the recorder fetches");
    // A namespace under the prefix sees it; a wider prefix selection does too.
    assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses.length, 1);
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=happy-cat-123-")).body.misses.length, 1);
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=zzz-")).body.misses.length, 0);
    // An exact-namespace reset leaves the deployment's list; a prefix reset clears it.
    await fake.call("POST", "/__fake/reset", { body: { ns: NS } });
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=happy-cat-")).body.misses.length, 1);
    await fake.call("POST", "/__fake/reset", { body: { prefix: "happy-cat-" } });
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=happy-cat-")).body.misses.length, 0);
    assert.equal((await fake.call("GET", "/__fake/misses?prefix=other-slug-")).body.misses.length, 1);
  });

  it("reads x-nb-fake-ns strictly: a malformed value is no header", async () => {
    assert.deepEqual(readHeaderScope("happy-cat-"), { prefix: "happy-cat-" });
    assert.deepEqual(readHeaderScope("happy-cat-123-w0"), { ns: "happy-cat-123-w0" });
    for (const bad of ["", "-", "a-", "Happy-cat-", "-cat-", "happy_cat-", "happy cat-", "a".repeat(101), "happy-cat-\n", undefined, 7]) {
      assert.equal(readHeaderScope(bad), null, JSON.stringify(bad));
    }
    await setFaults([{ match: { method: "GET", pathTemplate: "marketplace/card/:id/card-listing", cardId: "c1" }, kind: "503" }]);
    // Malformed: read as no header, so the unscoped (every namespace) rule set applies.
    assert.equal((await fake.call("GET", "/api/marketplace/card/c1/card-listing", { extra: { "x-nb-fake-ns": "Happy-Cat-" } })).status, 503);
    await fake.call("GET", "/api/marketplace/card/c2/card-listing", { extra: { "x-nb-fake-ns": "happy_cat-" } });
    const misses = (await fake.call("GET", "/__fake/misses?prefix=happy-cat-")).body.misses;
    assert.deepEqual(misses.map((m) => [m.ns, m.prefix]), [[null, undefined]]);
  });

  it("matches the photo upload by Convex's literal template", async () => {
    await setFaults([{ match: { method: "POST", pathTemplate: "common/card/undefined/product/undefined/attachment" }, kind: "429" }]);
    const r = await fake.call("POST", "/api/common/card/undefined/product/undefined/attachment", { bsc: BSC, body: {} });
    assert.equal(r.status, 429);
  });

  it("refuses malformed rules", async () => {
    for (const rules of [{}, [{ kind: "429" }], [{ match: { method: "GET", pathTemplate: "x" }, kind: "teapot" }], [{ match: { method: "GET", pathTemplate: "x" }, kind: "delay" }], [{ match: { method: "GET", pathTemplate: "x" }, kind: "429", ttlS: 99999 }]]) {
      assert.equal((await setFaults(rules)).status, 400, JSON.stringify(rules));
    }
  });

  it("reset clears run state and faults but never identity sessions; reset-all drops them too", async () => {
    await setFaults([{ match: { method: "*", pathTemplate: "marketplace/user/profile" }, kind: "503" }]);
    await fake.call("POST", "/api/seller/x", { bsc: BSC, body: {} });
    const r = await fake.call("POST", "/__fake/reset", { body: { prefix: "happy-cat-" } });
    assert.deepEqual(r.body, { ok: true, cleared: 1 });
    assert.deepEqual(fake.identity.resets, []);
    assert.equal((await fake.call("GET", "/api/marketplace/user/profile", { bsc: BSC })).status, 200);
    assert.equal((await fake.call("GET", `/__fake/misses?ns=${NS}`)).body.misses.length, 0);
    assert.equal((await fake.call("POST", "/__fake/reset", { body: { prefix: "h" } })).status, 400);
    assert.equal((await fake.call("POST", "/__fake/reset-all", { body: {} })).status, 403);
    assert.equal((await fake.call("POST", "/__fake/reset-all", { email: LOADER, admin: true, body: {} })).status, 200);
    assert.deepEqual(fake.identity.resets, [{}]);
  });
});

describe("process-wide cap on held sockets", () => {
  // `delay` waits on a gate the test opens, so delayed sockets stay held.
  let fake;
  let gates;
  before(async () => {
    gates = [];
    fake = await startFake({ sleep: () => new Promise((r) => gates.push(r)) });
  });
  after(() => fake.close());
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const profile = (bsc, signal) =>
    fetch(`${fake.base}/api/marketplace/user/profile`, { headers: fake.headers(CALLER, { bsc }), signal }).then(
      (r) => r.status,
      () => "aborted",
    );

  const match = { method: "GET", pathTemplate: "marketplace/user/profile" };
  const setRule = (ns, kind) =>
    fake.call("POST", "/__fake/faults", { body: { ns, rules: [{ match, kind, ...(kind === "delay" ? { delayMs: 1000 } : {}) }] } });
  const settle = async (want) => {
    for (let i = 0; i < 50 && gates.length < want; i++) await wait(20);
    assert.equal(gates.length, want);
  };

  it("caps: 4 hangs and 24 delays per scope, 64 held in all", () => {
    const { MAX_HUNG_PER_SCOPE, MAX_DELAYED_PER_SCOPE, MAX_HELD_SOCKETS } = require("../dist/src/faults.js");
    assert.deepEqual([MAX_HUNG_PER_SCOPE, MAX_DELAYED_PER_SCOPE, MAX_HELD_SOCKETS], [4, 24, 64]);
  });

  it("lets a wave of 10 delays in one namespace through (bscFault.slow), and refuses the 25th", async () => {
    await setRule("slow-wave-w1", "delay");
    const wave = Array.from({ length: 10 }, () => profile("tok-slow-wave-w1"));
    await settle(10);
    for (const g of gates.splice(0)) g();
    assert.deepEqual(await Promise.all(wave), Array(10).fill(200));
    const held = Array.from({ length: 24 }, () => profile("tok-slow-wave-w1"));
    await settle(24);
    assert.equal(await profile("tok-slow-wave-w1"), 503);
    for (const g of gates.splice(0)) g();
    assert.deepEqual(await Promise.all(held), Array(24).fill(200));
  });

  it("holds at most 64 hung or delayed sockets in all, whatever scopes a caller picks", async () => {
    // 24 + 24 + 12 delays and 4 hangs: 64 held across four scopes.
    for (const ns of ["cap-scope-w1", "cap-scope-w2", "cap-scope-w3"]) await setRule(ns, "delay");
    await setRule("cap-scope-w4", "hang");
    await setRule("cap-scope-w5", "delay");
    await setRule("cap-scope-w6", "hang");
    const ctl = new AbortController();
    const delayed = [];
    for (const [ns, n] of [["cap-scope-w1", 24], ["cap-scope-w2", 24], ["cap-scope-w3", 12]]) for (let k = 0; k < n; k++) delayed.push(profile(`tok-${ns}`));
    const hung = Array.from({ length: 4 }, () => profile("tok-cap-scope-w4", ctl.signal));
    await settle(60);
    await wait(100);
    // Fresh scopes, each under its own per-scope cap, are refused: the process is full.
    assert.equal(await profile("tok-cap-scope-w5"), 503);
    assert.equal(await profile("tok-cap-scope-w6"), 503);
    // A delay finishing frees its socket for the next one.
    gates.shift()();
    await settle(59);
    const next = profile("tok-cap-scope-w5");
    await settle(60);
    assert.equal(await profile("tok-cap-scope-w5"), 503);
    ctl.abort();
    for (const g of gates.splice(0)) g();
    assert.equal(await next, 200);
    assert.ok((await Promise.all(delayed)).every((r) => r === 200), "the delays answered");
    assert.ok((await Promise.all(hung)).every((r) => r === "aborted"), "the hangs never answered");
  });
});

describe("cold start: listening before the recordings are in", () => {
  // Built by hand (not startFake) to control the loading flag and its promise.
  const servers = [];
  const startCold = async ({ loadWaitMs } = {}) => {
    const h = await import("./helpers.mjs");
    h.setLogSink(() => {});
    const cold = { loading: true };
    cold.loaded = new Promise((r) => (cold.finish = () => ((cold.loading = false), r())));
    const app = h.createApp({
      config: h.testConfig(),
      catalogue: new h.Catalogue(new h.MemoryStore()),
      captures: new h.Captures(new h.MemoryStore()),
      state: new h.StateStore(),
      identity: h.stubIdentity(),
      verifyIdToken: h.stubVerifier,
      instanceId: "cold",
      loading: () => cold.loading,
      loaded: cold.loaded,
      ...(loadWaitMs !== undefined ? { loadWaitMs } : {}),
    });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    cold.call = async (method, p, { body, admin = false, bsc } = {}) => {
      const headers = { "x-nb-fake-bsc-key": CALLER_KEY, "x-nb-fake-id-token": idToken(admin ? LOADER : CALLER) };
      if (admin) headers["x-nb-fake-bsc-admin-key"] = ADMIN_KEY;
      if (bsc) headers.authorization = `Bearer ${bsc}`;
      if (body !== undefined) headers["content-type"] = "application/json";
      const r = await fetch(`${base}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
    };
    cold.base = base;
    return cold;
  };
  after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  it("holds /api and the miss list until loaded, then answers them normally", async () => {
    const cold = await startCold();
    assert.equal((await cold.call("GET", "/healthz")).body.loading, true);
    const settled = [];
    const track = (name, p) => p.then((r) => (settled.push(name), r));
    const held = [
      track("profile", cold.call("GET", "/api/marketplace/user/profile", { bsc: BSC })),
      track("filters", cold.call("POST", `/api/${FILTERS_PATH}`, { bsc: BSC, body: { filters: {} } })),
      track("misses", cold.call("GET", "/__fake/misses?prefix=happy-cat-")),
    ];
    await wait(200);
    assert.deepEqual(settled, [], "nothing answers while loading");
    cold.finish();
    const [profile, filters, misses] = await Promise.all(held);
    assert.equal(profile.status, 200);
    assert.equal(filters.status, 501, "an unrecorded catalogue request is a miss, not a loading 503");
    assert.equal(filters.headers.get("x-nb-fake"), "unrecorded");
    assert.equal(misses.status, 200);
    // Read again: the held read may have run before the held filters call recorded its miss.
    assert.equal((await cold.call("GET", "/__fake/misses?prefix=happy-cat-")).body.misses.length, 1);
    assert.equal((await cold.call("GET", "/healthz")).body.loading, false);
  });

  it("refuses admin uploads at once while loading; run controls work at once", async () => {
    const cold = await startCold();
    for (const [p, body] of [
      ["/__fake/recordings", { recordings: [] }],
      ["/__fake/write-captures", {}],
      ["/__fake/drift-compare", { shapes: {} }],
    ]) {
      const r = await cold.call("POST", p, { admin: true, body });
      assert.equal(r.status, 503, p);
      assert.equal(r.headers.get("x-nb-fake"), "loading", p);
      assert.equal(r.headers.get("retry-after"), "2", p);
    }
    assert.equal((await cold.call("POST", "/__fake/reset", { body: { prefix: "happy-cat-" } })).status, 200);
    assert.equal((await cold.call("POST", "/__fake/faults", { body: { ns: NS, rules: [{ match: { method: "GET", pathTemplate: "x" }, kind: "429" }] } })).status, 200);
    assert.equal((await cold.call("POST", "/__fake/orders", { body: { ns: NS, order: { items: [{ cardId: "c1", condition: "near_mint", quantity: 1 }] } } })).status, 200);
    // Auth still comes first: no key, no hold.
    assert.equal((await fetch(`${cold.base}/api/marketplace/user/profile`)).status, 401);
    cold.finish();
  });

  it("answers 503 loading only after the hold runs out", async () => {
    const { LOAD_WAIT_MS } = require("../dist/src/app.js");
    assert.equal(LOAD_WAIT_MS, 25_000);
    const cold = await startCold({ loadWaitMs: 150 });
    const started = Date.now();
    const r = await cold.call("GET", "/api/marketplace/user/profile", { bsc: BSC });
    assert.ok(Date.now() - started >= 140, "held for the wait first");
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("x-nb-fake"), "loading");
    assert.equal(r.headers.get("retry-after"), "2");
    assert.equal((await cold.call("GET", "/__fake/misses?prefix=happy-cat-")).status, 503);
    cold.finish();
  });
});

describe("write captures", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("stores a capture and judges the synthesis against it", async () => {
    // What a real PUT answer could look like: more fields than the fake makes.
    const realPut = [{ productId: "p", productType: "raw", cardId: "c", condition: "near_mint", availableQuantity: 1, price: "0.25", sellerId: "s", sellerSku: "1|1", updatedTimestamp: "t", active: true }];
    const ok = await fake.call("POST", "/__fake/write-captures", { email: LOADER, admin: true, body: { endpoint: "PUT seller/bulk-upload", status: 200, shape: shapeOf(realPut) } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.verdict, "ok");
    const drift = await fake.call("POST", "/__fake/write-captures", {
      email: LOADER,
      admin: true,
      body: { endpoint: "POST common/card/undefined/product/undefined/attachment", status: 200, shape: shapeOf({ key: "x" }) },
    });
    assert.equal(drift.body.verdict, "shape_drift");
    assert.deepEqual(drift.body.paths, ["objectKey"]);
    const list = (await fake.call("GET", "/__fake/write-captures", { email: LOADER, admin: true })).body.captures;
    assert.equal(list.length, 2);
  });

  it("refuses a capture for an unknown endpoint, with values, or from a non-admin", async () => {
    assert.equal((await fake.call("POST", "/__fake/write-captures", { email: LOADER, admin: true, body: { endpoint: "DELETE everything", status: 200, shape: {} } })).status, 400);
    assert.equal((await fake.call("POST", "/__fake/write-captures", { email: LOADER, admin: true, body: { endpoint: "PUT seller/bulk-upload", status: 200, shape: { objectKey: "a value" } } })).status, 400);
    assert.equal((await fake.call("POST", "/__fake/write-captures", { body: { endpoint: "PUT seller/bulk-upload", status: 200, shape: {} } })).status, 403);
  });

  it("reports the write endpoints with no capture on /healthz, until each has one", async () => {
    const fresh = await startFake();
    try {
      const both = ["PUT seller/bulk-upload", "POST common/card/undefined/product/undefined/attachment"];
      const before = (await fresh.call("GET", "/healthz")).body;
      assert.deepEqual(before.writeCaptures, { missing: both });

      await fresh.call("POST", "/__fake/write-captures", {
        email: LOADER,
        admin: true,
        body: { endpoint: "PUT seller/bulk-upload", status: 200, shape: shapeOf([{ productId: "p" }]) },
      });
      assert.deepEqual((await fresh.call("GET", "/healthz")).body.writeCaptures, { missing: [both[1]] });

      await fresh.call("POST", "/__fake/write-captures", {
        email: LOADER,
        admin: true,
        body: { endpoint: both[1], status: 200, shape: shapeOf({ objectKey: "x" }) },
      });
      assert.deepEqual((await fresh.call("GET", "/healthz")).body.writeCaptures, { missing: [] });
    } finally {
      await fresh.close();
    }
  });

  it("holds a stored capture for BOTH write endpoints the specs drive (a missing one is not a pass)", async () => {
    // The test below judges only the captures that exist, so with none stored
    // it passes without judging anything. This is the explicit check.
    assert.deepEqual(fake.captures.missing(), [], `no stored capture for: ${fake.captures.missing().join(", ")}; run \`recorder capture-write\``);
  });

  it("synthesis matches the latest stored capture for every write endpoint that has one", async () => {
    const captures = fake.captures.list();
    assert.ok(captures.length > 0);
    for (const c of captures) {
      const v = checkCapture(c);
      if (c.endpoint === "PUT seller/bulk-upload") assert.equal(v.verdict, "ok", `${c.endpoint}: ${v.paths.join(", ")}`);
    }
    assert.equal(synthesisedWrite("PUT seller/bulk-upload").status, 200);
  });
});

describe("drift-compare", () => {
  let fake;
  before(async () => {
    fake = await startFake();
    const body = { filters: { sport: ["baseball"] } };
    await fake.call("POST", "/__fake/recordings", {
      email: LOADER,
      admin: true,
      body: { recordings: [recording(FILTERS_PATH, "POST", body, { aggregations: { year: [{ label: "1996", slug: "1996", count: 4, active: false }] } })] },
    });
  });
  after(() => fake.close());

  const probe = (shapes, extra = {}) => fake.call("POST", "/__fake/drift-compare", { email: LOADER, admin: true, body: { shapes, ...extra } });
  const realShape = {
    "": "object",
    aggregations: "object",
    "aggregations.year": "array",
    "aggregations.year[]": "object",
    "aggregations.year[].label": "string",
    "aggregations.year[].slug": "string",
    "aggregations.year[].count": "number",
    "aggregations.year[].active": "boolean",
    "aggregations.year[].sellerOnly": "string", // outside the allowlist: ignored
    "aggregations.setName": "array", // a facet the recording lacks: not drift
  };

  it("is ok when the allowlisted shape agrees", async () => {
    const r = await probe({ "search/bulk-upload/filters": realShape });
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, "ok", JSON.stringify(r.body));
  });

  it("reports shape_drift for a type change and a dropped field, as paths", async () => {
    const changed = { ...realShape, "aggregations.year[].count": "string" };
    delete changed["aggregations.year[].slug"];
    const r = await probe({ "POST search/bulk-upload/filters": changed });
    assert.equal(r.body.outcome, "shape_drift");
    assert.deepEqual(r.body.endpoints[0].paths, ["aggregations.year[].count", "aggregations.year[].slug"]);
    assert.deepEqual(r.body.paths, ["POST search/bulk-upload/filters aggregations.year[].count", "POST search/bulk-upload/filters aggregations.year[].slug"]);
  });

  it("reports an unrecorded pinned key", async () => {
    const r = await probe({ "search/bulk-upload/filters": realShape }, { requests: { "search/bulk-upload/filters": { method: "POST", path: FILTERS_PATH, body: { filters: { sport: ["hockey"] } } } } });
    assert.equal(r.body.outcome, "unrecorded pinned key");
    const pinned = await probe({ "search/bulk-upload/filters": realShape }, { requests: { "search/bulk-upload/filters": { method: "POST", path: FILTERS_PATH, body: { filters: { sport: ["baseball"] } } } } });
    assert.equal(pinned.body.outcome, "ok");
    assert.equal((await probe({ "search/bulk-upload/results": { "": "array" } })).body.outcome, "unrecorded pinned key");
  });

  it("checks the profile paths NB reads", async () => {
    const r = await probe({ "marketplace/user/profile": { "": "object", sellerProfile: "object", "sellerProfile.sellerId": "number", "sellerProfile.sellerStoreName": "string" } });
    assert.equal(r.body.outcome, "shape_drift");
    assert.deepEqual(r.body.endpoints[0].paths, ["sellerProfile.sellerId"]);
  });

  it("reads the probe's dialect: $ root, unions, {*} map keys", async () => {
    const dialect = {
      $: "object",
      aggregations: "object",
      "aggregations.year": "array",
      "aggregations.year[]": "object",
      "aggregations.year[].label": "string",
      "aggregations.year[].slug": "string|null",
      "aggregations.year[].count": "number",
      "aggregations.year[].active": "boolean",
      "aggregations.{*}": "array",
    };
    const r = await probe({ "search/bulk-upload/filters": dialect }, { requests: { "search/bulk-upload/filters": { method: "POST", path: FILTERS_PATH, query: [], body: { filters: { sport: ["baseball"] } } } } });
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, "ok", JSON.stringify(r.body));
  });

  it("compares the synthesised seller sheet and order history on the paths NB reads", async () => {
    const sheet = {
      $: "array",
      "[]": "object",
      "[].productId": "string",
      "[].productType": "string",
      "[].cardId": "string",
      "[].price": "string",
      "[].condition": "string",
      "[].availableQuantity": "number",
      "[].sellerSku": "string|null",
      "[].sellerImgFront": "string",
      "[].sellerImgBack": "string",
      "[].card": "object",
      "[].card.id": "string",
      "[].card.cardNo": "string",
      "[].someNewField": "string",
    };
    assert.equal((await probe({ "seller/bulk-upload/results": sheet })).body.outcome, "ok");
    const moved = { ...sheet, "[].availableQuantity": "string" };
    delete moved["[].card.id"];
    const r = await probe({ "seller/bulk-upload/results": moved });
    assert.deepEqual(r.body.endpoints[0].paths, ["[].availableQuantity", "[].card.id"]);
    // The wrapped root form `{results: [...]}`, which NB also reads: no drift.
    const wrap = (shape) => Object.fromEntries([["$", "object"], ...Object.entries(shape).map(([p, t]) => [p === "$" ? "results" : `results${p}`, t])]);
    const wrapped = await probe({ "seller/bulk-upload/results": wrap(sheet) });
    assert.equal(wrapped.body.outcome, "ok", JSON.stringify(wrapped.body));
    // ...and a real change inside the wrapped form is still drift, named in the bare form.
    const wrappedMoved = await probe({ "seller/bulk-upload/results": wrap(moved) });
    assert.deepEqual(wrappedMoved.body.endpoints[0].paths, ["[].availableQuantity", "[].card.id"]);
    // An object root with no results array is a shape NB cannot read: drift.
    assert.equal((await probe({ "seller/bulk-upload/results": { $: "object", rows: "array" } })).body.outcome, "shape_drift");
    // An empty order history (no items to describe) is not drift.
    assert.equal((await probe({ "seller/order/history": { $: "object", totalElements: "number", results: "array" } })).body.outcome, "ok");
    assert.equal((await probe({ "seller/order/history": { $: "object", totalElements: "string", results: "array" } })).body.outcome, "shape_drift");
  });

  it("refuses a malformed probe", async () => {
    assert.equal((await probe({ "search/bulk-upload/filters": { "bad path!": "string" } })).status, 400);
    assert.equal((await fake.call("POST", "/__fake/drift-compare", { body: { shapes: {} } })).status, 403);
  });
});
