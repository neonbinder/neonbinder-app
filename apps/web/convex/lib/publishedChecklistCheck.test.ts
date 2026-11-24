/**
 * NEO-496 security audit — `checkPublishedChecklist` refuses a row that sends
 * more than `MAX_PUBLISHED_ROW_NAMES` player or team strings, counted as sent
 * (blanks included), before any is trimmed or dropped. A real row is far
 * under it; a row padded with blank strings is refused before they are read.
 */

import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "../features/cardAttention";
import { MAX_PUBLISHED_ROW_NAMES, checkPublishedChecklist } from "./publishedChecklistCheck";

const row = (players: string[], teams: string[] = []) => ({ number: "1", players, teams });

describe("checkPublishedChecklist — NEO-643 names are cleansed on the server too", () => {
  test("a stray backslash, soft hyphen and zero-width space are gone from players, teams and the variation note", () => {
    const checked = checkPublishedChecklist({
      rows: [
        {
          number: "1",
          players: ["Wilmer R\\ios", "Mike\u200b  Trout"],
          teams: ["Le\\on Mex\u00adico"],
          variationName: "Photo Var\\iation",
        },
      ],
    })!;
    expect(checked.rows[0]).toEqual({
      number: "1",
      players: ["Wilmer Rios", "Mike Trout"],
      teams: ["Leon Mexico"],
      variationName: "Photo Variation",
    });
  });
});

describe("checkPublishedChecklist — names sent per row", () => {
  test("the raw cap is generous next to a card's own caps", () => {
    expect(MAX_PUBLISHED_ROW_NAMES).toBe(40);
    expect(MAX_PUBLISHED_ROW_NAMES).toBeGreaterThanOrEqual(2 * MAX_CARD_PLAYERS);
    expect(MAX_PUBLISHED_ROW_NAMES).toBeGreaterThanOrEqual(2 * MAX_CARD_TEAMS);
  });

  test("takes a row of exactly the cap when the blanks drop it within the card's caps", () => {
    const players = ["Mike Trout", ...Array<string>(MAX_PUBLISHED_ROW_NAMES - 1).fill(" ")];
    const teams = ["Los Angeles Angels", ...Array<string>(MAX_PUBLISHED_ROW_NAMES - 1).fill("")];
    const checked = checkPublishedChecklist({ rows: [row(players, teams)] })!;
    expect(checked.rows[0]).toEqual({ number: "1", players: ["Mike Trout"], teams: ["Los Angeles Angels"] });
  });

  test.each([
    ["player", row(["Mike Trout", ...Array<string>(MAX_PUBLISHED_ROW_NAMES).fill("")])],
    ["team", row(["Mike Trout"], Array<string>(MAX_PUBLISHED_ROW_NAMES + 1).fill(" "))],
  ])("refuses a row sending more %s strings than the cap, even all blank, naming the row", (unit, bad) => {
    const call = () => checkPublishedChecklist({ rows: [row(["Shohei Ohtani"]), bad] });
    expect(call).toThrow(ConvexError);
    expect(call).toThrow(
      `Row 2 of the official checklist sends ${MAX_PUBLISHED_ROW_NAMES + 1} ${unit} names; the limit is ${MAX_PUBLISHED_ROW_NAMES}.`,
    );
  });

  test("refuses a padded row quickly, before trimming any of it", () => {
    const huge = row(Array<string>(500_000).fill(" ".repeat(10)));
    const started = performance.now();
    expect(() => checkPublishedChecklist({ rows: [huge] }, { label: "section “Base”" })).toThrow(
      /Row 1 of section “Base” sends 500000 player names/,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("checkPublishedChecklist — NEO-645 the subject a row with no player printed is the card's name", () => {
  test("is kept, cleansed, on a row with no player; and never on a row with one", () => {
    const checked = checkPublishedChecklist({
      rows: [
        { number: "1", players: [], teams: [], cardName: "Team\u200b  Ca\\rd" },
        { number: "2", players: ["Mike Trout"], teams: [], cardName: "Team Card" },
        { number: "3", players: [], teams: [] },
        { number: "4", players: [], teams: [], cardName: "   " },
      ],
    })!;
    expect(checked.rows.map((r) => r.cardName)).toEqual(["Team Card", undefined, undefined, undefined]);
  });

  test("a name over a player name's bound refuses the checklist, named by row position", () => {
    expect(() =>
      checkPublishedChecklist({
        rows: [{ number: "1", players: [], teams: [], cardName: "x".repeat(121) }],
      }),
    ).toThrow(/card name over 120/);
  });
});
