/**
 * NEO-254 — the era arithmetic, and the one asymmetry in it.
 *
 * Two Winnipeg Jets exist: 1972-1996 (which became the Coyotes and then Utah)
 * and 2011- (the revived name on the old Atlanta Thrashers). Under the NEO-236
 * key they were one row, so a 1985 card and a 2015 card pointed at the same
 * team. These functions are what tells them apart.
 *
 * The property worth guarding hardest is the one a future simplification would
 * quietly drop: **an undated row is never excluded**. "We never recorded this
 * team's years" and "this team was not active then" are different facts, and
 * collapsing them is how a card silently binds to the wrong era.
 */

import { describe, expect, test } from "vitest";
import {
  eraCoversYear,
  eraLabel,
  eraOverlapReason,
  erasOverlap,
  pickCardTeam,
  pickTeamForYear,
  stintOverlapsEra,
  teamOptionLabel,
  teamsActiveInYear,
} from "./team-era";

const OLD_JETS = { yearsActive: { from: 1972, to: 1996 } };
const NEW_JETS = { yearsActive: { from: 2011 } };
const UNDATED = {};

describe("eraLabel", () => {
  test.each([
    [{ from: 1972, to: 1996 }, "1972–1996"],
    [{ from: 2011 }, "2011–present"],
    [{ from: 1969, to: 1969 }, "1969–1969"],
  ])("%o reads as %s", (years, expected) => {
    expect(eraLabel(years)).toBe(expected);
  });

  test("an undated row gets no label rather than an empty range", () => {
    // "Winnipeg Jets · " with nothing after it reads as a rendering bug.
    expect(eraLabel(undefined)).toBe("");
  });
});

describe("eraCoversYear", () => {
  test.each([
    ["the first season", 1972, true],
    ["the last season", 1996, true],
    ["mid-era", 1985, true],
    ["the year before", 1971, false],
    ["the year after", 1997, false],
  ])("a closed era and %s", (_label, year, expected) => {
    expect(eraCoversYear(OLD_JETS.yearsActive, year)).toBe(expected);
  });

  test("an open era runs forever", () => {
    expect(eraCoversYear(NEW_JETS.yearsActive, 2011)).toBe(true);
    expect(eraCoversYear(NEW_JETS.yearsActive, 2_099)).toBe(true);
    expect(eraCoversYear(NEW_JETS.yearsActive, 2010)).toBe(false);
  });

  test("an UNDATED era covers every year", () => {
    // The rule the whole module rests on. Not "matches nothing" — unknown.
    expect(eraCoversYear(undefined, 1900)).toBe(true);
    expect(eraCoversYear(undefined, 2100)).toBe(true);
  });

  test("no tolerance window, unlike the player narrowing", () => {
    // A career span is assembled from stints that may be missing their first
    // or last season, so it needs slack. `yearsActive` is one recorded fact
    // about when a franchise existed, and widening it would let a 1997 card
    // match a team that had already folded.
    expect(eraCoversYear(OLD_JETS.yearsActive, 1997)).toBe(false);
    expect(eraCoversYear(OLD_JETS.yearsActive, 1998)).toBe(false);
  });
});

describe("erasOverlap", () => {
  test("the two Jets do not overlap — that is what makes them two rows", () => {
    expect(erasOverlap(OLD_JETS.yearsActive, NEW_JETS.yearsActive)).toBe(false);
  });

  test("touching at a single season counts as overlapping", () => {
    expect(erasOverlap({ from: 1972, to: 1996 }, { from: 1996, to: 2000 })).toBe(
      true,
    );
  });

  test("an open era overlaps anything that starts before it ends", () => {
    expect(erasOverlap({ from: 2011 }, { from: 1990, to: 2015 })).toBe(true);
    expect(erasOverlap({ from: 2011 }, { from: 1990, to: 2010 })).toBe(false);
  });

  test("an undated side is unknown, so NOT ruled out", () => {
    // The asymmetry with `eraCoversYear`'s filter: this decides whether two
    // ROWS are the same team, and errs toward refusing the write rather than
    // toward creating a second Winnipeg Jets by accident.
    expect(erasOverlap(undefined, OLD_JETS.yearsActive)).toBe(true);
    expect(erasOverlap(OLD_JETS.yearsActive, undefined)).toBe(true);
    expect(erasOverlap(undefined, undefined)).toBe(true);
  });
});

describe("teamsActiveInYear", () => {
  const rows = [OLD_JETS, NEW_JETS, UNDATED];

  test("a 1985 card sees the old Jets — and the undated row", () => {
    expect(teamsActiveInYear(rows, 1985)).toEqual([OLD_JETS, UNDATED]);
  });

  test("a 2015 card sees the new Jets — and the undated row", () => {
    expect(teamsActiveInYear(rows, 2015)).toEqual([NEW_JETS, UNDATED]);
  });

  test("with no year NOTHING is narrowed", () => {
    // Rule 1 of the player narrowing, restated: the year is the evidence, and
    // with no evidence the answer is a human — never the first row an index
    // returned.
    expect(teamsActiveInYear(rows, undefined)).toEqual(rows);
    expect(teamsActiveInYear(rows, Number.NaN)).toEqual(rows);
  });

  test("returns a new array — the caller's list is never mutated", () => {
    const out = teamsActiveInYear(rows, undefined);
    expect(out).not.toBe(rows);
  });
});

describe("pickTeamForYear — a card can show a team's past, never its future", () => {
  // NEO-307. Jason, 2026-09-25: "a card can show a team's past, never its
  // future."
  const BROOKLYN = { yearsActive: { from: 1911, to: 1957 } };
  // The card callers' mode. The allowance is opt-in; see the describe below.
  const CARD = { allowPastEra: true };

  test("a lone CLOSED era links a later set year — the retro card", () => {
    // A 2026 Donruss Brooklyn Dodgers card is a Brooklyn Dodgers card.
    expect(pickTeamForYear([BROOKLYN], 2026, CARD)).toEqual({
      row: BROOKLYN,
      pastEra: true,
    });
    // The first season after the end is already the past.
    expect(pickTeamForYear([BROOKLYN], 1958, CARD)).toEqual({
      row: BROOKLYN,
      pastEra: true,
    });
  });

  test("a lone era never links a set year BEFORE it began", () => {
    // The NEO-254 case, unchanged: a 1985 card is not about the 2011 Jets.
    expect(pickTeamForYear([NEW_JETS], 1985, CARD)).toBeNull();
    expect(pickTeamForYear([OLD_JETS], 1971, CARD)).toBeNull();
  });

  test("a lone era covering the year links it, and is NOT a past-era link", () => {
    expect(pickTeamForYear([BROOKLYN], 1957, CARD)).toEqual({
      row: BROOKLYN,
      pastEra: false,
    });
    expect(pickTeamForYear([NEW_JETS], 2015, CARD)).toEqual({
      row: NEW_JETS,
      pastEra: false,
    });
  });

  test("a lone UNDATED row links every year, and with no year", () => {
    for (const year of [1800, 2026, undefined]) {
      expect(pickTeamForYear([UNDATED], year, CARD)).toEqual({
        row: UNDATED,
        pastEra: false,
      });
    }
  });

  test("with no year a lone dated row still links — no evidence is not counter-evidence", () => {
    expect(pickTeamForYear([BROOKLYN], undefined, CARD)).toEqual({
      row: BROOKLYN,
      pastEra: false,
    });
  });

  test("both Jets and a year between their eras: still no answer", () => {
    // 1999 is after the first Jets ended — but there are TWO rows, and the
    // past-era allowance is for a lone row only.
    expect(pickTeamForYear([OLD_JETS, NEW_JETS], 1999, CARD)).toBeNull();
  });

  test("two CLOSED eras both before the set year: never guess between them", () => {
    const first = { yearsActive: { from: 1901, to: 1910 } };
    const second = { yearsActive: { from: 1920, to: 1930 } };
    expect(pickTeamForYear([first, second], 2026, CARD)).toBeNull();
  });

  test("several rows with exactly one covering the year: that one", () => {
    expect(pickTeamForYear([OLD_JETS, NEW_JETS], 1985, CARD)).toEqual({
      row: OLD_JETS,
      pastEra: false,
    });
    expect(pickTeamForYear([OLD_JETS, NEW_JETS], 2015, CARD)).toEqual({
      row: NEW_JETS,
      pastEra: false,
    });
  });

  test("no rows is no answer", () => {
    expect(pickTeamForYear([], 2026, CARD)).toBeNull();
  });
});

describe("pickTeamForYear — the past-era allowance is CARD-ONLY and opt-in", () => {
  // A career stint is a season a player actually played, and nobody plays for
  // a team after it folds. So a stint caller leaves `allowPastEra` off, and a
  // new caller that forgets to choose gets the strict rule.
  const BROOKLYN = { yearsActive: { from: 1911, to: 1957 } };

  test("by default a lone closed era does NOT answer for a later year", () => {
    expect(pickTeamForYear([BROOKLYN], 2026)).toBeNull();
    expect(pickTeamForYear([BROOKLYN], 2026, {})).toBeNull();
    expect(pickTeamForYear([BROOKLYN], 2026, { allowPastEra: false })).toBeNull();
  });

  test("a 2015 stint with only the 1972–1996 Jets held is a question, not a link", () => {
    expect(pickTeamForYear([OLD_JETS], 2015)).toBeNull();
    // …while a 2015 CARD of the same lone row is a retro card and links.
    expect(pickTeamForYear([OLD_JETS], 2015, { allowPastEra: true })).toEqual({
      row: OLD_JETS,
      pastEra: true,
    });
  });

  test("strict mode changes nothing else: covered, undated and no-year still link", () => {
    expect(pickTeamForYear([BROOKLYN], 1950)).toEqual({ row: BROOKLYN, pastEra: false });
    expect(pickTeamForYear([UNDATED], 2026)).toEqual({ row: UNDATED, pastEra: false });
    expect(pickTeamForYear([BROOKLYN], undefined)).toEqual({ row: BROOKLYN, pastEra: false });
    expect(pickTeamForYear([OLD_JETS, NEW_JETS], 1985)).toEqual({ row: OLD_JETS, pastEra: false });
  });
});

describe("teamOptionLabel", () => {
  test("names the era when there is one", () => {
    expect(teamOptionLabel("Winnipeg Jets", OLD_JETS.yearsActive)).toBe(
      "Winnipeg Jets · 1972–1996",
    );
  });

  test("leaves an undated row as its plain name", () => {
    expect(teamOptionLabel("Winnipeg Jets", undefined)).toBe("Winnipeg Jets");
  });
});

// ---------------------------------------------------------------------------
// NEO-602 — who decides between several rows for a CARD
// ---------------------------------------------------------------------------

describe("stintOverlapsEra", () => {
  const era = { from: 1968, to: 2024 };

  test("a dated stint inside the era overlaps", () => {
    expect(stintOverlapsEra({ teamId: "t", fromYear: 1979, toYear: 1984 }, era)).toBe(true);
  });

  test("a dated stint after the era ended does not", () => {
    expect(stintOverlapsEra({ teamId: "t", fromYear: 2025, toYear: 2026 }, era)).toBe(false);
  });

  test("a dated stint before the era began does not", () => {
    expect(stintOverlapsEra({ teamId: "t", fromYear: 1950, toYear: 1960 }, era)).toBe(false);
  });

  test("an undated stint overlaps every era", () => {
    expect(stintOverlapsEra({ teamId: "t" }, era)).toBe(true);
  });

  test("a stint missing only its end runs open to the right", () => {
    expect(stintOverlapsEra({ teamId: "t", fromYear: 2020 }, era)).toBe(true);
    expect(stintOverlapsEra({ teamId: "t", fromYear: 2030 }, era)).toBe(false);
  });

  test("a stint missing only its start runs open to the left", () => {
    expect(stintOverlapsEra({ teamId: "t", toYear: 1970 }, era)).toBe(true);
    expect(stintOverlapsEra({ teamId: "t", toYear: 1960 }, era)).toBe(false);
  });

  test("an undated era overlaps every stint", () => {
    expect(stintOverlapsEra({ teamId: "t", fromYear: 1500, toYear: 1501 }, undefined)).toBe(true);
  });
});

describe("pickCardTeam", () => {
  // "Oakland Athletics": the PRIMARY name of the 1968-2024 Oakland row and an
  // ALIAS of the 2025- Athletics row.
  const OAK = { _id: "oak", yearsActive: { from: 1968, to: 2024 } };
  const ATH = { _id: "ath", yearsActive: { from: 2025 } };
  const NO_ALIAS = new Set<string>();
  const ATH_BY_ALIAS = new Set(["ath"]);
  const oak = (fromYear: number, toYear: number) => ({ teamId: "oak", fromYear, toYear });
  const ath = (fromYear: number, toYear?: number) => ({
    teamId: "ath",
    fromYear,
    ...(toYear !== undefined ? { toYear } : {}),
  });

  test("Rickey Henderson (stints 1979-84 and 1989-93 on Oakland) on a 2025 card is Oakland, by his players, against the year", () => {
    const pick = pickCardTeam([OAK, ATH], {
      setYear: 2025,
      aliasOnlyIds: ATH_BY_ALIAS,
      cards: [[[oak(1979, 1984), oak(1989, 1993)]]],
    });
    expect(pick).toEqual({ row: OAK, via: "players", agreesWithYear: false });
  });

  test("the same players on a card whose year covers Oakland agree with the year", () => {
    const pick = pickCardTeam([OAK, ATH], {
      setYear: 1990,
      aliasOnlyIds: ATH_BY_ALIAS,
      cards: [[[oak(1979, 1984)]]],
    });
    expect(pick).toEqual({ row: OAK, via: "players", agreesWithYear: true });
  });

  test("a player on the 2025- row picks it on a 2025 card", () => {
    const pick = pickCardTeam([OAK, ATH], {
      setYear: 2025,
      aliasOnlyIds: ATH_BY_ALIAS,
      cards: [[[ath(2025, 2026)]]],
    });
    expect(pick).toEqual({ row: ATH, via: "players", agreesWithYear: true });
  });

  test("a player with stints on both rows is a tie: null, and the year does not break it", () => {
    expect(
      pickCardTeam([OAK, ATH], {
        setYear: 2025,
        aliasOnlyIds: NO_ALIAS,
        cards: [[[oak(2020, 2024), ath(2025, 2026)]]],
      }),
    ).toBeNull();
  });

  test("two players on one card, one per row, is a tie: null", () => {
    expect(
      pickCardTeam([OAK, ATH], {
        setYear: 2025,
        aliasOnlyIds: NO_ALIAS,
        cards: [[[oak(1979, 1984)], [ath(2025, 2026)]]],
      }),
    ).toBeNull();
  });

  test("cards whose players disagree: null", () => {
    expect(
      pickCardTeam([OAK, ATH], {
        setYear: 2025,
        aliasOnlyIds: NO_ALIAS,
        cards: [[[oak(1979, 1984)]], [[ath(2025, 2026)]]],
      }),
    ).toBeNull();
  });

  test("cards whose players agree: that row", () => {
    const pick = pickCardTeam([OAK, ATH], {
      setYear: 2025,
      aliasOnlyIds: NO_ALIAS,
      cards: [[[oak(1979, 1984)]], [[oak(1989, 1993)]]],
    });
    expect(pick?.row).toBe(OAK);
    expect(pick?.via).toBe("players");
  });

  test("a card the players say nothing about, beside one they do: null (never the first candidate)", () => {
    expect(
      pickCardTeam([OAK, ATH], {
        setYear: 1990,
        aliasOnlyIds: NO_ALIAS,
        cards: [[[oak(1979, 1984)]], [[]]],
      }),
    ).toBeNull();
  });

  test("a stint dated outside the row's era does not support it", () => {
    // Oakland's only stint ends in 1960 - before the 1968 franchise. With no
    // supporting stint anywhere, the year decides (2025 -> Athletics, own name).
    const pick = pickCardTeam([OAK, ATH], {
      setYear: 2025,
      aliasOnlyIds: NO_ALIAS,
      cards: [[[oak(1955, 1960)]]],
    });
    expect(pick).toEqual({ row: ATH, via: "year", agreesWithYear: true });
  });

  test("a stint on a team that is not a candidate is ignored", () => {
    const pick = pickCardTeam([OAK, ATH], {
      setYear: 2025,
      aliasOnlyIds: NO_ALIAS,
      cards: [[[{ teamId: "elsewhere", fromYear: 2025, toYear: 2026 }]]],
    });
    expect(pick?.via).toBe("year");
    expect(pick?.row).toBe(ATH);
  });

  test("a row that begins after the set year is never picked, even with a stint on it", () => {
    const early = { _id: "early", yearsActive: { from: 1950 } };
    const future = { _id: "future", yearsActive: { from: 2030 } };
    // The only stint is on the future row: it is not evidence, so the year
    // decides and lands on the early row.
    const onFutureOnly = pickCardTeam([early, future], {
      setYear: 2025,
      aliasOnlyIds: NO_ALIAS,
      cards: [[[{ teamId: "future", fromYear: 2030, toYear: 2031 }]]],
    });
    expect(onFutureOnly).toEqual({ row: early, via: "year", agreesWithYear: true });
    // A player with stints on both is NOT a tie: the future one is excluded.
    const onBoth = pickCardTeam([early, future], {
      setYear: 2025,
      aliasOnlyIds: NO_ALIAS,
      cards: [
        [[
          { teamId: "early", fromYear: 1990, toYear: 1995 },
          { teamId: "future", fromYear: 2030, toYear: 2031 },
        ]],
      ],
    });
    expect(onBoth?.row).toBe(early);
    expect(onBoth?.via).toBe("players");
  });

  test("when every row begins after the set year: null", () => {
    expect(
      pickCardTeam([{ _id: "a", yearsActive: { from: 2030 } }, { _id: "b", yearsActive: { from: 2040 } }], {
        setYear: 2025,
        aliasOnlyIds: NO_ALIAS,
      }),
    ).toBeNull();
  });

  test("no player evidence: the set year picks (2025 -> Athletics, 2000 -> Oakland), both by their own name", () => {
    expect(pickCardTeam([OAK, ATH], { setYear: 2025, aliasOnlyIds: NO_ALIAS })).toEqual({
      row: ATH,
      via: "year",
      agreesWithYear: true,
    });
    expect(pickCardTeam([OAK, ATH], { setYear: 2000, aliasOnlyIds: NO_ALIAS })).toEqual({
      row: OAK,
      via: "year",
      agreesWithYear: true,
    });
  });

  test("empty cards array behaves as no evidence", () => {
    expect(pickCardTeam([OAK, ATH], { setYear: 2000, aliasOnlyIds: NO_ALIAS, cards: [] })?.via).toBe(
      "year",
    );
  });

  test("no stints at all, year pick reached only by alias while the other row owns the name: null (option A)", () => {
    expect(pickCardTeam([OAK, ATH], { setYear: 2025, aliasOnlyIds: ATH_BY_ALIAS })).toBeNull();
    expect(
      pickCardTeam([OAK, ATH], {
        setYear: 2025,
        aliasOnlyIds: ATH_BY_ALIAS,
        cards: [[[]]],
      }),
    ).toBeNull();
  });

  test("the alias-only guard does not fire when the year picks the own-name row", () => {
    // 2000: the year lands on Oakland, which owns the name; Athletics is the
    // alias-only candidate but is not the pick.
    expect(pickCardTeam([OAK, ATH], { setYear: 2000, aliasOnlyIds: ATH_BY_ALIAS })?.row).toBe(OAK);
  });

  test("the alias-only guard needs ANOTHER eligible row with its own name", () => {
    // Both rows reached by alias only: nothing owns the name, the year picks.
    expect(
      pickCardTeam([OAK, ATH], { setYear: 2025, aliasOnlyIds: new Set(["oak", "ath"]) })?.row,
    ).toBe(ATH);
    // The own-name row begins after the set year, so it is not eligible and
    // cannot hold the alias pick back.
    const futureOwner = { _id: "owner", yearsActive: { from: 2040 } };
    expect(
      pickCardTeam([futureOwner, ATH], { setYear: 2025, aliasOnlyIds: ATH_BY_ALIAS })?.row,
    ).toBe(ATH);
  });

  test("no set year: the players still decide; without them nothing is narrowed and it is a question", () => {
    expect(
      pickCardTeam([OAK, ATH], {
        setYear: undefined,
        aliasOnlyIds: NO_ALIAS,
        cards: [[[oak(1979, 1984)]]],
      })?.row,
    ).toBe(OAK);
    expect(pickCardTeam([OAK, ATH], { setYear: undefined, aliasOnlyIds: NO_ALIAS })).toBeNull();
  });

  test("a lone row keeps the old rule: its era, or its past, never its future", () => {
    expect(pickCardTeam([OAK], { setYear: 2000, aliasOnlyIds: NO_ALIAS })).toEqual({
      row: OAK,
      via: "year",
      agreesWithYear: true,
    });
    // A card shows a team's past.
    expect(pickCardTeam([OAK], { setYear: 2030, aliasOnlyIds: NO_ALIAS })?.row).toBe(OAK);
    // ...never its future.
    expect(pickCardTeam([OAK], { setYear: 1950, aliasOnlyIds: NO_ALIAS })).toBeNull();
  });

  test("a lone row asks no player: evidence pointing elsewhere does not change it", () => {
    expect(
      pickCardTeam([OAK], {
        setYear: 2000,
        aliasOnlyIds: NO_ALIAS,
        cards: [[[ath(2025, 2026)]]],
      })?.via,
    ).toBe("year");
  });

  test("no rows: null", () => {
    expect(pickCardTeam([], { setYear: 2025, aliasOnlyIds: NO_ALIAS })).toBeNull();
  });

  test("undated rows are not excluded: an undated row keeps the name a question", () => {
    const undated = { _id: "undated" };
    expect(pickCardTeam([undated, ATH], { setYear: 2025, aliasOnlyIds: NO_ALIAS })).toBeNull();
  });
});

describe("eraOverlapReason", () => {
  const dated = { from: 1968, to: 2024 };

  test("two dated teams: the years overlap", () => {
    expect(eraOverlapReason(dated, { from: 2000 })).toBe("the two teams' years overlap");
  });

  test("neither team dated", () => {
    expect(eraOverlapReason(undefined, undefined)).toBe(
      "neither team has years on file, so they may overlap",
    );
  });

  test("this team undated", () => {
    expect(eraOverlapReason(undefined, dated)).toBe(
      "this team has no years on file, so they may overlap",
    );
  });

  test("that team undated", () => {
    expect(eraOverlapReason(dated, undefined)).toBe(
      "that team has no years on file, so they may overlap",
    );
  });
});
