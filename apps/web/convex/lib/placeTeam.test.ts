/**
 * The pure rules of settling a team printed as a place: which rows are "at"
 * it, and the one-row era pick.
 */
import { describe, expect, test } from "vitest";
import { pickPlaceTeam, placeTextOrNull, teamLocationIs } from "./placeTeam";
import { MAX_PLAYER_NAME_LENGTH } from "../../lib/players/name-limits";

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

describe("pickPlaceTeam", () => {
  const row = (id: string, yearsActive?: { from: number; to?: number }) => ({ id, ...(yearsActive ? { yearsActive } : {}) });

  test("one candidate is the pick", () => {
    expect(pickPlaceTeam([row("a")], 2026)?.id).toBe("a");
  });

  test("no candidate is no pick", () => {
    expect(pickPlaceTeam([], 2026)).toBeNull();
  });

  test("two undated candidates are no pick (never the first)", () => {
    expect(pickPlaceTeam([row("a"), row("b")], 2026)).toBeNull();
  });

  test("several eras at one place are NEVER settled by the set year (the Pilots and the Mariners in a 2001 set)", () => {
    const old = row("old", { from: 1960, to: 1990 });
    const now = row("now", { from: 2000 });
    // Before NEO-591 (2026-11-20) the year picked: "now" for 2026, "old" for 1975.
    expect(pickPlaceTeam([old, now], 1975)).toBeNull();
    expect(pickPlaceTeam([old, now], 2026)).toBeNull();
    const pilots = row("pilots", { from: 1969, to: 1969 });
    const mariners = row("mariners", { from: 1977 });
    expect(pickPlaceTeam([pilots, mariners], 2001)).toBeNull();
  });

  test("a lone team whose era ended before the card's year is still the pick (a past, allowed)", () => {
    expect(pickPlaceTeam([row("gone", { from: 1960, to: 1990 })], 2026)?.id).toBe("gone");
  });

  test("a lone team that did not exist yet is not the pick (a future, never)", () => {
    expect(pickPlaceTeam([row("later", { from: 2030 })], 2026)).toBeNull();
  });

  test("with no set year a lone dated team is the pick; two are not", () => {
    expect(pickPlaceTeam([row("a", { from: 1960, to: 1970 })], undefined)?.id).toBe("a");
    expect(pickPlaceTeam([row("a", { from: 1960, to: 1970 }), row("b", { from: 1971 })], undefined)).toBeNull();
  });
});

describe("placeTextOrNull", () => {
  test("trims a plain place", () => {
    expect(placeTextOrNull("  Seattle ")).toBe("Seattle");
  });

  test("a blank, a comma text and an over-long text are not places", () => {
    expect(placeTextOrNull("   ")).toBeNull();
    expect(placeTextOrNull("Seattle, WA")).toBeNull();
    expect(placeTextOrNull("x".repeat(MAX_PLAYER_NAME_LENGTH + 1))).toBeNull();
    expect(placeTextOrNull("x".repeat(MAX_PLAYER_NAME_LENGTH))).not.toBeNull();
  });
});
