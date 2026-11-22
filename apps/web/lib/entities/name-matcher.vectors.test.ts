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
 * ONE deliberate exception, ruled by Jason on 2026-11-22: a hyphen. The
 * COMPARISON matchers (the `*Compare*` keys, `rosterCompareKey`, `nameKey`,
 * `checklistNameKey`, the ladder, names-first pairing) read it as a space, while
 * the STORED identity keys (`normalizeEntityName`, `normalizeOrderedEntityName`,
 * `rosterKey`) keep it inside its token, byte-identical to what is on disk.
 * The hyphen vectors therefore have their own list and their own two-sided
 * assertion.
 *
 * Junk characters are written as escapes so the file shows what is under test.
 */
import { describe, expect, test } from "vitest";
import {
  entityNameCompareKey,
  normalizeEntityName,
  normalizeOrderedEntityName,
  orderedEntityNameCompareKey,
  rosterCompareKey,
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

/** The STORED identity keys' verdicts: a hyphen stays inside its token. */
const storedVerdicts = (a: string, b: string): Record<string, boolean> => ({
  identityKey: normalizeEntityName(a) === normalizeEntityName(b),
  orderedKey: normalizeOrderedEntityName(a) === normalizeOrderedEntityName(b),
  rosterKey: rosterKey([a]) === rosterKey([b]),
});

/** The COMPARISON matchers' verdicts: a hyphen is a space. */
const comparisonVerdicts = (a: string, b: string): Record<string, boolean> => ({
  identityCompareKey: entityNameCompareKey(a) === entityNameCompareKey(b),
  orderedCompareKey: orderedEntityNameCompareKey(a) === orderedEntityNameCompareKey(b),
  rosterCompareKey: rosterCompareKey([a]) === rosterCompareKey([b]),
  nameKey: nameKey(a) === nameKey(b),
  checklistNameKey: checklistNameKey(a) === checklistNameKey(b),
  ladderExact: playerNamesMatch(a, b).exact,
  ladderKey: ladderPlayerName(a) === ladderPlayerName(b),
  namesFirstByName: pairNamesFirst(
    [{ names: [a], number: "12" }],
    [{ names: [b], number: "SIG-1" }],
  ).pairs.some((p) => p.by === "name"),
});

/** Every matcher's verdict on "are these two the same name?". */
const verdicts = (a: string, b: string): Record<string, boolean> => ({
  ...storedVerdicts(a, b),
  ...comparisonVerdicts(a, b),
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
  // Every dash form but the ASCII hyphen-minus was always a separator in the
  // stored key too, so these agree in the stored keys as well (as on main).
  ["a non-breaking hyphen against a space", "Smith\u2011Jones", "Smith Jones"],
  ["an en dash against a space", "Smith\u2013Jones", "Smith Jones"],
  ["a full-width hyphen against a space", "Smith\uFF0DJones", "Smith Jones"],
];

/**
 * NEO-643, Jason 2026-11-21 and 2026-11-22: a hyphen matches a space in every
 * COMPARISON, and the stored key still tells them apart. Each pair must be the
 * same name to every comparison matcher and two different keys to every stored
 * identity key.
 */
const HYPHEN_IS_A_SPACE_WHEN_COMPARING: Array<[string, string, string]> = [
  ["a hyphen against a space", "Smith-Jones", "Smith Jones"],
  ["a given name with a hyphen", "Shin-Soo Choo", "Shin Soo Choo"],
  ["a hyphenated place against its spaced form", "Wilkes-Barre", "Wilkes Barre"],
  ["a hyphenated team against its spaced form", "Wilkes-Barre Barons", "Wilkes Barre Barons"],
  ["a hyphenated set name against its spaced form", "Topps-Chrome", "Topps Chrome"],
  ["a spaced hyphen against a space", "Smith - Jones", "Smith Jones"],
  ["a figure dash against a hyphen", "Smith\u2012Jones", "Smith-Jones"],
  ["a hyphen between initials joins them", "J-P Arencibia", "JP Arencibia"],
  ["a hyphen between initials against dotted initials", "J-P Arencibia", "J.P. Arencibia"],
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
  ["a hyphen is a space, not a deletion", "Smith-Jones", "Smithjones"],
];

describe("one name matcher: names that must match", () => {
  test.each(MUST_MATCH)("%s: %j = %j in every matcher", (_why, a, b) => {
    const v = verdicts(a, b);
    expect(Object.entries(v).filter(([, same]) => !same).map(([k]) => k)).toEqual([]);
    // Symmetric.
    expect(Object.values(verdicts(b, a)).every(Boolean)).toBe(true);
  });
});

describe("one name matcher: a hyphen is a space when COMPARING, and not in a stored key (NEO-643)", () => {
  test.each(HYPHEN_IS_A_SPACE_WHEN_COMPARING)(
    "%s: %j = %j in every comparison matcher, and two keys in every stored key",
    (_why, a, b) => {
      expect(
        Object.entries(comparisonVerdicts(a, b)).filter(([, same]) => !same).map(([k]) => k),
      ).toEqual([]);
      expect(
        Object.entries(comparisonVerdicts(b, a)).filter(([, same]) => !same).map(([k]) => k),
      ).toEqual([]);
      expect(
        Object.entries(storedVerdicts(a, b)).filter(([, same]) => same).map(([k]) => k),
      ).toEqual([]);
    },
  );

  test('"Min-jae Kim" and "Jae-min Kim" are two people in every stored key', () => {
    // With the dash gone the token sort would put both on "jae kim min" and
    // collide two real players on one row.
    expect(normalizeEntityName("Min-jae Kim")).not.toBe(normalizeEntityName("Jae-min Kim"));
    expect(normalizeOrderedEntityName("Min-jae Kim")).not.toBe(normalizeOrderedEntityName("Jae-min Kim"));
    expect(rosterKey(["Min-jae Kim"])).not.toBe(rosterKey(["Jae-min Kim"]));
  });

  test('"Min-jae Kim" and "Jae-min Kim" stay apart in the order-keeping comparison matchers', () => {
    const v = comparisonVerdicts("Min-jae Kim", "Jae-min Kim");
    expect(v.orderedCompareKey).toBe(false);
    expect(v.nameKey).toBe(false);
    expect(v.checklistNameKey).toBe(false);
    expect(v.ladderExact).toBe(false);
    expect(v.ladderKey).toBe(false);
    // The two sorted comparison keys read them as the same three words, as they
    // always read "Min Jae Kim" and "Jae Min Kim"; only the stored key matters
    // for identity, and it keeps them apart (above).
    expect(v.identityCompareKey).toBe(true);
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

describe("one name matcher: what a hyphen keys as (NEO-643)", () => {
  test("Smith-Jones is two words in every comparison key and one in every stored key", () => {
    // Comparison: a hyphen is a space.
    expect(entityNameCompareKey("Smith-Jones")).toBe("jones smith");
    expect(orderedEntityNameCompareKey("Smith-Jones")).toBe("smith jones");
    expect(rosterCompareKey(["Smith-Jones"])).toBe("jones smith");
    expect(nameKey("Smith-Jones")).toBe("smith jones");
    expect(checklistNameKey("Smith-Jones")).toBe("smith jones");
    expect(ladderPlayerName("Smith-Jones")).toBe("smith jones");
    // Stored: the hyphen stays inside its token, as on main.
    expect(normalizeEntityName("Smith-Jones")).toBe("smith-jones");
    expect(normalizeOrderedEntityName("Smith-Jones")).toBe("smith-jones");
    expect(rosterKey(["Smith-Jones"])).toBe("smith-jones");
  });

  test("a hyphen between single letters joins them like any initials, when comparing", () => {
    expect(orderedEntityNameCompareKey("J-P Arencibia")).toBe("jp arencibia");
    expect(orderedEntityNameCompareKey("J-P Arencibia")).toBe(orderedEntityNameCompareKey("J.P. Arencibia"));
    // A lone letter beside a word is not a run: "A-Rod" is two tokens.
    expect(orderedEntityNameCompareKey("A-Rod")).toBe("a rod");
    // Stored, it is the one token it always was.
    expect(normalizeOrderedEntityName("J-P Arencibia")).toBe("j-p arencibia");
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

  test("a hyphenated label pairs with its spaced label at confidence 1 (a comparison)", () => {
    const r = computeMatches([item("Topps-Chrome")], [item("Topps Chrome")]);
    expect(r.autoMatched).toHaveLength(1);
    expect(r.autoMatched[0].confidence).toBe(1);
    expect(r.unmatchedBsc).toEqual([]);
    expect(r.unmatchedSl).toEqual([]);
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
