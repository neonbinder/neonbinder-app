/**
 * NEO-676 adversarial pass: tries to make the MLB link pass overwrite a present
 * value, steal an id, mis-route an era, double-link a player, or fail to converge.
 * Helpers are copied from bulkLoad.mlb.test.ts (they are not exported).
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { MAX_PARENT_CLUBS } from "./lib/parentClubs";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const CONFIRM = "BULK_LOAD" as const;
type T = ReturnType<typeof convexTest>;

afterEach(() => vi.unstubAllEnvs());

function armed() {
  vi.stubEnv("ALLOW_BULK_LOAD", "true");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function epoch(): Promise<number> {
  await sleep(5);
  const e = Date.now();
  await sleep(5);
  return e;
}

async function seedSport(t: T, value = "Baseball") {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value,
      platformData: {},
      children: [],
      lastUpdated: 1_700_000_000_000,
    }),
  );
}

async function seedLeague(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  extra: {
    level?: "major" | "minor" | "other";
    aliases?: string[];
    mlbamId?: number;
    classes?: Array<{
      class: "aaa" | "aa" | "high-a" | "single-a" | "rookie";
      fromYear: number;
      toYear?: number;
    }>;
  } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("leagues", {
      name,
      nameNormalized: name.trim().toLowerCase(),
      sportId,
      level: extra.level ?? "major",
      ...(extra.aliases ? { aliases: extra.aliases } : {}),
      ...(extra.mlbamId !== undefined ? { externalIds: { mlbamId: extra.mlbamId } } : {}),
      ...(extra.classes ? { minorLeagueClasses: extra.classes } : {}),
      lastUpdated: 1_700_000_000_000,
    }),
  );
}

async function seedTeam(
  t: T,
  sportId: Id<"selectorOptions">,
  parts: {
    location?: string;
    name: string;
    years?: { from: number; to?: number };
    aliases?: string[];
    leagueId?: Id<"leagues">;
    mlbamId?: number;
    parentClubs?: Array<{ parentTeamId: Id<"teams">; fromYear: number; toYear?: number }>;
  },
) {
  const full = parts.location ? `${parts.location} ${parts.name}` : parts.name;
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("teams", {
      name: parts.name,
      ...(parts.location ? { location: parts.location } : {}),
      nameNormalized: normalizeTeamName(full),
      sportId,
      ...(parts.years ? { yearsActive: parts.years } : {}),
      ...(parts.aliases ? { aliases: parts.aliases } : {}),
      ...(parts.leagueId ? { leagueId: parts.leagueId } : {}),
      ...(parts.mlbamId !== undefined ? { externalIds: { mlbamId: parts.mlbamId } } : {}),
      ...(parts.parentClubs ? { parentClubs: parts.parentClubs } : {}),
      lastUpdated: 1_700_000_000_000,
    });
    for (const alias of parts.aliases ?? []) {
      await ctx.db.insert("teamAliases", {
        teamId: id,
        sportId,
        aliasNormalized: normalizeTeamName(alias),
      });
    }
    return id;
  });
}

async function seedPlayer(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  extra: { birthYear?: number; birthDate?: string; mlbamId?: number } = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...(extra.birthYear !== undefined ? { birthYear: extra.birthYear } : {}),
      ...(extra.birthDate !== undefined ? { birthDate: extra.birthDate } : {}),
      ...(extra.mlbamId !== undefined ? { externalIds: { mlbamId: extra.mlbamId } } : {}),
      lastUpdated: 1_700_000_000_000,
    }),
  );
}

const league = (t: T, id: Id<"leagues">) => t.run(async (ctx) => ctx.db.get(id));
const team = (t: T, id: Id<"teams">) => t.run(async (ctx) => ctx.db.get(id));
const player = (t: T, id: Id<"players">) => t.run(async (ctx) => ctx.db.get(id));
const allLeagues = (t: T) => t.run(async (ctx) => ctx.db.query("leagues").collect());
const allTeams = (t: T) => t.run(async (ctx) => ctx.db.query("teams").collect());
const allPlayers = (t: T) => t.run(async (ctx) => ctx.db.query("players").collect());
const scheduled = (t: T) =>
  t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());

type LeagueIn = {
  name: string;
  level: "major" | "minor" | "college" | "international" | "independent" | "other";
  aliases?: string[];
  mlbamId?: number;
  minorLeagueClasses?: Array<{
    class: "aaa" | "aa" | "high-a" | "single-a" | "short-season-a" | "rookie-advanced" | "rookie";
    fromYear: number;
    toYear?: number;
  }>;
  yearsActive?: { from: number; to?: number };
};
const leagues = (t: T, rows: LeagueIn[], dryRun = false) =>
  t.mutation(internal.bulkLoad.upsertLeagues, {
    confirm: CONFIRM,
    sport: "Baseball",
    dryRun,
    leagues: rows,
  });

type TeamIn = {
  key: string;
  location?: string;
  name: string;
  aliases?: string[];
  league?: string;
  yearsActive?: { from: number; to?: number };
  mlbamId?: number;
  parentClubs?: Array<{ parentTeamId: Id<"teams">; fromYear: number; toYear?: number }>;
  decision?: { adopt: Id<"teams"> } | { create: true };
};
const teams = (t: T, rows: TeamIn[]) =>
  t.mutation(internal.bulkLoad.upsertTeams, {
    confirm: CONFIRM,
    sport: "Baseball",
    teams: rows,
  });
const previewTeams = (t: T, rows: TeamIn[]) =>
  t.query(internal.bulkLoad.previewTeams, { confirm: CONFIRM, sport: "Baseball", teams: rows });

type PlayerIn = {
  key: string;
  name: string;
  birthYear?: number;
  birthDate?: string;
  mlbamId?: number;
  decision?: { adopt: Id<"players"> } | { create: true };
};
const players = (t: T, loadStartedAt: number, rows: PlayerIn[]) =>
  t.mutation(internal.bulkLoad.upsertPlayers, {
    confirm: CONFIRM,
    sport: "Baseball",
    loadStartedAt,
    players: rows.map((r) => ({ ...r, stints: [] })),
  });
const previewPlayers = (t: T, loadStartedAt: number, rows: PlayerIn[]) =>
  t.query(internal.bulkLoad.previewPlayers, {
    confirm: CONFIRM,
    sport: "Baseball",
    loadStartedAt,
    players: rows.map((r) => ({ ...r, stints: [] })),
  });

const snap = async (t: T) => ({
  leagues: await allLeagues(t),
  teams: await allTeams(t),
  players: await allPlayers(t),
});

describe("leagues: never overwrite, always converge", () => {
  test("an adopt that disagrees on level, aliases and classes changes nothing but the id", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedLeague(t, sportId, "Texas League", {
      level: "minor",
      aliases: ["TL"],
      classes: [{ class: "aa", fromYear: 1995 }],
    });
    const before = await league(t, id);
    const out = await leagues(t, [
      {
        name: "Texas League",
        level: "major",
        aliases: ["Lone Star"],
        mlbamId: 104,
        minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }],
      },
    ]);
    expect(out.results[0].id).toBe(id);
    const after = await league(t, id);
    expect(after?.externalIds).toEqual({ mlbamId: 104 });
    expect({ ...after, externalIds: undefined, lastUpdated: 0 }).toEqual({
      ...before,
      externalIds: undefined,
      lastUpdated: 0,
    });
  });

  test("a rerun of a create lands on the same row and writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const rows: LeagueIn[] = [
      { name: "Pacific Coast League", level: "minor", mlbamId: 112, minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }] },
    ];
    await leagues(t, rows);
    const first = await snap(t);
    const again = await leagues(t, rows);
    expect(again.results[0].status).not.toBe("created");
    expect(await snap(t)).toEqual(first);
  });
});

describe("teams: id stealing and era routing", () => {
  test("a decision adopt onto a row holding a different id holds it, nothing written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedTeam(t, sportId, { location: "Detroit", name: "Tigers", mlbamId: 116 });
    const before = await snap(t);
    const out = await teams(t, [
      { key: "k", location: "Detroit", name: "Tigers", mlbamId: 999, decision: { adopt: id } },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements).toEqual([{ field: "mlbamId", nb: "116", mlb: "999" }]);
    expect(await snap(t)).toEqual(before);
  });

  // KNOWN BUG (reported): the decision-replay step runs before step 1b, so an
  // {adopt} onto a bare row writes an id that another era row already holds for
  // overlapping seasons; every later by-id lookup is then a tie.
  test.fails("a decision adopt of an id onto a row whose seasons overlap another holder of that id does not mint a second holder", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const holder = await seedTeam(t, sportId, {
      location: "Los Angeles", name: "Dodgers", years: { from: 1958 }, mlbamId: 119,
    });
    const bare = await seedTeam(t, sportId, {
      location: "Los Angeles", name: "Dodgers", years: { from: 1958 },
    });
    const out = await teams(t, [
      { key: "k", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1958 }, mlbamId: 119, decision: { adopt: bare } },
    ]);
    const holders = (await allTeams(t)).filter((x) => x.externalIds?.mlbamId === 119);
    expect(holders.map((x) => x._id)).toEqual([holder]);
    expect(out.results[0].status).toBe("ambiguous");
  });

  test("seasons straddling two eras of one id are a tie: held, neither row touched", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedTeam(t, sportId, { location: "Brooklyn", name: "Dodgers", years: { from: 1901, to: 1957 }, mlbamId: 119 });
    await seedTeam(t, sportId, { location: "Los Angeles", name: "Dodgers", years: { from: 1958 }, mlbamId: 119 });
    const before = await snap(t);
    const out = await teams(t, [
      { key: "k", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1950, to: 1970 }, mlbamId: 119 },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
    expect(await snap(t)).toEqual(before);
  });

  test("MLB seasons outside NB's span are reported and NB's years are not widened", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedTeam(t, sportId, {
      location: "Detroit", name: "Tigers", years: { from: 1901, to: 1999 }, mlbamId: 116,
    });
    const out = await teams(t, [
      { key: "k", location: "Detroit", name: "Tigers", yearsActive: { from: 1990, to: 2010 }, mlbamId: 116 },
    ]);
    expect(out.results[0]).toMatchObject({ id, status: "adopted" });
    expect(out.results[0].disagreements?.[0]).toMatchObject({ field: "yearsActive" });
    expect((await team(t, id))?.yearsActive).toEqual({ from: 1901, to: 1999 });
  });

  test("an adopt with a different league, years and parent leaves the present doc deep-equal", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const l1 = await seedLeague(t, sportId, "Texas League", { level: "minor" });
    await seedLeague(t, sportId, "Eastern League", { level: "minor" });
    const p1 = await seedTeam(t, sportId, { location: "Houston", name: "Astros" });
    const p2 = await seedTeam(t, sportId, { location: "Texas", name: "Rangers" });
    const id = await seedTeam(t, sportId, {
      location: "Corpus Christi", name: "Hooks", years: { from: 2005, to: 2020 },
      leagueId: l1, mlbamId: 640,
      parentClubs: [{ parentTeamId: p1, fromYear: 2005, toYear: 2020 }],
    });
    const before = await team(t, id);
    const out = await teams(t, [
      {
        key: "k", location: "Corpus Christi", name: "Hooks", league: "Eastern League",
        yearsActive: { from: 1995, to: 2026 }, mlbamId: 640,
        parentClubs: [{ parentTeamId: p2, fromYear: 2010, toYear: 2012 }],
      },
    ]);
    expect(out.results[0].id).toBe(id);
    const fields = (out.results[0].disagreements ?? []).map((d) => d.field);
    expect(fields).toContain("league");
    expect(fields).toContain("yearsActive");
    expect(await team(t, id)).toEqual(before);
  });

  test("a rerun after a create converges: same row, nothing filled, nothing created", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const parent = await seedTeam(t, sportId, { location: "Houston", name: "Astros" });
    await seedLeague(t, sportId, "Texas League", { level: "minor" });
    const row: TeamIn = {
      key: "k", location: "Corpus Christi", name: "Hooks", league: "Texas League",
      yearsActive: { from: 2005 }, mlbamId: 640,
      parentClubs: [{ parentTeamId: parent, fromYear: 2005 }],
    };
    const first = await teams(t, [row]);
    expect(first.results[0].status).toBe("created");
    const snapshot = await snap(t);
    const again = await teams(t, [row]);
    expect(again.results[0]).toMatchObject({ id: first.results[0].id, matchedBy: "mlbamId", filled: [] });
    expect(again.results[0].disagreements).toBeUndefined();
    expect(await snap(t)).toEqual(snapshot);
  });

  test("two keys for one club in one call create one row", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    await teams(t, [
      { key: "a", location: "Corpus Christi", name: "Hooks", yearsActive: { from: 2005 }, mlbamId: 640 },
      { key: "b", location: "Corpus Christi", name: "Hooks", yearsActive: { from: 2005 }, mlbamId: 640 },
    ]);
    expect(await allTeams(t)).toHaveLength(1);
  });
});

describe("teams: parent clubs", () => {
  test("a covered year with another parent is never claimed; the present entry survives", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const p1 = await seedTeam(t, sportId, { location: "Houston", name: "Astros" });
    const p2 = await seedTeam(t, sportId, { location: "Texas", name: "Rangers" });
    const id = await seedTeam(t, sportId, {
      location: "Corpus Christi", name: "Hooks", years: { from: 2005 }, mlbamId: 640,
      parentClubs: [{ parentTeamId: p1, fromYear: 2005, toYear: 2010 }],
    });
    const out = await teams(t, [
      {
        key: "k", location: "Corpus Christi", name: "Hooks", mlbamId: 640,
        parentClubs: [
          { parentTeamId: p1, fromYear: 2005, toYear: 2015 },
          { parentTeamId: p2, fromYear: 2008, toYear: 2009 },
        ],
      },
    ]);
    const next = (await team(t, id))?.parentClubs ?? [];
    expect(next).toContainEqual({ parentTeamId: p1, fromYear: 2005, toYear: 2010 });
    expect(next.some((e) => e.parentTeamId === p2)).toBe(false);
    expect(out.results[0].disagreements?.length).toBeGreaterThan(0);
  });

  test("an adopt that would pass the cap throws and leaves the row alone", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const parent = await seedTeam(t, sportId, { location: "Houston", name: "Astros" });
    const held = Array.from({ length: MAX_PARENT_CLUBS }, (_, i) => ({
      parentTeamId: parent, fromYear: 1800 + i, toYear: 1800 + i,
    }));
    const id = await seedTeam(t, sportId, {
      location: "Corpus Christi", name: "Hooks", mlbamId: 640, parentClubs: held,
    });
    await expect(
      teams(t, [
        {
          key: "k", location: "Corpus Christi", name: "Hooks", mlbamId: 640,
          parentClubs: [{ parentTeamId: parent, fromYear: 2020, toYear: 2020 }],
        },
      ]),
    ).rejects.toThrow(/parent clubs/);
    expect((await team(t, id))?.parentClubs).toHaveLength(MAX_PARENT_CLUBS);
  });
});

describe("players: link-or-create adversaries", () => {
  test("an adopt by id never overwrites a present birth date or name", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Michael Trout", {
      birthYear: 1991, birthDate: "1991-08-07", mlbamId: 545361,
    });
    const before = await player(t, id);
    const out = await players(t, await epoch(), [
      { key: "a", name: "Mike Trout", mlbamId: 545361, birthYear: 1991, birthDate: "1991-08-08" },
    ]);
    expect(out.results[0]).toMatchObject({ playerId: id, status: "adopted" });
    expect(out.results[0].disagreements).toEqual([
      { field: "birthDate", nb: "1991-08-07", mlb: "1991-08-08" },
    ]);
    expect(await player(t, id)).toEqual(before);
  });

  test("two keys with different ids aimed at one NB player link it once", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Will Smith", { birthYear: 1995 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Will Smith", mlbamId: 656970, birthYear: 1995 },
      { key: "b", name: "Will Smith", mlbamId: 669257, birthYear: 1995 },
    ]);
    expect(out.results.filter((r) => r.playerId === id)).toHaveLength(1);
    expect((await player(t, id))?.externalIds?.mlbamId).toBe(656970);
    expect((await allPlayers(t)).filter((p) => p.externalIds?.mlbamId === 669257)).toEqual([]);
  });

  test("two keys with one id create one player", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    await players(t, await epoch(), [
      { key: "a", name: "Shohei Ohtani", mlbamId: 660271 },
      { key: "b", name: "Shohei Ohtani", mlbamId: 660271 },
    ]);
    expect((await allPlayers(t)).filter((p) => p.externalIds?.mlbamId === 660271)).toHaveLength(1);
  });

  test("a rerun after an id-keyed create writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const e = await epoch();
    const row: PlayerIn = { key: "a", name: "Shohei Ohtani", mlbamId: 660271, birthDate: "1994-07-05" };
    await players(t, e, [row]);
    const snapshot = await snap(t);
    const again = await players(t, e, [row]);
    expect(again.results[0].status).toBe("adopted");
    expect(again.results[0].filled).toBeUndefined();
    expect(await snap(t)).toEqual(snapshot);
  });

  test("a dated MLB row whose year differs from a dated NB namesake is not linked to him", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Will Smith", { birthYear: 1990 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Will Smith", mlbamId: 656970, birthDate: "1995-03-28" },
    ]);
    expect(out.results[0].playerId).not.toBe(id);
    const after = await player(t, id);
    expect(after?.externalIds).toBeUndefined();
    expect(after?.birthDate).toBeUndefined();
  });
});
