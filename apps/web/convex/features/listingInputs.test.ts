/**
 * NEO-335 — the title inputs shared by the insert and the wizard's pre-save
 * "Card titles" step.
 *
 * The parity block is the point of the module: the SAME card, assessed the way
 * the step assesses it before save and then born through
 * `buildCardRowForInsert` and read back through `deriveLegacyCardAttention`, must
 * come to the same title and the same title kinds. If the two ever drift, the
 * step asks about cards the walker will not flag (or the reverse).
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import { buildCardRowForInsert, type NewCardRow } from "../cardRowCreate";
import { deriveLegacyCardAttention } from "./cardAttention";
import {
  assessNewCardListing,
  checkShortNameAnswer,
  checkTitleAnswer,
  leftOutOfTitle,
  LISTING_TITLE_KEPT_MAX,
  listingInputsForCard,
  mergeCardFeatures,
  setDescriptionForTitles,
  titleAttentionItems,
  type ListingCardFacts,
  type ListingSetContext,
} from "./listingInputs";
import { assessListingTitle, titleDescription } from "./generateListing";
import { ASPECT_VALUE_MAX, LISTING_TITLE_MAX } from "./listingLimits";

const SELECTOR_ID = "selector-1" as unknown as Id<"selectorOptions">;
const NOW = 1_700_000_000_000;

const SET: ListingSetContext = {
  sportValue: "Baseball",
  setNameValue: "Chrome",
  inheritedFeatures: { manufacturer: "Topps", season: "2026" },
};

/** A set name long enough that the title stays over the cap after every cut. */
const LONG_SET: ListingSetContext = {
  ...SET,
  setNameValue:
    "Chrome Update Series Sapphire Edition Platinum Anniversary Collectors Box",
};

/** A set name that fits only once the player's first name is cut (NEO-535 row 11). */
const FIRST_NAME_SET: ListingSetContext = {
  ...SET,
  setNameValue: "Chrome Update Series Sapphire Edition Platinum Anniversary",
};

const LONG_VARIATION =
  "Image Variation; Wearing a throwback uniform with the 1970s powder blue logo";

type Case = {
  name: string;
  set: ListingSetContext;
  card: ListingCardFacts;
  playerNames: string[];
  teamNames: string[];
};

const CASES: Case[] = [
  {
    name: "a plain card that fits",
    set: SET,
    card: { cardNumber: "12", isRookie: true },
    playerNames: ["Mike Trout"],
    teamNames: ["Los Angeles Angels"],
  },
  {
    // NEO-535 — fits once "Shohei" goes: born `listingTitleTruncated`.
    name: "a title that fits only without a first name",
    set: FIRST_NAME_SET,
    card: { cardNumber: "9" },
    playerNames: ["Shohei Ohtani"],
    teamNames: [],
  },
  {
    // NEO-535 — the box replaces a description that is over the cap.
    name: "a title built from the set's box text",
    set: { ...LONG_SET, listingShortName: "2026 Topps Sapphire" },
    card: { cardNumber: "300" },
    playerNames: ["Shohei Ohtani"],
    teamNames: [],
  },
  {
    // NEO-535 — over the cap after every cut: the STOP.
    name: "a title over the cap after every cut",
    set: LONG_SET,
    card: { cardNumber: "300", isRookie: true },
    playerNames: ["Shohei Ohtani"],
    teamNames: ["Los Angeles Dodgers"],
  },
  {
    name: "a variation over the aspect cap",
    set: SET,
    card: { cardNumber: "300b", cardVariation: LONG_VARIATION },
    playerNames: ["Aaron Judge"],
    teamNames: ["New York Yankees"],
  },
  {
    name: "both at once, with an autograph and a print run",
    set: LONG_SET,
    card: {
      cardNumber: "RA-1",
      autographType: "On-Card",
      printRun: 99,
      cardVariation: LONG_VARIATION,
      attributes: ["SP"],
    },
    playerNames: ["Ken Griffey Jr.", "Ken Griffey Sr."],
    teamNames: ["Seattle Mariners", "Cincinnati Reds"],
  },
  {
    name: "a variation that fits once its stray space is trimmed",
    set: SET,
    card: { cardNumber: "44b", cardVariation: `${"v".repeat(ASPECT_VALUE_MAX)} ` },
    playerNames: ["Paul Skenes"],
    teamNames: [],
  },
  {
    name: "a brand NB has not identified",
    set: { ...LONG_SET, manufacturerBrandUnknown: true },
    card: { cardNumber: "7" },
    playerNames: ["Bobby Witt Jr."],
    teamNames: [],
  },
  {
    // NEO-335 — both labels, from the chain's ROLES.
    name: "a parallel of an insert, labelled",
    set: {
      ...SET,
      insertNameValue: "Dugout Collection",
      insertIsRole: true,
      parallelLeafValue: "Gold",
    },
    card: { cardNumber: "DC-5" },
    playerNames: ["Ken Griffey Jr."],
    teamNames: ["Seattle Mariners"],
  },
  {
    // NEO-335 — a rookie insert with repeats (AUTO, RC) cut first.
    name: "a rookie insert whose AUTO and RC are repeats",
    set: { ...SET, insertNameValue: "Rookie Debut Patch Autographs", insertIsRole: true },
    card: { cardNumber: "RD-12", isRookie: true, isRelic: true, autographType: "On-Card", printRun: 99 },
    playerNames: ["Elly De La Cruz"],
    teamNames: [],
  },
];

function newCardRow(c: Case): NewCardRow {
  return {
    selectorOptionId: SELECTOR_ID,
    cardNumber: c.card.cardNumber,
    cardName: c.playerNames.join(" & "),
    isRookie: c.card.isRookie,
    isRelic: c.card.isRelic,
    autographType: c.card.autographType,
    cardVariation: c.card.cardVariation,
    attributes: c.card.attributes ? [...c.card.attributes] : undefined,
    printRun: c.card.printRun,
    platformData: {},
    pendingPlayerNames: [],
    pendingTeamNames: [],
    sortOrder: 0,
    playerNames: c.playerNames,
    teamNames: c.teamNames,
  };
}

const TITLE_KINDS = new Set(["titleOverLimit", "titleTruncated", "aspectValueOverLimit"]);

describe("listingInputs — the pre-save step and the insert agree (parity)", () => {
  test.each(CASES)("$name: same title, same title kinds", (c) => {
    const before = assessNewCardListing(c.card, c.set, {
      playerNames: c.playerNames,
      teamNames: c.teamNames,
    });
    const built = buildCardRowForInsert(newCardRow(c), c.set, NOW);
    const after = deriveLegacyCardAttention(built.row).filter((i) => TITLE_KINDS.has(i.kind));

    expect(built.row.listingTitle).toBe(before.assessment.title);
    expect(after).toEqual(before.items);
    // Signed By is defaulted on top at insert; it is not a title input.
    expect(built.row.features).toMatchObject(before.mergedFeatures);
  });

  test("the cases cover every kind the step asks about", () => {
    const kinds = new Set(
      CASES.flatMap((c) =>
        assessNewCardListing(c.card, c.set, { playerNames: c.playerNames, teamNames: c.teamNames })
          .items.map((i) => i.kind),
      ),
    );
    // NEO-535: the generator STOPs over the cap rather than cut description
    // words, so a new card can be born over the cap too.
    expect(kinds).toEqual(new Set(["titleOverLimit", "titleTruncated", "aspectValueOverLimit"]));
  });
});

describe("assessNewCardListing — the card's own name (NEO-645)", () => {
  test("a named card with no player carries its name; a placeholder or the player's own name changes nothing", () => {
    const names = { playerNames: [] as string[], teamNames: [] as string[] };
    const plain = assessNewCardListing({ cardNumber: "7" }, SET, names).assessment.title;
    const named = assessNewCardListing({ cardNumber: "7" }, SET, { ...names, cardName: "Team Card" });
    expect(named.inputs.subjectName).toBe("Team Card");
    expect(named.assessment.title).toContain("Team Card #7");
    expect(
      assessNewCardListing({ cardNumber: "7" }, SET, { ...names, cardName: "Card #7" }).assessment.title,
    ).toBe(plain);
    const withPlayer = { playerNames: ["Mike Trout"], teamNames: [] as string[] };
    const asPlayer = assessNewCardListing({ cardNumber: "7" }, SET, withPlayer).assessment.title;
    expect(
      assessNewCardListing({ cardNumber: "7" }, SET, { ...withPlayer, cardName: "Mike Trout" }).assessment.title,
    ).toBe(asPlayer);
  });
});

describe("the stored variation is the trimmed one (NEO-335 adversarial pass)", () => {
  test("a padded variation is stored trimmed, and neither side flags it", () => {
    const padded = CASES.find((c) => c.card.cardNumber === "44b")!;
    const built = buildCardRowForInsert(newCardRow(padded), padded.set, NOW);
    expect(built.row.cardVariation).toBe("v".repeat(ASPECT_VALUE_MAX));
    // NEO-609: a variation is never cut from the title, so a 65-character one
    // beside the set and player runs the title over the cap. That is the ONLY
    // thing flagged (by length): the padding is not counted against the
    // variation's own aspect limit, and the trimmed card reads the same.
    const items = assessNewCardListing(padded.card, padded.set, {
      playerNames: padded.playerNames,
    }).items;
    expect(items.map((i) => i.kind)).toEqual(["titleOverLimit"]);
    const trimmed = assessNewCardListing(
      { ...padded.card, cardVariation: "v".repeat(ASPECT_VALUE_MAX) },
      padded.set,
      { playerNames: padded.playerNames },
    ).items;
    expect(items).toEqual(trimmed);
  });

  test("a blank variation is stored as none", () => {
    const c = { ...CASES[0], card: { ...CASES[0].card, cardVariation: "   " } };
    expect(buildCardRowForInsert(newCardRow(c), c.set, NOW).row.cardVariation).toBeUndefined();
  });
});

describe("titleAttentionItems — the rules deriveLegacyCardAttention had, unchanged", () => {
  test("over the cap wins over truncated: one thing to say", () => {
    expect(
      titleAttentionItems({ listingTitle: "x".repeat(LISTING_TITLE_MAX + 4), listingTitleTruncated: true }),
    ).toEqual([{ kind: "titleOverLimit", length: LISTING_TITLE_MAX + 4 }]);
  });

  test("truncated alone", () => {
    expect(titleAttentionItems({ listingTitle: "short", listingTitleTruncated: true })).toEqual([
      { kind: "titleTruncated" },
    ]);
  });

  test("a variation one past the aspect cap is flagged; at the cap it is not", () => {
    expect(titleAttentionItems({ cardVariation: "v".repeat(ASPECT_VALUE_MAX) })).toEqual([]);
    expect(titleAttentionItems({ cardVariation: "v".repeat(ASPECT_VALUE_MAX + 1) })).toEqual([
      { kind: "aspectValueOverLimit", field: "cardVariation", length: ASPECT_VALUE_MAX + 1 },
    ]);
  });

  test("deriveLegacyCardAttention keeps the same order: title kinds before unreviewedName", () => {
    expect(
      deriveLegacyCardAttention({
        teamOnCardIds: ["t1"],
        listingTitleTruncated: true,
        cardVariation: "v".repeat(ASPECT_VALUE_MAX + 1),
        pendingPlayerNames: ["Somebody"],
      }).map((i) => i.kind),
    ).toEqual(["titleTruncated", "aspectValueOverLimit", "unreviewedName"]);
  });
});

describe("mergeCardFeatures / listingInputsForCard", () => {
  test("observed facts beat the set snapshot; a variation becomes the parallel name", () => {
    const merged = mergeCardFeatures(
      { cardNumber: "1", isRookie: true, cardVariation: "Sliding" },
      { ...SET, inheritedFeatures: { ...SET.inheritedFeatures, isRookie: "false" } },
    );
    expect(merged).toMatchObject({ isRookie: "true", parallelName: "Sliding", season: "2026" });
  });

  test("NEO-591: a prospect card's merged features carry the Prospect Card attribute", () => {
    expect(mergeCardFeatures({ cardNumber: "1", isProspect: true }, SET).isProspect).toBe("true");
    expect(mergeCardFeatures({ cardNumber: "1" }, SET).isProspect).toBeUndefined();
  });

  test("the inputs read the merged snapshot and the set's facts", () => {
    const inputs = listingInputsForCard({ cardNumber: "1" }, SET, {
      playerNames: ["A"],
      teamNames: ["B"],
    });
    expect(inputs).toMatchObject({
      cardNumber: "1",
      year: "2026",
      manufacturer: "Topps",
      setName: "Chrome",
      sport: "Baseball",
      playerNames: ["A"],
      teamNames: ["B"],
    });
  });
});

describe("listingInputsForCard — cameos (NEO-528)", () => {
  test("cameoNames are carried through in order", () => {
    const inputs = listingInputsForCard({ cardNumber: "1" }, SET, {
      playerNames: ["A B"],
      cameoNames: ["C D", "E F"],
    });
    expect(inputs.cameoNames).toEqual(["C D", "E F"]);
  });

  test("an empty or absent cameo list leaves no cameoNames key at all", () => {
    const empty = listingInputsForCard({ cardNumber: "1" }, SET, { playerNames: ["A B"], cameoNames: [] });
    const absent = listingInputsForCard({ cardNumber: "1" }, SET, { playerNames: ["A B"] });
    expect(empty).not.toHaveProperty("cameoNames");
    expect(absent).toEqual(empty);
  });
});

describe("leftOutOfTitle", () => {
  test("an over-cap title reports what was cut, never filler and never a description word", () => {
    const inputs = listingInputsForCard({ cardNumber: "300", isRookie: true }, LONG_SET, {
      playerNames: ["Shohei Ohtani"],
      teamNames: ["Los Angeles Dodgers"],
    });
    const assessment = assessListingTitle(inputs);
    expect(assessment.fits).toBe(false);
    const left = leftOutOfTitle(inputs, assessment.title);
    expect(left).toEqual(["Los Angeles Dodgers", "#300", "Shohei", "RC"]);
    // The sport and the second rookie spelling are FILLER: never listed.
    expect(left).not.toContain("Baseball");
    expect(left).not.toContain("Rookie");
    expect(left).toEqual(assessment.dropped);
    for (const entry of left) {
      expect(assessment.title.toLowerCase()).not.toContain(entry.toLowerCase());
    }
  });

  test("a title that fits whole reports nothing", () => {
    const inputs = listingInputsForCard({ cardNumber: "1" }, SET, { playerNames: ["A B"] });
    expect(leftOutOfTitle(inputs, assessListingTitle(inputs).title)).toEqual([]);
  });

  test("an unknown brand is never reported as left out — it was never in", () => {
    const set = { ...LONG_SET, manufacturerBrandUnknown: true };
    const inputs = listingInputsForCard({ cardNumber: "7" }, set, { playerNames: ["Bobby Witt Jr."] });
    expect(leftOutOfTitle(inputs, assessListingTitle(inputs).title)).not.toContain("Topps");
  });
});

describe("checkTitleAnswer — the write path's caps", () => {
  test("a title at the cap is accepted, trimmed", () => {
    const title = "t".repeat(LISTING_TITLE_MAX);
    expect(checkTitleAnswer({ listingTitle: `  ${title}  ` }, "card #1")).toEqual({
      listingTitle: title,
    });
  });

  test("a title one past the cap is refused, naming the card", () => {
    expect(() =>
      checkTitleAnswer({ listingTitle: "t".repeat(LISTING_TITLE_MAX + 1) }, "card #1"),
    ).toThrow(/card #1: the title is 81 characters; the limit is 80/);
  });

  test("a kept title may be over eBay's cap (the step showed it), up to its own bound", () => {
    // NEO-535: the generator STOPs over the cap, so the title the step showed
    // and the operator kept can be over 80. It is bounded, not capped.
    const over = "t".repeat(LISTING_TITLE_MAX + 1);
    expect(checkTitleAnswer({ listingTitleKept: over }, "card #3")).toEqual({
      listingTitleKept: over,
    });
    const atBound = "t".repeat(LISTING_TITLE_KEPT_MAX);
    expect(checkTitleAnswer({ listingTitleKept: atBound }, "card #3")).toEqual({
      listingTitleKept: atBound,
    });
    expect(() =>
      checkTitleAnswer({ listingTitleKept: "t".repeat(LISTING_TITLE_KEPT_MAX + 1) }, "card #3"),
    ).toThrow(
      `card #3: the title is ${LISTING_TITLE_KEPT_MAX + 1} characters; the limit is ${LISTING_TITLE_KEPT_MAX}.`,
    );
    expect(checkTitleAnswer({ listingTitleKept: " Shown #3 " }, "card #3")).toEqual({
      listingTitleKept: "Shown #3",
    });
  });

  test("a blank title is no answer", () => {
    expect(checkTitleAnswer({ listingTitle: "   " }, "card #1")).toEqual({});
  });

  test("an answered variation is held to the aspect cap; an unanswered one is not", () => {
    const long = "v".repeat(ASPECT_VALUE_MAX + 1);
    expect(() =>
      checkTitleAnswer({ cardVariation: long, cardVariationAnswered: true }, "card #2"),
    ).toThrow(/card #2: the variation is 66 characters; the limit is 65/);
    expect(checkTitleAnswer({ cardVariation: long }, "card #2")).toEqual({});
    expect(
      checkTitleAnswer({ cardVariation: " Sliding ", cardVariationAnswered: true }, "card #2"),
    ).toEqual({ cardVariation: "Sliding" });
  });
});

describe("buildCardRowForInsert — the operator's pre-save answer", () => {
  const truncatedCase = CASES.find((c) => c.name === "a title that fits only without a first name")!;

  test("no answer: the generated title, flagged cut short, exactly as before", () => {
    const built = buildCardRowForInsert(newCardRow(truncatedCase), truncatedCase.set, NOW);
    expect(built.row.listingTitleTruncated).toBe(true);
  });

  test("kept: the generated title, NOT flagged — the question was asked before save", () => {
    const plain = buildCardRowForInsert(newCardRow(truncatedCase), truncatedCase.set, NOW);
    const kept = buildCardRowForInsert(
      { ...newCardRow(truncatedCase), listingTitleKept: plain.row.listingTitle },
      truncatedCase.set,
      NOW,
    );
    expect(kept.row.listingTitle).toBe(plain.row.listingTitle);
    expect(kept.row).not.toHaveProperty("listingTitleTruncated");
  });

  test("kept, but the server generated a different title: flagged as before", () => {
    const kept = buildCardRowForInsert(
      { ...newCardRow(truncatedCase), listingTitleKept: "A title nobody generated #9" },
      truncatedCase.set,
      NOW,
    );
    expect(kept.row.listingTitle).not.toBe("A title nobody generated #9");
    expect(kept.row.listingTitleTruncated).toBe(true);
  });

  test("their own title: written verbatim, NOT flagged; the description is still generated", () => {
    const own = buildCardRowForInsert(
      { ...newCardRow(truncatedCase), listingTitle: "2026 Topps Chrome Update Shohei Ohtani #9" },
      truncatedCase.set,
      NOW,
    );
    expect(own.row.listingTitle).toBe("2026 Topps Chrome Update Shohei Ohtani #9");
    expect(own.row).not.toHaveProperty("listingTitleTruncated");
    expect(own.row.listingDescription).toContain("Shohei Ohtani");
  });
});

describe("a generational suffix is never trimmed off a name (NEO-335 visual pass)", () => {
  /**
   * Every description length from "everything fits" to "over the cap after
   * every cut", so the first-name cut (NEO-535 row 11) is reached for every
   * name shape below.
   */
  function sweep(playerNames: string[]) {
    const out: Array<{ title: string; coreFits: boolean; firstNameLost: boolean; left: string[] }> = [];
    for (let pad = 0; pad < 70; pad += 1) {
      const inputs = listingInputsForCard(
        { cardNumber: "1" },
        { sportValue: "Baseball", setNameValue: `Upper Deck ${"x".repeat(pad)}`.trim() },
        { playerNames },
      );
      const a = assessListingTitle(inputs);
      out.push({
        title: a.title,
        coreFits: a.coreFits,
        firstNameLost: a.firstNameLost,
        left: leftOutOfTitle(inputs, a.title),
      });
    }
    return out;
  }

  test("Jr. and Sr. on one card: each surname keeps its suffix; only a first name goes", () => {
    const results = sweep(["Ken Griffey Jr.", "Ken Griffey Sr."]);
    for (const { title, coreFits, firstNameLost, left } of results) {
      // "Griffey" never ends up without its suffix right after it…
      expect(title).not.toMatch(/Griffey(?! (Jr|Sr)\.)/);
      // …neither name is ever lost whole…
      expect(title).toContain("Griffey Jr.");
      expect(title).toContain("Griffey Sr.");
      // …a bare suffix is never reported as what was left out…
      expect(left).not.toContain("Jr.");
      expect(left).not.toContain("Sr.");
      // …and a title that lost a first name is flagged.
      if (left.includes("Ken")) {
        expect(firstNameLost).toBe(true);
        expect(coreFits).toBe(false);
      }
    }
    // The sweep did reach the first-name cut.
    expect(results.some((r) => r.left.includes("Ken"))).toBe(true);
  });

  test("a single Jr. stays attached", () => {
    const results = sweep(["Bobby Witt Jr."]);
    for (const { title } of results) {
      expect(title).not.toMatch(/Witt(?! Jr\.)/);
      expect(title).toContain("Witt Jr.");
    }
    expect(results.some((r) => r.left.includes("Bobby"))).toBe(true);
  });

  test("a suffix without a period (Jr, III) stays attached too", () => {
    for (const { title } of sweep(["Ken Griffey Jr"])) {
      expect(title).not.toMatch(/Griffey(?! Jr\b)/);
    }
    for (const { title } of sweep(["Cal Ripken III"])) {
      expect(title).not.toMatch(/Ripken(?! III\b)/);
    }
  });

  test("a name with no suffix loses only its first word, and that word is what is reported", () => {
    const results = sweep(["Shohei Ohtani"]);
    for (const { title } of results) expect(title).toContain("Ohtani");
    const cut = results.filter((r) => !r.title.includes("Shohei"));
    expect(cut.length).toBeGreaterThan(0);
    for (const r of cut) {
      expect(r.left).toContain("Shohei");
      expect(r.left).not.toContain("Shohei Ohtani");
    }
  });
});

describe("filler is never listed as a loss (collector review)", () => {
  test("a set word that reads like the sport is never cut, and the sport is never listed", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "1" },
      { sportValue: "Baseball", setNameValue: `${"x".repeat(70)} Baseball Heroes` },
      { playerNames: ["Shohei Ohtani"] },
    );
    const a = assessListingTitle(inputs);
    expect(a.fits).toBe(false);
    expect(a.title).toContain("Baseball Heroes");
    expect(leftOutOfTitle(inputs, a.title)).toEqual(["#1", "Shohei"]);
  });

  test("the sport, the second Rookie and the labels are never listed; RC and a team are", () => {
    // NEO-535 retired `isFillerToken`; `leftOutOfTitle` reads the text, so the
    // same rule is pinned against a title missing every one of them.
    const inputs = listingInputsForCard(
      { cardNumber: "1", isRookie: true },
      { ...FIRST_NAME_SET, insertNameValue: "Dugout", insertIsRole: true, parallelLeafValue: "Gold" },
      { playerNames: ["Mike Trout"], teamNames: ["Los Angeles Dodgers"] },
    );
    expect(inputs.parallelIsRole).toBe(true);
    expect(
      leftOutOfTitle(
        inputs,
        "2026 Topps Chrome Update Series Sapphire Edition Platinum Anniversary Dugout Gold Mike Trout #1",
      ),
    ).toEqual(["Los Angeles Dodgers", "RC"]);
  });

  test("the dropped labels are never listed as left out (NEO-335)", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "5" },
      {
        ...SET,
        insertNameValue: "Dugout Collection",
        insertIsRole: true,
        parallelLeafValue: "Gold",
      },
      { playerNames: ["Ken Griffey Jr."], teamNames: ["Seattle Mariners"] },
    );
    const a = assessListingTitle(inputs);
    // Both labels and the sport went (rows 4-6) so the team fits.
    expect(a.title).toBe("2026 Topps Chrome Dugout Collection Gold Ken Griffey Jr. #5 Seattle Mariners");
    expect(a.dropped).toEqual([]);
    expect(leftOutOfTitle(inputs, a.title)).toEqual([]);
  });

  test("an RC-shortened insert does not report \"Rookie\" as lost", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "RD-12", isRookie: true },
      {
        ...SET,
        insertNameValue: "Rookie Debut Patch Autographs Sapphire Platinum Anniversary Edition",
        insertIsRole: true,
      },
      { playerNames: ["Elly De La Cruz"] },
    );
    const a = assessListingTitle(inputs);
    expect(a.fits).toBe(false);
    expect(a.title).toContain("RC Debut Patch Autographs");
    const left = leftOutOfTitle(inputs, a.title);
    expect(left.some((entry) => /\bRookie\b/.test(entry))).toBe(false);
    expect(left).toEqual(["#RD-12", "Elly"]);
  });
});

describe("NEO-335 — the insert name, the parallel leaf and the short name reach the inputs", () => {
  test("the insert name joins only on the insert ROLE", () => {
    const withRole = listingInputsForCard(
      { cardNumber: "5" },
      { ...SET, insertNameValue: "Dugout Collection", insertIsRole: true },
      { playerNames: ["Ken Griffey Jr."] },
    );
    expect(withRole.insertName).toBe("Dugout Collection");
    expect(assessListingTitle(withRole).title).toBe(
      "2026 Topps Chrome Dugout Collection Insert Ken Griffey Jr. #5 Baseball",
    );
    // An insert-level row without the role (a parallels-type child) is not an insert.
    for (const insertIsRole of [undefined, false]) {
      const inputs = listingInputsForCard(
        { cardNumber: "5" },
        { ...SET, insertNameValue: "Dugout Collection", insertIsRole },
        { playerNames: ["Ken Griffey Jr."] },
      );
      expect(inputs).not.toHaveProperty("insertName");
    }
  });

  test("no role, no labels: a set with neither inputs exactly what it did", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "5", cardVariation: "Image Variation" },
      SET,
      { playerNames: ["Ken Griffey Jr."] },
    );
    expect(inputs).not.toHaveProperty("parallelIsRole");
    expect(inputs).not.toHaveProperty("insertName");
    expect(assessListingTitle(inputs).title).toBe(
      "2026 Topps Chrome Ken Griffey Jr. #5 Image Variation Baseball",
    );
  });

  test("a parallel leaf's own value is the parallel token when the features name none", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "5" },
      { ...SET, parallelLeafValue: "Gold Refractor" },
      { playerNames: ["A"] },
    );
    expect(inputs.parallelName).toBe("Gold Refractor");
    expect(inputs.parallelIsRole).toBe(true);
    expect(assessListingTitle(inputs).title).toBe(
      "2026 Topps Chrome Gold Refractor Parallel A #5 Baseball",
    );
  });

  test("NEO-535: the parallel leaf's own name wins over a name the features carry", () => {
    // Reversed from NEO-335 ("features win"): a card on a parallel leaf names
    // the leaf, as every parallel copy does; the snapshot's name was often
    // one it inherited. New cards and stored cards (preview, Regenerate) alike.
    const set = {
      ...SET,
      inheritedFeatures: { ...SET.inheritedFeatures, parallelName: "Refractor" },
      parallelLeafValue: "Gold Refractor",
    };
    expect(listingInputsForCard({ cardNumber: "5" }, set, { playerNames: ["A"] }).parallelName).toBe(
      "Gold Refractor",
    );
    // A stored card's features passed in as they are stored.
    expect(
      listingInputsForCard({ cardNumber: "5" }, set, { playerNames: ["A"] }, { parallelName: "Base" })
        .parallelName,
    ).toBe("Gold Refractor");
    // Born naming the leaf, so the stored features agree with the title.
    expect(mergeCardFeatures({ cardNumber: "5" }, set).parallelName).toBe("Gold Refractor");
  });

  test("off a parallel leaf the features' name is the parallel", () => {
    const set = { ...SET, inheritedFeatures: { ...SET.inheritedFeatures, parallelName: "Refractor" } };
    expect(listingInputsForCard({ cardNumber: "5" }, set, { playerNames: ["A"] }).parallelName).toBe(
      "Refractor",
    );
    expect(mergeCardFeatures({ cardNumber: "5" }, set).parallelName).toBe("Refractor");
  });

  test("the short name rides through trimmed; blank is none", () => {
    const set = { ...SET, listingShortName: "  Topps Hologram  " };
    expect(listingInputsForCard({ cardNumber: "1" }, set, { playerNames: [] }).setShortName).toBe(
      "Topps Hologram",
    );
    expect(
      listingInputsForCard({ cardNumber: "1" }, { ...SET, listingShortName: " " }, { playerNames: [] }),
    ).not.toHaveProperty("setShortName");
  });
});

describe("NEO-535 — leftOutOfTitle and the set and insert words", () => {
  const LONG_INSERT: ListingSetContext = {
    ...SET,
    setNameValue: "Chrome Update Series",
    insertNameValue: "Sapphire Edition Platinum Anniversary Collectors Box",
    insertIsRole: true,
  };

  test("an over-cap insert is never cut, so never reported; the number and first name are", () => {
    const inputs = listingInputsForCard({ cardNumber: "300" }, LONG_INSERT, {
      playerNames: ["Shohei Ohtani"],
    });
    const assessment = assessListingTitle(inputs);
    expect(assessment.fits).toBe(false);
    expect(assessment.title).toContain("Sapphire Edition Platinum Anniversary Collectors Box");
    const left = leftOutOfTitle(inputs, assessment.title);
    expect(left).toEqual(["#300", "Shohei"]);
  });

  test("with the box in use, the full description is not reported — the box stands in for it", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "300" },
      { ...LONG_INSERT, listingShortName: "Topps Sapphire" },
      { playerNames: ["Shohei Ohtani"] },
    );
    const assessment = assessListingTitle(inputs);
    expect(assessment.shortNameUsed).toBe(true);
    expect(assessment.fits).toBe(true);
    // Built from the box: the card is on the Card titles step (born flagged).
    expect(assessment.coreFits).toBe(false);
    expect(leftOutOfTitle(inputs, assessment.title)).toEqual([]);
  });

  test("an operator's text without the box or the description words reports those words", () => {
    const inputs = listingInputsForCard(
      { cardNumber: "300" },
      { ...LONG_INSERT, listingShortName: "Topps Sapphire" },
      { playerNames: ["Shohei Ohtani"] },
    );
    expect(leftOutOfTitle(inputs, "2026 Topps Shohei Ohtani #300")).toEqual([
      "Chrome Update Series",
      "Sapphire Edition Platinum Anniversary Collectors Box",
    ]);
  });
});

describe("NEO-535 — setDescriptionForTitles (the box's prefill)", () => {
  const COLLECTORS_CHOICE: ListingSetContext = {
    sportValue: "Baseball",
    setNameValue: "Collector's Choice",
    inheritedFeatures: { manufacturer: "Upper Deck", season: "1990" },
  };

  test("the builder's whole description: year, maker, set and the insert on its role", () => {
    expect(
      setDescriptionForTitles({ ...COLLECTORS_CHOICE, insertNameValue: "Hologram", insertIsRole: true }),
    ).toBe("1990 Upper Deck Collector's Choice Hologram");
  });

  test("an insert-level row without the role is not read", () => {
    expect(
      setDescriptionForTitles({ ...COLLECTORS_CHOICE, insertNameValue: "Hologram", insertIsRole: false }),
    ).toBe("1990 Upper Deck Collector's Choice");
  });

  test("an unknown brand is never offered", () => {
    expect(
      setDescriptionForTitles({
        ...COLLECTORS_CHOICE,
        manufacturerBrandUnknown: true,
        inheritedFeatures: { manufacturer: "All Brands", season: "1990" },
        insertNameValue: "Hologram Heroes",
        insertIsRole: true,
      }),
    ).toBe("1990 Collector's Choice Hologram Heroes");
  });

  test("the parallel leaf is included, the stored box is ignored, and no label is added", () => {
    expect(
      setDescriptionForTitles({
        ...COLLECTORS_CHOICE,
        insertNameValue: "Hologram",
        insertIsRole: true,
        parallelLeafValue: "Gold",
        listingShortName: "UD Holo",
      }),
    ).toBe("1990 Upper Deck Collector's Choice Hologram Gold");
  });
});

describe("NEO-535 — setDescriptionForTitles on a parallel leaf (the whole description)", () => {
  /** 2026 Bowman → Inserts → Anime → Anime Red Refractors, as the E2E builds it. */
  const ANIME: ListingSetContext = {
    sportValue: "Baseball",
    setNameValue: "Bowman",
    inheritedFeatures: { manufacturer: "Bowman", season: "2026" },
    insertNameValue: "Anime",
    insertIsRole: true,
    parallelLeafValue: "Anime Red Refractors",
  };
  const WHOLE = "2026 Bowman Anime Red Refractors";

  test("the leaf names the parallel even when its snapshot inherited another name", () => {
    for (const inherited of ["Base", "Anime", "Red"]) {
      expect(
        setDescriptionForTitles({
          ...ANIME,
          inheritedFeatures: { ...ANIME.inheritedFeatures, parallelName: inherited },
        }),
      ).toBe(WHOLE);
    }
    expect(setDescriptionForTitles(ANIME)).toBe(WHOLE);
  });

  test("a card's own parallel name wins, as the build's copies carry it", () => {
    expect(
      setDescriptionForTitles(
        { ...ANIME, parallelLeafValue: undefined, inheritedFeatures: { ...ANIME.inheritedFeatures, parallelName: "Base" } },
        { parallelName: "Anime Red Refractors" },
      ),
    ).toBe(WHOLE);
  });

  test("it is the description a copy on the parallel is titled with", () => {
    const copy = listingInputsForCard(
      { cardNumber: "BA-1", parallelName: "Anime Red Refractors" },
      { ...ANIME, inheritedFeatures: { ...ANIME.inheritedFeatures, parallelName: "Base" } },
      { playerNames: ["Mike Trout"] },
    );
    // The builder's description for that copy, labels aside.
    expect(titleDescription(copy)).toBe(WHOLE);
  });

  test("off a parallel leaf the snapshot's name still counts", () => {
    expect(
      setDescriptionForTitles({
        ...ANIME,
        parallelLeafValue: undefined,
        inheritedFeatures: { ...ANIME.inheritedFeatures, parallelName: "Gold" },
      }),
    ).toBe("2026 Bowman Anime Gold");
  });
});

describe("NEO-335 — checkShortNameAnswer (the write paths' rule, without throwing)", () => {
  test("trimmed; blank and absent are nothing to send", () => {
    expect(checkShortNameAnswer("  Upper Deck Hologram ")).toEqual({ value: "Upper Deck Hologram" });
    expect(checkShortNameAnswer("   ")).toEqual({});
    expect(checkShortNameAnswer(undefined)).toEqual({});
  });

  test("80 is the cap (NEO-535: the box holds the whole description)", () => {
    expect(checkShortNameAnswer("x".repeat(80))).toEqual({ value: "x".repeat(80) });
    expect(checkShortNameAnswer("x".repeat(81)).error).toBe(
      "Set name in titles tops out at 80 characters.",
    );
  });

  test("control and invisible characters are refused with the server's sentence", () => {
    expect(checkShortNameAnswer("Upper\tDeck").error).toMatch(/control characters/);
    expect(checkShortNameAnswer("Upper\u200bDeck").error).toMatch(/invisible/);
  });
});

describe("NEO-345 — the leaf's autograph format, through mergeCardFeatures", () => {
  const leaf = (format: string): ListingSetContext => ({
    ...SET,
    inheritedFeatures: { ...SET.inheritedFeatures, autographed: "None", autographFormat: format },
  });

  test.each(["On Card", "Sticker/Label"])(
    "an AU card under a %s leaf is autographed with it, and the format is stripped",
    (format) => {
      const merged = mergeCardFeatures({ cardNumber: "1", attributes: ["AU"] }, leaf(format));
      expect(merged.autographed).toBe(format);
      expect(merged).not.toHaveProperty("autographFormat");
    },
  );

  test("a card without AU stays None and loses the leaf's key too", () => {
    const merged = mergeCardFeatures({ cardNumber: "1", attributes: ["RC"] }, leaf("On Card"));
    expect(merged.autographed).toBe("None");
    expect(merged).not.toHaveProperty("autographFormat");
  });

  test("fill-empty: a copy's own autographed (its base features) wins", () => {
    const merged = mergeCardFeatures(
      { cardNumber: "1", attributes: ["AU"], baseFeatures: { autographed: "On Card" } },
      leaf("Sticker/Label"),
    );
    expect(merged.autographed).toBe("On Card");
  });

  test("a marketplace autographType is never the format", () => {
    const merged = mergeCardFeatures(
      { cardNumber: "1", attributes: ["AU"], autographType: "Unknown" },
      { ...SET, inheritedFeatures: { ...SET.inheritedFeatures, autographed: "None" } },
    );
    expect(merged.autographed).toBe("None");
  });

  test("the pre-save title (draft answer on titleContext) and the insert agree: both say AUTO", () => {
    const card: ListingCardFacts = { cardNumber: "7", attributes: ["AU"] };
    // The UI puts the wizard's draft answer here before save; the commit
    // writes it onto the leaf, so the insert reads the same key.
    const set = leaf("On Card");
    const preview = assessNewCardListing(card, set, { playerNames: ["Mike Trout"] });
    const built = buildCardRowForInsert(
      {
        selectorOptionId: SELECTOR_ID,
        cardNumber: "7",
        cardName: "Mike Trout",
        attributes: ["AU"],
        platformData: {},
        pendingPlayerNames: [],
        pendingTeamNames: [],
        sortOrder: 0,
        playerNames: ["Mike Trout"],
      } satisfies NewCardRow,
      set,
      NOW,
    );
    expect(preview.assessment.title).toMatch(/\bAUTO\b/);
    expect(built.row.listingTitle).toBe(preview.assessment.title);
    expect(built.row.features?.autographed).toBe("On Card");
    expect(built.row.features?.signedBy).toBe("Mike Trout");
  });
});
