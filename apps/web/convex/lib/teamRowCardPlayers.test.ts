/**
 * NEO-490 (2b) — a team name with several eras, settled by the card's own
 * players.
 *
 * `narrowTeamRowsByCardPlayers` is the pure-ish rule (reads player documents
 * only); `selectorOptions.resolveGateTeamNames` is the internal query the
 * review gate asks for its printed team names. Fixtures are
 * raw `t.run` inserts: a sport, one team name with two eras (and a third,
 * modern one for the future-era cases), and players whose `teamYears` point at
 * the eras.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { MAX_TEAM_NAME_LENGTH, normalizeTeamName } from "../teams";
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

/**
 * NEO-574 — the year rule is about WHEN a stint began, so this fixture dates
 * stints by position, not by era: the first team's from 1930, the second's
 * from 1931 (`insertPlayer` above dates each inside its own team's era, which
 * NEO-602 needs and which would put every stint at or before a 1930 card).
 */
async function insertPlayerStintsByPosition(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  teams: Id<"teams">[],
): Promise<Id<"players">> {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: name.toLowerCase().split(" ").reverse().join(" "),
      sportId,
      teamYears: teams.map((teamId, i) => ({ teamId, fromYear: 1930 + i, toYear: 1931 + i })),
      lastUpdated: Date.now(),
    }),
  );
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

  test("NEO-574: a stint beginning after the set year does not count (the shared coverage rule)", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    // `insertPlayerStintsByPosition` starts the first team's stint in 1930 and
    // the second's in 1931.
    const both = await insertPlayerStintsByPosition(t, w.sportId, "Satchel Paige", [
      w.early,
      w.late,
    ]);
    const startsLate = await insertPlayerStintsByPosition(t, w.sportId, "Other Player", [
      w.late,
      w.early,
    ]);

    // A 1930 card: both eras are in range for the early row, the stint on it
    // began that year and counts; the late stint (1931) does not, so the
    // player points at one era...
    expect(await narrow(t, [w.early, w.late], [[both]], 1930)).toBe(w.early);
    // ...a 1925 card sees neither stint begun, so nothing says which era...
    expect(await narrow(t, [w.early, w.late], [[both]], 1925)).toBeNull();
    // ...and this player's stint on the early era began in 1931, after a 1930
    // card (his other stint is on a row that does not exist yet in 1930).
    expect(await narrow(t, [w.early, w.late], [[startsLate]], 1930)).toBeNull();
    expect(await narrow(t, [w.early, w.late], [[startsLate]], 1931)).toBe(w.early);
    // With no year every stint counts: a player with a stint in each era is
    // ambiguous again. (NEO-602: `insertPlayer` dates each stint inside its
    // own team's era; `both` above dates the late one in 1931, outside the
    // 1961-65 row, which would not support it whatever the year rule said.)
    const inBothEras = await insertPlayer(t, w.sportId, "Era Hopper", [w.early, w.late]);
    expect(await narrow(t, [w.early, w.late], [[inBothEras]], undefined)).toBeNull();
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

describe("NEO-490 / NEO-602: selectorOptions.resolveGateTeamNames, the players' answer", () => {
  type ResolveArgs = {
    sportId: Id<"selectorOptions">;
    name?: string;
    setYear?: number;
    cardPlayerIds: Id<"players">[][];
  };
  // The gate's batch query answers per ask with the row's id, HOW the rule got
  // there (`via`) and whether the players' row is the year's own
  // (`agreesWithYear`). `resolveAnswer` keeps the whole answer; `resolve`
  // reduces it to the id of an answer the PLAYERS made, which is what a visible
  // career-team link needs: a year's answer, or none, is null.
  const resolveAnswer = async (t: T, args: ResolveArgs) => {
    const [answer] = await t.query(internal.selectorOptions.resolveGateTeamNames, {
      sportId: args.sportId,
      ...(args.setYear !== undefined ? { setYear: args.setYear } : {}),
      asks: [{ name: args.name ?? "St. Louis Browns", cardPlayerIds: args.cardPlayerIds }],
    });
    return answer;
  };
  const resolve = async (t: T, args: ResolveArgs) => {
    const { answer } = await resolveAnswer(t, args);
    return answer?.via === "players" ? answer.teamId : null;
  };

  test("returns the era the card's player played for when the name has several and no year", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(await resolve(t, { sportId: w.sportId, cardPlayerIds: [[paige]] })).toBe(w.early);
    // And what comes back names the row (id, sport and full name).
    const { answer } = await resolveAnswer(t, { sportId: w.sportId, cardPlayerIds: [[paige]] });
    expect(answer).toMatchObject({
      teamId: w.early,
      rowSportId: w.sportId,
      fullName: "St. Louis Browns",
      via: "players",
    });
  });

  test("returns the row the players chose even when the set year lands on the same row", async () => {
    // 1930 sits only inside the 1902-1953 era, so the year alone would pick it
    // too. The player points at that SAME era: the players' row comes back,
    // flagged `agreesWithYear` so the caller links it silently.
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    const { answer } = await resolveAnswer(t, {
      sportId: w.sportId,
      setYear: 1930,
      cardPlayerIds: [[paige]],
    });
    expect(answer).toMatchObject({ teamId: w.early, via: "players", agreesWithYear: true });
  });

  test("the set year's answer is not the players' when no player has a stint on a row", async () => {
    // The year's answer is not a career-team link the players made, so it comes
    // back as `via: "year"` and the caller does not label it as one.
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const blank = await insertPlayer(t, w.sportId, "Satchel Paige", []);

    const { answer } = await resolveAnswer(t, {
      sportId: w.sportId,
      setYear: 1930,
      cardPlayerIds: [[blank]],
    });
    expect(answer).toMatchObject({ teamId: w.early, via: "year", agreesWithYear: true });
    expect(
      await resolve(t, { sportId: w.sportId, setYear: 1930, cardPlayerIds: [[blank]] }),
    ).toBeNull();
  });

  test("returns the players' row when it differs from the year's (the visible-row case)", async () => {
    // A 1990 card: the year covers neither era; only the late (1961-65) player
    // evidence names a row. Players decide, so the answer is theirs.
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

    const answer = await resolveAnswer(t, { sportId: w.sportId, cardPlayerIds: [[a], [b]] });
    expect(answer.answer).toBeNull();
    expect(await resolve(t, { sportId: w.sportId, cardPlayerIds: [[a], [b]] })).toBeNull();
  });

  test("returns null for a name the sport does not hold", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);

    expect(
      await resolveAnswer(t, { sportId: w.sportId, name: "Nowhere Nobodies", cardPlayerIds: [[paige]] }),
    ).toEqual({ answer: null, ambiguous: false, candidateTeamIds: [] });
  });

  test("never inserts a team", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    const before = await t.run((ctx) => ctx.db.query("teams").collect());

    await resolve(t, { sportId: w.sportId, cardPlayerIds: [[paige]] });

    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(before.length);
  });

  test("refuses, never truncates, an ask past the card rule's bounds or a name no team can have", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const paige = await insertPlayer(t, w.sportId, "Satchel Paige", [w.early]);
    const ask = (asks: Array<{ name: string; cardPlayerIds?: Id<"players">[][] }>) =>
      t.query(internal.selectorOptions.resolveGateTeamNames, { sportId: w.sportId, asks });
    const name = "St. Louis Browns";

    // At the bounds: answered.
    const atCards = Array.from({ length: CARD_PLAYER_TEAM_MAX_CARDS }, () => [paige]);
    const atPlayers = [Array.from({ length: CARD_PLAYER_TEAM_MAX_PLAYERS_PER_CARD }, () => paige)];
    expect(await ask([{ name, cardPlayerIds: atCards }])).toHaveLength(1);
    expect(await ask([{ name, cardPlayerIds: atPlayers }])).toHaveLength(1);
    expect(await ask([{ name: "x".repeat(MAX_TEAM_NAME_LENGTH) }])).toHaveLength(1);

    // One past: refused, even when it is only the second ask that breaches.
    const pastCards = Array.from({ length: CARD_PLAYER_TEAM_MAX_CARDS + 1 }, () => [paige]);
    const pastPlayers = [Array.from({ length: CARD_PLAYER_TEAM_MAX_PLAYERS_PER_CARD + 1 }, () => paige)];
    await expect(ask([{ name }, { name, cardPlayerIds: pastCards }])).rejects.toMatchObject({
      data: { code: "too_many_cards" },
    });
    await expect(ask([{ name, cardPlayerIds: pastPlayers }])).rejects.toMatchObject({
      data: { code: "too_many_players" },
    });
    await expect(ask([{ name: "x".repeat(MAX_TEAM_NAME_LENGTH + 1) }])).rejects.toMatchObject({
      data: { code: "name_too_long" },
    });
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

describe("NEO-574 adversarial: narrowTeamRowsByCardPlayers year rule", () => {
  test("an undated stint counts at any set year", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const p = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Undated Guy",
        nameNormalized: "guy undated",
        sportId: w.sportId,
        teamYears: [{ teamId: w.early }],
        lastUpdated: Date.now(),
      }),
    );
    expect(await narrow(t, [w.early, w.late], [[p]], 1925)).toBe(w.early);
  });

  test("a stint that ended before the set year still counts", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const p = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Old Timer",
        nameNormalized: "old timer",
        sportId: w.sportId,
        teamYears: [{ teamId: w.early, fromYear: 1910, toYear: 1912 }],
        lastUpdated: Date.now(),
      }),
    );
    expect(await narrow(t, [w.early, w.late], [[p]], 1950)).toBe(w.early);
  });

  test("a later-starting stint on one era is ignored, leaving the other era the answer", async () => {
    const t = convexTest(schema, modules);
    const w = await seed(t);
    const p = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Mixed Career",
        nameNormalized: "career mixed",
        sportId: w.sportId,
        teamYears: [
          { teamId: w.early, fromYear: 1920, toYear: 1925 },
          { teamId: w.late, fromYear: 1962, toYear: 1964 },
        ],
        lastUpdated: Date.now(),
      }),
    );
    expect(await narrow(t, [w.early, w.late], [[p]], 1930)).toBe(w.early);
    expect(await narrow(t, [w.early, w.late], [[p]], 1963)).toBeNull();
  });
});
