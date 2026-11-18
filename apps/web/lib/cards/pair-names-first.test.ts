/**
 * NEO-591 — the names-first core (product rule 7): same roster pairs, numbers
 * only say whether they agree; a tie stays unmatched (rule 8).
 */
import { describe, expect, test } from "vitest";
import { NUMBERS_DIFFER_FACTOR, pairNamesFirst } from "./pair-names-first";
import { rosterKey } from "../entities/normalize-name";

const item = (number: string, ...names: string[]) => ({ names, number });
const brief = (r: ReturnType<typeof pairNamesFirst>) =>
  r.pairs.map((p) => [p.leftIndex, p.rightIndex, p.by, p.numbersAgree]);

describe("rosterKey", () => {
  test("folds, dedupes, sorts: order and spelling the fold absorbs do not matter", () => {
    expect(rosterKey(["Juan Soto", "Pete Alonso"])).toBe(rosterKey(["pete alonso", "Juan Soto", "Juan Soto"]));
    expect(rosterKey(["José Ramírez"])).toBe(rosterKey(["Jose Ramirez"]));
  });
  test("no names, or only blanks, is the empty key", () => {
    expect(rosterKey([])).toBe("");
    expect(rosterKey(["", "  "])).toBe("");
  });
  test("a different roster is a different key", () => {
    expect(rosterKey(["Pete Alonso"])).not.toBe(rosterKey(["Pete Alonso", "Juan Soto"]));
  });
});

describe("pairNamesFirst: the Onyx shape", () => {
  test("56 letter-numbered cards against 56 NNO rows pair 56 of 56 at 0.9", () => {
    const left = Array.from({ length: 56 }, (_, i) => item(`OV-${String.fromCharCode(65 + (i % 26))}${i}`, `Player Number${i}`));
    const right = Array.from({ length: 56 }, (_, i) => item("NNO", `Player Number${i}`));
    const r = pairNamesFirst(left, right);
    expect(r.pairs).toHaveLength(56);
    expect(r.pairs.every((p, i) => p.leftIndex === i && p.rightIndex === i)).toBe(true);
    expect(r.pairs.every((p) => p.by === "name" && !p.numbersAgree)).toBe(true);
    expect(r.pairs.every((p) => p.confidence === NUMBERS_DIFFER_FACTOR)).toBe(true);
    expect(r.tiedLeft).toEqual([]);
    expect(r.tiedRight).toEqual([]);
  });
});

describe("pairNamesFirst: same roster, one each", () => {
  test("numbers agreeing: confidence 1", () => {
    const r = pairNamesFirst([item("12", "Mike Trout")], [item("12", "Mike Trout")]);
    expect(r.pairs).toEqual([
      { leftIndex: 0, rightIndex: 0, by: "name", numbersAgree: true, confidence: 1 },
    ]);
  });

  test("numbers differing: the pair stands at 0.9", () => {
    const r = pairNamesFirst([item("12", "Mike Trout")], [item("SIG-MT", "Mike Trout")]);
    expect(r.pairs).toEqual([
      { leftIndex: 0, rightIndex: 0, by: "name", numbersAgree: false, confidence: 0.9 },
    ]);
  });

  test("the answer does not depend on list order", () => {
    const left = [item("SIG-1", "A One"), item("SIG-2", "B Two"), item("SIG-3", "C Three")];
    const right = [item("30", "C Three"), item("10", "A One"), item("20", "B Two")];
    expect(brief(pairNamesFirst(left, right))).toEqual([
      [0, 1, "name", false],
      [1, 2, "name", false],
      [2, 0, "name", false],
    ]);
  });
});

describe("pairNamesFirst: NNO against NNO", () => {
  test("agree, confidence 1, however the no-number is printed", () => {
    const r = pairNamesFirst([item("", "A One"), item("NNO", "B Two")], [item("nno", "A One"), item("#NNO", "B Two")]);
    expect(r.pairs.map((p) => [p.numbersAgree, p.confidence])).toEqual([
      [true, 1],
      [true, 1],
    ]);
  });
});

describe("pairNamesFirst: a player with several cards", () => {
  test("the number decides inside the group", () => {
    const left = [item("5", "Will Smith"), item("50", "Will Smith")];
    const right = [item("50", "Will Smith"), item("5", "Will Smith")];
    const r = pairNamesFirst(left, right);
    expect(brief(r)).toEqual([
      [0, 1, "name", true],
      [1, 0, "name", true],
    ]);
    expect(r.tiedLeft).toEqual([]);
  });

  test("case-folded, then prefix-stripped, each exactly one within the group", () => {
    const r = pairNamesFirst(
      [item("1a", "P Q"), item("BCP-12", "P Q")],
      [item("1A", "P Q"), item("12", "P Q")],
    );
    expect(brief(r)).toEqual([
      [0, 0, "name", true],
      [1, 1, "name", true],
    ]);
  });

  test("the 1:1 remainder pairs with the numbers differing", () => {
    // 5 agrees; what is left is one card and one row, whose numbers differ.
    const r = pairNamesFirst(
      [item("5", "Will Smith"), item("SIG-WS", "Will Smith")],
      [item("5", "Will Smith"), item("77", "Will Smith")],
    );
    expect(brief(r)).toEqual([
      [0, 0, "name", true],
      [1, 1, "name", false],
    ]);
    expect(r.pairs[1].confidence).toBe(0.9);
  });

  test("two Will Smiths on each side with nothing to tell them apart is a tie: nothing pairs", () => {
    const r = pairNamesFirst(
      [item("NNO", "Will Smith"), item("NNO", "Will Smith")],
      [item("A1", "Will Smith"), item("A2", "Will Smith")],
    );
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft).toEqual([0, 1]);
    expect(r.tiedRight).toEqual([0, 1]);
  });

  test("two cards, one row: the number settles one, the other is left but not tied", () => {
    const r = pairNamesFirst(
      [item("5", "Will Smith"), item("6", "Will Smith")],
      [item("6", "Will Smith")],
    );
    expect(brief(r)).toEqual([[1, 0, "name", true]]);
    expect(r.tiedLeft).toEqual([]);
  });

  test("two cards, one row, no number agreeing: a tie, neither is given the row", () => {
    const r = pairNamesFirst(
      [item("5", "Will Smith"), item("6", "Will Smith")],
      [item("SIG", "Will Smith")],
    );
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft).toEqual([0, 1]);
    expect(r.tiedRight).toEqual([0]);
  });

  test("a repeated number inside the group pins nothing down", () => {
    const r = pairNamesFirst(
      [item("5", "Will Smith"), item("5", "Will Smith")],
      [item("5", "Will Smith"), item("9", "Will Smith")],
    );
    // "5" is two cards, so it does not decide; the rest is 2 against 2.
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft).toEqual([0, 1]);
  });

  test("a tied group's members sit out the number and near-name tiers", () => {
    const r = pairNamesFirst(
      [item("NNO", "Will Smith"), item("NNO", "Will Smith"), item("7", "Other Person")],
      [item("A1", "Will Smith"), item("A2", "Will Smith"), item("7", "Someone Else")],
    );
    // "Other Person" #7 meets "Someone Else" #7 by number; the Wills stay tied.
    expect(brief(r)).toEqual([[2, 2, "number", true]]);
    expect(r.tiedLeft).toEqual([0, 1]);
  });
});

describe("pairNamesFirst: a roster is not a cameo", () => {
  test("a card that shares a player with another roster is not that roster", () => {
    const r = pairNamesFirst(
      [item("5", "Pete Alonso", "Juan Soto"), item("6", "Pete Alonso")],
      [item("6", "Pete Alonso")],
    );
    // The solo card takes the solo row by name; the pair card is left alone.
    expect(brief(r)).toEqual([[1, 0, "name", true]]);
  });

  test("a different roster pairs only as a near name on the first player, at 0.9 for the numbers", () => {
    const r = pairNamesFirst([item("SIG-A", "Pete Alonso", "Juan Soto")], [item("1", "Pete Alonso")]);
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ by: "nearName", numbersAgree: false, nameScore: 1, confidence: 0.9 });
  });

  test("the same players in a different order are the same roster", () => {
    const r = pairNamesFirst([item("1", "Pete Alonso", "Juan Soto")], [item("1", "Juan Soto", "Pete Alonso")]);
    expect(brief(r)).toEqual([[0, 0, "name", true]]);
  });
});

describe("pairNamesFirst: T2, numbers on what has no name counterpart", () => {
  test("a misspelling falls through to the number, at confidence 1", () => {
    const r = pairNamesFirst([item("7", "Jon Smyth")], [item("7", "John Smith")]);
    // Collector 9: a number-only pair whose names disagree is not certain.
    expect(r.pairs).toEqual([
      { leftIndex: 0, rightIndex: 0, by: "number", numbersAgree: true, namesDisagree: true, confidence: 0.9 },
    ]);
  });

  test("a side that names no one is not a names disagreement", () => {
    const r = pairNamesFirst([item("9")], [item("9", "Mike Trout")]);
    expect(r.pairs[0].namesDisagree).toBeUndefined();
  });

  test("a number repeated on either side pins nothing down", () => {
    expect(pairNamesFirst([item("7", "Jon Smyth")], [item("7", "A B"), item("7", "C D")]).pairs).toEqual([]);
    expect(pairNamesFirst([item("7", "A B"), item("7", "C D")], [item("7", "Jon Smyth")]).pairs).toEqual([]);
  });

  test("the guard counts the whole set, not just the leftovers", () => {
    // "7" is two cards (one already paired by name): the lone row does not take either.
    const r = pairNamesFirst(
      [item("7", "Jon Smyth"), item("7", "Mike Trout")],
      [item("7", "John Smith"), item("MT-70", "Mike Trout")],
    );
    expect(brief(r)).toEqual([[1, 1, "name", false]]);
  });

  test("as printed, then case-folded, then the set's prefix stripped", () => {
    const r = pairNamesFirst(
      [item("1a", "Aa Aa"), item("2B", "Bb Bb"), item("BCP-3", "Cc Cc")],
      [item("1A", "Xx Xx"), item("2B", "Yy Yy"), item("3", "Zz Zz")],
      { prefix: "BCP-" },
    );
    expect(brief(r)).toEqual([
      [0, 0, "number", true],
      [1, 1, "number", true],
      [2, 2, "number", true],
    ]);
  });

  test("an arbitrary letter prefix is not stripped when numbers alone decide: T-10 is not 10", () => {
    // BSC "T-10 Joe A" against SportLots "10 Bob B": two different cards.
    const r = pairNamesFirst([item("T-10", "Joe A")], [item("10", "Bob B")]);
    expect(r.pairs).toEqual([]);
  });

  test("the set's own prefix is: BCP-12 against 12 with prefix BCP- pairs by number", () => {
    const r = pairNamesFirst([item("BCP-12", "Joe A")], [item("12", "Bob B")], { prefix: "BCP-" });
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ by: "number", numbersAgree: true, namesDisagree: true });
  });

  test("stripLetterPrefix: true opts an arbitrary prefix back in, for the checklist matcher", () => {
    const r = pairNamesFirst([item("T-10", "Joe A")], [item("10", "Bob B")], { stripLetterPrefix: true });
    expect(brief(r)).toEqual([[0, 0, "number", true]]);
  });

  test("inside a multi-card roster the same rule holds: T-10 does not decide, the 1:1 remainder does", () => {
    const r = pairNamesFirst(
      [item("T-10", "Will Smith"), item("20", "Will Smith")],
      [item("10", "Will Smith"), item("20", "Will Smith")],
    );
    // 20 decides one pair; what is left is one each, so they pair with numbersAgree
    // read leniently (a letter prefix only decides the "Numbers differ" note).
    expect(brief(r)).toEqual([
      [0, 0, "name", true],
      [1, 1, "name", true],
    ]);
    const tied = pairNamesFirst(
      [item("T-10", "Will Smith"), item("T-11", "Will Smith")],
      [item("10", "Will Smith"), item("11", "Will Smith")],
    );
    // No exact/folded number decides and two are left on each side: a tie.
    expect(tied.pairs).toEqual([]);
    expect(tied.tiedLeft).toEqual([0, 1]);
  });

  test("a no-number item has no number to pair by", () => {
    const r = pairNamesFirst([item("NNO", "Jon Smyth")], [item("NNO", "Wholly Different")]);
    expect(r.pairs).toEqual([]);
  });

  test("an item with no players pairs by number alone", () => {
    const r = pairNamesFirst([item("9")], [item("9", "Mike Trout")]);
    expect(brief(r)).toEqual([[0, 0, "number", true]]);
  });
});

describe("pairNamesFirst: T3, near names", () => {
  test("a near name with the numbers differing is its score times 0.9", () => {
    const r = pairNamesFirst([item("FS-3", "Shohei Ohtani")], [item("3a", "Shohei Otani")]);
    expect(r.pairs).toHaveLength(1);
    const p = r.pairs[0];
    expect(p.by).toBe("nearName");
    expect(p.numbersAgree).toBe(false);
    expect(p.nameScore).toBeGreaterThanOrEqual(0.92);
    expect(p.nameScore).toBeLessThan(1);
    expect(p.confidence).toBeCloseTo(p.nameScore! * NUMBERS_DIFFER_FACTOR, 10);
  });

  test("below 0.92 nothing pairs (a nickname is not a slip)", () => {
    expect(pairNamesFirst([item("FS-3", "Mike Trout")], [item("30", "Michael Trout")]).pairs).toEqual([]);
  });

  test("two rows equally near leave the card unmatched", () => {
    const r = pairNamesFirst(
      [item("FS-3", "Shohei Ohtani")],
      [item("30", "Shohei Otani"), item("40", "Shohei Otani")],
    );
    expect(r.pairs).toEqual([]);
  });

  test("an exact name wins over a near one", () => {
    const r = pairNamesFirst(
      [item("FS-3", "Shohei Ohtani")],
      [item("30", "Shohei Otani"), item("40", "Shohei Ohtani")],
    );
    expect(brief(r)).toEqual([[0, 1, "name", false]]);
  });
});

describe("pairNamesFirst: letter prefixes count as agreeing", () => {
  test("BCP-12 against 12 agrees, so the pair is 1", () => {
    const r = pairNamesFirst([item("BCP-12", "Mike Trout")], [item("12", "Mike Trout")]);
    expect(r.pairs[0]).toMatchObject({ by: "name", numbersAgree: true, confidence: 1 });
  });

  test("the set's own prefix is stripped too", () => {
    const r = pairNamesFirst([item("DK-5", "Mike Trout")], [item("5", "Mike Trout")], { prefix: "DK-" });
    expect(r.pairs[0]).toMatchObject({ numbersAgree: true, confidence: 1 });
    const bare = pairNamesFirst([item("DK-5", "Mike Trout")], [item("5", "Mike Trout")]);
    expect(bare.pairs[0]).toMatchObject({ numbersAgree: true });
  });

  test("a bare number and the same with an 'a' agree (38 / 38a): 100%, no note; 38b still differs", () => {
    const r = pairNamesFirst([item("38a", "Mike Trout")], [item("38", "Mike Trout")]);
    expect(r.pairs[0]).toMatchObject({ by: "name", numbersAgree: true, confidence: 1 });
    // 38b against 38 is two plain-looking numbers that disagree... one is lettered, so it pairs at 0.9.
    const b = pairNamesFirst([item("38b", "Mike Trout")], [item("38", "Mike Trout")]);
    expect(b.pairs[0]).toMatchObject({ by: "name", numbersAgree: false, confidence: 0.9 });
  });
});

describe("pairNamesFirst: kind", () => {
  type Card = { names: string[]; number: string; isVariation?: boolean };
  const card = (number: string, name: string, isVariation = false): Card => ({
    names: [name],
    number,
    isVariation,
  });
  const kind = (c: Card) => c.isVariation === true;

  test("a variation never pairs with a base card, by name, number or near name", () => {
    const left = [card("5", "Mike Trout", true), card("6", "Shohei Ohtani", true), card("7", "Jon Smyth", true)];
    const right = [card("5", "Mike Trout"), card("SIG-60", "Shohei Otani"), card("7", "John Smith")];
    expect(pairNamesFirst(left, right, { kind }).pairs).toEqual([]);
    // Without the restriction they all pair.
    expect(pairNamesFirst(left, right).pairs).toHaveLength(3);
  });

  test("each kind pairs within itself, and a name that is once per kind is not a tie", () => {
    const left = [card("5", "Mike Trout"), card("5", "Mike Trout", true)];
    const right = [card("5", "Mike Trout", true), card("5", "Mike Trout")];
    expect(brief(pairNamesFirst(left, right, { kind }))).toEqual([
      [0, 1, "name", true],
      [1, 0, "name", true],
    ]);
    // Unrestricted, two Mike Trouts and the same numbers: the number decides... and is repeated.
    expect(pairNamesFirst(left, right).pairs).toEqual([]);
  });
});

describe("pairNamesFirst: bounded", () => {
  test("thousands of items pair without a quadratic pass", () => {
    const n = 5000;
    const left = Array.from({ length: n }, (_, i) => item(`L${i}`, `Player${i} Unique`));
    const right = Array.from({ length: n }, (_, i) => item(`R${i}`, `Player${i} Unique`));
    const started = performance.now();
    const r = pairNamesFirst(left, right);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(r.pairs).toHaveLength(n);
  });

  test("empty sides pair nothing", () => {
    expect(pairNamesFirst([], [item("1", "A B")])).toEqual({
      pairs: [],
      stemLinks: [],
      stemSiblings: [],
      tiedLeft: [],
      tiedRight: [],
    });
    expect(pairNamesFirst([item("1", "A B")], [])).toEqual({
      pairs: [],
      stemLinks: [],
      stemSiblings: [],
      tiedLeft: [],
      tiedRight: [],
    });
  });
});

// Variations (Jason, 2026-11-18): both sides list 38a / 38b, match each; one
// side lists only the stem, its data applies to every variation.
describe("pairNamesFirst: the stem step", () => {
  const smith = (n: string) => item(n, "Will Smith");

  test("both sides list 38a / 38b: each pairs with its own, no stem link", () => {
    const r = pairNamesFirst([smith("38a"), smith("38b")], [smith("38b"), smith("38a")]);
    expect(brief(r)).toEqual([
      [0, 1, "name", true],
      [1, 0, "name", true],
    ]);
    expect(r.stemLinks).toEqual([]);
    expect(r.stemSiblings).toEqual([]);
  });

  test("one right row 38 against left 38 / 38b / 38c: 38 pairs 38, the others link to the row", () => {
    const r = pairNamesFirst([smith("38"), smith("38b"), smith("38c")], [smith("38")]);
    expect(brief(r)).toEqual([[0, 0, "name", true]]);
    expect(r.stemLinks).toEqual([{ oneSide: "right", oneIndex: 0, manyIndices: [1, 2] }]);
    expect(r.tiedLeft).toEqual([]);
    expect(r.tiedRight).toEqual([]);
  });

  test("a lettered base (left 38a / 38b / 38c) against the bare row 38: the row stands for all three", () => {
    const r = pairNamesFirst([smith("38a"), smith("38b"), smith("38c")], [smith("38")]);
    expect(r.pairs).toEqual([]);
    expect(r.stemLinks).toEqual([{ oneSide: "right", oneIndex: 0, manyIndices: [0, 1, 2] }]);
    expect(r.tiedLeft).toEqual([]);
    expect(r.tiedRight).toEqual([]);
  });

  test("mirrored: one left item against right 38 / 38b with no siblings option links both ways", () => {
    const r = pairNamesFirst([smith("38")], [smith("38"), smith("38b")]);
    expect(brief(r)).toEqual([[0, 0, "name", true]]);
    expect(r.stemLinks).toEqual([{ oneSide: "left", oneIndex: 0, manyIndices: [1] }]);
    const bare = pairNamesFirst([smith("38")], [smith("38a"), smith("38b")]);
    expect(bare.pairs).toEqual([]);
    expect(bare.stemLinks).toEqual([{ oneSide: "left", oneIndex: 0, manyIndices: [0, 1] }]);
  });

  describe("stemSiblingSide: right (a checklist's rows)", () => {
    const opts = { stemSiblingSide: "right" as const };

    test("card 38 against rows 38a / 38b: pairs the single 'a' row, 38b is a sibling to create", () => {
      const r = pairNamesFirst([smith("38")], [smith("38b"), smith("38a")], opts);
      // 38 and 38a are one number: it agrees, so 100% and no note.
      expect(brief(r)).toEqual([[0, 1, "name", true]]);
      expect(r.pairs[0].confidence).toBe(1);
      expect(r.stemSiblings).toEqual([{ index: 0, side: "right", parentIndex: 0 }]);
      expect(r.stemLinks).toEqual([]);
      expect(r.tiedLeft).toEqual([]);
      expect(r.tiedRight).toEqual([]);
    });

    test("card 38 against rows 38 / 38b / 38c: the exact row pairs, the others are siblings", () => {
      const r = pairNamesFirst([smith("38")], [smith("38"), smith("38b"), smith("38c")], opts);
      expect(brief(r)).toEqual([[0, 0, "name", true]]);
      expect(r.stemSiblings).toEqual([
        { index: 1, side: "right", parentIndex: 0 },
        { index: 2, side: "right", parentIndex: 0 },
      ]);
    });

    test("no exact row and no single 'a' row is a tie: nothing pairs, nothing is created", () => {
      const r = pairNamesFirst([smith("38")], [smith("38b"), smith("38c")], opts);
      expect(r.pairs).toEqual([]);
      expect(r.stemSiblings).toEqual([]);
      expect(r.stemLinks).toEqual([]);
      expect(r.tiedLeft).toEqual([0]);
      expect(r.tiedRight).toEqual([0, 1]);
    });

    test("the mirror (one row, several cards) is still a plain link", () => {
      const r = pairNamesFirst([smith("38"), smith("38b")], [smith("38")], opts);
      expect(r.stemLinks).toEqual([{ oneSide: "right", oneIndex: 0, manyIndices: [1] }]);
      expect(r.stemSiblings).toEqual([]);
    });
  });

  test("two items sharing the stem on the one side is a tie", () => {
    // Two left 38s against three right items with stem 38: nobody stands for anybody.
    const r = pairNamesFirst(
      [smith("38"), smith("38")],
      [smith("38a"), smith("38b"), smith("38c")],
    );
    expect(r.pairs).toEqual([]);
    expect(r.stemLinks).toEqual([]);
    expect(r.tiedLeft).toEqual([0, 1]);
    expect(r.tiedRight).toEqual([0, 1, 2]);
  });

  test("groups stay per player: a Legend 52b Mantle never takes the 52 Bradley row", () => {
    const r = pairNamesFirst(
      [item("52b", "Mickey Mantle"), item("52c", "Mickey Mantle")],
      [item("52", "Bill Bradley")],
    );
    expect(r.stemLinks).toEqual([]);
    expect(r.stemSiblings).toEqual([]);
    expect(r.pairs).toEqual([]);
  });

  test("each player's stems are separate: 38 for Smith and 38 for Jones do not mix", () => {
    const r = pairNamesFirst(
      [item("38", "Will Smith"), item("38b", "Will Smith"), item("38", "Pat Jones"), item("38b", "Pat Jones")],
      [item("38", "Will Smith"), item("38", "Pat Jones")],
    );
    expect(brief(r)).toEqual([
      [0, 0, "name", true],
      [2, 1, "name", true],
    ]);
    expect(r.stemLinks).toEqual([
      { oneSide: "right", oneIndex: 0, manyIndices: [1] },
      { oneSide: "right", oneIndex: 1, manyIndices: [3] },
    ]);
  });

  test("a number with no leading digits is its own stem, so letters never link", () => {
    const r = pairNamesFirst(
      [item("OV-A", "Will Smith"), item("OV-B", "Will Smith")],
      [item("OV-C", "Will Smith")],
    );
    expect(r.stemLinks).toEqual([]);
  });
});

// Jason, 2026-11-18: "if they are both numeric then leave unmatched. only
// match with different numbers if the type is different."
describe("pairNamesFirst: two plain numbers that disagree are not a pair", () => {
  test("a one-each name pair of 38 against 250 stays unmatched and is tied", () => {
    const r = pairNamesFirst([item("38", "Mike Trout")], [item("250", "Mike Trout")]);
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft).toEqual([0]);
    expect(r.tiedRight).toEqual([0]);
  });

  test("the group remainder is vetoed the same way", () => {
    const r = pairNamesFirst(
      [item("5", "Will Smith"), item("38", "Will Smith")],
      [item("5", "Will Smith"), item("250", "Will Smith")],
    );
    expect(brief(r)).toEqual([[0, 0, "name", true]]);
    expect(r.tiedLeft).toEqual([1]);
    expect(r.tiedRight).toEqual([1]);
  });

  test("a near name is vetoed the same way, and does not go on to pair elsewhere", () => {
    const r = pairNamesFirst([item("38", "Shohei Ohtani")], [item("250", "Shohei Otani")]);
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft).toEqual([0]);
    expect(r.tiedRight).toEqual([0]);
  });

  test("a different type of number still pairs at 0.9: letters, NNO, or a digits/letters mix", () => {
    const r = pairNamesFirst(
      [item("12", "A One"), item("OV-B", "B Two"), item("T-10", "C Three"), item("NNO", "D Four")],
      [item("NNO", "A One"), item("NNO", "B Two"), item("11", "C Three"), item("OV-D", "D Four")],
    );
    expect(r.pairs.map((p) => [p.leftIndex, p.rightIndex, p.numbersAgree, p.confidence])).toEqual([
      [0, 0, false, 0.9],
      [1, 1, false, 0.9],
      [2, 2, false, 0.9],
      [3, 3, false, 0.9],
    ]);
    expect(r.tiedLeft).toEqual([]);
  });

  test("US12 against 12 agrees (a prefix), so it is no disagreement to veto", () => {
    const r = pairNamesFirst([item("US12", "A One")], [item("12", "A One")]);
    expect(r.pairs[0]).toMatchObject({ numbersAgree: true, confidence: 1 });
  });
});

describe("pairNamesFirst: a combo card left over in a roster group", () => {
  test("it may still pair by number when the other side has nothing left in that group", () => {
    // SportLots lists the Bonds / Griffey combo as "Barry Bonds" #400; BSC lists both players.
    const left = [item("25", "Barry Bonds"), item("400", "Barry Bonds", "Ken Griffey Jr")];
    const right = [item("25", "Barry Bonds"), item("400", "Barry Bonds")];
    const r = pairNamesFirst(left, right);
    expect(r.pairs.map((p) => [p.leftIndex, p.rightIndex, p.by, p.numbersAgree])).toEqual([
      [0, 0, "name", true],
      [1, 1, "number", true],
    ]);
    // The names disagree, so it is not a certain pair.
    expect(r.pairs[1]).toMatchObject({ namesDisagree: true, confidence: 0.9 });
  });

  test("the whole-set exactly-one guard still holds: a repeated #400 pins nothing down", () => {
    const left = [item("25", "Barry Bonds"), item("400", "Barry Bonds", "Ken Griffey Jr"), item("400", "Other Person")];
    const right = [item("25", "Barry Bonds"), item("400", "Barry Bonds")];
    const r = pairNamesFirst(left, right);
    expect(brief(r)).toEqual([[0, 0, "name", true]]);
  });

  test("a tied group does not release its members: both sides still have cards left", () => {
    const r = pairNamesFirst(
      [item("NNO", "Will Smith"), item("NNO", "Will Smith")],
      [item("7", "Will Smith"), item("8", "Will Smith")],
    );
    expect(r.pairs).toEqual([]);
    expect(r.tiedLeft).toEqual([0, 1]);
  });
});
