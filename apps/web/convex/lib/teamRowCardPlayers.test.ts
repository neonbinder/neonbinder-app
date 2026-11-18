/**
 * NEO-490 (2b) — a team name with several eras, settled by the card's own
 * players.
 *
 * `narrowTeamRowsByCardPlayers` is the pure-ish rule (reads player documents
 * only); `teams.resolveTeamByCardPlayers` is the internal query the review
 * gate calls for names `resolveTeamForSetYear` could not settle. Fixtures are
 * raw `t.run` inserts: a sport, one team name with two eras (and a third,
 * modern one for the future-era cases), and players whose `teamYears` point at
 * the eras.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { normalizeTeamName } from "../teams";
import {
  CARD_PLAYER_TEAM_MAX_CARDS,
  CARD_PLAYER_TEAM_MAX_PLAYERS_PER_CARD,
  narrowTeamRowsByCardPlayers,
  resolveCardTeamName,
} from "./teamRow";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("../**/*.*s");

type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const era = (from: number, to?: number) =>
      ctx.db.insert("teams", {
        location: "St. Louis",
        name: "Browns",
        nameNormalized: normalizeTeamName("St. Louis Browns"),
        sportId,
        yearsActive: { from, ...(to !== undefined ? { to } : {}) },
        lastUpdated: Date.now(),
      });
    const early = await era(1902, 1953);
    const late = await era(1961, 1965);
    const modern = await era(2010);
    return { sportId, early, late, modern };
  });
}

async function insertPlayer(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  teams: Id<"teams">[],
): Promise<Id<"players">> {
  // NEO-602: a stint only supports a row whose era it overlaps, so each stint
  // is dated INSIDE its team's era (its first two seasons). A team with no era
  // gets an undated stint.
  return t.run(async (ctx) => {
    const teamYears = [];
    for (const teamId of teams) {
      const from = (await ctx.db.get(teamId))?.yearsActive?.from;
      teamYears.push(
        from === undefined ? { teamId } : { teamId, fromYear: from, toYear: from + 1 },
      );
    }
    return ctx.db.insert("players", {
      name,
      nameNormalized: name.toLowerCase().split(" ").reverse().join(" "),
      sportId,
      ...(teamYears.length > 0 ? { teamYears } : {}),
      lastUpdated: Date.now(),
    });
  });
}

function narrow(
  t: T,
  teamIds: Id<"teams">[],
  cardPlayerIds: Id<"players">[][],
  setYear: number | undefined,
): Promise<Id<"teams"> | null> {
  return t.run(async (ctx) => {
    const rows = (await Promise.all(teamIds.map((id) => ctx.db.get(id)))).filter(
      (row): row is Doc<"teams"> => row !== null,
    );
    return narrowTeamRowsByCardPlayers(ctx, rows, cardPlayerIds, setYear);
  });
}

describe("NEO-490: narrowTeamRowsByCardPlayers", () => {
  test("one card, one player, one era: that era", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(await narrow(t, [w.early, w.late], [[paige]], undefined)).toBe(w.early);
  });

  test("two cards whose players point at the same era agree", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const a = await insertPlayer(t, w.sportId, "Satchel Paige", [w.late]);
    const b = await insertPlayer(t, w.sportId, "Other Player", [w.late]);

    expect(await narrow(t, [w.early, w.late], [[a], [b]], undefined)).toBe(w.late);
  });

  test("two cards pointing at different eras: no decision", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const a = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    const b = await insertPlayer(t, w.sportId, "Other Player", [w.late]);

    expect(await narrow(t, [w.early, w.late], [[a], [b]], undefined)).toBeNull();
  });

  test("a card whose player played for two of the eras: no decision", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const both = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early, w.late]);

    expect(await narrow(t, [w.early, w.late], [[both]], undefined)).toBeNull();
  });

  test("a card with no resolved player: no decision, even when another card has one", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(await narrow(t, [w.early, w.late], [[]], undefined)).toBeNull();
    expect(await narrow(t, [w.early, w.late], [[paige], []], undefined)).toBeNull();
  });

  test("a player with no career on file: no decision", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const blank = await insertPlayer(t, w.sportId, "Satchel Paige", []);

    expect(await narrow(t, [w.early, w.late], [[blank]], undefined)).toBeNull();
  });

  test("a player deleted since: no decision", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const gone = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    await t.run((ctx) => ctx.db.delete(gone));

    expect(await narrow(t, [w.early, w.late], [[gone]], undefined)).toBeNull();
  });

  test("a stint on a team that is not a candidate does not count", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const elsewhere = await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Elsewhere",
        nameNormalized: "elsewhere",
        sportId: w.sportId,
        lastUpdated: Date.now(),
      }),
    );
    const p = await insertPlayer(t, w.sportId, "Satchel Paige", [elsewhere, w.late]);

    expect(await narrow(t, [w.early, w.late], [[p]], undefined)).toBe(w.late);
  });

  test("a row whose era begins after the set year is never the answer", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const both = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early, w.modern]);
    const onlyModern = await insertPlayer(t, w.sportId, "Other Player", [w.modern]);

    // The 2010 era is in the future of a 1950 card, so the stint on it is not
    // evidence and the player points at one era...
    expect(await narrow(t, [w.early, w.modern], [[both]], 1950)).toBe(w.early);
    // ...with no year, nothing is excluded and the same player is ambiguous.
    expect(await narrow(t, [w.early, w.modern], [[both]], undefined)).toBeNull();
    // A player whose only stint is on the future era gives nothing.
    expect(await narrow(t, [w.early, w.modern], [[onlyModern]], 1950)).toBeNull();
  });

  test("a stint dated outside the row's era does not support it (NEO-602)", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const outside = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Satchel Paige",
        nameNormalized: "paige satchel",
        sportId: w.sportId,
        teamYears: [{ teamId: w.early, fromYear: 1970, toYear: 1975 }],
        lastUpdated: Date.now(),
      }),
    );

    expect(await narrow(t, [w.early, w.late], [[outside]], undefined)).toBeNull();
  });

  test("an undated stint supports the row it names (NEO-602)", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const undated = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Satchel Paige",
        nameNormalized: "paige satchel",
        sportId: w.sportId,
        teamYears: [{ teamId: w.late }],
        lastUpdated: Date.now(),
      }),
    );

    expect(await narrow(t, [w.early, w.late], [[undated]], undefined)).toBe(w.late);
  });

  test("fewer than two candidates is resolveTeamForSetYear's to answer", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(await narrow(t, [w.early], [[paige]], undefined)).toBeNull();
    expect(await narrow(t, [], [[paige]], undefined)).toBeNull();
  });

  test("no cards at all: no decision", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    expect(await narrow(t, [w.early, w.late], [], undefined)).toBeNull();
  });

  test("the bounds are 16 cards and 4 players a card", () => {
    expect(CARD_PLAYER_TEAM_MAX_CARDS).toBe(16);
    expect(CARD_PLAYER_TEAM_MAX_PLAYERS_PER_CARD).toBe(4);
  });

  test("exactly the card bound still decides; one card more does not", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    const atBound = Array.from({ length: CARD_PLAYER_TEAM_MAX_CARDS }, () => [paige]);
    const pastBound = Array.from({ length: CARD_PLAYER_TEAM_MAX_CARDS + 1 }, () => [paige]);
    expect(await narrow(t, [w.early, w.late], atBound, undefined)).toBe(w.early);
    expect(await narrow(t, [w.early, w.late], pastBound, undefined)).toBeNull();
  });

  test("exactly the players-per-card bound still decides; one player more does not", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    const blanks: Id<"players">[] = [];
    for (let i = 0; i < CARD_PLAYER_TEAM_MAX_PLAYERS_PER_CARD; i++) {
      blanks.push(await insertPlayer(t, w.sportId, `Blank${i} Player`, []));
    }
    const atBound = [paige, ...blanks.slice(1)];
    expect(atBound).toHaveLength(CARD_PLAYER_TEAM_MAX_PLAYERS_PER_CARD);
    const pastBound = [paige, ...blanks];

    expect(await narrow(t, [w.early, w.late], [atBound], undefined)).toBe(w.early);
    expect(await narrow(t, [w.early, w.late], [pastBound], undefined)).toBeNull();
  });
});

describe("NEO-490: teams.resolveTeamByCardPlayers", () => {
  const resolve = (
    t: T,
    args: {
      sportId: Id<"selectorOptions">;
      name?: string;
      setYear?: number;
      cardPlayerIds: Id<"players">[][];
    },
  ) =>
    t.query(internal.teams.resolveTeamByCardPlayers, {
      sportId: args.sportId,
      name: args.name ?? "St. Louis Browns",
      ...(args.setYear !== undefined ? { setYear: args.setYear } : {}),
      cardPlayerIds: args.cardPlayerIds,
    });

  test("returns the era the card's player played for when the name has several and no year", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(await resolve(t, { sportId: w.sportId, cardPlayerIds: [[paige]] })).toBe(w.early);
  });

  test("returns the row the players chose even when the set year lands on the same row", async () => {
    // 1930 sits only inside the 1902-1953 era, so the year alone would pick it
    // too. The player points at that SAME era: the players' row comes back (the
    // caller decides, via resolveCardTeamName's agreesWithYear, to link it
    // silently).
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(
      await resolve(t, { sportId: w.sportId, setYear: 1930, cardPlayerIds: [[paige]] }),
    ).toBe(w.early);
  });

  test("returns null when the set year settles the name and no player has a stint on a row", async () => {
    // The year's answer is not a career-team link the players made, so the
    // internal query stays silent rather than label it as one.
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const blank = await insertPlayer(t, w.sportId, "Satchel Paige", []);

    expect(
      await resolve(t, { sportId: w.sportId, setYear: 1930, cardPlayerIds: [[blank]] }),
    ).toBeNull();
  });

  test("returns the players' row when it differs from the year's (the visible-row case)", async () => {
    // A 1990 card: the year covers neither era; only the late (1961-65) player
    // evidence names a row. Players decide, so the query returns it.
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const late = await insertPlayer(t, w.sportId, "Other Player", [w.late]);

    expect(
      await resolve(t, { sportId: w.sportId, setYear: 1990, cardPlayerIds: [[late]] }),
    ).toBe(w.late);
  });

  test("a stint dated outside every row's era is no evidence", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const outside = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Satchel Paige",
        nameNormalized: "paige satchel",
        sportId: w.sportId,
        teamYears: [{ teamId: w.early, fromYear: 1970, toYear: 1975 }],
        lastUpdated: Date.now(),
      }),
    );

    expect(await resolve(t, { sportId: w.sportId, cardPlayerIds: [[outside]] })).toBeNull();
  });

  test("returns null when the players disagree", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const a = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    const b = await insertPlayer(t, w.sportId, "Other Player", [w.late]);

    expect(await resolve(t, { sportId: w.sportId, cardPlayerIds: [[a], [b]] })).toBeNull();
  });

  test("returns null for a name the sport does not hold", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(
      await resolve(t, { sportId: w.sportId, name: "Nowhere Nobodies", cardPlayerIds: [[paige]] }),
    ).toBeNull();
  });

  test("never inserts a team", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    const before = await t.run((ctx) => ctx.db.query("teams").collect());

    await resolve(t, { sportId: w.sportId, cardPlayerIds: [[paige]] });

    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(before.length);
  });
});

describe("NEO-602 (S1): resolveCardTeamName's lazy player loader", () => {
  test("is called once for a name that reaches several rows, and its players decide", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const late = await insertPlayer(t, w.sportId, "Other Player", [w.late]);
    let calls = 0;

    const pick = await t.run((ctx) =>
      resolveCardTeamName(ctx, w.sportId, "St. Louis Browns", 1990, {
        loadCardPlayerIds: async () => {
          calls++;
          return [[late]];
        },
      }),
    );

    expect(calls).toBe(1);
    expect(pick.teamId).toBe(w.late);
    expect(pick.via).toBe("players");
    expect(pick.agreesWithYear).toBe(false);
  });

  test("is never called for a one-row name or an unknown one", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    let calls = 0;
    const loader = async () => {
      calls++;
      return undefined;
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("teams", {
        name: "Padres",
        location: "San Diego",
        nameNormalized: normalizeTeamName("San Diego Padres"),
        sportId: w.sportId,
        lastUpdated: Date.now(),
      });
    });

    const one = await t.run((ctx) =>
      resolveCardTeamName(ctx, w.sportId, "San Diego Padres", 2000, { loadCardPlayerIds: loader }),
    );
    const none = await t.run((ctx) =>
      resolveCardTeamName(ctx, w.sportId, "Nowhere Nobodies", 2000, { loadCardPlayerIds: loader }),
    );

    expect(one.teamId).not.toBeNull();
    expect(none.teamId).toBeNull();
    expect(calls).toBe(0);
  });

  test("a loader that finds no evidence leaves the year to decide, and an explicit cardPlayerIds wins over the loader", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const late = await insertPlayer(t, w.sportId, "Other Player", [w.late]);
    let calls = 0;

    const noEvidence = await t.run((ctx) =>
      resolveCardTeamName(ctx, w.sportId, "St. Louis Browns", 1930, {
        loadCardPlayerIds: async () => undefined,
      }),
    );
    expect(noEvidence.teamId).toBe(w.early);
    expect(noEvidence.via).toBe("year");

    const explicit = await t.run((ctx) =>
      resolveCardTeamName(ctx, w.sportId, "St. Louis Browns", 1990, {
        cardPlayerIds: [[late]],
        loadCardPlayerIds: async () => {
          calls++;
          return [[]];
        },
      }),
    );
    expect(explicit.teamId).toBe(w.late);
    expect(calls).toBe(0);
  });
});
