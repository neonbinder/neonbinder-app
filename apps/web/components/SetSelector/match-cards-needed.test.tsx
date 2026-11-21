/**
 * NEO-640 — `matchCardsNeeded`: does any streamed card still need the operator
 * in Match Cards? Every branch, for 0, 1, 2 and 3 sources.
 *
 * (`.test.tsx` on purpose: under `components/` a `.test.ts` is collected by
 * nothing, see `vitest.include.mjs`.)
 *
 * The fixtures are named for what the row IS, not for the branch that reads
 * it: a clean pair, then one field changed per test, so a test that fails
 * names the one thing that opened the dialog.
 */

import { describe, expect, it } from "vitest";
import {
  isFullConfidence,
  matchCardsNeeded,
  type FetchSource,
  type MatchCandidate,
} from "./match-cards-needed";

const BOTH: FetchSource[] = ["bsc", "sportlots"];
const BSC_CHECKLIST: FetchSource[] = ["bsc", "checklist"];
const ALL_THREE: FetchSource[] = ["bsc", "sportlots", "checklist"];

/** A BSC + SportLots pair, paired by number, at full confidence. */
const pair = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  cardNumber: "1",
  cardName: "Solo One",
  bucket: "matched",
  confidence: 1,
  pairedBy: "number",
  platformData: { bsc: { ref: "bsc-1" }, sportlots: { ref: "sl-1" } },
  ...over,
});

/** A card only BSC lists, linked to a checklist row by number. */
const bscLinked = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  cardNumber: "1",
  cardName: "Solo One",
  bucket: "bscOnly",
  platformData: { bsc: { ref: "bsc-1" } },
  checklistLink: { via: "number" },
  ...over,
});

/** A pair that is also linked to a checklist row by number. */
const linkedPair = (over: Partial<MatchCandidate> = {}): MatchCandidate =>
  pair({ checklistLink: { via: "number" }, ...over });

describe("matchCardsNeeded — no sources", () => {
  it("has nothing to show for an empty batch", () => {
    expect(matchCardsNeeded([], [])).toBe(false);
  });

  it("cannot vouch for any card, so any card needs the operator", () => {
    expect(matchCardsNeeded([pair()], [])).toBe(true);
  });
});

describe("matchCardsNeeded — one source keeps the solo rule (NEO-255)", () => {
  const solo = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
    cardNumber: "1",
    cardName: "Solo One",
    bucket: "slOnly",
    platformData: { sportlots: { ref: "sl-1" } },
    ...over,
  });

  it("skips a batch of plain singles", () => {
    expect(matchCardsNeeded([solo(), solo({ cardNumber: "2" })], ["sportlots"])).toBe(false);
  });

  it("skips a batch that is empty", () => {
    expect(matchCardsNeeded([], ["bsc"])).toBe(false);
  });

  it("opens for a matched row, which a single source should not produce", () => {
    expect(matchCardsNeeded([solo(), pair()], ["bsc"])).toBe(true);
  });

  it("opens for a name conflict", () => {
    const c = solo({ nameConflict: { bsc: "A", sportlots: "B" } });
    expect(matchCardsNeeded([c], ["sportlots"])).toBe(true);
  });

  it("opens for a roster conflict", () => {
    const c = solo({ playersConflict: { bsc: ["A"], sportlots: ["B"] } });
    expect(matchCardsNeeded([c], ["sportlots"])).toBe(true);
  });

  it("does not look at confidence, pairedBy or a checklist link: only the solo triggers count", () => {
    const c = solo({ confidence: 0.5, pairedBy: "name", checklistLink: { via: "playerName" } });
    expect(matchCardsNeeded([c], ["checklist"])).toBe(false);
  });
});

describe("matchCardsNeeded — two marketplaces", () => {
  it("skips when every card is a full-confidence pair", () => {
    expect(matchCardsNeeded([pair(), pair({ cardNumber: "2" })], BOTH)).toBe(false);
  });

  it("skips an empty batch", () => {
    expect(matchCardsNeeded([], BOTH)).toBe(false);
  });

  it.each(["stored", "crossRef", "number", "variation"] as const)(
    "a full-confidence pair paired by %s is Matched at 100% and skips",
    (pairedBy) => {
      expect(matchCardsNeeded([pair({ pairedBy })], BOTH)).toBe(false);
    },
  );

  it("a matched row with no pairedBy is unknown and opens (a row written before the field)", () => {
    const { pairedBy: _omit, ...unstamped } = pair();
    expect(matchCardsNeeded([unstamped], BOTH)).toBe(true);
  });

  it("a pair paired by name is a guess and opens", () => {
    expect(matchCardsNeeded([pair({ pairedBy: "name" })], BOTH)).toBe(true);
  });

  it("a pair carrying pairedNumber (the numbers-didn't-match note) opens", () => {
    expect(matchCardsNeeded([pair({ pairedBy: "name", pairedNumber: "250" })], BOTH)).toBe(true);
    expect(matchCardsNeeded([pair({ pairedNumber: "250" })], BOTH)).toBe(true);
  });

  it("a pair at confidence 0.9 opens", () => {
    expect(matchCardsNeeded([pair({ confidence: 0.9 })], BOTH)).toBe(true);
  });

  it("a pair with no confidence stamp reads as full and skips", () => {
    const { confidence: _omit, ...bare } = pair();
    expect(matchCardsNeeded([bare], BOTH)).toBe(false);
  });

  it("a matched row missing a marketplace half opens", () => {
    expect(
      matchCardsNeeded([pair({ platformData: { bsc: { ref: "bsc-1" } } })], BOTH),
    ).toBe(true);
    expect(
      matchCardsNeeded([pair({ platformData: { sportlots: { ref: "sl-1" } } })], BOTH),
    ).toBe(true);
  });

  it("a card only BSC has opens", () => {
    const c: MatchCandidate = {
      cardNumber: "9",
      cardName: "Lonely",
      bucket: "bscOnly",
      platformData: { bsc: { ref: "bsc-9" } },
    };
    expect(matchCardsNeeded([pair(), c], BOTH)).toBe(true);
  });

  it("a card only SportLots has opens", () => {
    const c: MatchCandidate = {
      cardNumber: "9",
      cardName: "Lonely",
      bucket: "slOnly",
      platformData: { sportlots: { ref: "sl-9" } },
    };
    expect(matchCardsNeeded([c], BOTH)).toBe(true);
  });

  it("a name conflict opens even on a full-confidence pair", () => {
    expect(
      matchCardsNeeded([pair({ nameConflict: { bsc: "A", sportlots: "B" } })], BOTH),
    ).toBe(true);
  });

  it("a roster conflict opens even on a full-confidence pair", () => {
    expect(
      matchCardsNeeded([pair({ playersConflict: { bsc: ["A"], sportlots: ["B"] } })], BOTH),
    ).toBe(true);
  });

  it("one needing card among many clean ones is enough", () => {
    const clean = [1, 2, 3, 4].map((n) => pair({ cardNumber: String(n) }));
    expect(matchCardsNeeded([...clean, pair({ confidence: 0.5 })], BOTH)).toBe(true);
  });

  it("a checklist-only row opens", () => {
    const row: MatchCandidate = {
      cardNumber: "1",
      cardName: "Row",
      bucket: "checklistOnly",
      platformData: {},
    };
    expect(matchCardsNeeded([pair(), row], BOTH)).toBe(true);
  });
});

describe("matchCardsNeeded — one marketplace and the checklist", () => {
  it("skips a card linked to a checklist row by number", () => {
    expect(matchCardsNeeded([bscLinked()], BSC_CHECKLIST)).toBe(false);
  });

  it.each(["caseFolded", "prefixStripped", "player"] as const)(
    "skips a card linked by %s at full confidence",
    (via) => {
      expect(matchCardsNeeded([bscLinked({ checklistLink: { via } })], BSC_CHECKLIST)).toBe(
        false,
      );
    },
  );

  it("opens a card with no checklist link", () => {
    expect(matchCardsNeeded([bscLinked({ checklistLink: undefined })], BSC_CHECKLIST)).toBe(
      true,
    );
  });

  it.each(["playerName", "playerFuzzy"] as const)(
    "opens a card linked by %s even at full confidence",
    (via) => {
      expect(
        matchCardsNeeded([bscLinked({ checklistLink: { via, confidence: 1 } })], BSC_CHECKLIST),
      ).toBe(true);
    },
  );

  it("opens a link below full confidence", () => {
    expect(
      matchCardsNeeded(
        [bscLinked({ checklistLink: { via: "number", confidence: 0.95 } })],
        BSC_CHECKLIST,
      ),
    ).toBe(true);
  });

  it("opens a link to a row that prints another number", () => {
    expect(
      matchCardsNeeded(
        [bscLinked({ checklistLink: { via: "number", checklistNumber: "38a" } })],
        BSC_CHECKLIST,
      ),
    ).toBe(true);
  });

  it("reads a blank checklistNumber as no number", () => {
    expect(
      matchCardsNeeded(
        [bscLinked({ checklistLink: { via: "number", checklistNumber: "  " } })],
        BSC_CHECKLIST,
      ),
    ).toBe(false);
  });

  it("opens a checklist-only row", () => {
    const row: MatchCandidate = {
      cardNumber: "2",
      cardName: "Row",
      bucket: "checklistOnly",
      platformData: {},
    };
    expect(matchCardsNeeded([bscLinked(), row], BSC_CHECKLIST)).toBe(true);
  });

  it("a one-marketplace card is not a bscOnly problem when SportLots is not a source", () => {
    expect(matchCardsNeeded([bscLinked({ bucket: "slOnly" })], ["sportlots", "checklist"])).toBe(
      false,
    );
  });

  it("opens on a name or roster conflict", () => {
    expect(
      matchCardsNeeded(
        [bscLinked({ nameConflict: { bsc: "A", sportlots: "B" } })],
        BSC_CHECKLIST,
      ),
    ).toBe(true);
    expect(
      matchCardsNeeded(
        [bscLinked({ playersConflict: { bsc: ["A"], sportlots: ["B"] } })],
        BSC_CHECKLIST,
      ),
    ).toBe(true);
  });

  it("opens when the checklist and the marketplaces disagree about who is on the card", () => {
    const c = bscLinked({
      checklistConflict: { players: { marketplace: ["A"], checklist: ["B"] } },
    });
    expect(matchCardsNeeded([c], BSC_CHECKLIST)).toBe(true);
  });

  it("does not open for a team-only disagreement (the wizard settles it)", () => {
    const c = bscLinked({
      checklistConflict: { teams: { marketplace: [], checklist: ["Reds"] } },
    });
    expect(matchCardsNeeded([c], BSC_CHECKLIST)).toBe(false);
  });
});

describe("matchCardsNeeded — three sources", () => {
  it("skips a full-confidence pair linked to a checklist row by number", () => {
    expect(matchCardsNeeded([linkedPair()], ALL_THREE)).toBe(false);
  });

  it("opens a pair with no checklist link", () => {
    expect(matchCardsNeeded([pair()], ALL_THREE)).toBe(true);
  });

  it("opens a card only one marketplace has, even with a checklist link", () => {
    expect(matchCardsNeeded([bscLinked()], ALL_THREE)).toBe(true);
  });

  it("opens a name pair even when the checklist link is clean", () => {
    expect(matchCardsNeeded([linkedPair({ pairedBy: "name" })], ALL_THREE)).toBe(true);
  });

  it("opens a pair at 0.9 even when the checklist link is clean", () => {
    expect(matchCardsNeeded([linkedPair({ confidence: 0.9 })], ALL_THREE)).toBe(true);
  });

  it("opens a pair whose checklist link is by player name", () => {
    expect(
      matchCardsNeeded([linkedPair({ checklistLink: { via: "playerName" } })], ALL_THREE),
    ).toBe(true);
  });

  it("opens a checklist-only row among clean pairs", () => {
    const row: MatchCandidate = {
      cardNumber: "7",
      cardName: "Row",
      bucket: "checklistOnly",
      platformData: {},
    };
    expect(matchCardsNeeded([linkedPair(), row], ALL_THREE)).toBe(true);
  });

  it("skips when SportLots and the checklist are sources but BSC is not, and a card is one-sided", () => {
    expect(
      matchCardsNeeded(
        [
          {
            cardNumber: "1",
            cardName: "A",
            bucket: "slOnly",
            platformData: { sportlots: { ref: "sl-1" } },
            checklistLink: { via: "number" },
          },
        ],
        ["sportlots", "checklist"],
      ),
    ).toBe(false);
  });
});

describe("isFullConfidence", () => {
  it("reads 1 as full", () => {
    expect(isFullConfidence(1)).toBe(true);
  });

  it("reads a missing stamp as full", () => {
    expect(isFullConfidence(undefined)).toBe(true);
  });

  it("reads 0.99 as not full", () => {
    expect(isFullConfidence(0.99)).toBe(false);
  });

  it("reads 0 as not full", () => {
    expect(isFullConfidence(0)).toBe(false);
  });
});
