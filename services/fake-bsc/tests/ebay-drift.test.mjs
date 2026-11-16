// `/__fake/drift-compare {marketplace: "ebay"}`: the prod eBay probe's shapes
// against the fake's recordings (rows 5, 7) and synthesis (the rest), and the
// rows 5 and 7 hashes as a warning only.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { LOADER, startFake } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { compareEbayDrift, ebayCatalogueHash } = require("../dist/src/ebay/drift.js");
const { sampleAnswers, endpointName } = require("../dist/src/ebay/sample.js");
const { shapeOf } = require("../dist/src/shape.js");
const { Catalogue } = require("../dist/src/catalogue.js");
const { MemoryStore } = require("../dist/src/store/local.js");

const SHIP = "GET ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services";
const ASPECTS = "GET ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category";
const ORDERS = "GET ebay/api/sell/fulfillment/v1/order";
const LOCATION = "GET ebay/api/sell/inventory/v1/location/:merchantLocationKey";

/** A shape in the browser probe's dialect: `$` root, `a|b` unions. */
function probeShape(body) {
  const out = {};
  for (const [p, ts] of Object.entries(shapeOf(body))) out[p === "" ? "$" : p] = ts.join("|");
  return out;
}

const SHIP_BODY = {
  shippingServices: [
    { shippingService: "USPSGroundAdvantage", description: "USPS Ground Advantage", shippingCarrier: "USPS", internationalService: false, validForSellingFlow: true, shippingCostTypes: ["FLAT_RATE", "CALCULATED"], shippingCategory: "STANDARD", minShippingTime: 2, maxShippingTime: 5, packageLimits: { maxWeight: 70, weightUnit: "POUND" } },
    { shippingService: "US_eBayStandardEnvelope", description: "eBay Standard Envelope", shippingCarrier: "USPS", internationalService: false, validForSellingFlow: true, shippingCostTypes: ["FLAT_RATE"], shippingCategory: "ECONOMY" },
  ],
};
const ASPECTS_BODY = { aspects: [{ localizedAspectName: "Sport", aspectConstraint: { aspectRequired: true, aspectMaxLength: 65 } }, { localizedAspectName: "Team", aspectConstraint: { aspectRequired: false } }] };

async function catalogueWith(recordings) {
  const c = new Catalogue(new MemoryStore());
  await c.load();
  if (recordings.length) await c.add(recordings.map((r) => require("../dist/src/catalogue.js").checkRecording(r).recording));
  return c;
}

const rec = (path, query, body) => ({ request: { method: "GET", path, query }, response: { status: 200, body } });
const RECORDINGS = [
  rec("ebay/api/sell/metadata/v1/shipping/marketplace/EBAY_US/get_shipping_services", [], SHIP_BODY),
  rec("ebay/api/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category", [["category_id", "261328"]], ASPECTS_BODY),
];

/** A probe body built from the fake's own answers: what an unchanged eBay would send. */
function cleanProbe() {
  const answers = sampleAnswers();
  const shapes = {};
  for (const op of ["optedInPrograms", "listPaymentPolicies", "listReturnPolicies", "listFulfillmentPolicies", "getLocation", "getOffers", "orders", "identityUser"]) {
    shapes[endpointName(op)] = probeShape(answers[endpointName(op)].body);
  }
  shapes[SHIP] = probeShape(SHIP_BODY);
  shapes[ASPECTS] = probeShape(ASPECTS_BODY);
  return { marketplace: "ebay", shapes, statuses: Object.fromEntries(Object.keys(shapes).map((k) => [k, 200])) };
}

describe("eBay drift: the hash", () => {
  it("is sha256 of the JSON of the unique, sorted, non-empty names", () => {
    const want = createHash("sha256").update(JSON.stringify(["Sport", "Team", "Year Manufactured"]), "utf8").digest("hex");
    assert.equal(ebayCatalogueHash(["Year Manufactured", "Team", "Sport", "Team", "", null, 7]), want);
    // JavaScript's default sort is by UTF-16 code unit: upper case before lower.
    assert.equal(ebayCatalogueHash(["b", "B", "a"]), createHash("sha256").update('["B","a","b"]').digest("hex"));
  });

  it("matches the browser probe's digestNames, by its source's stated definition", () => {
    const src = readFileSync(new URL("../../browser/src/routes/ebay-probe.ts", import.meta.url), "utf8");
    assert.match(src, /new Set\(names\.filter\(\(n\) => typeof n === "string" && n\.length > 0\)\)\]\.sort\(\)/);
    assert.match(src, /createHash\("sha256"\)\.update\(JSON\.stringify\(list\), "utf8"\)\.digest\("hex"\)/);
  });
});

describe("eBay drift: compare", () => {
  let recorded;
  before(async () => (recorded = await catalogueWith(RECORDINGS)));

  it("an unchanged eBay is ok, every endpoint compared", () => {
    const out = compareEbayDrift(cleanProbe(), recorded);
    assert.equal(out.ok, true);
    assert.equal(out.result.outcome, "ok", JSON.stringify(out.result.paths));
    assert.ok(out.result.endpoints.every((e) => e.verdict === "ok"), JSON.stringify(out.result.endpoints));
    assert.deepEqual(out.result.warnings, []);
  });

  it("every endpoint name the browser probe sends is one the fake compares", () => {
    const src = readFileSync(new URL("../../browser/src/routes/ebay-probe-allowlist.ts", import.meta.url), "utf8");
    const names = [...src.matchAll(/endpoint: "([^"]+)"/g)].map((m) => m[1]);
    assert.ok(names.length >= 10, `found ${names.length} endpoint names`);
    const probe = cleanProbe();
    for (const n of names) assert.ok(n in probe.shapes, `the fake does not compare ${n}`);
  });

  it("a read path NB uses that went missing is drift; a type change is drift", () => {
    const probe = cleanProbe();
    delete probe.shapes[ORDERS]["orders[].lineItems[].legacyItemId"];
    probe.shapes[endpointName("listPaymentPolicies")].total = "string";
    const out = compareEbayDrift(probe, recorded).result;
    assert.equal(out.outcome, "shape_drift");
    assert.deepEqual(out.paths.sort(), [`${ORDERS} orders[].lineItems[].legacyItemId`, `${endpointName("listPaymentPolicies")} total`].sort());
  });

  it("an optional path NB reads is not drift when absent (the last page has no next, a line may have no SKU)", () => {
    const probe = cleanProbe();
    delete probe.shapes[ORDERS].next;
    delete probe.shapes[ORDERS]["orders[].lineItems[].sku"];
    assert.equal(compareEbayDrift(probe, recorded).result.outcome, "ok");
  });

  it("an empty list says nothing about its items", () => {
    const probe = cleanProbe();
    probe.shapes[ORDERS] = { $: "object", total: "number", orders: "array" };
    assert.equal(compareEbayDrift(probe, recorded).result.outcome, "ok");
  });

  it("a recorded row compares allowlisted paths against the pinned recording", () => {
    const probe = cleanProbe();
    probe.shapes[SHIP]["shippingServices[].shippingService"] = "number";
    probe.shapes[SHIP]["shippingServices[].brandNewField"] = "string";
    const out = compareEbayDrift(probe, recorded).result;
    assert.deepEqual(out.paths, [`${SHIP} shippingServices[].shippingService`]);
  });

  it("rows 5 and 7 unrecorded are 'unrecorded pinned key'; a hash with no recording is a warning", async () => {
    const empty = await catalogueWith([]);
    const probe = { ...cleanProbe(), hashes: { [ASPECTS]: "0".repeat(64) } };
    const out = compareEbayDrift(probe, empty).result;
    assert.equal(out.outcome, "unrecorded pinned key");
    assert.deepEqual(out.warnings, [{ endpoint: ASPECTS, kind: "hash_unrecorded" }]);
  });

  it("a hash that differs from the recording's is a warning, never drift; an equal one is silent", () => {
    const names = ASPECTS_BODY.aspects.map((a) => a.localizedAspectName);
    const probe = { ...cleanProbe(), hashes: { [ASPECTS]: ebayCatalogueHash(names), [SHIP]: ebayCatalogueHash(["SomethingElse"]) } };
    const out = compareEbayDrift(probe, recorded).result;
    assert.equal(out.outcome, "ok");
    assert.deepEqual(out.warnings, [{ endpoint: SHIP, kind: "hash_mismatch" }]);
  });

  it("a 404 on the location compares eBay's error envelope; a 401 is not compared and warned", () => {
    const probe = cleanProbe();
    probe.shapes[LOCATION] = { $: "object", errors: "array", "errors[]": "object", "errors[].errorId": "number", "errors[].domain": "string", "errors[].category": "string" };
    probe.statuses[LOCATION] = 404;
    probe.statuses[ORDERS] = 401;
    const out = compareEbayDrift(probe, recorded).result;
    assert.equal(out.endpoints.find((e) => e.endpoint === LOCATION).verdict, "ok");
    assert.equal(out.endpoints.find((e) => e.endpoint === ORDERS).verdict, "not_compared");
    assert.deepEqual(out.warnings, [{ endpoint: ORDERS, kind: "not_2xx" }]);
    probe.shapes[LOCATION]["errors[].errorId"] = "string";
    assert.equal(compareEbayDrift(probe, recorded).result.outcome, "shape_drift");
  });

  it("an unknown endpoint is not compared; malformed input is refused", () => {
    const out = compareEbayDrift({ marketplace: "ebay", shapes: { "GET ebay/api/sell/finances/v1/payout": { $: "object" } } }, recorded).result;
    assert.equal(out.endpoints[0].verdict, "not_compared");
    assert.equal(compareEbayDrift({ marketplace: "ebay" }, recorded).ok, false);
    assert.equal(compareEbayDrift({ marketplace: "ebay", shapes: {}, hashes: { [SHIP]: "NOTHEX" } }, recorded).ok, false);
    assert.equal(compareEbayDrift({ marketplace: "ebay", shapes: {}, statuses: { [SHIP]: "200" } }, recorded).ok, false);
  });
});

describe("eBay drift over HTTP", () => {
  let fake;
  before(async () => (fake = await startFake()));
  after(() => fake.close());

  it("routes on `marketplace`; no marketplace is BSC; anything else is refused; admin only", async () => {
    const ebay = await fake.call("POST", "/__fake/drift-compare", { email: LOADER, admin: true, body: { marketplace: "ebay", shapes: { [ORDERS]: { $: "object" } } } });
    assert.equal(ebay.status, 200);
    assert.deepEqual(ebay.body.warnings, []);
    const bsc = await fake.call("POST", "/__fake/drift-compare", { email: LOADER, admin: true, body: { shapes: { "GET marketplace/user/profile": { $: "object" } } } });
    assert.equal(bsc.status, 200);
    assert.equal(bsc.body.warnings, undefined);
    assert.equal((await fake.call("POST", "/__fake/drift-compare", { email: LOADER, admin: true, body: { marketplace: "mercari", shapes: {} } })).status, 400);
    assert.equal((await fake.call("POST", "/__fake/drift-compare", { body: { marketplace: "ebay", shapes: {} } })).status, 403);
  });
});
