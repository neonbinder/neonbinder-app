// The fake eBay's synthesised answers against eBay's own OpenAPI contracts:
// every key path an answer carries must exist in the published 2xx schema of
// that operation (tests/fixtures/ebay-oas-response-paths.json). Synthesis may
// carry fewer fields than eBay; it must never invent one.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sampleAnswers } = require("../dist/src/ebay/sample.js");
const { shapeOf } = require("../dist/src/shape.js");
const { EBAY_CAPTURE_ENDPOINTS } = require("../dist/src/ebay/captures.js");
const fixture = require("./fixtures/ebay-oas-response-paths.json");

/** `{param}` names differ between eBay's contracts and the fake's templates: compare without them. */
const norm = (k) => k.replace(/\{[^}]+\}/g, "{}").replace(/\/$/, "");
const OAS = new Map(Object.entries(fixture.operations).map(([k, v]) => [norm(k), v]));

/** The OAS operation a capture endpoint name is, or null (the token endpoint and the 204 writes have no schema). */
function oasFor(name) {
  const m = /^(\w+) ebay\/(?:api|apiz|apim)\/([^ #]+)/.exec(name);
  return OAS.get(norm(`${m[1]} /${m[2].replace(/:[A-Za-z]+/g, "{}")}`)) ?? null;
}

/**
 * eBay's Inventory contract types `product.aspects` as a string, but the API
 * sends (and NB writes) a map of name to values. Paths below it are allowed.
 */
const isAspectsMap = (p) => /(^|\.)product\.aspects\./.test(p);

const answers = sampleAnswers();

describe("eBay OpenAPI conformance", () => {
  it("the sample walk answers every capture endpoint", () => {
    assert.deepEqual(Object.keys(answers).sort(), [...EBAY_CAPTURE_ENDPOINTS].sort());
  });

  for (const [name, a] of Object.entries(answers)) {
    if (a.status < 200 || a.status > 299 || a.body === undefined) continue;
    const op = oasFor(name);
    if (!op) continue;
    it(`${name} stays inside eBay's ${a.status} schema`, () => {
      const allowed = op[String(a.status)];
      assert.ok(allowed, `eBay documents no ${a.status} for ${name} (it has ${Object.keys(op).join(", ")})`);
      const invented = Object.keys(shapeOf(a.body)).filter((p) => !(p in allowed) && !isAspectsMap(p));
      assert.deepEqual(invented, []);
    });
  }

  it("covers the operations NB reads (no silent skip)", () => {
    const checked = Object.entries(answers).filter(([n, a]) => a.status >= 200 && a.status < 300 && a.body !== undefined && oasFor(n));
    // 2xx answers with a body and a published schema: everything but the token endpoint, the opt_in 409
    // and `enable` (the sandbox answers it 200 with no body).
    assert.equal(checked.length, 20, `checked ${checked.length} answers`);
  });

  it("eBay's error body is the documented ErrorDetailV3 envelope", () => {
    const refused = answers["POST ebay/api/sell/inventory/v1/offer/:offerId/publish #refused"];
    assert.equal(refused.status, 400);
    assert.deepEqual(Object.keys(shapeOf(refused.body)).sort(), ["", "errors", "errors[]", "errors[].category", "errors[].domain", "errors[].errorId", "errors[].message"]);
    // The sandbox refused publish with 25007, not 25002 (CONTRACT.md, "Write and read captures (eBay)").
    assert.equal(refused.body.errors[0].errorId, 25007);
  });

  it("enable answers 200 with no body, as the sandbox did", () => {
    const enable = answers["POST ebay/api/sell/inventory/v1/location/:merchantLocationKey/enable"];
    assert.equal(enable.status, 200);
    assert.equal(enable.body, undefined);
  });
});
