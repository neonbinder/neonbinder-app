/**
 * NEO-591 — the pure rules of settling a "Prospect (X)" team: which league
 * levels qualify, which rows are "at" X, and the one-row era pick.
 */
import { describe, expect, test } from "vitest";
import {
  PROSPECT_TEAM_LEVELS,
  isProspectTeamLevel,
  pickProspectTeam,
  teamLocationIs,
} from "./prospectTeam";

describe("isProspectTeamLevel", () => {
  test("only minor and college leagues qualify", () => {
    expect([...PROSPECT_TEAM_LEVELS].sort()).toEqual(["college", "minor"]);
    expect(isProspectTeamLevel("minor")).toBe(true);
    expect(isProspectTeamLevel("college")).toBe(true);
  });

  test.each(["major", "international", "independent", "other", "", "Minor", "MINOR"])(
    "%j does not qualify",
    (level) => {
      expect(isProspectTeamLevel(level)).toBe(false);
    },
  );

  test("a team with no league does not qualify", () => {
    expect(isProspectTeamLevel(undefined)).toBe(false);
    expect(isProspectTeamLevel(null)).toBe(false);
  });
});

describe("teamLocationIs", () => {
  test("matches the place by the folded, token-sorted key", () => {
    expect(teamLocationIs({ location: "Oklahoma" }, "Oklahoma")).toBe(true);
    expect(teamLocationIs({ location: "oklahoma " }, " OKLAHOMA")).toBe(true);
    expect(teamLocationIs({ location: "Dallas Baptist" }, "Baptist Dallas")).toBe(true);
  });

  test("a different place does not match, nor a place that only contains X", () => {
    expect(teamLocationIs({ location: "Oklahoma State" }, "Oklahoma")).toBe(false);
    expect(teamLocationIs({ location: "Arizona" }, "Oklahoma")).toBe(false);
  });

  test("a row with no location never matches", () => {
    expect(teamLocationIs({}, "Oklahoma")).toBe(false);
    expect(teamLocationIs({ location: null }, "Oklahoma")).toBe(false);
    expect(teamLocationIs({ location: "   " }, "")).toBe(false);
  });
});

describe("pickProspectTeam", () => {
  const row = (id: string, yearsActive?: { from: number; to?: number }) => ({ id, ...(yearsActive ? { yearsActive } : {}) });

  test("one candidate is the pick", () => {
    expect(pickProspectTeam([row("a")], 2026)?.id).toBe("a");
  });

  test("no candidate is no pick", () => {
    expect(pickProspectTeam([], 2026)).toBeNull();
  });

  test("two undated candidates are no pick (never the first)", () => {
    expect(pickProspectTeam([row("a"), row("b")], 2026)).toBeNull();
  });

  test("two eras are told apart by the set year", () => {
    const old = row("old", { from: 1960, to: 1990 });
    const now = row("now", { from: 2000 });
    expect(pickProspectTeam([old, now], 1975)?.id).toBe("old");
    expect(pickProspectTeam([old, now], 2026)?.id).toBe("now");
  });

  test("a lone team whose era ended before the card's year is still the pick (a past, allowed)", () => {
    expect(pickProspectTeam([row("gone", { from: 1960, to: 1990 })], 2026)?.id).toBe("gone");
  });

  test("a lone team that did not exist yet is not the pick (a future, never)", () => {
    expect(pickProspectTeam([row("later", { from: 2030 })], 2026)).toBeNull();
  });

  test("two eras neither of which covers the year are no pick", () => {
    const a = row("a", { from: 1960, to: 1970 });
    const b = row("b", { from: 1971, to: 1980 });
    expect(pickProspectTeam([a, b], 2026)).toBeNull();
  });

  test("with no set year two dated eras are no pick", () => {
    expect(pickProspectTeam([row("a", { from: 1960, to: 1970 }), row("b", { from: 1971 })], undefined)).toBeNull();
  });
});
