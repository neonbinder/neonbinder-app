// The seller sheet against the daily probe (CONTRACT.md, "The seller sheet"):
// the real answer is `{results: [...]}`, and an unlisted row has no
// `sellerSku`, `sellerImgFront` or `sellerImgBack` at all. Drift must neither
// demand those keys of an account with no listings nor ignore a wrong type.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Catalogue, MemoryStore } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const { compareDrift, synthShape } = require("../dist/src/drift.js");
const { synthSheet, sheetAnswer, DEFAULT_IMG_FRONT, DEFAULT_IMG_BACK } = require("../dist/src/synth/sheet.js");
const { listingKey } = require("../dist/src/state.js");

const NAME = "seller/bulk-upload/results";
const LISTED_ONLY = ["sellerSku", "sellerImgFront", "sellerImgBack"];

// Key paths and types only, copied from the probe of an account with no
// listings (the run that flagged the three keys), in the probe's dialect.
const PROBE_NO_LISTINGS = {
  $: "object",
  results: "array",
  "results[]": "object",
  "results[].availableQuantity": "number",
  "results[].card": "object",
  "results[].card.cardNo": "string",
  "results[].card.id": "string",
  "results[].cardId": "string",
  "results[].condition": "string",
  "results[].price": "string",
  "results[].productId": "string",
  "results[].productType": "string",
};

const LISTED_KEYS = { "results[].sellerSku": "string|null", "results[].sellerImgFront": "string", "results[].sellerImgBack": "string" };

async function drift(shape) {
  const catalogue = new Catalogue(new MemoryStore());
  await catalogue.load();
  const out = compareDrift({ shapes: { [NAME]: shape } }, catalogue);
  assert.equal(out.ok, true);
  return out.result;
}

const without = (shape, ...keys) => Object.fromEntries(Object.entries(shape).filter(([k]) => !keys.includes(k)));

const state = (listings = []) => ({
  ns: "n",
  sellerId: "seller-1",
  storeName: "s",
  userId: "u",
  listings: new Map(listings.map((l) => [listingKey(l.cardId, l.condition), l])),
  photos: 0,
  orders: new Map(),
  faults: [],
  misses: new Map(),
  lastSeen: 0,
});

const listing = (over = {}) => ({
  cardId: "c1",
  condition: "near_mint",
  productId: "p1",
  availableQuantity: 2,
  price: 0.5,
  sellerSku: "1|1",
  sellerImgFront: null,
  sellerImgBack: null,
  updatedTimestamp: "2026-11-01T00:00:00.000000",
  card: null,
  ...over,
});

const ROWS = [{ id: "c1", cardNo: "1", players: "A" }, { id: "c2", cardNo: "2", players: "B" }];

describe("seller sheet drift", () => {
  it("is ok for the probe of an account with no listings, exactly as the failing run reported it", async () => {
    const r = await drift(PROBE_NO_LISTINGS);
    assert.equal(r.outcome, "ok", JSON.stringify(r));
    assert.deepEqual(r.paths, []);
  });

  it("is ok when the probe's rows are listed and carry the three keys", async () => {
    const r = await drift({ ...PROBE_NO_LISTINGS, ...LISTED_KEYS });
    assert.equal(r.outcome, "ok", JSON.stringify(r));
  });

  it("is ok for the same shape as a bare array", async () => {
    const bare = Object.fromEntries(Object.entries(PROBE_NO_LISTINGS).filter(([k]) => k !== "results").map(([k, t]) => [k === "$" ? "$" : k.replace("results", ""), k === "$" ? "array" : t]));
    assert.equal((await drift(bare)).outcome, "ok");
  });

  it("flags a listed-only key of the wrong type, named in the bare form", async () => {
    for (const key of LISTED_ONLY) {
      const r = await drift({ ...PROBE_NO_LISTINGS, ...LISTED_KEYS, [`results[].${key}`]: "number" });
      assert.equal(r.outcome, "shape_drift", key);
      assert.deepEqual(r.endpoints[0].paths, [`[].${key}`], key);
    }
  });

  it("accepts null for a listed-only key: null says nothing about its type", async () => {
    const r = await drift({ ...PROBE_NO_LISTINGS, "results[].sellerSku": "null" });
    assert.equal(r.outcome, "ok");
  });

  it("flags a key every row carries when the probe lacks it", async () => {
    for (const key of ["price", "productId", "cardId", "condition", "availableQuantity", "productType"]) {
      const r = await drift(without(PROBE_NO_LISTINGS, `results[].${key}`));
      assert.equal(r.outcome, "shape_drift", key);
      assert.deepEqual(r.endpoints[0].paths, [`[].${key}`], key);
    }
    const noCardId = await drift(without(PROBE_NO_LISTINGS, "results[].card.id"));
    assert.deepEqual(noCardId.endpoints[0].paths, ["[].card.id"]);
  });

  it("flags a required key of the wrong type", async () => {
    const r = await drift({ ...PROBE_NO_LISTINGS, "results[].price": "number" });
    assert.deepEqual(r.endpoints[0].paths, ["[].price"]);
  });

  it("flags a probe whose rows lost a required key even while the listed-only keys are absent too", async () => {
    const r = await drift(without(PROBE_NO_LISTINGS, "results[].price", "results[].card.cardNo"));
    assert.deepEqual(r.endpoints[0].paths, ["[].card.cardNo", "[].price"]);
  });

  it("does not demand the three keys even in a probe that has other optional-looking ones", async () => {
    const r = await drift({ ...PROBE_NO_LISTINGS, "results[].active": "boolean", "results[].sellerId": "string" });
    assert.equal(r.outcome, "ok");
  });
});

describe("what the fake serves for the sheet", () => {
  it("synthShape requires every blank-row key and none of the listed-only keys, but serves them", () => {
    const { served, required } = synthShape("sheet");
    for (const key of LISTED_ONLY) {
      assert.ok(served[`[].${key}`], `${key} is served on a listed row`);
      assert.equal(required.has(`[].${key}`), false, `${key} is optional`);
    }
    for (const key of ["productId", "cardId", "price", "condition", "availableQuantity", "productType", "card.id", "card.cardNo"]) {
      assert.ok(required.has(`[].${key}`), `${key} is required`);
    }
  });

  it("the other synthesised shapes require everything they serve", () => {
    for (const which of ["profile", "orderHistory"]) {
      const { served, required } = synthShape(which);
      assert.deepEqual([...required].sort(), Object.keys(served).sort(), which);
    }
  });

  it("a blank row has none of the three keys, not even null", () => {
    const rows = synthSheet(ROWS, state(), "near_mint", 0);
    assert.equal(rows.length, 2);
    for (const row of rows) for (const k of LISTED_ONLY) assert.equal(k in row, false, k);
  });

  it("an \"all\" read shows blank rows even for a card the namespace has listed", () => {
    const rows = synthSheet(ROWS, state([listing()]), "all", 0);
    for (const row of rows) for (const k of LISTED_ONLY) assert.equal(k in row, false, k);
  });

  it("a listed row carries all three as strings; no photo falls back to BSC's default images", () => {
    const [listed, blank] = synthSheet(ROWS, state([listing()]), "near_mint", 0);
    assert.equal(listed.sellerSku, "1|1");
    assert.equal(listed.sellerImgFront, DEFAULT_IMG_FRONT);
    assert.equal(listed.sellerImgBack, DEFAULT_IMG_BACK);
    assert.equal("sellerSku" in blank, false, "the next card is still blank");
  });

  it("a listed row keeps its own photos", () => {
    const [listed] = synthSheet(ROWS, state([listing({ sellerImgFront: "f.jpg", sellerImgBack: "b.jpg" })]), "near_mint", 0);
    assert.equal(listed.sellerImgFront, "f.jpg");
    assert.equal(listed.sellerImgBack, "b.jpg");
  });

  it("sheetAnswer wraps the rows as {results}, in order", () => {
    const rows = synthSheet(ROWS, state(), "near_mint", 0);
    const wire = sheetAnswer(rows);
    assert.deepEqual(Object.keys(wire), ["results"]);
    assert.equal(wire.results, rows);
    assert.deepEqual(sheetAnswer([]), { results: [] });
  });
});
