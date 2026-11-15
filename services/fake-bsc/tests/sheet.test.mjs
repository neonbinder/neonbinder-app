// putAnswer (src/synth/sheet.ts) on its own: the derived fields of the PUT
// answer, without a server.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { putAnswer, DEFAULT_IMG_FRONT, DEFAULT_IMG_BACK } = require("../dist/src/synth/sheet.js");

const STATE = { sellerId: "seller-1" };

function listing(over = {}) {
  return {
    cardId: "c1",
    condition: "near_mint",
    productId: "p1",
    availableQuantity: 1,
    price: 1.5,
    sellerSku: null,
    sellerImgFront: "front.jpg",
    sellerImgBack: "back.jpg",
    updatedTimestamp: "2026-11-14T00:00:00.000000",
    card: { year: 2024, sport: "baseball" },
    ...over,
  };
}

const answerOf = (l) => putAnswer([l], STATE).listings[0];

describe("putAnswer", () => {
  it("a quantity-0 row is inactive and its seller inventory status is false", () => {
    const row = answerOf(listing({ availableQuantity: 0 }));
    assert.equal(row.active, false);
    assert.equal(row.sellerInventoryStatus, false);
    assert.equal(row.availableQuantity, 0);
  });

  it("a row with stock is active and its seller inventory status is true", () => {
    const row = answerOf(listing({ availableQuantity: 3 }));
    assert.equal(row.active, true);
    assert.equal(row.sellerInventoryStatus, true);
  });

  for (const [label, year, expected] of [
    ["the string 2024", "2024", 2024],
    ["the number 2024", 2024, 2024],
    ["a two-digit string (not a year: null, not 2024)", "24", null],
    ["null", null, null],
    ["a non-integer number", 2024.5, null],
  ]) {
    it(`card.year ${label} gives cardYear ${expected}`, () => {
      assert.equal(answerOf(listing({ card: { year: year, sport: "baseball" } })).cardYear, expected);
    });
  }

  it("a listing with no card gives a null cardYear and a null sportId", () => {
    const row = answerOf(listing({ card: null }));
    assert.equal(row.cardYear, null);
    assert.equal(row.sportId, null);
  });

  it("a string card.sport is echoed as sportId; a non-string one gives null", () => {
    assert.equal(answerOf(listing({ card: { sport: "baseball" } })).sportId, "baseball");
    for (const sport of [5, null, undefined, ["baseball"], { id: "baseball" }]) {
      assert.equal(answerOf(listing({ card: { sport } })).sportId, null);
    }
  });

  it("a row with no photos gets the default images, a row with photos keeps them", () => {
    const bare = answerOf(listing({ sellerImgFront: null, sellerImgBack: null }));
    assert.equal(bare.sellerImgFront, DEFAULT_IMG_FRONT);
    assert.equal(bare.sellerImgBack, DEFAULT_IMG_BACK);
    const kept = answerOf(listing());
    assert.equal(kept.sellerImgFront, "front.jpg");
    assert.equal(kept.sellerImgBack, "back.jpg");
  });
});
