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
    assert.deepEqual(sh, { "": ["object"], objectKey: ["string"], rows: ["array"], "rows[]": ["object"], "rows[].q": ["null", "number"] });
    assert.ok(!JSON.stringify(sh).includes("prod"));
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
