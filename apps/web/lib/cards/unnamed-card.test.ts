import { describe, expect, it } from "vitest";
import { bornNameless, hasCardName, placeholderCardName } from "./unnamed-card";

describe("placeholderCardName", () => {
  it("is 'Card #n', and 'Card #NNO' for a blank number", () => {
    expect(placeholderCardName("38")).toBe("Card #38");
    expect(placeholderCardName(" 7b ")).toBe("Card #7b");
    expect(placeholderCardName("")).toBe("Card #NNO");
  });
});

describe("hasCardName", () => {
  it("is false for blank text and for NB's own placeholder, in any case or spacing", () => {
    for (const none of [undefined, "", "   ", "Card #38", "card #NNO", "Card # 7", "Card #", " Card #BDC-12 "]) {
      expect(hasCardName(none)).toBe(false);
    }
  });

  it("is true for any name a row printed, 'Checklist' and 'Team Card' included", () => {
    for (const name of ["Checklist", "Team Card", "Checklist 1-100", "Mike Trout", "Card Shop", "Card 38"]) {
      expect(hasCardName(name)).toBe(true);
    }
  });

  it("reads what placeholderCardName writes as no name", () => {
    expect(hasCardName(placeholderCardName("12"))).toBe(false);
    expect(hasCardName(placeholderCardName(""))).toBe(false);
  });
});

describe("bornNameless", () => {
  it("is true only with no player, none pending and no real name", () => {
    expect(bornNameless(undefined, [], "Card #3")).toBe(true);
    expect(bornNameless([], [], "")).toBe(true);
    expect(bornNameless([], [], undefined)).toBe(true);
    expect(bornNameless([], [], "Team Card")).toBe(false);
    expect(bornNameless(["p1"], [], "Card #3")).toBe(false);
    expect(bornNameless([], ["Mike Trout"], "Card #3")).toBe(false);
  });
});
