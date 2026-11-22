/**
 * Unit tests for convex/lib/pairing/names.ts.
 *
 * Covers: the ladder's normalisation (the shared entity-name tokens minus the
 * generational suffix tokens), the standalone-`v` quirk, NEO-643's accent and
 * stray-backslash folds, last-name extraction, and every rung of the
 * player-name ladder — exact, surname-only, single initial,
 * truncated-first-name prefix with its 2-character floor, and the
 * disagreement case. Plus team matching by equality and by containment.
 */

import { describe, expect, test } from "vitest";

import {
  MIN_PREFIX_CHARS,
  ladderPlayerName,
  lastName,
  playerNamesMatch,
  teamNamesMatch,
} from "./names";

describe("ladderPlayerName", () => {
  test("lowercases", () => {
    expect(ladderPlayerName("Walker BUEHLER")).toBe("walker buehler");
  });

  test.each([
    ["Ken Griffey Jr.", "ken griffey"],
    ["Ken Griffey Jr", "ken griffey"],
    ["Cal Ripken Sr.", "cal ripken"],
    ["Robert Griffin III", "robert griffin"],
    ["Robert Griffin II", "robert griffin"],
    ["Robert Griffin IV", "robert griffin"],
    ["Griffey, Jr.", "griffey"],
  ])("drops generational suffix tokens: %s", (raw, expected) => {
    expect(ladderPlayerName(raw)).toBe(expected);
  });

  test.each([
    ["P. Mahomes", "p mahomes"],
    ["Shaquille O'Neal", "shaquille oneal"],
    // The shared reading turns a hyphen into a space (NEO-643; the ladder used
    // to delete it, fusing "Jean-Luc" into "jeanluc").
    ["Jean-Luc Picard", "jean luc picard"],
    ["C. J. Kayfus", "cj kayfus"],
    ["C.J. Kayfus", "cj kayfus"],
  ])("strips punctuation the way the identity key does: %s", (raw, expected) => {
    expect(ladderPlayerName(raw)).toBe(expected);
  });

  test("a comma or ampersand is a word break, not deleted", () => {
    expect(ladderPlayerName("Smith, John")).toBe("smith john");
    expect(ladderPlayerName("Ruth&Gehrig")).toBe("ruth gehrig");
  });

  test("collapses whitespace and trims", () => {
    expect(ladderPlayerName("  Walker   Buehler  ")).toBe("walker buehler");
  });

  test("folds accents and deletes BSC's stray backslash", () => {
    expect(ladderPlayerName("Wilmer Ríos")).toBe("wilmer rios");
    expect(ladderPlayerName("Wilmer R\\ios")).toBe("wilmer rios");
  });

  test("standalone v quirk is kept", () => {
    // A lone `v` token is dropped from ANYWHERE in the name, not just a
    // trailing Roman-numeral suffix. Kept deliberately (documented in
    // names.ts): this test makes the quirk a decision, not a bug.
    expect(ladderPlayerName("Bobby V")).toBe("bobby");
  });

  test("v inside a word is untouched", () => {
    expect(ladderPlayerName("Vlad Guerrero")).toBe("vlad guerrero");
  });

  test("empty string", () => {
    expect(ladderPlayerName("")).toBe("");
  });
});

describe("lastName", () => {
  test("multi part", () => {
    expect(lastName("walker buehler")).toBe("buehler");
  });

  test("single part", () => {
    expect(lastName("buehler")).toBe("buehler");
  });

  test("three parts takes the last", () => {
    expect(lastName("jean luc picard")).toBe("picard");
  });
});

describe("playerNamesMatch", () => {
  test("identical names are exact", () => {
    expect(playerNamesMatch("Walker Buehler", "Walker Buehler")).toEqual({
      match: true,
      exact: true,
    });
  });

  test("case and suffix differences still exact", () => {
    // Both normalise to the same string, so this is an exact match.
    expect(playerNamesMatch("KEN GRIFFEY JR.", "Ken Griffey")).toEqual({
      match: true,
      exact: true,
    });
  });

  test("NEO-643: BSC's backslash for an accent pairs with the accented name, exactly", () => {
    expect(playerNamesMatch("Wilmer R\\ios", "Wilmer Ríos")).toEqual({
      match: true,
      exact: true,
    });
    expect(playerNamesMatch("W. R\\ios", "Wilmer Rios").match).toBe(true);
  });

  test("an accented surname matches across accents on the fuzzy rungs too", () => {
    const result = playerNamesMatch("J. Ramírez", "Jose Ramirez");
    expect(result.match).toBe(true);
    expect(result.exact).toBe(false);
  });

  test("surname-only front matches full-name back", () => {
    // The headline fix from the source commit: a front printing only
    // "BUEHLER" must pair with a back reading "Walker Buehler".
    const result = playerNamesMatch("BUEHLER", "Walker Buehler");
    expect(result.match).toBe(true);
    expect(result.exact).toBe(false);
  });

  test("surname-only match is symmetric", () => {
    const result = playerNamesMatch("Walker Buehler", "BUEHLER");
    expect(result.match).toBe(true);
    expect(result.exact).toBe(false);
  });

  test.each([
    ["P. Mahomes", "Patrick Mahomes"],
    ["Patrick Mahomes", "P. Mahomes"],
  ])("single initial matches full first name: %s vs %s", (a, b) => {
    const result = playerNamesMatch(a, b);
    expect(result.match).toBe(true);
    expect(result.exact).toBe(false);
  });

  test("single initial that does not prefix is rejected", () => {
    expect(playerNamesMatch("T. Mahomes", "Patrick Mahomes").match).toBe(false);
  });

  test.each([
    ["Rob Gronkowski", "Robert Gronkowski"],
    ["Pat Mahomes", "Patrick Mahomes"],
    ["Robert Gronkowski", "Rob Gronkowski"],
  ])("truncated first-name prefix matches: %s vs %s", (a, b) => {
    const result = playerNamesMatch(a, b);
    expect(result.match).toBe(true);
    expect(result.exact).toBe(false);
  });

  test("prefix floor is driven by the production constant", () => {
    // A first name shorter than the floor may only match through the
    // single-initial rung, which requires a genuine prefix.
    const shorter = "x".repeat(MIN_PREFIX_CHARS - 1);
    expect(playerNamesMatch(`${shorter} Smith`, "Adam Smith").match).toBe(false);
  });

  test("different surnames never match", () => {
    expect(playerNamesMatch("Walker Buehler", "Walker Kershaw").match).toBe(false);
  });

  test("different first names with same surname do not match", () => {
    expect(playerNamesMatch("Walker Buehler", "Clayton Buehler").match).toBe(false);
  });
});

describe("ladderPlayerName and playerNamesMatch: a hyphen is a space (NEO-643)", () => {
  test("a hyphenated name is the spaced name, exactly", () => {
    expect(ladderPlayerName("Smith-Jones")).toBe("smith jones");
    expect(playerNamesMatch("Smith-Jones", "Smith Jones")).toEqual({ match: true, exact: true });
    expect(playerNamesMatch("Shin-Soo Choo", "Shin Soo Choo")).toEqual({ match: true, exact: true });
  });

  test("two hyphenated first names that differ stay apart", () => {
    expect(playerNamesMatch("Min-jae Kim", "Jae-min Kim").match).toBe(false);
  });
});

describe("teamNamesMatch", () => {
  test("identical is exact", () => {
    expect(teamNamesMatch("Dodgers", "Dodgers")).toEqual({ match: true, exact: true });
  });

  test("case and whitespace insensitive exact", () => {
    expect(teamNamesMatch("  DODGERS ", "dodgers")).toEqual({
      match: true,
      exact: true,
    });
  });

  test.each([
    ["Chiefs", "Kansas City Chiefs"],
    ["Kansas City Chiefs", "Chiefs"],
  ])("containment is a fuzzy match: %s vs %s", (a, b) => {
    const result = teamNamesMatch(a, b);
    expect(result.match).toBe(true);
    expect(result.exact).toBe(false);
  });

  test("NEO-643: folds accents and the stray backslash", () => {
    expect(teamNamesMatch("Mexico City Diablos Rojos", "México City Diablos Rojos")).toEqual({
      match: true,
      exact: true,
    });
    expect(teamNamesMatch("M\\exico", "México")).toEqual({ match: true, exact: true });
  });

  test("NEO-643: a hyphen is a space", () => {
    expect(teamNamesMatch("Wilkes-Barre Barons", "Wilkes Barre Barons")).toEqual({
      match: true,
      exact: true,
    });
    expect(teamNamesMatch("Wilkes - Barre Barons", "Wilkes-Barre Barons")).toEqual({
      match: true,
      exact: true,
    });
    expect(teamNamesMatch("Barons", "Wilkes-Barre Barons").match).toBe(true);
    expect(teamNamesMatch("Wilkes Barre", "Wilkes-Barre Barons")).toEqual({
      match: true,
      exact: false,
    });
  });

  test("unrelated teams do not match", () => {
    expect(teamNamesMatch("Chiefs", "Dodgers").match).toBe(false);
  });
});
