/**
 * NEO-535 — `parallel-titles.ts`, the pure half of the parallel Card titles
 * dialog: what each stored card shows (with and without a box draft), what
 * Save sends, when leaving asks first, and the lines it says.
 *
 * `.test.tsx` because the `components` project collects only that suffix.
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { assessListingTitle, type ListingCardInputs } from "../../convex/features/generateListing";
import { assessParallelCopyTitle } from "../../convex/features/carriedTitle";
import {
  assessStoredTitleCards,
  moreTitlesLine,
  parallelTitlesSource,
  saveTitleFixesArgs,
  savedTitlesLine,
  NOTHING_CHANGED,
  sectionEdited,
  type ParallelTitlesSection,
  type StoredTitleCard,
} from "./parallel-titles";

const PARALLEL = "Kanji Orange Wave Refractor Sapphire Gold XYZW";
const BOX = "Anime Kanji XYZW";

function inputs(cardNumber: string): StoredTitleCard["inputs"] {
  const out: ListingCardInputs & { playerNames: string[]; teamNames: string[] } = {
    cardNumber,
    playerNames: ["Mike Trout"],
    teamNames: [],
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps Chrome",
    insertName: "Anime",
    parallelName: PARALLEL,
    parallelIsRole: true,
    sport: "Baseball",
  };
  return out;
}

function stored(n: string, extra: Partial<StoredTitleCard> = {}): StoredTitleCard {
  return {
    cardId: `card-${n}` as unknown as Id<"cardChecklist">,
    cardNumber: n,
    cardName: "Mike Trout",
    title: assessListingTitle(inputs(n)).title,
    inputs: inputs(n),
    ...extra,
  };
}

const OVER = `${"Long ".repeat(17)}#9`;

function section(cards = [stored("3"), stored("4")], moreCount = 0): ParallelTitlesSection {
  return {
    parallelId: "parallel-1" as unknown as Id<"selectorOptions">,
    parallelValue: PARALLEL,
    boxPrefill: `2024 Topps Chrome Anime ${PARALLEL}`,
    cards,
    moreCount,
  };
}

describe("assessStoredTitleCards", () => {
  test("with the box untouched each card shows its stored title, flagged by why it is here", () => {
    const [cut, over] = assessStoredTitleCards([stored("3"), stored("9", { title: OVER })]);
    expect(cut.title).toBe(stored("3").title);
    expect(cut.items).toEqual([{ kind: "titleTruncated" }]);
    expect(over.title).toBe(OVER);
    expect(over.fits).toBe(false);
    expect(over.items).toEqual([{ kind: "titleOverLimit", length: OVER.length }]);
  });

  test("a box draft redraws each title by the build's own order", () => {
    const card = stored("3", { carriedRest: "Trout Halos" });
    const [drawn] = assessStoredTitleCards([card], BOX);
    expect(drawn.title).toBe(
      assessParallelCopyTitle({ ...card.inputs, setShortName: BOX }, "Trout Halos").title,
    );
    expect(drawn.title).toContain(`${BOX} Mike Trout`);
    expect(drawn.inputs.setShortName).toBe(BOX);
  });

  // NEO-618 — a card that fits but lost its team (a Tidy Up cut, not a first
  // name) takes the box the operator types, in the dialog as in the build.
  describe("NEO-618 the box on a card that only lost its team", () => {
    const chromamax = (): StoredTitleCard["inputs"] => ({
      cardNumber: "CM-CD",
      playerNames: ["Chase Dollander"],
      teamNames: ["Colorado Rockies"],
      year: "2026",
      manufacturer: "Pulse",
      setName: "Aura",
      insertName: "Chromamax",
      parallelName: "Special Purple Light Blue",
      parallelIsRole: true,
      sport: "Baseball",
    });
    const teamless = (): StoredTitleCard => ({
      cardId: "card-cm" as unknown as Id<"cardChecklist">,
      cardNumber: "CM-CD",
      cardName: "Chase Dollander",
      title: assessListingTitle(chromamax()).title,
      inputs: chromamax(),
    });

    test("the stored title is the builder's, team out", () => {
      const [shown] = assessStoredTitleCards([teamless()]);
      expect(shown.title).toBe(
        "2026 Pulse Aura Chromamax Special Purple Light Blue Chase Dollander #CM-CD",
      );
    });

    test("a box draft redraws it, the team still out at that length", () => {
      const [shown] = assessStoredTitleCards(
        [teamless()],
        "2026 Pulse Aura Chromamax Special Light Blue",
      );
      expect(shown.title).toBe(
        "2026 Pulse Aura Chromamax Special Light Blue Chase Dollander #CM-CD Baseball",
      );
      expect(shown.inputs.setShortName).toBe("2026 Pulse Aura Chromamax Special Light Blue");
    });

    test("a shorter box draft brings the team back", () => {
      const [shown] = assessStoredTitleCards([teamless()], "2026 Aura Chromamax Light Blue");
      expect(shown.title).toBe(
        "2026 Aura Chromamax Light Blue Chase Dollander #CM-CD Colorado Rockies Baseball",
      );
    });
  });

  test("groups hold still while the box is edited: the key is read from the stored title", () => {
    const [plain] = assessStoredTitleCards([stored("3")]);
    const [boxed] = assessStoredTitleCards([stored("3")], BOX);
    expect(boxed.groupKey).toBe(plain.groupKey);
  });
});

describe("parallelTitlesSource", () => {
  test("counts its cards, opens the box on the prefill, and names its scope", () => {
    const source = parallelTitlesSource(section(), PARALLEL);
    expect(source.count).toBe(2);
    expect(source.prefill).toBe(section().boxPrefill);
    expect(source.scope).toBe(PARALLEL);
    expect(source.more).toBeUndefined();
    const { titleGroups, variationGroups } = source.groups({ answers: [] });
    expect(variationGroups).toEqual([]);
    expect(titleGroups.flatMap((g) => g.cards)).toHaveLength(2);
  });

  test("cards past the first page are counted in a line", () => {
    const source = parallelTitlesSource(section(undefined, 7));
    expect(source.more).toEqual({ count: 7, line: moreTitlesLine(7) });
    expect(source.scope).toBeUndefined();
  });
});

describe("saveTitleFixesArgs", () => {
  test("an own title is sent as the card's title; an untouched row is kept as shown", () => {
    const args = saveTitleFixesArgs(section(), [{ listingTitle: "  My Trout #3  " }, undefined]);
    expect(args).toEqual({
      parallelId: section().parallelId,
      cards: [
        { cardId: stored("3").cardId, listingTitle: "My Trout #3" },
        { cardId: stored("4").cardId, kept: stored("4").title },
      ],
    });
  });

  test("a draft over the cap answers nothing, so that card stays flagged", () => {
    const args = saveTitleFixesArgs(section(), [{ listingTitle: "x".repeat(81) }, undefined]);
    expect(args.cards.map((c) => c.cardId)).toEqual([stored("4").cardId]);
  });

  test("a draft equal to the shown title, or blank, keeps it", () => {
    const args = saveTitleFixesArgs(section(), [
      { listingTitle: stored("3").title },
      { listingTitle: "   " },
    ]);
    expect(args.cards).toEqual([
      { cardId: stored("3").cardId, kept: stored("3").title },
      { cardId: stored("4").cardId, kept: stored("4").title },
    ]);
  });

  test("with a box, kept rows carry the box-built title and the box is sent", () => {
    const args = saveTitleFixesArgs(section(), [], BOX);
    expect(args.listingShortName).toBe(BOX);
    for (const card of args.cards) expect(card.kept).toContain(`${BOX} Mike Trout`);
  });
});

describe("sectionEdited", () => {
  test("an edited box, or a title changed from what it shows, is an edit", () => {
    expect(sectionEdited(section(), [], undefined)).toBe(false);
    expect(sectionEdited(section(), [], BOX)).toBe(true);
    expect(sectionEdited(section(), [{ listingTitle: "Mine #3" }], undefined)).toBe(true);
  });

  test("a draft that is blank or the same title is not", () => {
    expect(sectionEdited(section(), [{ listingTitle: "  " }], undefined)).toBe(false);
    expect(sectionEdited(section(), [{ listingTitle: ` ${stored("3").title} ` }], undefined)).toBe(false);
  });
});

describe("savedTitlesLine", () => {
  const zero = { saved: 0, rewritten: 0, kept: 0, skipped: 0, stillFailing: 0 };

  test("sums saved, rewritten and kept", () => {
    expect(savedTitlesLine({ ...zero, saved: 1 })).toBe("Saved 1 title.");
    expect(savedTitlesLine({ ...zero, saved: 1, rewritten: 2, kept: 3 })).toBe("Saved 6 titles.");
  });

  test("says what still runs long and what was left alone", () => {
    expect(savedTitlesLine({ ...zero, kept: 1, stillFailing: 1, skipped: 1 })).toBe(
      "Saved 1 title. 1 still runs long. 1 changed while you were in there, so it was left alone.",
    );
    expect(savedTitlesLine({ ...zero, stillFailing: 2, skipped: 3 })).toBe(
      "No titles saved. 2 still run long. 3 changed while you were in there, so they were left alone.",
    );
  });

  test("a save that wrote nothing says so, never 'Saved 0 titles.'", () => {
    expect(savedTitlesLine(zero)).toBe(NOTHING_CHANGED);
    expect(NOTHING_CHANGED).toBe("Nothing changed, dude.");
  });
});
