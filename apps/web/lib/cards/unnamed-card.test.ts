import { describe, expect, it } from "vitest";
import { bornNameless, cardSubjectName, hasCardName, placeholderCardName } from "./unnamed-card";

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

describe("cardSubjectName — the name a title carries", () => {
  it("is a name with nobody on the card, cameo or not", () => {
    expect(cardSubjectName({ cardName: "Checklist" })).toBe("Checklist");
    expect(cardSubjectName({ cardName: " Team Card ", cameoNames: ["Mike Trout"] })).toBe("Team Card");
    expect(cardSubjectName({ cardName: "Boston Red Sox" })).toBe("Boston Red Sox");
  });

  it("is nothing for a placeholder, a blank or no name", () => {
    for (const cardName of ["Card #3", "Card #NNO", "  ", "", undefined]) {
      expect(cardSubjectName({ cardName })).toBeUndefined();
    }
  });

  it("is nothing when the name only repeats the players, in any spelling the card holds", () => {
    const p = { playerNames: ["Dwight Gooden"], printedPlayerNames: ["Doc Gooden"] };
    expect(cardSubjectName({ cardName: "Dwight Gooden", ...p })).toBeUndefined();
    expect(cardSubjectName({ cardName: "Doc Gooden", ...p })).toBeUndefined();
    expect(cardSubjectName({ cardName: "Gooden", ...p })).toBeUndefined();
    expect(
      cardSubjectName({ cardName: "Pete Rose / Johnny Bench", playerNames: ["Johnny Bench", "Pete Rose"] }),
    ).toBeUndefined();
    expect(
      cardSubjectName({ cardName: "Ronald Acuna Jr.", playerNames: ["Ronald Acuña Jr."] }),
    ).toBeUndefined();
  });

  it("is nothing when the name already contains the players", () => {
    expect(
      cardSubjectName({
        cardName: "National League Leaders RBI (Kyle Schwarber / Pete Alonso)",
        playerNames: ["Kyle Schwarber", "Pete Alonso"],
      }),
    ).toBeUndefined();
    expect(
      cardSubjectName({ cardName: "Mike Trout Rookie Cup", playerNames: ["Mike Trout"] }),
    ).toBeUndefined();
  });

  it("is the name when the card has a player the name does not contain", () => {
    expect(cardSubjectName({ cardName: "It Takes Two CPC", playerNames: ["Mike Trout"] })).toBe(
      "It Takes Two CPC",
    );
    // One of two players is not both.
    expect(
      cardSubjectName({ cardName: "Mike Trout Tribute", playerNames: ["Mike Trout", "Shohei Ohtani"] }),
    ).toBe("Mike Trout Tribute");
  });

  it("is nothing when it is only a cameo, and the name when it adds to one", () => {
    expect(cardSubjectName({ cardName: "Ronald Acuña Jr.", cameoNames: ["Ronald Acuña Jr."] })).toBeUndefined();
    expect(cardSubjectName({ cardName: "Hopping to It CPC", cameoNames: ["Ronald Acuña Jr."] })).toBe(
      "Hopping to It CPC",
    );
  });
});
