/**
 * NEO-645 (Q1 = A) — `planCardFill`: per player, the stored tier, else the
 * career; the union of the answers; a stored disagreement stops the search.
 */

import { describe, expect, test } from "vitest";
import { planCardFill, type StoredTeamEvidence } from "./teamFillOnCommit";

const careerOf = (table: Record<string, string>) => async (playerId: string) => table[playerId];
const answer = (playerId: string, ...teamIds: string[]): StoredTeamEvidence => ({
  playerId,
  status: "answer",
  teamIds,
});
const disagree = (playerId: string): StoredTeamEvidence => ({
  playerId,
  status: "disagree",
  teamIds: [],
});

describe("planCardFill", () => {
  test("a stored answer fills, reason otherCards, and the career is never asked", async () => {
    let asked = 0;
    const out = await planCardFill({
      players: ["p1"],
      stored: [answer("p1", "reds")],
      career: async () => (asked++, "phillies"),
      maxTeams: 4,
    });
    expect(out).toEqual({ teamIds: ["reds"], reason: "otherCards" });
    expect(asked).toBe(0);
  });

  test("no stored evidence falls through to the career, reason career", async () => {
    expect(
      await planCardFill({
        players: ["p1"],
        stored: [],
        career: careerOf({ p1: "phillies" }),
        maxTeams: 4,
      }),
    ).toEqual({ teamIds: ["phillies"], reason: "career" });
  });

  test("a stored disagreement stops the search even when the career would answer", async () => {
    expect(
      await planCardFill({
        players: ["p1"],
        stored: [disagree("p1")],
        career: careerOf({ p1: "phillies" }),
        maxTeams: 4,
      }),
    ).toBeUndefined();
  });

  test("every player must answer; one that does not leaves the card alone", async () => {
    expect(
      await planCardFill({
        players: ["p1", "p2"],
        stored: [answer("p1", "reds")],
        career: careerOf({}),
        maxTeams: 4,
      }),
    ).toBeUndefined();
  });

  test("mixed answers are one union in player order, reason otherCards", async () => {
    expect(
      await planCardFill({
        players: ["p1", "p2"],
        stored: [answer("p1", "reds")],
        career: careerOf({ p2: "phillies" }),
        maxTeams: 4,
      }),
    ).toEqual({ teamIds: ["reds", "phillies"], reason: "otherCards" });
  });

  test("the same team from two players is written once", async () => {
    expect(
      await planCardFill({
        players: ["p1", "p2"],
        stored: [answer("p1", "reds"), answer("p2", "reds")],
        career: careerOf({}),
        maxTeams: 4,
      }),
    ).toEqual({ teamIds: ["reds"], reason: "otherCards" });
  });

  test("a union past maxTeams fills nothing; so does a card with no player", async () => {
    expect(
      await planCardFill({
        players: ["p1", "p2"],
        stored: [answer("p1", "a"), answer("p2", "b")],
        career: careerOf({}),
        maxTeams: 1,
      }),
    ).toBeUndefined();
    expect(
      await planCardFill({ players: [], stored: [], career: careerOf({}), maxTeams: 4 }),
    ).toBeUndefined();
  });
});
