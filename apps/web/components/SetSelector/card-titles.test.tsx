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
import {
  assessNewCardListing,
  listingInputsForCard,
  type TitleContext,
} from "../../convex/features/listingInputs";
import { assessListingTitle } from "../../convex/features/generateListing";
import { ASPECT_VALUE_MAX, LISTING_TITLE_MAX } from "../../convex/features/listingLimits";
import {
  buildTitleGroups,
  cardsNeedingTitleReview,
  retitleDraftsForSetName,
  setNameInTitlesPrefill,
  shortNameFieldApplies,
  swapSetNameInTitle,
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
/** A set so short that a 66-character variation is the ONLY thing wrong with a title (NEO-609: it is never cut). */
const VARIATION_ONLY = context({ setNameValue: "X", inheritedFeatures: {} });
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

  test("NEO-574: a name the career step relinked is titled by the PICKED player", () => {
    const relinked = card("1", {
      players: ["Shohei Ohtani"],
      playerIdByName: [{ name: "Shohei Ohtani", playerId: "p-doc" }],
    });
    const names = { playerNameById: new Map([["p-doc", "Dwight Gooden"]]) };
    const [row] = rowsOf(buildTitleGroups([relinked], context(), undefined, { names }).titleGroups);
    expect(row.title).toContain("Gooden");
    expect(row.title).not.toContain("Ohtani");
  });

  test("NEO-574: the relink matches the printed name loosely, and only that name on the card", () => {
    const two = card("1", {
      players: ["shohei  ohtani", "Ken Griffey Jr."],
      playerIdByName: [{ name: "Shohei Ohtani", playerId: "p-doc" }],
    });
    const names = { playerNameById: new Map([["p-doc", "Dwight Gooden"]]) };
    const [row] = rowsOf(buildTitleGroups([two], context(), undefined, { names }).titleGroups);
    expect(row.title).toContain("Gooden");
    expect(row.title).toContain("Griffey");
    expect(row.title).not.toContain("Ohtani");
  });

  test("NEO-574: a relinked player whose name has not arrived falls back to the printed name's own reading", () => {
    const relinked = card("1", {
      players: ["Shohei Ohtani"],
      playerIdByName: [{ name: "Shohei Ohtani", playerId: "p-doc" }],
    });
    const [row] = rowsOf(buildTitleGroups([relinked], context()).titleGroups);
    expect(row.title).toContain("Ohtani");
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

  test("NEO-528: a card with nobody on it takes the row's Player on every card; a card with a player keeps its own", () => {
    const withDefault = context({ setPlayerNames: ["Ken Griffey Jr."] });
    const titled = (ctx: TitleContext, playerNames: string[]) =>
      assessNewCardListing({ cardNumber: "1" }, ctx, { playerNames, teamNames: [] }).assessment.title;
    const nobody = buildTitleGroups([card("1", { players: [] })], withDefault).titleGroups;
    expect(nobody[0].cards[0].title).toBe(titled(withDefault, ["Ken Griffey Jr."]));
    // This long set cuts the title. NEO-535's order keeps the player's name
    // (the default player is the card's player): only the first name goes,
    // after the number, and the surname stays.
    expect(nobody[0].cards[0].title).toContain("Griffey Jr.");
    expect(nobody[0].cards[0].leftOut).toEqual(["#1", "Ken"]);
    // Printed and resolved: their own player, never the default.
    const own = buildTitleGroups([card("1")], withDefault).titleGroups;
    expect(own[0].cards[0].title).toBe(titled(withDefault, ["Shohei Ohtani"]));
    // Jason, 2026-11-15: a card whose listing names anyone is left blank by
    // the commit, so its title never names the default, even when every
    // printed name was ruled out (no player resolves from it) or is still
    // waiting for review.
    // NEO-535: only a card whose title needs a look is listed, and this one
    // fits once nobody is named, so it is not listed at all (with the default
    // it would be, exactly as `nobody` is).
    const ruledOut = buildTitleGroups([card("1", { players: ["Team Photo"] })], withDefault).titleGroups;
    expect(ruledOut).toEqual([]);
    // A blank printed string names nobody: the default still applies.
    const blank = buildTitleGroups([card("1", { players: ["  "] })], withDefault).titleGroups;
    expect(blank[0].cards[0].title).toBe(titled(withDefault, ["Ken Griffey Jr."]));
    // An older server sends no default: nobody stays nobody.
    const older = buildTitleGroups([card("1", { players: [] })], context()).titleGroups;
    expect(older).toEqual([]);
  });

  test("NEO-528 + NEO-535: the row's default cameos ride in the title as the insert's will, dropped first", () => {
    const withCameo = context({ setCameoNames: ["Ken Griffey Jr."] });
    const groups = buildTitleGroups([card("1")], withCameo).titleGroups;
    const row = groups[0].cards[0];
    // The same title the insert builds for this card with the default cameo.
    expect(row.title).toBe(
      assessNewCardListing({ cardNumber: "1" }, withCameo, {
        playerNames: ["Shohei Ohtani"],
        teamNames: [],
        cameoNames: ["Ken Griffey Jr."],
      }).assessment.title,
    );
    // This long set is over the cap: the cameo is the first thing given up.
    expect(row.title).not.toContain("Griffey");
    expect(row.leftOut[0]).toBe("Ken Griffey Jr.");
    // A default cameo who is the card's own player is not named twice.
    const self = buildTitleGroups([card("1")], context({ setCameoNames: ["Shohei Ohtani"] })).titleGroups;
    expect(self[0].cards[0].leftOut).not.toContain("Shohei Ohtani");
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
    // NEO-609: a variation is never cut, so the shared thing is a RELIC
    // (row 17, before any first name goes).
    const cards = [
      card("1", { isRelic: true }),
      card("2", { players: ["Doc Gooden"], isRelic: true }),
      card("3", { isRookie: true }),
    ];
    const { titleGroups } = buildTitleGroups(cards, context());
    expect(titleGroups.map((g) => g.cards.map((c) => c.cardNumber))).toEqual([["1", "2"], ["3"]]);
    // What every card on the line is missing.
    expect(titleGroups[0].leftOut).toEqual(["RELIC"]);
    // The rest, row by row.
    expect(titleGroups[0].cards.map((c) => c.leftOut)).toEqual([["Shohei"], ["Dwight"]]);
    // A one-card group has no line: its row says it all.
    expect(titleGroups[1].leftOut).toEqual([]);
    expect(titleGroups[1].cards[0].leftOut).toEqual(["#3", "Shohei"]);
  });

  test("groups hold still while typing: a retyped word moves from the line to the other rows", () => {
    const cards = [
      card("1", { isRelic: true }),
      card("2", { players: ["Doc Gooden"], isRelic: true }),
    ];
    const before = buildTitleGroups(cards, context()).titleGroups;
    const title1 = before[0].cards[0].title;
    const after = buildTitleGroups(cards, context(), undefined, {
      answers: [{ listingTitle: `${title1} RELIC` }, undefined],
    }).titleGroups;
    expect(after.map((g) => g.key)).toEqual(before.map((g) => g.key));
    expect(after[0].cards.map((c) => c.index)).toEqual([0, 1]);
    // Only card 2 still lacks the RELIC, so the line no longer says it.
    expect(after[0].leftOut).toEqual([]);
    expect(after[0].cards[1].leftOut).toEqual(["Dwight", "RELIC"]);
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
    ).toEqual([
      {
        cardVariation: "Throwback",
        cardVariationAnswered: true,
        // The card is on the step for its ORIGINAL variation (a variation is
        // never cut, NEO-609, so that title ran over the cap), and the step
        // showed the title the answer gives it: kept as shown.
        listingTitleKept: "2026 Topps Chrome Shohei Ohtani #2 Throwback Baseball",
      },
    ]);
    expect(
      titleAnswersForCommit(cards, SHORT, undefined, {
        answers: [{ cardVariation: "v".repeat(ASPECT_VALUE_MAX + 1) }],
      }),
      // No variation answer counts, so the card keeps its own variation and
      // the over-cap title the step showed for it (kept, not invented).
    ).toEqual([
      {
        listingTitleKept: rowsOf(buildTitleGroups(cards, SHORT).titleGroups)[0].title,
      },
    ]);
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
    // Only a variation over 65 on the step: no box (it would not help). The
    // title must fit by itself for that to hold: a variation is never cut
    // (NEO-609), so beside a real description it would run the title over.
    expect(
      shortNameFieldApplies(
        [card("3", { players: [], cardVariation: "v".repeat(ASPECT_VALUE_MAX + 1) })],
        VARIATION_ONLY,
      ),
    ).toBe(false);
    // Beside a real description a long variation puts the TITLE on the step too.
    expect(
      shortNameFieldApplies([card("3", { cardVariation: LONG_VARIATION })], SHORT),
    ).toBe(true);
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

/**
 * NEO-606 — a team whose row is split gives up its location before it goes,
 * and the step's title is the one the commit and Regenerate will write. The
 * split reaches the preview from the server's context (`teamSplits`), from the
 * teams the operator picked or linked in the wizard (`names.teamSplits`), and
 * from a team created in the Names phase (its Location / Name).
 */
describe("a split team in the preview (NEO-606)", () => {
  const NY = { location: "New York", name: "Yankees" };
  /**
   * A 50-character "Set name in titles" box: "<box> Shohei Ohtani #1" is 66,
   * "New York Yankees" would make 83, "Yankees" 74. The card is on the step
   * because its own description lost a first name and the box did not.
   */
  const BOX = "B".repeat(50);
  const boxed = (extra: Partial<TitleContext> = {}) =>
    context({
      setNameValue: "C".repeat(62),
      listingShortName: BOX,
      teams: [{ printed: "NY", name: "New York Yankees" }],
      ...extra,
    });
  const teamCard = card("1", { teams: ["NY"] });

  /** What Regenerate / the commit title: the same inputs, from the server's builder. */
  const stored = (ctx: TitleContext, teamSplits?: Array<{ location: string; name: string }>) =>
    assessListingTitle(
      listingInputsForCard({ cardNumber: "1" }, ctx, {
        playerNames: ["Shohei Ohtani"],
        teamNames: ["New York Yankees"],
        teamSplits,
      }),
    );

  test("the preview says 'Yankees' from the server context, exactly as the stored title does", () => {
    const ctx = boxed({ teamSplits: [NY] });
    const [row] = rowsOf(buildTitleGroups([teamCard], ctx).titleGroups);
    const written = stored(ctx, [NY]);
    expect(row.title).toBe(`${BOX} Shohei Ohtani #1 Yankees`);
    expect(row.title).toBe(written.title);
    expect(row.leftOut).toEqual(written.dropped);
    expect(row.leftOut).toEqual([]);
  });

  test("without the split the team is dropped whole, in the preview and the stored title alike", () => {
    const ctx = boxed();
    const [row] = rowsOf(buildTitleGroups([teamCard], ctx).titleGroups);
    const written = stored(ctx);
    // The sport the team's room had cost comes back in its place.
    expect(row.title).toBe(`${BOX} Shohei Ohtani #1 Baseball`);
    expect(row.title).toBe(written.title);
    expect(row.leftOut).toEqual(["New York Yankees"]);
    expect(row.leftOut).toEqual(written.dropped);
  });

  test("a team the operator picked or linked carries its split from the wizard's sources", () => {
    const id = "t-ny" as Id<"teams">;
    const names = {
      teamNameById: new Map([[id, "New York Yankees"]]),
      teamSplits: [NY],
    };
    const ctx = boxed();
    const [row] = rowsOf(
      buildTitleGroups([card("1")], ctx, [{ teamIds: [id] }], { names }).titleGroups,
    );
    expect(row.title).toBe(stored(ctx, [NY]).title);
    expect(row.title.endsWith("#1 Yankees")).toBe(true);
  });

  test("a team created in the Names phase carries the Location / Name it was created with", () => {
    const rows: TitleReviewRow[] = [
      {
        kind: "team",
        name: "NYY",
        decision: { action: "create", create: { location: "New York", name: "Yankees" } },
      },
    ];
    const ctx = boxed({ teams: [] });
    const [row] = rowsOf(
      buildTitleGroups([card("1", { teams: ["NYY"] })], ctx, undefined, { names: { rows } })
        .titleGroups,
    );
    expect(row.title).toBe(stored(ctx, [NY]).title);
    expect(row.title.endsWith("#1 Yankees")).toBe(true);
  });

  test("a team with no location (no split) is dropped whole", () => {
    const rows: TitleReviewRow[] = [
      { kind: "team", name: "NYY", decision: { action: "create", create: { name: "New York Yankees" } } },
    ];
    const [row] = rowsOf(
      buildTitleGroups([card("1", { teams: ["NYY"] })], boxed({ teams: [] }), undefined, {
        names: { rows },
      }).titleGroups,
    );
    expect(row.title).toBe(`${BOX} Shohei Ohtani #1 Baseball`);
    expect(row.leftOut).toEqual(["New York Yankees"]);
  });
});

describe("NEO-637 — the box and a title the operator edited", () => {
  const OLD = `2026 Topps ${FIRST_NAME_SET}`;
  const NEW = "2026 Topps Chrome Sapphire";
  const cards: PreviewCardForTitles[] = [
    { cardNumber: "1", cardName: "Card 1", players: ["Shohei Ohtani"] },
    { cardNumber: "2", cardName: "Card 2", players: ["Shohei Ohtani"] },
  ];
  const ctx = context();
  const groups = (answers: Array<{ listingTitle?: string } | undefined>) =>
    buildTitleGroups(cards, ctx, undefined, { answers }).titleGroups;

  describe("swapSetNameInTitle", () => {
    test("swaps the first whole-word run, any case, and keeps every other word", () => {
      expect(swapSetNameInTitle("My 2026 topps Chrome RC Ohtani #1", "2026 Topps Chrome", "Score")).toBe(
        "My Score RC Ohtani #1",
      );
    });

    test("is undefined when the old text is not there, or only inside another word", () => {
      expect(swapSetNameInTitle("My Ohtani title #1", OLD, NEW)).toBeUndefined();
      expect(swapSetNameInTitle("Scorecard Ohtani", "Score", "Box")).toBeUndefined();
      expect(swapSetNameInTitle("anything", "  ", NEW)).toBeUndefined();
    });

    test("start, middle and end of the title", () => {
      expect(swapSetNameInTitle("Old Set Ohtani #1", "Old Set", "New")).toBe("New Ohtani #1");
      expect(swapSetNameInTitle("My Old Set Ohtani #1", "Old Set", "New")).toBe("My New Ohtani #1");
      expect(swapSetNameInTitle("Ohtani #1 Old Set", "Old Set", "New")).toBe("Ohtani #1 New");
    });

    test("a name ending in punctuation, and non-letter edges around the run", () => {
      expect(swapSetNameInTitle("Topps Co. Ohtani", "Topps Co.", "Topps")).toBe("Topps Ohtani");
      expect(swapSetNameInTitle("(Old Set) Ohtani", "Old Set", "New")).toBe("(New) Ohtani");
      expect(swapSetNameInTitle("Old Set, Ohtani", "Old Set", "New")).toBe("New, Ohtani");
      // A name that itself ends in a non-letter needs no word edge after it.
      expect(swapSetNameInTitle("Old Set!Ohtani", "Old Set!", "New")).toBe("NewOhtani");
    });

    test("leading space in the edit does not hide the opening run", () => {
      expect(swapSetNameInTitle("  Old Set Ohtani Old Set", "Old Set", "New")).toBe("  New Ohtani Old Set");
    });

    test("the run at the start wins over a later copy; two copies with none at the start are a guess, so not found", () => {
      expect(swapSetNameInTitle("Old Set Ohtani Old Set", "Old Set", "New")).toBe("New Ohtani Old Set");
      expect(swapSetNameInTitle("Ohtani Old Set #1 Old Set", "Old Set", "New")).toBeUndefined();
    });

    test("a copy inside a longer word does not count towards the repeat", () => {
      expect(swapSetNameInTitle("Ohtani Old Set #1 Old Setter", "Old Set", "New")).toBe("Ohtani New #1 Old Setter");
    });

    test("a swap can make the title longer than 80: it is returned as it is, never cut", () => {
      const long = "N".repeat(79);
      const swapped = swapSetNameInTitle("Old Ohtani #1", "Old", long);
      expect(swapped).toBe(`${long} Ohtani #1`);
      expect(swapped!.length).toBeGreaterThan(LISTING_TITLE_MAX);
    });

    test("a pasted line break in the new text is one space", () => {
      expect(swapSetNameInTitle("Old Ohtani", "Old", "New\nSet")).toBe("New Set Ohtani");
    });
  });

  describe("retitleDraftsForSetName", () => {
    test("a hand edit whose row shows the line: the set name is swapped, the rest kept", () => {
      const edit = `${OLD} Ohtani my own #1 words`;
      const next = retitleDraftsForSetName([{ listingTitle: edit }], groups([{ listingTitle: edit }]), OLD, NEW);
      expect(next[0]).toEqual({ listingTitle: `${NEW} Ohtani my own #1 words` });
    });

    test("a hand edit whose row shows the line but lost the old set name: the edit is dropped (rebuilt)", () => {
      const edit = "My Ohtani title #1";
      const next = retitleDraftsForSetName([{ listingTitle: edit }], groups([{ listingTitle: edit }]), OLD, NEW);
      expect(next[0]).toBeUndefined();
    });

    test("an edit that lost the box text in effect but carries the builder's description is swapped from that", () => {
      // The box was edited to "Prior Box" earlier; this title was written
      // before that, so it still opens with the builder's own description.
      const edit = `${OLD} Ohtani my own #1 words`;
      const next = retitleDraftsForSetName([{ listingTitle: edit }], groups([{ listingTitle: edit }]), "Prior Box", NEW);
      expect(next[0]).toEqual({ listingTitle: `${NEW} Ohtani my own #1 words` });
    });

    test("the box text in effect wins over the builder's description when both are in the edit", () => {
      const edit = `Prior Box Ohtani ${OLD} #1`;
      const next = retitleDraftsForSetName([{ listingTitle: edit }], groups([{ listingTitle: edit }]), "Prior Box", NEW);
      expect(next[0]).toEqual({ listingTitle: `${NEW} Ohtani ${OLD} #1` });
    });

    test("dropping the edit keeps the rest of the answer (the variation)", () => {
      const edit = "My Ohtani title #1";
      const answers = [{ listingTitle: edit, cardVariation: "Blue" }];
      const next = retitleDraftsForSetName(answers, groups(answers), OLD, NEW);
      expect(next[0]).toEqual({ cardVariation: "Blue" });
    });

    test("a hand edit whose row shows no line is left exactly as typed", () => {
      const edit = `${OLD} Shohei Ohtani #1 Baseball`;
      const answers = [{ listingTitle: edit }];
      const [row] = groups(answers).flatMap((g) => g.cards);
      expect(row.leftOut).toEqual([]);
      expect(retitleDraftsForSetName(answers, groups(answers), OLD, NEW)).toEqual(answers);
    });

    test("a blank draft, or one that is just the generated title, is no hand edit", () => {
      const generated = groups([])[0].cards[1].title;
      const answers = [{ listingTitle: "   " }, { listingTitle: generated }];
      expect(retitleDraftsForSetName(answers, groups(answers), OLD, NEW)).toEqual(answers);
    });

    test("a line shared by the group alone (the row's own is empty) counts as showing the line", () => {
      const answers = [
        { listingTitle: `${OLD} Ohtani my own #1` },
        { listingTitle: `${OLD} Ohtani my own #2` },
      ];
      const [group] = groups(answers);
      expect(group.leftOut.length).toBeGreaterThan(0);
      expect(group.cards.every((c) => c.leftOut.length === 0)).toBe(true);
      expect(retitleDraftsForSetName(answers, groups(answers), OLD, NEW)).toEqual([
        { listingTitle: `${NEW} Ohtani my own #1` },
        { listingTitle: `${NEW} Ohtani my own #2` },
      ]);
    });

    test("an edit with the old text twice and none at the start falls to the builder's description, then rebuilds", () => {
      const twice = `Ohtani Prior Box #1 Prior Box`;
      expect(
        retitleDraftsForSetName([{ listingTitle: twice }], groups([{ listingTitle: twice }]), "Prior Box", NEW)[0],
      ).toBeUndefined();
      const withDescription = `Ohtani ${OLD} #1 Prior Box Prior Box`;
      expect(
        retitleDraftsForSetName([{ listingTitle: withDescription }], groups([{ listingTitle: withDescription }]), "Prior Box", NEW)[0],
      ).toEqual({ listingTitle: `Ohtani ${NEW} #1 Prior Box Prior Box` });
    });

    test("an unchanged set name changes nothing", () => {
      const answers = [{ listingTitle: `${OLD} Ohtani my own #1` }];
      expect(retitleDraftsForSetName(answers, groups(answers), OLD, OLD)).toEqual(answers);
    });
  });
});
