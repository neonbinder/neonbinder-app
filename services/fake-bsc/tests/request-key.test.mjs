// src/requestKey.ts: one key for one request, however it is spelled.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const k = require("../dist/src/requestKey.js");
const shape = require("../dist/src/shape.js");

describe("requestKey", () => {
  it("ignores key order, method case, slashes and the /api prefix", () => {
    const a = k.requestKey({ method: "post", path: "/api/search/bulk-upload/results/", body: { filters: { year: ["1996"], sport: ["baseball"] }, page: 0 } });
    const b = k.requestKey({ method: "POST", path: "search/bulk-upload/results", body: { page: 0, filters: { sport: ["baseball"], year: ["1996"] } } });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it("sorts the query but keeps array order in the body", () => {
    assert.equal(k.requestKey({ method: "GET", path: "x", query: "b=2&a=1" }), k.requestKey({ method: "GET", path: "x", query: [["a", "1"], ["b", "2"]] }));
    assert.notEqual(
      k.requestKey({ method: "POST", path: "x", body: { s: ["a", "b"] } }),
      k.requestKey({ method: "POST", path: "x", body: { s: ["b", "a"] } }),
    );
  });

  it("ignores a GET body and distinguishes values", () => {
    assert.equal(k.requestKey({ method: "GET", path: "x", body: { a: 1 } }), k.requestKey({ method: "GET", path: "x" }));
    assert.notEqual(k.requestKey({ method: "POST", path: "x", body: { a: 1 } }), k.requestKey({ method: "POST", path: "x", body: { a: 2 } }));
  });

  it("diffs two requests as paths only", () => {
    const a = k.canonicalRequest({ method: "POST", path: "p", body: { filters: { year: ["1996"], sport: ["baseball"] }, size: 5000 } });
    const b = k.canonicalRequest({ method: "POST", path: "p", body: { filters: { year: ["1997"], sport: ["baseball"] }, size: 5000, page: 0 } });
    assert.deepEqual(k.diffRequestPaths(a, b), ["body.filters.year", "body.page"]);
    assert.ok(!JSON.stringify(k.diffRequestPaths(a, b)).includes("1997"));
  });
});

describe("shapes", () => {
  it("records key paths and types, never values", () => {
    const sh = shape.shapeOf({ objectKey: "/prod/x.jpg", rows: [{ q: 1 }, { q: null }], "someone@example.com": 1 });
    assert.deepEqual(sh, { "": ["object"], "*": ["number"], objectKey: ["string"], rows: ["array"], "rows[]": ["object"], "rows[].q": ["null", "number"] });
    assert.ok(!JSON.stringify(sh).includes("prod"));
    assert.ok(!JSON.stringify(sh).includes("someone"));
  });

  it("collapses id-like keys to `*`, so a key that is really a value is never stored", () => {
    const ids = ["5f3a9c0e1b2d3e4f5a6b7c8d", "deadbeefcafe", "DEADBEEF", "123e4567-e89b-12d3-a456-426614174000", "2024", "user123456", "a1b2c3d4", "x".repeat(41), "someone@example.com", "Ken Griffey Jr."];
    const value = { byId: Object.fromEntries(ids.map((k, i) => [k, { price: i % 2 ? 1 : "1" }])), cardNo: "1", line1: "x", sellerImgFront: "y" };
    const sh = shape.shapeOf(value);
    assert.deepEqual(Object.keys(sh).sort(), ["", "byId", "byId.*", "byId.*.price", "cardNo", "line1", "sellerImgFront"]);
    assert.deepEqual(sh["byId.*.price"], ["number", "string"]);
    for (const k of ids) assert.ok(!JSON.stringify(sh).includes(k), k);
    for (const k of ["cardNo", "playerAttributeDesc", "sellerImgFront", "line1", "img12", "_id", "abcdef"]) assert.equal(shape.isFieldName(k), true, k);
  });

  it("collapses id-like segments of an uploaded shape too, merging their types", () => {
    const sh = shape.readShape({ "listings.deadbeefcafe.price": ["string"], "listings.a1b2c3d4.price": ["number"], "listings.*.sku": ["null"], "listings.user123456": ["object"] });
    assert.deepEqual(sh, { "listings.*": ["object"], "listings.*.price": ["number", "string"], "listings.*.sku": ["null"] });
  });

  it("validates an untrusted shape", () => {
    assert.ok(shape.readShape({ "a.b[]": ["string"] }));
    assert.equal(shape.readShape({ "a b": ["string"] }), null);
    assert.equal(shape.readShape({ a: ["date"] }), null);
    assert.equal(shape.readShape({ a: "string" }), null);
  });

  it("checks synthesis against a capture: extra capture fields are fine, invented ones are not", () => {
    const capture = { "": ["object"], objectKey: ["string"], extra: ["number"] };
    assert.deepEqual(shape.synthConformsTo({ "": ["object"], objectKey: ["string"] }, capture).paths, []);
    assert.deepEqual(shape.synthConformsTo({ "": ["object"], invented: ["string"] }, capture).paths, ["invented"]);
    assert.deepEqual(shape.synthConformsTo({ "": ["object"], objectKey: ["number"] }, capture).paths, ["objectKey"]);
    // An array the capture only saw empty cannot speak for its items.
    assert.deepEqual(shape.synthConformsTo({ "": ["array"], "[]": ["object"], "[].a": ["string"] }, { "": ["array"] }).paths, []);
  });
});
