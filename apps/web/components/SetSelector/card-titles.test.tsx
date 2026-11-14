/**
 * NEO-335 / NEO-535 — `card-titles.ts`: who is on the wizard's "Card titles"
 * step, what each title says, what "Left out to fit" says about the text in
 * each field, and what reaches the commit.
 *
 * `.test.tsx` although it renders nothing: the components project collects
 * only `.tsx` (vitest.include.mjs).
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { type TitleContext } from "../../convex/features/listingInputs";
import { ASPECT_VALUE_MAX, LISTING_TITLE_MAX } from "../../convex/features/listingLimits";
import {
  buildTitleGroups,
  cardsNeedingTitleReview,
  setNameInTitlesPrefill,
  shortNameFieldApplies,
  teamIdNamesFromRefs,
  titleAnswersForCommit,
  titleDraftState,
  validShortName,
  withTitleAnswer,
  type PreviewCardForTitles,
  type TitleReviewRow,
} from "./card-titles";

/** "2026 Topps <this>" is 69 characters: a card keeps its surname, not its first name. */
const FIRST_NAME_SET = "Chrome Update Series Sapphire Edition Platinum Anniversary";
/** "2026 Topps <this>" is 84 characters: every title stays over the cap. */
const OVER_SET = `${FIRST_NAME_SET} Collectors Box`;
const LONG_VARIATION =
  "Image Variation; Wearing a throwback uniform with the 1970s powder blue logo";

function context(overrides: Partial<TitleContext> = {}): TitleContext {
  return {
    sportValue: "Baseball",
    setNameValue: FIRST_NAME_SET,
    inheritedFeatures: { manufacturer: "Topps", season: "2026" },
    setTeamNames: [],
    players: [
      { printed: "Shohei Ohtani", name: "Shohei Ohtani" },
      { printed: "Doc Gooden", name: "Dwight Gooden" },
      { printed: "Ken Griffey Jr.", name: "Ken Griffey Jr." },
      { printed: "Ken Griffey Sr.", name: "Ken Griffey Sr." },
    ],
    teams: [{ printed: "LA Dodgers", name: "Los Angeles Dodgers" }],
    ...overrides,
  };
}

const SHORT = context({ setNameValue: "Chrome" });
const OVER = context({ setNameValue: OVER_SET });

function card(n: string, extra: Partial<PreviewCardForTitles> = {}): PreviewCardForTitles {
  return { cardNumber: n, cardName: `Card ${n}`, players: ["Shohei Ohtani"], ...extra };
}

const rowsOf = (groups: ReturnType<typeof buildTitleGroups>["titleGroups"]) =>
  groups.flatMap((g) => g.cards);

describe("cardsNeedingTitleReview — who is on the step", () => {
  test("a NEW card that lost a first name, runs over the cap, or has a variation over 65; not one that fits", () => {
    expect(cardsNeedingTitleReview([card("1")], context())).toEqual([0]);
    expect(cardsNeedingTitleReview([card("1")], OVER)).toEqual([0]);
    expect(cardsNeedingTitleReview([card("1")], SHORT)).toEqual([]);
    expect(cardsNeedingTitleReview([card("2", { cardVariation: LONG_VARIATION })], SHORT)).toEqual([
      0,
    ]);
  });

  test("a card that re-syncs a stored row is never asked about", () => {
    expect(
      cardsNeedingTitleReview([card("1"), card("2")], context(), undefined, {
        existingIndexes: [0],
      }),
    ).toEqual([1]);
  });

  test("never moved by the step's own answers (membership reads the printed variation)", () => {
    const cards = [card("2", { cardVariation: LONG_VARIATION })];
    const { variationGroups } = buildTitleGroups(cards, SHORT, undefined, {
      answers: [{ cardVariation: "Throwback" }],
    });
    expect(variationGroups).toHaveLength(1);
  });

  test("the over-cap title stays as built: description words are never cut to force a fit", () => {
    const [row] = rowsOf(buildTitleGroups([card("1")], OVER).titleGroups);
    expect(row.fits).toBe(false);
    expect(row.title.length).toBeGreaterThan(LISTING_TITLE_MAX);
    expect(row.title).toContain(OVER_SET);
  });
});

describe("names — a data claim, never a guess", () => {
  test("a printed name that resolved is titled by its CANONICAL name", () => {
    const [row] = rowsOf(buildTitleGroups([card("1", { players: ["Doc Gooden"] })], context()).titleGroups);
    expect(row.title).not.toContain("Doc");
    expect(row.title).toContain("Gooden");
    // The first name is what the builder had to give up.
    expect(row.leftOut).toEqual(["Dwight"]);
  });

  test("a printed name that did not resolve and has no wizard answer is not on the card", () => {
    const [row] = rowsOf(
      buildTitleGroups([card("1", { players: ["Unknown Rookie"] })], OVER).titleGroups,
    );
    expect(row.leftOut.join(" ")).not.toContain("Unknown");
    expect(row.title).not.toContain("Unknown");
  });

  test("wizard decisions: create keeps the row's name, link takes the candidate's, skip drops it", () => {
    const rows: TitleReviewRow[] = [
      { kind: "player", name: "Jim Thome", decision: { action: "create" } },
      {
        kind: "player",
        name: "Ron Artest",
        decision: { action: "link", linkedPlayerId: "p1" },
        enrichment: { existingCandidates: [{ playerId: "p1", name: "Metta World Peace" }] },
      },
      { kind: "player", name: "CHECKLIST", decision: { action: "skip" } },
    ];
    const cards = [card("1", { players: ["Jim Thome", "Ron Artest", "CHECKLIST"] })];
    const [row] = rowsOf(buildTitleGroups(cards, context(), undefined, { names: { rows } }).titleGroups);
    const said = `${row.title} ${row.leftOut.join(" ")}`;
    expect(said).toContain("Thome");
    expect(said).toContain("World Peace");
    expect(said).not.toContain("Artest");
    expect(said).not.toContain("CHECKLIST");
  });
});

describe("recomputed from the team answers", () => {
  const teamId = "t1" as Id<"teams">;
  const names = { teamNameById: new Map([[teamId, "Los Angeles Dodgers"]]) };

  test("a team answer changes what the title leaves out", () => {
    const cards = [card("1")];
    const without = rowsOf(buildTitleGroups(cards, context(), [undefined], { names }).titleGroups);
    const withTeam = rowsOf(
      buildTitleGroups(cards, context(), [{ teamIds: [teamId] }], { names }).titleGroups,
    );
    expect(without[0].leftOut).not.toContain("Los Angeles Dodgers");
    expect(withTeam[0].leftOut).toContain("Los Angeles Dodgers");
  });

  test("a printed team resolves through the context; none at all takes the set's team", () => {
    const printed = rowsOf(buildTitleGroups([card("1", { teams: ["LA Dodgers"] })], context()).titleGroups);
    expect(printed[0].leftOut).toContain("Los Angeles Dodgers");
    const setTeam = rowsOf(
      buildTitleGroups([card("1")], context({ setTeamNames: ["Los Angeles Angels"] })).titleGroups,
    );
    expect(setTeam[0].leftOut).toContain("Los Angeles Angels");
  });

  test("the team answer's strings REPLACE the printed ones", () => {
    const rows = rowsOf(
      buildTitleGroups(
        [card("1", { teams: ["LA Dodgers"] })],
        context({
          teams: [
            { printed: "LA Dodgers", name: "Los Angeles Dodgers" },
            { printed: "Seattle Mariners", name: "Seattle Mariners" },
          ],
        }),
        [{ teams: ["Seattle Mariners"] }],
      ).titleGroups,
    );
    expect(rows[0].leftOut).toContain("Seattle Mariners");
    expect(rows[0].leftOut).not.toContain("Los Angeles Dodgers");
  });

  test("teamIdNamesFromRefs keeps only refs with an id", () => {
    expect(
      teamIdNamesFromRefs([
        { teamId: "t1", label: "Reds" },
        { label: "Staged Team" },
      ]),
    ).toEqual(new Map([["t1", "Reds"]]));
  });
});

describe("the over-long variation is asked about once", () => {
  test("a card on the variation list does not also list that variation as a title loss", () => {
    const cards = [card("2", { cardVariation: LONG_VARIATION })];
    const { variationGroups, titleGroups } = buildTitleGroups(cards, context());
    expect(variationGroups).toHaveLength(1);
    expect(rowsOf(titleGroups)[0].leftOut).not.toContain(LONG_VARIATION);
  });
});

describe("a generational suffix stays on the name (shared with the insert)", () => {
  test("a father-and-son card never titles as two bare 'Griffey's", () => {
    for (let pad = 0; pad < 40; pad += 1) {
      const ctx = context({ setNameValue: `Upper Deck ${"x".repeat(20 + pad)}` });
      const groups = buildTitleGroups(
        [card("1", { players: ["Ken Griffey Jr.", "Ken Griffey Sr."] })],
        ctx,
      ).titleGroups;
      for (const c of rowsOf(groups)) {
        expect(c.title).not.toMatch(/Griffey(?! (Jr|Sr)\.)/);
        expect(c.leftOut).not.toContain("Jr.");
        expect(c.leftOut).not.toContain("Sr.");
      }
    }
  });
});

describe("NEO-535 — 'Left out to fit' is read from the text in each field", () => {
  test("retyping a cut word takes it off the note", () => {
    const [generated] = rowsOf(buildTitleGroups([card("1")], context()).titleGroups);
    expect(generated.leftOut).toEqual(["Shohei"]);
    const [typed] = rowsOf(
      buildTitleGroups([card("1")], context(), undefined, {
        answers: [{ listingTitle: `${FIRST_NAME_SET} Shohei Ohtani` }],
      }).titleGroups,
    );
    // The first name is back; what the operator's own words dropped (the
    // year, the brand, the number) is what the note says now.
    expect(typed.text).toBe(`${FIRST_NAME_SET} Shohei Ohtani`);
    expect(typed.leftOut).not.toContain("Shohei");
    expect(typed.leftOut).toContain("#1");
    // The generated title the row offers to go back to is unchanged.
    expect(typed.title).toBe(generated.title);
  });

  test("a blank field is read as the generated title it saves", () => {
    const [row] = rowsOf(
      buildTitleGroups([card("1")], context(), undefined, { answers: [{ listingTitle: "  " }] })
        .titleGroups,
    );
    expect(row.text).toBe(row.title);
    expect(row.leftOut).toEqual(["Shohei"]);
  });

  test("the Insert / Parallel labels are never named as left out", () => {
    const roomy = context({
      setNameValue: "Chrome",
      insertNameValue: "Dugout Collection Sapphire Platinum Anniversary",
      insertIsRole: true,
      parallelLeafValue: "Gold",
    });
    const [row] = rowsOf(
      buildTitleGroups([card("6", { players: ["Shohei Ohtani", "Doc Gooden"] })], roomy).titleGroups,
    );
    expect(row.leftOut).not.toContain("Insert");
    expect(row.leftOut).not.toContain("Parallel");
    expect(row.leftOut).not.toContain("Baseball");
  });
});

describe("NEO-535 — grouping", () => {
  test("cards whose titles left out the same things share one line; each card's own names sit on its row", () => {
    const cards = [
      card("1", { cardVariation: "Throwback" }),
      card("2", { players: ["Doc Gooden"], cardVariation: "Throwback" }),
      card("3", { cardVariation: "Sapphire Gold" }),
    ];
    const { titleGroups } = buildTitleGroups(cards, context());
    expect(titleGroups.map((g) => g.cards.map((c) => c.cardNumber))).toEqual([["1", "2"], ["3"]]);
    // What every card on the line is missing.
    expect(titleGroups[0].leftOut).toEqual(["Throwback"]);
    // The rest, row by row.
    expect(titleGroups[0].cards.map((c) => c.leftOut)).toEqual([["Shohei"], ["Dwight"]]);
    // A one-card group has no line: its row says it all.
    expect(titleGroups[1].leftOut).toEqual([]);
    expect(titleGroups[1].cards[0].leftOut).toEqual(["Shohei", "Sapphire Gold"]);
  });

  test("groups hold still while typing: a retyped word moves from the line to the other rows", () => {
    const cards = [
      card("1", { cardVariation: "Throwback" }),
      card("2", { players: ["Doc Gooden"], cardVariation: "Throwback" }),
    ];
    const before = buildTitleGroups(cards, context()).titleGroups;
    const title1 = before[0].cards[0].title;
    const after = buildTitleGroups(cards, context(), undefined, {
      answers: [{ listingTitle: `${title1} Throwback` }, undefined],
    }).titleGroups;
    expect(after.map((g) => g.key)).toEqual(before.map((g) => g.key));
    expect(after[0].cards.map((c) => c.index)).toEqual([0, 1]);
    // Only card 2 still lacks the variation, so the line no longer says it.
    expect(after[0].leftOut).toEqual([]);
    expect(after[0].cards[1].leftOut).toEqual(["Dwight", "Throwback"]);
  });

  test("a card's own number is its row's business, never a line of its own", () => {
    const { titleGroups } = buildTitleGroups([card("1"), card("2")], OVER);
    expect(titleGroups).toHaveLength(1);
    expect(titleGroups[0].cards.map((c) => c.leftOut)).toEqual([["#1"], ["#2"]]);
  });

  test("cards printing the same over-long variation share one field", () => {
    const cards = [
      card("1", { cardVariation: LONG_VARIATION }),
      card("2", { cardVariation: `  ${LONG_VARIATION}` }),
      card("3", { cardVariation: `${LONG_VARIATION}, again` }),
    ];
    const { variationGroups } = buildTitleGroups(cards, SHORT);
    expect(variationGroups.map((g) => g.cards.map((c) => c.index))).toEqual([[0, 1], [2]]);
  });
});

describe("titleDraftState", () => {
  test("blank or unchanged is kept; within the cap is theirs; past it is over", () => {
    expect(titleDraftState(undefined, "Gen")).toEqual({ kind: "kept" });
    expect(titleDraftState("  ", "Gen")).toEqual({ kind: "kept" });
    expect(titleDraftState(" Gen ", "Gen")).toEqual({ kind: "kept" });
    expect(titleDraftState("Mine", "Gen")).toEqual({ kind: "own", title: "Mine" });
    expect(titleDraftState("t".repeat(LISTING_TITLE_MAX + 1), "Gen")).toEqual({
      kind: "over",
      length: LISTING_TITLE_MAX + 1,
    });
  });
});

describe("titleAnswersForCommit — never blocks, never invents", () => {
  test("an untouched title card sends 'kept'; a card not on the step sends nothing", () => {
    const out = titleAnswersForCommit([card("1"), card("2")], context(), undefined, {
      existingIndexes: [1],
    });
    // The kept answer carries the very title the step showed.
    const shown = rowsOf(buildTitleGroups([card("1")], context()).titleGroups)[0].title;
    expect(out).toEqual([{ listingTitleKept: shown }, undefined]);
    expect(titleAnswersForCommit([card("1")], SHORT)).toEqual([undefined]);
  });

  test("an over-cap title is kept as shown (it is flagged by its length after save)", () => {
    const shown = rowsOf(buildTitleGroups([card("1")], OVER).titleGroups)[0].title;
    expect(shown.length).toBeGreaterThan(LISTING_TITLE_MAX);
    expect(titleAnswersForCommit([card("1")], OVER)).toEqual([{ listingTitleKept: shown }]);
  });

  test("their own title within the cap is sent; over the cap sends nothing at all", () => {
    expect(
      titleAnswersForCommit([card("1")], context(), undefined, {
        answers: [{ listingTitle: " 2026 Topps Chrome Ohtani #1 " }],
      }),
    ).toEqual([{ listingTitle: "2026 Topps Chrome Ohtani #1" }]);
    expect(
      titleAnswersForCommit([card("1")], context(), undefined, {
        answers: [{ listingTitle: "t".repeat(LISTING_TITLE_MAX + 1) }],
      }),
    ).toEqual([undefined]);
  });

  test("a trimmed variation within 65 is sent, flagged as the operator's; over 65 is not", () => {
    const cards = [card("2", { cardVariation: LONG_VARIATION })];
    expect(
      titleAnswersForCommit(cards, SHORT, undefined, { answers: [{ cardVariation: "Throwback " }] }),
    ).toEqual([{ cardVariation: "Throwback", cardVariationAnswered: true }]);
    expect(
      titleAnswersForCommit(cards, SHORT, undefined, {
        answers: [{ cardVariation: "v".repeat(ASPECT_VALUE_MAX + 1) }],
      }),
    ).toEqual([undefined]);
  });

  test("withTitleAnswer: no answer is the same object; an answer replaces the variation", () => {
    const c = card("2", { cardVariation: LONG_VARIATION });
    expect(withTitleAnswer(c, undefined)).toBe(c);
    expect(
      withTitleAnswer(c, { cardVariation: "Throwback", cardVariationAnswered: true }),
    ).toMatchObject({ cardVariation: "Throwback", cardVariationAnswered: true, cardNumber: "2" });
  });
});

describe("NEO-535 — Set name in titles on the step", () => {
  const cards = [card("1"), card("2", { players: ["Doc Gooden"] })];
  const BOX = "2026 Topps Chrome Sapphire";

  test("the box shows whenever the step lists titles, a stored value or not", () => {
    expect(shortNameFieldApplies(cards, context())).toBe(true);
    expect(shortNameFieldApplies(cards, OVER)).toBe(true);
    // A stored value the builder used is still a title the operator should
    // see (Jason Q1: such cards appear in the dialog).
    expect(shortNameFieldApplies(cards, context({ listingShortName: "2026 Topps Chrome" }))).toBe(
      true,
    );
    // Nothing listed: no box.
    expect(shortNameFieldApplies(cards, SHORT)).toBe(false);
    // Only a variation over 65 on the step: no box (it would not help).
    expect(
      shortNameFieldApplies([card("3", { cardVariation: LONG_VARIATION })], SHORT),
    ).toBe(false);
  });

  test("a stored value over-cap cards still need keeps them on the step", () => {
    const stored = context({ setNameValue: OVER_SET, listingShortName: `${OVER_SET} Extra` });
    expect(cardsNeedingTitleReview(cards, stored)).toEqual([0, 1]);
    expect(shortNameFieldApplies(cards, stored)).toBe(true);
  });

  test("prefill: the stored value, else the builder's own description", () => {
    expect(setNameInTitlesPrefill(context())).toBe(`2026 Topps ${FIRST_NAME_SET}`);
    expect(setNameInTitlesPrefill(context({ listingShortName: " Topps Sapphire " }))).toBe(
      "Topps Sapphire",
    );
  });

  test("prefill on a parallel leaf names the parallel, whatever its snapshot inherited", () => {
    const leaf = context({
      setNameValue: "Bowman",
      inheritedFeatures: { manufacturer: "Bowman", season: "2026", parallelName: "Base" },
      insertNameValue: "Anime",
      insertIsRole: true,
      parallelLeafValue: "Anime Red Refractors",
    });
    expect(setNameInTitlesPrefill(leaf)).toBe("2026 Bowman Anime Red Refractors");
  });

  test("the draft rewrites the listed titles as typed; the list never moves", () => {
    const before = buildTitleGroups(cards, context());
    const after = buildTitleGroups(cards, context(), undefined, { listingShortName: BOX });
    expect(rowsOf(after.titleGroups).map((c) => c.index)).toEqual([0, 1]);
    expect(after.titleGroups.map((g) => g.key)).toEqual(before.titleGroups.map((g) => g.key));
    expect(rowsOf(after.titleGroups).map((c) => c.title)).toEqual([
      `${BOX} Shohei Ohtani #1 Baseball`,
      `${BOX} Dwight Gooden #2 Baseball`,
    ]);
    // The box text stands in for the description: nothing is left out now.
    expect(rowsOf(after.titleGroups).map((c) => c.leftOut)).toEqual([[], []]);
    expect(cardsNeedingTitleReview(cards, context())).toEqual([0, 1]);
  });

  test("a draft that cannot fit an over-cap card leaves it over, titled with the draft", () => {
    const longBox = `${BOX} Update Series Platinum Anniversary Collectors Box Edition`;
    const [row] = rowsOf(
      buildTitleGroups([card("1", { players: ["Shohei Ohtani", "Doc Gooden"] })], OVER, undefined, {
        listingShortName: longBox,
      }).titleGroups,
    );
    expect(row.title.startsWith(longBox)).toBe(true);
    expect(row.fits).toBe(false);
  });

  test("the commit's kept titles are generated with the draft", () => {
    expect(titleAnswersForCommit(cards, context(), undefined, { listingShortName: BOX })).toEqual([
      { listingTitleKept: `${BOX} Shohei Ohtani #1 Baseball` },
      { listingTitleKept: `${BOX} Dwight Gooden #2 Baseball` },
    ]);
  });

  test("their own title still wins over the draft", () => {
    const answers = [{ listingTitle: "My Ohtani title #1" }, undefined];
    expect(
      titleAnswersForCommit(cards, context(), undefined, { answers, listingShortName: BOX }),
    ).toEqual([
      { listingTitle: "My Ohtani title #1" },
      { listingTitleKept: `${BOX} Dwight Gooden #2 Baseball` },
    ]);
  });

  test("validShortName: the server's rule (80), read without throwing", () => {
    expect(validShortName("  Topps Sapphire ")).toBe("Topps Sapphire");
    expect(validShortName("")).toBeUndefined();
    expect(validShortName(undefined)).toBeUndefined();
    expect(validShortName("x".repeat(80))).toBe("x".repeat(80));
    expect(validShortName("x".repeat(81))).toBeUndefined();
    expect(validShortName("Topps\tSapphire")).toBeUndefined();
  });
});
