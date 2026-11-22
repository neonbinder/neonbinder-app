/**
 * NEO-645 — the One-card Tidy Up derivation in convex/features/cardAttention.ts
 * (`deriveCardAttention`): pink ("fix"), blue ("check") and "none", from the
 * row alone.
 *
 * Pure function, so plain unit tests. The legacy rule (`missingTeam`,
 * `unreviewedName`) is covered, unchanged, in cardAttention.test.ts under its
 * new name `deriveLegacyCardAttention`.
 */

import { describe, expect, test } from "vitest";
import {
  TIDY_REVIEWED_KEY_MAX_LENGTH,
  TIDY_REVIEWED_MAX_KEYS,
  currentReviewKeys,
  deriveCardAttention,
  teamFillOf,
  tidyHash,
  tidyReviewedKeyCareer,
  tidyReviewedKeyCareerGap,
  tidyReviewedKeyCut,
  tidyReviewedKeyPicked,
  tidyReviewedKeyVariation,
  type AttentionCardRow,
} from "./cardAttention";

/** A card with nothing to ask: one linked player, one linked team. */
const CLEAN: AttentionCardRow = {
  playerIds: ["p1"],
  teamOnCardIds: ["t1"],
  platformData: {},
  listingTitle: "2024 Topps #1 Mike Trout",
};

const kinds = (row: AttentionCardRow) =>
  deriveCardAttention(row).items.map((i) => i.kind);
const level = (row: AttentionCardRow) => deriveCardAttention(row).level;

describe("deriveCardAttention — nothing to ask", () => {
  test("a clean card is none with no items", () => {
    expect(deriveCardAttention(CLEAN)).toEqual({ level: "none", items: [] });
  });

  test("an empty row with an operator's No-team stamp and no names is none", () => {
    expect(
      deriveCardAttention({ teamNoneConfirmedAt: 1, platformData: {} }),
    ).toEqual({ level: "none", items: [] });
  });

  test("level is none exactly when items is empty", () => {
    for (const row of [
      CLEAN,
      { ...CLEAN, pendingPlayerNames: ["Mike Trout"] },
      { ...CLEAN, listingTitleTruncated: true },
    ]) {
      const { level: l, items } = deriveCardAttention(row);
      expect(l === "none").toBe(items.length === 0);
    }
  });
});

describe("deriveCardAttention — pink: sources disagree", () => {
  test("a disagreement with no chosen value is pink", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      sourceDisagreements: [
        {
          field: "players",
          values: [
            { value: ["Jackson Merril"], sources: ["bsc", "sportlots"] },
            { value: ["Jackson Merrill"], sources: ["checklist"] },
          ],
        },
      ],
    };
    expect(deriveCardAttention(row).items).toEqual([
      { level: "fix", kind: "sourcesDisagree", field: "players" },
    ]);
    expect(level(row)).toBe("fix");
  });

  test("an operator's choice answers it: nothing is left", () => {
    expect(
      deriveCardAttention({
        ...CLEAN,
        sourceDisagreements: [
          {
            field: "players",
            values: [
              { value: ["A"], sources: ["bsc"] },
              { value: ["B"], sources: ["checklist"] },
            ],
            chosen: { value: ["B"], by: "operator" },
          },
        ],
      }),
    ).toEqual({ level: "none", items: [] });
  });

  test("two unsettled fields are two items, players before teams as stored", () => {
    const d = (field: "players" | "teams") => ({
      field,
      values: [
        { value: ["A"], sources: ["bsc"] },
        { value: ["B"], sources: ["checklist"] },
      ],
    });
    expect(
      deriveCardAttention({ ...CLEAN, sourceDisagreements: [d("players"), d("teams")] })
        .items,
    ).toEqual([
      { level: "fix", kind: "sourcesDisagree", field: "players" },
      { level: "fix", kind: "sourcesDisagree", field: "teams" },
    ]);
  });
});

describe("deriveCardAttention — pink: names", () => {
  test("a pending player name is pink and carries the names", () => {
    const { items } = deriveCardAttention({
      ...CLEAN,
      playerIds: [],
      pendingPlayerNames: ["Jackson Merrill"],
    });
    expect(items).toEqual([
      { level: "fix", kind: "playerName", names: ["Jackson Merrill"] },
    ]);
  });

  test("a multi-player card with one name linked is still pink while another is pending", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      playerIds: ["p1"],
      pendingPlayerNames: ["Second Player"],
    };
    expect(kinds(row)).toEqual(["playerName"]);
    expect(level(row)).toBe("fix");
  });

  test("a legacy pending player name left beside a link is pink (the old rule let it pass)", () => {
    expect(
      kinds({ ...CLEAN, playerIds: ["p1"], pendingPlayerNames: ["Doc Gooden"] }),
    ).toContain("playerName");
  });

  test("a pending team name is pink, and is NOT also 'no team'", () => {
    const { items } = deriveCardAttention({
      ...CLEAN,
      teamOnCardIds: [],
      pendingTeamNames: ["SD Padres"],
    });
    expect(items).toEqual([{ level: "fix", kind: "teamName", names: ["SD Padres"] }]);
  });

  test("a pending team name beside a linked team is still pink (flips NEO-208)", () => {
    expect(
      kinds({ ...CLEAN, teamOnCardIds: ["t1"], pendingTeamNames: ["SD Padres"] }),
    ).toEqual(["teamName"]);
  });

  test("blank spellings are not names", () => {
    expect(
      deriveCardAttention({
        ...CLEAN,
        pendingPlayerNames: ["  ", ""],
        pendingTeamNames: [" "],
      }),
    ).toEqual({ level: "none", items: [] });
  });
});

describe("deriveCardAttention — pink: no team", () => {
  const TEAMLESS: AttentionCardRow = { playerIds: ["p1"], platformData: {} };

  test("no team, nobody has said none, no lookup owed: pink", () => {
    expect(deriveCardAttention(TEAMLESS).items).toEqual([{ level: "fix", kind: "noTeam" }]);
  });

  test("a No-team stamp answers it", () => {
    expect(level({ ...TEAMLESS, teamNoneConfirmedAt: 5 })).toBe("none");
  });

  test("a card still waiting on the team lookup is not pink for team", () => {
    const waiting: AttentionCardRow = {
      ...TEAMLESS,
      platformData: { bsc: { ref: "123" } },
    };
    expect(level(waiting)).toBe("none");
    // ...and the moment the lookup has been and gone, it is pink.
    expect(kinds({ ...waiting, teamCheckDoneAt: 9 })).toEqual(["noTeam"]);
  });

  test("an unsettled TEAMS disagreement holds the no-team stop back", () => {
    const row: AttentionCardRow = {
      ...TEAMLESS,
      sourceDisagreements: [
        {
          field: "teams",
          values: [
            { value: ["Padres"], sources: ["bsc"] },
            { value: ["Mets"], sources: ["checklist"] },
          ],
        },
      ],
    };
    expect(kinds(row)).toEqual(["sourcesDisagree"]);
  });

  test("a settled teams disagreement does not hide a card that still has no team", () => {
    expect(
      kinds({
        ...TEAMLESS,
        sourceDisagreements: [
          {
            field: "teams",
            values: [
              { value: ["Padres"], sources: ["bsc"] },
              { value: ["Mets"], sources: ["checklist"] },
            ],
            chosen: { value: ["Padres"], by: "operator" },
          },
        ],
      }),
    ).toEqual(["noTeam"]);
  });

  test("a card the commit pre-filled (teamFill) has a team and is not a stop", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      tidyChecks: [{ kind: "teamFill", teamIds: ["t1"], reason: "career" }],
    };
    expect(deriveCardAttention(row)).toEqual({ level: "none", items: [] });
  });

  test("a pending player name and no team are both asked: one tile each", () => {
    expect(kinds({ platformData: {}, pendingPlayerNames: ["X Y"] })).toEqual([
      "playerName",
      "noTeam",
    ]);
  });
});

describe("deriveCardAttention — pink: autograph", () => {
  const AU: AttentionCardRow = { ...CLEAN, attributes: ["RC", "AU"] };

  test("the AU token with no format is pink", () => {
    expect(deriveCardAttention(AU).items).toEqual([{ level: "fix", kind: "autograph" }]);
  });

  test("the set-level default 'None' is not an answer", () => {
    expect(kinds({ ...AU, features: { autographed: "None" } })).toEqual(["autograph"]);
  });

  test.each(["On Card", "Sticker/Label"])("'%s' answers it", (format) => {
    expect(level({ ...AU, features: { autographed: format } })).toBe("none");
  });

  test("a lowercase token still counts; a card without AU never asks", () => {
    expect(kinds({ ...CLEAN, attributes: ["au"] })).toEqual(["autograph"]);
    expect(level({ ...CLEAN, attributes: ["RC"] })).toBe("none");
  });
});

describe("deriveCardAttention — title boundaries", () => {
  const titleOf = (n: number) => "x".repeat(n);

  test("80 characters is fine; 81 is pink with the length", () => {
    expect(level({ ...CLEAN, listingTitle: titleOf(80) })).toBe("none");
    expect(deriveCardAttention({ ...CLEAN, listingTitle: titleOf(81) }).items).toEqual([
      { level: "fix", kind: "titleOverLimit", length: 81 },
    ]);
  });

  test("an over-limit title that is also flagged cut is pink once, not blue too", () => {
    expect(
      kinds({ ...CLEAN, listingTitle: titleOf(90), listingTitleTruncated: true }),
    ).toEqual(["titleOverLimit"]);
  });

  test("65 characters of variation is fine; 66 is blue", () => {
    expect(level({ ...CLEAN, cardVariation: "v".repeat(65) })).toBe("none");
    const { items, level: l } = deriveCardAttention({
      ...CLEAN,
      cardVariation: "v".repeat(66),
    });
    expect(l).toBe("check");
    expect(items).toEqual([
      {
        level: "check",
        kind: "variationOverLimit",
        length: 66,
        key: tidyReviewedKeyVariation("v".repeat(66)),
      },
    ]);
  });

  test("the variation is measured trimmed", () => {
    expect(level({ ...CLEAN, cardVariation: `  ${"v".repeat(65)}  ` })).toBe("none");
  });
});

describe("deriveCardAttention — blue", () => {
  test("a disagreement NB decided is blue, keyed on the value it chose", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      sourceDisagreements: [
        {
          field: "players",
          values: [
            { value: ["Jackson Merril"], sources: ["bsc"] },
            { value: ["Jackson Merrill"], sources: ["checklist"] },
          ],
          chosen: { value: ["Jackson Merrill"], by: "nb" },
        },
      ],
    };
    expect(deriveCardAttention(row)).toEqual({
      level: "check",
      items: [
        {
          level: "check",
          kind: "nbPicked",
          field: "players",
          key: tidyReviewedKeyPicked("players", ["Jackson Merrill"]),
        },
      ],
    });
  });

  test("a new player's career is blue only while that player is on the card", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      tidyChecks: [{ kind: "newPlayerCareer", playerId: "p1" }],
    };
    expect(deriveCardAttention(row).items).toEqual([
      {
        level: "check",
        kind: "newPlayerCareer",
        playerId: "p1",
        key: tidyReviewedKeyCareer("p1"),
      },
    ]);
    expect(level({ ...row, playerIds: ["p2"] })).toBe("none");
  });

  test("a career gap is blue on a single-player card whose team is still on it", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      tidyChecks: [{ kind: "careerGap", playerId: "p1", teamId: "t1" }],
    };
    expect(deriveCardAttention(row).items).toEqual([
      {
        level: "check",
        kind: "careerGap",
        playerId: "p1",
        teamId: "t1",
        key: tidyReviewedKeyCareerGap("p1", "t1"),
      },
    ]);
  });

  test("a career gap is never raised on a multi-player card (nobody can say whose team it is)", () => {
    expect(
      level({
        ...CLEAN,
        playerIds: ["p1", "p2"],
        tidyChecks: [{ kind: "careerGap", playerId: "p1", teamId: "t1" }],
      }),
    ).toBe("none");
  });

  test("a stale career gap (team changed by hand, or another player now) says nothing", () => {
    const gap = { kind: "careerGap" as const, playerId: "p1", teamId: "t1" };
    expect(level({ ...CLEAN, teamOnCardIds: ["t2"], tidyChecks: [gap] })).toBe("none");
    expect(level({ ...CLEAN, playerIds: ["p9"], tidyChecks: [gap] })).toBe("none");
  });

  test("a cut generated title is blue, keyed on the title", () => {
    const row: AttentionCardRow = { ...CLEAN, listingTitleTruncated: true };
    expect(deriveCardAttention(row).items).toEqual([
      { level: "check", kind: "titleCut", key: tidyReviewedKeyCut(CLEAN.listingTitle!) },
    ]);
  });

  test("teamFill is a note, never a stop: no item, whatever the card", () => {
    expect(
      deriveCardAttention({
        ...CLEAN,
        tidyChecks: [{ kind: "teamFill", teamIds: ["t1"], reason: "otherCards" }],
      }).items,
    ).toEqual([]);
  });
});

describe("deriveCardAttention — pink beats blue, and the order is the tiles'", () => {
  test("any pink item makes the level fix; blue items are still listed", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      pendingPlayerNames: ["X Y"],
      listingTitleTruncated: true,
    };
    expect(level(row)).toBe("fix");
    expect(kinds(row)).toEqual(["playerName", "titleCut"]);
  });

  test("items come in tile order: sources, player, career, team, autograph, title", () => {
    const row: AttentionCardRow = {
      playerIds: ["p1"],
      platformData: {},
      attributes: ["AU"],
      listingTitle: "x".repeat(81),
      pendingPlayerNames: ["Second Player"],
      sourceDisagreements: [
        {
          field: "teams",
          values: [
            { value: ["A"], sources: ["bsc"] },
            { value: ["B"], sources: ["checklist"] },
          ],
        },
      ],
      tidyChecks: [{ kind: "newPlayerCareer", playerId: "p1" }],
    };
    expect(kinds(row)).toEqual([
      "sourcesDisagree",
      "playerName",
      "newPlayerCareer",
      "autograph",
      "titleOverLimit",
    ]);
  });
});

describe("deriveCardAttention — tidyReviewed (seen) suppresses blue, never pink", () => {
  const cut: AttentionCardRow = { ...CLEAN, listingTitleTruncated: true };

  test("a reviewed blue item drops out; the card leaves the walk", () => {
    expect(
      deriveCardAttention({
        ...cut,
        tidyReviewed: { keys: [tidyReviewedKeyCut(CLEAN.listingTitle!)] },
      }),
    ).toEqual({ level: "none", items: [] });
  });

  test("a changed value re-raises: the old key no longer matches", () => {
    const reviewedOld = { keys: [tidyReviewedKeyCut(CLEAN.listingTitle!)] };
    const retitled = deriveCardAttention({
      ...cut,
      listingTitle: "2024 Topps #1 Michael Trout",
      tidyReviewed: reviewedOld,
    });
    expect(retitled.level).toBe("check");
    expect(retitled.items.map((i) => i.kind)).toEqual(["titleCut"]);
  });

  test("seen is per item: other blue items on the card still show", () => {
    const row: AttentionCardRow = {
      ...cut,
      cardVariation: "v".repeat(70),
      tidyReviewed: { keys: [tidyReviewedKeyCut(CLEAN.listingTitle!)] },
    };
    expect(kinds(row)).toEqual(["variationOverLimit"]);
  });

  test("a pink item is never suppressed, even if a stray key matches nothing it owns", () => {
    expect(
      level({
        ...CLEAN,
        pendingPlayerNames: ["X Y"],
        tidyReviewed: { keys: ["playerName", "anything"] },
      }),
    ).toBe("fix");
  });

  test("a career-gap key for one team does not clear the gap for another", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      teamOnCardIds: ["t2"],
      tidyChecks: [{ kind: "careerGap", playerId: "p1", teamId: "t2" }],
      tidyReviewed: { keys: [tidyReviewedKeyCareerGap("p1", "t1")] },
    };
    expect(level(row)).toBe("check");
  });
});

describe("currentReviewKeys — what markReviewed stores", () => {
  test("every blue key, reviewed or not, and no pink ones", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      pendingPlayerNames: ["X Y"],
      listingTitleTruncated: true,
      cardVariation: "v".repeat(70),
      tidyReviewed: { keys: [tidyReviewedKeyCut(CLEAN.listingTitle!)] },
    };
    expect(currentReviewKeys(row)).toEqual([
      tidyReviewedKeyCut(CLEAN.listingTitle!),
      tidyReviewedKeyVariation("v".repeat(70)),
    ]);
  });

  test("a card with nothing blue stores nothing", () => {
    expect(currentReviewKeys(CLEAN)).toEqual([]);
  });

  test("stored keys, once written, make the card quiet", () => {
    const row: AttentionCardRow = {
      ...CLEAN,
      listingTitleTruncated: true,
      cardVariation: "v".repeat(70),
    };
    const stored = { keys: currentReviewKeys(row) };
    expect(deriveCardAttention({ ...row, tidyReviewed: stored }).level).toBe("none");
  });
});

describe("the key helpers", () => {
  test("every key fits the stored bound, whatever the value", () => {
    const longName = "n".repeat(500);
    const keys = [
      tidyReviewedKeyCareer("jh7a2b3c4d5e6f7g8h9i0j1k2l3m4n5"),
      tidyReviewedKeyCareerGap(
        "jh7a2b3c4d5e6f7g8h9i0j1k2l3m4n5",
        "kh7a2b3c4d5e6f7g8h9i0j1k2l3m4n5",
      ),
      tidyReviewedKeyCut(longName),
      tidyReviewedKeyVariation(longName),
      tidyReviewedKeyPicked("players", [longName, longName, longName, longName]),
    ];
    for (const k of keys) {
      expect(k.length).toBeLessThanOrEqual(TIDY_REVIEWED_KEY_MAX_LENGTH);
    }
  });

  test("the hash is stable, value-sensitive and the same on repeat calls", () => {
    expect(tidyHash("Jackson Merrill")).toBe(tidyHash("Jackson Merrill"));
    expect(tidyHash("Jackson Merrill")).not.toBe(tidyHash("Jackson Merril"));
    expect(tidyHash("")).toMatch(/^[0-9a-z]+$/);
    // Pinned: the client and the server share this function; a change here
    // would silently un-see every stored review.
    expect(tidyHash("abc")).toBe("1dtlchkfkb1");
  });

  test("the picked key is order- and value-sensitive", () => {
    expect(tidyReviewedKeyPicked("players", ["A", "B"])).not.toBe(
      tidyReviewedKeyPicked("players", ["B", "A"]),
    );
    expect(tidyReviewedKeyPicked("players", ["A"])).not.toBe(
      tidyReviewedKeyPicked("teams", ["A"]),
    );
  });

  test("the cap matches the schema doc (16 keys of at most 64 characters)", () => {
    expect(TIDY_REVIEWED_MAX_KEYS).toBe(16);
    expect(TIDY_REVIEWED_KEY_MAX_LENGTH).toBe(64);
  });
});

describe("teamFillOf", () => {
  test("returns the fill while the card's teams are still the ones the commit wrote", () => {
    expect(
      teamFillOf({
        teamOnCardIds: ["t1", "t2"],
        tidyChecks: [{ kind: "teamFill", teamIds: ["t1"], reason: "otherCards" }],
      }),
    ).toEqual({ teamIds: ["t1"], reason: "otherCards" });
  });

  test("is gone once the team was changed by hand", () => {
    expect(
      teamFillOf({
        teamOnCardIds: ["t9"],
        tidyChecks: [{ kind: "teamFill", teamIds: ["t1"], reason: "career" }],
      }),
    ).toBeUndefined();
    expect(teamFillOf({ teamOnCardIds: [], tidyChecks: [] })).toBeUndefined();
    expect(teamFillOf({})).toBeUndefined();
  });
});
