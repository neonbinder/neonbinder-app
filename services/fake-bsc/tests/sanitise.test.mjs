// The catalogue field allowlist (src/sanitise.ts), adversarially: seller and
// PII-shaped fields at any depth, type confusion under allowed names, and
// values that are credentials whatever key they sit under.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const s = require("../dist/src/sanitise.js");

const json = (v) => JSON.stringify(v);

describe("filters allowlist", () => {
  it("keeps exactly the facet fields the selector parser reads", () => {
    const input = {
      aggregations: {
        sport: [{ label: "Baseball", slug: "baseball", count: 10, active: false, sellerCount: 3 }],
        year: [{ label: "1996", slug: "1996", count: 2, active: true }],
        sellerName: [{ label: "Jane Q", slug: "jane", count: 1 }],
      },
      total: 5,
      user: { email: "jane@example.com" },
    };
    const out = s.sanitiseCatalogue("filters", input);
    assert.deepEqual(out.value, {
      aggregations: {
        sport: [{ label: "Baseball", slug: "baseball", count: 10, active: false }],
        year: [{ label: "1996", slug: "1996", count: 2, active: true }],
      },
    });
    assert.deepEqual(out.dropped, ["aggregations.sellerName", "aggregations.sport[].sellerCount", "total", "user"]);
  });

  it("drops a facet item whose label is an object hiding PII", () => {
    const out = s.sanitiseCatalogue("filters", { aggregations: { setName: [{ label: { email: "x@y.com" }, slug: "s" }] } });
    assert.deepEqual(out.value, { aggregations: { setName: [{ slug: "s" }] } });
    assert.ok(!json(out.value).includes("x@y.com"));
    assert.deepEqual(out.dropped, ["aggregations.setName[].label"]);
  });
});

describe("results allowlist", () => {
  const row = {
    id: "abc123",
    setName: "1996-score",
    players: "Ken Griffey Jr.",
    cardNo: "24",
    playerAttribute: "RC",
    playerAttributeDesc: "",
    cardNoOrder: 24,
    cardNoSequence: 1,
    cardNoSort: "0024",
    imgFront: "/Catalog/a.jpg",
    imgBack: "/Catalog/b.jpg",
    sellerId: "s-1",
    sellerStoreName: "Jane's Cards",
    price: "1.00",
    listings: [{ sellerId: "s-2", sellerEmailId: "seller@example.com", price: "0.25" }],
    buyer: { address: { line1: "1 Main St" }, phone: "555-0100" },
  };

  it("keeps the parsed fields and the row's own ids, nothing else", () => {
    const out = s.sanitiseCatalogue("results", [row]);
    assert.deepEqual(out.value, [
      { id: "abc123", setName: "1996-score", players: "Ken Griffey Jr.", cardNo: "24", playerAttribute: "RC", playerAttributeDesc: "", cardNoOrder: 24, cardNoSequence: 1, cardNoSort: "0024" },
    ]);
    for (const leak of ["s-1", "Jane's Cards", "seller@example.com", "1 Main St", "555-0100", "/Catalog/a.jpg", "1.00"]) {
      assert.ok(!json(out.value).includes(leak), `leaked ${leak}`);
    }
    assert.deepEqual(out.dropped, ["[].buyer", "[].imgBack", "[].imgFront", "[].listings", "[].price", "[].sellerId", "[].sellerStoreName"]);
  });

  it("drops an allowed key carrying a nested object, at any depth", () => {
    const out = s.sanitiseCatalogue("results", [{ id: "1", players: { name: "x", sellerEmail: "a@b.co" }, setName: ["nested", { email: "c@d.co" }] }]);
    assert.deepEqual(out.value, [{ id: "1" }]);
    assert.ok(out.dropped.includes("[].players") && out.dropped.includes("[].setName"));
  });

  it("drops credential-shaped values whatever key they sit under", () => {
    const out = s.sanitiseCatalogue("results", [
      { id: "1", players: "Contact owner@shop.example for this card", playerAttributeDesc: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.sig", setName: "Bearer abcdefghijklmnopqrstuvwxyz" },
    ]);
    assert.deepEqual(out.value, [{ id: "1" }]);
  });

  it("drops strings over their bound rather than truncating", () => {
    const out = s.sanitiseCatalogue("results", [{ id: "1", cardNo: "9".repeat(65) }]);
    assert.deepEqual(out.value, [{ id: "1" }]);
  });

  it("accepts playerAttribute as a string or a string list, nothing else", () => {
    assert.deepEqual(s.sanitiseCatalogue("results", [{ playerAttribute: ["AU", "SN25"] }]).value, [{ playerAttribute: ["AU", "SN25"] }]);
    assert.deepEqual(s.sanitiseCatalogue("results", [{ playerAttribute: [{ seller: "x" }] }]).value, [{}]);
  });

  it("refuses a whole list that is over the row cap", () => {
    const out = s.sanitiseCatalogue("results", Array.from({ length: 5001 }, () => ({ id: "1" })));
    assert.equal(out.value, undefined);
    assert.deepEqual(out.dropped, ["$"]);
  });

  it("refuses an object where the list belongs", () => {
    const out = s.sanitiseCatalogue("results", { results: [row] });
    assert.equal(out.value, undefined);
  });
});

describe("card-listing allowlist", () => {
  it("keeps teamName, playerAttribute and the card id; drops the listings and sellers", () => {
    const out = s.sanitiseCatalogue("cardListing", {
      id: "c1",
      teamName: "Seattle Mariners",
      playerAttribute: "AU, SN25",
      listings: [{ sellerId: "s", sellerStoreName: "Store", price: 3, seller: { email: "x@y.co" } }],
      lowestPrice: 0.25,
      sellerProfile: { sellerId: "s" },
    });
    assert.deepEqual(out.value, { id: "c1", teamName: "Seattle Mariners", playerAttribute: "AU, SN25" });
    assert.deepEqual(out.dropped, ["listings", "lowestPrice", "sellerProfile"]);
  });

  it("is not fooled by prototype keys", () => {
    const input = JSON.parse('{"__proto__": {"teamName": "x"}, "constructor": {"a": 1}, "toString": "y"}');
    const out = s.sanitiseCatalogue("cardListing", input);
    assert.deepEqual(out.value, {});
    assert.equal(out.dropped.length, 3);
  });
});

describe("routing and paths", () => {
  it("names only the three catalogue endpoints", () => {
    assert.equal(s.catalogueEndpointFor("POST", "search/bulk-upload/filters"), "filters");
    assert.equal(s.catalogueEndpointFor("post", "search/bulk-upload/results"), "results");
    assert.equal(s.catalogueEndpointFor("GET", "marketplace/card/abc/card-listing"), "cardListing");
    assert.equal(s.catalogueEndpointFor("GET", "search/bulk-upload/results"), null);
    assert.equal(s.catalogueEndpointFor("POST", "seller/bulk-upload/results"), null);
    assert.equal(s.catalogueEndpointFor("GET", "marketplace/card/../x/card-listing"), null);
  });

  it("says which shape paths the allowlist covers", () => {
    assert.equal(s.specAllowsPath(s.SPECS.filters, "aggregations.sport[].slug"), true);
    assert.equal(s.specAllowsPath(s.SPECS.filters, "aggregations.seller[].slug"), false);
    assert.equal(s.specAllowsPath(s.SPECS.results, "[].cardNo"), true);
    assert.equal(s.specAllowsPath(s.SPECS.results, "[].sellerId"), false);
    assert.equal(s.specAllowsPath(s.SPECS.cardListing, "playerAttribute[]"), true);
    assert.ok(s.specLeafPaths(s.SPECS.cardListing).includes("teamName"));
  });

  it("carries a version", () => {
    assert.equal(typeof s.SANITISE_ALLOWLIST_VERSION, "number");
  });
});
