/**
 * NEO-643 — one name matcher: the cross-matcher vector suite.
 *
 * Jason wants ONE reading of a name everywhere. Every vector below must get the
 * SAME verdict from every matcher that answers "same name?": the identity key
 * (`normalizeEntityName`), `rosterKey`, the ordered key, names-first pairing,
 * the ladder's exact rung, `nameKey` and `checklistNameKey`. A vector that
 * splits the matchers is the bug this ticket exists to remove. The set-label
 * matcher (`computeMatches`) is checked on its own labels at the bottom.
 *
 * Junk characters are written as escapes so the file shows what is under test.
 */
import { describe, expect, test } from "vitest";
import {
  normalizeEntityName,
  normalizeOrderedEntityName,
  rosterKey,
} from "./normalize-name";
import { nameKey } from "../cards/card-name";
import { checklistNameKey } from "../checklists/match-published-checklist";
import { pairNamesFirst } from "../cards/pair-names-first";
import { playerNamesMatch, ladderPlayerName } from "../../convex/lib/pairing/names";
import { computeMatches } from "../../convex/setReconciliation";

const ZWSP = "\u200B";
const SHY = "\u00AD";
const REPLACEMENT = "\uFFFD";

/** Every matcher's verdict on "are these two the same name?". */
const verdicts = (a: string, b: string): Record<string, boolean> => ({
  identityKey: normalizeEntityName(a) === normalizeEntityName(b),
  orderedKey: normalizeOrderedEntityName(a) === normalizeOrderedEntityName(b),
  rosterKey: rosterKey([a]) === rosterKey([b]),
  nameKey: nameKey(a) === nameKey(b),
  checklistNameKey: checklistNameKey(a) === checklistNameKey(b),
  ladderExact: playerNamesMatch(a, b).exact,
  ladderKey: ladderPlayerName(a) === ladderPlayerName(b),
  namesFirstByName: pairNamesFirst(
    [{ names: [a], number: "12" }],
    [{ names: [b], number: "SIG-1" }],
  ).pairs.some((p) => p.by === "name"),
});

const MUST_MATCH: Array<[string, string, string]> = [
  ["backslash for the accent", "Wilmer R\\ios", "Wilmer Ríos"],
  ["backslash against the unaccented spelling", "Wilmer R\\ios", "Wilmer Rios"],
  ["accented against unaccented", "Wilmer Ríos", "Wilmer Rios"],
  ["two backslashes", "Jos\\e Ram\\irez", "José Ramírez"],
  ["zero-width space inside a word", `Mi${ZWSP}ke Trout`, "Mike Trout"],
  ["soft hyphen inside a word", `Mi${SHY}ke Trout`, "Mike Trout"],
  ["backslash before an apostrophe", "O\\'Neal", "O'Neal"],
  ["decomposed accent against composed", "Jose\u0301 Ramirez", "José Ramírez"],
  ["case", "MIKE TROUT", "mike trout"],
  ["left-to-right mark inside a word", "Mi\u200Eke Trout", "Mike Trout"],
  ["bidi isolate around a name", "\u2066Mike Trout\u2069", "Mike Trout"],
  ["Mongolian vowel separator and U+061C", "Mi\u180Eke Tr\u061Cout", "Mike Trout"],
  ["variation selector", "Mike\uFE0F Trout", "Mike Trout"],
  ["acute stand-in for the accent", "Jos\u00B4e Ram\u00B4irez", "José Ramírez"],
  ["diaeresis and cedilla stand-ins", "Mu\u00A8ller Fran\u00B8cois", "Müller François"],
  ["grave accent stand-in", "Jos`e Ram`irez", "José Ramírez"],
  ["full-width letters", "\uFF2Dike Trout", "Mike Trout"],
  ["ligature", "\uFB01nn Wolfhard", "Finn Wolfhard"],
  ["a control character is a space", "Mike\u0000Trout", "Mike Trout"],
];

const MUST_STAY_APART: Array<[string, string, string]> = [
  ["a different letter, not junk", "Wilmer Rios", "Wilmer Ros"],
  ["a replacement character is a lost letter", `R${REPLACEMENT}os`, "Rios"],
  ["initials in a different order", "A. J. Smith", "J. A. Smith"],
  ["Ø is not O", "Søren Kierkegaard", "Soren Kierkegaard"],
  ["ß is not ss", "Strauß", "Strauss"],
  ["a question mark is not a letter", "R?os", "Rios"],
  ["a caret is a separator, not junk", "Ri^os", "Rios"],
  ["a slash is a separator, not junk", "Ri/os", "Rios"],
];

describe("one name matcher: names that must match", () => {
  test.each(MUST_MATCH)("%s: %j = %j in every matcher", (_why, a, b) => {
    const v = verdicts(a, b);
    expect(Object.entries(v).filter(([, same]) => !same).map(([k]) => k)).toEqual([]);
    // Symmetric.
    expect(Object.values(verdicts(b, a)).every(Boolean)).toBe(true);
  });
});

describe("one name matcher: names that must stay apart", () => {
  test.each(MUST_STAY_APART)("%s: %j is not %j in any matcher", (_why, a, b) => {
    const v = verdicts(a, b);
    expect(Object.entries(v).filter(([, same]) => same).map(([k]) => k)).toEqual([]);
  });

  test("a generational suffix: the keys keep it, the ladder drops it (its own rule, unchanged)", () => {
    const v = verdicts("Ken Griffey Jr.", "Ken Griffey");
    expect(v.identityKey).toBe(false);
    expect(v.rosterKey).toBe(false);
    expect(v.nameKey).toBe(false);
    expect(v.checklistNameKey).toBe(false);
    expect(v.namesFirstByName).toBe(false);
    // The ladder strips suffix tokens before comparing, so it calls this EXACT
    // (names.test.ts pins the same). The only matcher allowed to differ.
    expect(v.ladderExact).toBe(true);
    expect(playerNamesMatch("Ken Griffey Jr.", "Ken Griffey")).toEqual({ match: true, exact: true });
  });
});

describe("one name matcher: a backslash is deleted, not turned into a space", () => {
  test("Smith\\Jones keys as one word in every key", () => {
    expect(normalizeEntityName("Smith\\Jones")).toBe("smithjones");
    expect(normalizeOrderedEntityName("Smith\\Jones")).toBe("smithjones");
    expect(rosterKey(["Smith\\Jones"])).toBe("smithjones");
    expect(nameKey("Smith\\Jones")).toBe("smithjones");
    expect(checklistNameKey("Smith\\Jones")).toBe("smithjones");
    expect(ladderPlayerName("Smith\\Jones")).toBe("smithjones");
  });
});

describe("one name matcher: names-first pairing after the fold (rule 7)", () => {
  const card = (number: string, name: string) => ({ names: [name], number });

  test("a backslash spelling pairs by name with its accented twin, numbers differing", () => {
    const r = pairNamesFirst([card("12", "Wilmer R\\ios")], [card("SIG-WR", "Wilmer Ríos")]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ by: "name", numbersAgree: false });
    expect(r.tiedLeft).toEqual([]);
  });

  test("folding makes a second candidate share the name: both stay tied and unmatched", () => {
    // Left holds two cards for the player once folded; the right has one with no
    // number to pick between them. The first candidate must NOT take it.
    const r = pairNamesFirst(
      [card("1", "Wilmer R\\ios"), card("2", "Wilmer Rios")],
      [card("NNO", "Wilmer Ríos")],
    );
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft.sort()).toEqual([0, 1]);
    expect(r.tiedRight).toEqual([0]);
  });

  test("the tie is the same whichever order the candidates are listed", () => {
    const r = pairNamesFirst(
      [card("2", "Wilmer Rios"), card("1", "Wilmer R\\ios")],
      [card("NNO", "Wilmer Ríos")],
    );
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft.sort()).toEqual([0, 1]);
  });

  test("a number still decides inside the folded group", () => {
    const r = pairNamesFirst(
      [card("1", "Wilmer R\\ios"), card("2", "Wilmer Rios")],
      [card("2", "Wilmer Ríos")],
    );
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ leftIndex: 1, rightIndex: 0, numbersAgree: true });
    expect(r.tiedLeft).toEqual([]);
  });

  test("different players folded apart do not pair by name", () => {
    const r = pairNamesFirst([card("1", "Wilmer Rios")], [card("1", "Wilmer Ros")]);
    expect(r.pairs.every((p) => p.by !== "name")).toBe(true);
  });
});

describe("one name matcher: set labels in computeMatches", () => {
  const item = (value: string) => ({ value, platformValue: `pv-${value}` });

  test("a backslash label pairs with the accented label at confidence 1", () => {
    const bsc = "2026 Panini Liga Mexicana de B\\eisbol Stickers";
    const sl = "2026 Panini Liga Mexicana de Béisbol Stickers";
    const r = computeMatches([item(bsc)], [item(sl)]);
    expect(r.autoMatched).toHaveLength(1);
    expect(r.autoMatched[0].confidence).toBe(1);
    expect(r.unmatchedBsc).toEqual([]);
    expect(r.unmatchedSl).toEqual([]);
    expect(normalizeOrderedEntityName(bsc)).toBe(normalizeOrderedEntityName(sl));
  });

  test("a zero-width character label pairs with the clean label", () => {
    const r = computeMatches([item(`Gold Re${ZWSP}fractor`)], [item("Gold Refractor")]);
    expect(r.autoMatched).toHaveLength(1);
    expect(r.autoMatched[0].confidence).toBe(1);
  });

  test("two labels the fold makes identical are a tie: neither is auto-paired", () => {
    const r = computeMatches(
      [item("Béisbol Red")],
      [item("Beisbol Red"), item("B\\eisbol Red")],
    );
    expect(r.autoMatched).toEqual([]);
  });
});
