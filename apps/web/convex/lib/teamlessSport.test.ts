/**
 * NEO-426 — the one reader of "this sport has no teams" (`teamlessSportOf`,
 * `isTeamlessSport`) and the sport-default half of the No team rule
 * (`sportDefaultNoTeam`). The "does anything name a team?" half is
 * `noTeamCardVerdict`, pinned in the commit and BSC test files.
 */
import { describe, expect, test } from "vitest";
import {
  isTeamlessSport,
  sportDefaultNoTeam,
  teamlessSportOf,
  type TeamlessSport,
} from "./teamlessSport";

const STAMP: TeamlessSport = { setAt: 1_700_000_000_000, setByUserId: "admin_a" };
const OTHER: TeamlessSport = { setAt: 1_700_000_000_500, setByUserId: "admin_b" };

describe("teamlessSportOf", () => {
  test("a flagged sport row answers its stamp", () => {
    expect(teamlessSportOf({ level: "sport", teamlessSport: STAMP })).toEqual(STAMP);
  });

  test("answers a copy, never the row's own object", () => {
    const row = { level: "sport", teamlessSport: { ...STAMP } };
    const out = teamlessSportOf(row)!;
    expect(out).not.toBe(row.teamlessSport);
    out.setByUserId = "tampered";
    expect(row.teamlessSport.setByUserId).toBe("admin_a");
  });

  test.each([
    ["a year row carrying the field", { level: "year", teamlessSport: STAMP }],
    ["a setName row carrying the field", { level: "setName", teamlessSport: STAMP }],
    ["a variantType row carrying the field", { level: "variantType", teamlessSport: STAMP }],
    ["a sport with no field", { level: "sport" }],
    ["null", null],
    ["undefined", undefined],
  ])("is undefined for %s", (_label, row) => {
    expect(teamlessSportOf(row)).toBeUndefined();
    expect(isTeamlessSport(row)).toBe(false);
  });

  test("never reads the sport's name: a sport called Baseball with the field is teamless, Golf without it is not", () => {
    expect(isTeamlessSport({ level: "sport", value: "Baseball", teamlessSport: STAMP } as never)).toBe(true);
    expect(isTeamlessSport({ level: "sport", value: "Golf" } as never)).toBe(false);
  });
});

describe("sportDefaultNoTeam", () => {
  const flagged = new Map<string, TeamlessSport>([
    ["p1", STAMP],
    ["p2", OTHER],
  ]);
  const base = {
    playerIds: ["p1"] as string[],
    pendingPlayerNameCount: 0,
    homeSport: (id: string) => flagged.get(id),
  };

  test("one flagged player answers that sport's stamp", () => {
    expect(sportDefaultNoTeam(base)).toEqual(STAMP);
  });

  test("a card with no players is never defaulted", () => {
    expect(sportDefaultNoTeam({ ...base, playerIds: [] })).toBeUndefined();
  });

  test("a printed player name still waiting on review ends the default, even beside a flagged player", () => {
    expect(sportDefaultNoTeam({ ...base, pendingPlayerNameCount: 1 })).toBeUndefined();
  });

  test("a player whose home sport is not flagged ends it, wherever he sits in the list", () => {
    for (const ids of [["p1", "px"], ["px", "p1"], ["p1", "px", "p2"]]) {
      expect(sportDefaultNoTeam({ ...base, playerIds: ids }), ids.join()).toBeUndefined();
    }
  });

  test("a missing player (no home sport at all) is not teamless", () => {
    expect(sportDefaultNoTeam({ ...base, playerIds: ["ghost"], homeSport: () => undefined })).toBeUndefined();
  });

  test("several flagged players: the FIRST player's sport is the credit", () => {
    expect(sportDefaultNoTeam({ ...base, playerIds: ["p2", "p1"] })).toEqual(OTHER);
    expect(sportDefaultNoTeam({ ...base, playerIds: ["p1", "p2"] })).toEqual(STAMP);
  });

  test("asks homeSport only until the first refusal", () => {
    const asked: string[] = [];
    sportDefaultNoTeam({
      playerIds: ["p1", "px", "p2"],
      pendingPlayerNameCount: 0,
      homeSport: (id) => {
        asked.push(id);
        return flagged.get(id);
      },
    });
    expect(asked).toEqual(["p1", "px"]);
  });
});
