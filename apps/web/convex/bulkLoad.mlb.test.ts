/**
 * NEO-676 — the MLB link pass on the armed bulk loader: leagues, teams and
 * players are matched by MLB id first, adopted by gap-fill only, created when
 * nothing matches (leagues and teams), and every place NB and MLB disagree comes
 * back as `disagreements` with nothing written for it.
 *
 * Every test asserts the outcome AND the rows left behind: a status alone would
 * stay green while the wrong field was written.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { stintAlreadyPresent } from "./bulkLoad";
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
const previewLeagues = (t: T, rows: LeagueIn[]) =>
  t.query(internal.bulkLoad.previewLeagues, { confirm: CONFIRM, sport: "Baseball", leagues: rows });
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

describe("the gate", () => {
  test("every write leg refuses unarmed, MLB fields or not", async () => {
    const t = convexTest(schema, modules);
    await seedSport(t);
    await expect(
      leagues(t, [{ name: "AL", level: "major", mlbamId: 103 }]),
    ).rejects.toThrow(/not armed/);
    await expect(teams(t, [{ key: "k", name: "Tigers", mlbamId: 116 }])).rejects.toThrow(
      /not armed/,
    );
    await expect(
      players(t, await epoch(), [{ key: "p", name: "Mike Trout", mlbamId: 545361 }]),
    ).rejects.toThrow(/not armed/);
    expect(await allLeagues(t)).toEqual([]);
    expect(await allTeams(t)).toEqual([]);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("a bad MLB id or birth date is refused naming the row", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    await expect(leagues(t, [{ name: "AL", level: "major", mlbamId: -3 }])).rejects.toThrow(
      /MLB id/,
    );
    await expect(
      players(t, await epoch(), [
        { key: "p", name: "Mike Trout", birthDate: "1991-02-30" },
      ]),
    ).rejects.toThrow(/birth date/);
    await expect(
      players(t, await epoch(), [
        { key: "p", name: "Mike Trout", birthYear: 1990, birthDate: "1991-08-07" },
      ]),
    ).rejects.toThrow(/birth year/);
  });
});

describe("leagues", () => {
  test("a create carries the id, and classes only on a minor league", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const out = await leagues(t, [
      {
        name: "Pacific Coast League",
        level: "minor",
        mlbamId: 112,
        minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }],
      },
      {
        name: "Ladies League",
        level: "independent",
        mlbamId: 900,
        minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }],
      },
    ]);
    expect(out.results.map((r) => [r.created, r.disagreements])).toEqual([
      [true, undefined],
      [true, undefined],
    ]);
    const pcl = await league(t, out.results[0].id!);
    expect(pcl?.externalIds).toEqual({ mlbamId: 112 });
    expect(pcl?.minorLeagueClasses).toEqual([{ class: "aaa", fromYear: 1995 }]);
    const other = await league(t, out.results[1].id!);
    expect(other?.externalIds).toEqual({ mlbamId: 900 });
    expect(other?.minorLeagueClasses).toBeUndefined();
    expect((await allLeagues(t)).every((l) => l.sportId === sportId)).toBe(true);
    expect(await scheduled(t)).toEqual([]);
  });

  test("step 0: gap-fills a name match, then converges by id even under a new API name", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedLeague(t, sportId, "International League", { level: "minor" });
    const first = await leagues(t, [
      {
        name: "International League",
        level: "minor",
        mlbamId: 117,
        aliases: ["IL"],
        minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }],
      },
    ]);
    expect(first.results).toEqual([
      {
        name: "International League",
        id,
        created: false,
        nbName: "International League",
        filled: ["aliases", "mlbamId", "minorLeagueClasses"],
      },
    ]);
    const row = await league(t, id);
    expect(row?.externalIds?.mlbamId).toBe(117);
    expect(row?.aliases).toEqual(["IL"]);
    expect(row?.minorLeagueClasses).toEqual([{ class: "aaa", fromYear: 1995 }]);

    // Rerun, MLB now spells it differently: found by id, nothing new, no second row.
    const again = await leagues(t, [
      {
        name: "Intl League of Pro Baseball",
        level: "minor",
        mlbamId: 117,
        minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }],
      },
    ]);
    expect(again.results).toEqual([
      { name: "Intl League of Pro Baseball", id, created: false, nbName: "International League" },
    ]);
    expect(await allLeagues(t)).toHaveLength(1);
    expect((await league(t, id))?.name).toBe("International League");
  });

  test("a differing class is reported and left; the id still fills", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedLeague(t, sportId, "Eastern League", {
      level: "minor",
      classes: [{ class: "aa", fromYear: 1995 }],
    });
    const out = await leagues(t, [
      {
        name: "Eastern League",
        level: "minor",
        mlbamId: 113,
        minorLeagueClasses: [{ class: "high-a", fromYear: 1995 }],
      },
    ]);
    expect(out.results[0].filled).toEqual(["mlbamId"]);
    expect(out.results[0].disagreements).toEqual([
      { field: "minorLeagueClasses", nb: "aa 1995-", mlb: "high-a 1995-" },
    ]);
    const row = await league(t, id);
    expect(row?.minorLeagueClasses).toEqual([{ class: "aa", fromYear: 1995 }]);
    expect(row?.externalIds?.mlbamId).toBe(113);
  });

  test("a major league never takes classes", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedLeague(t, sportId, "Major League Baseball", { level: "major" });
    const out = await leagues(t, [
      {
        name: "Major League Baseball",
        level: "minor",
        mlbamId: 1,
        minorLeagueClasses: [{ class: "aaa", fromYear: 1995 }],
      },
    ]);
    expect(out.results[0].filled).toEqual(["mlbamId"]);
    expect((await league(t, id))?.minorLeagueClasses).toBeUndefined();
  });

  test("two leagues answering to one name are a tie: held, nothing written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedLeague(t, sportId, "American League");
    await seedLeague(t, sportId, "Junior Circuit", { aliases: ["American League"] });
    const out = await leagues(t, [{ name: "American League", level: "major", mlbamId: 103 }]);
    expect(out.results[0].id).toBeNull();
    expect(out.results[0].created).toBe(false);
    expect(out.results[0].disagreements).toHaveLength(1);
    expect(out.results[0].disagreements?.[0]).toMatchObject({ field: "name", mlb: "American League" });
    const rows = await allLeagues(t);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.externalIds === undefined)).toBe(true);
  });

  test("a different id on the name match, and an id on two rows, hold the row", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const a = await seedLeague(t, sportId, "Texas League", { mlbamId: 104 });
    await seedLeague(t, sportId, "Twin A", { mlbamId: 200 });
    await seedLeague(t, sportId, "Twin B", { mlbamId: 200 });
    const out = await leagues(t, [
      { name: "Texas League", level: "major", mlbamId: 999 },
      { name: "Whatever", level: "major", mlbamId: 200 },
    ]);
    expect(out.results[0]).toMatchObject({
      id: null,
      created: false,
      disagreements: [{ field: "mlbamId", nb: "104", mlb: "999" }],
    });
    expect(out.results[1]).toMatchObject({ id: null, created: false });
    expect(out.results[1].disagreements?.[0].field).toBe("mlbamId");
    expect((await league(t, a))?.externalIds?.mlbamId).toBe(104);
    expect(await allLeagues(t)).toHaveLength(3);
  });

  test("a dry run reports and writes nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedLeague(t, sportId, "Sally League", { level: "minor" });
    const out = await leagues(
      t,
      [
        { name: "Sally League", level: "minor", mlbamId: 5 },
        { name: "New League", level: "minor", mlbamId: 6 },
      ],
      true,
    );
    expect(out.results[0]).toMatchObject({ id, created: false, filled: ["mlbamId"] });
    expect(out.results[1]).toMatchObject({ id: null, created: true });
    expect((await league(t, id))?.externalIds).toBeUndefined();
    expect(await allLeagues(t)).toHaveLength(1);
  });

  test("previewLeagues runs unarmed, writes nothing, and agrees with the write run", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const adopted = await seedLeague(t, sportId, "South Atlantic League", {
      level: "minor",
      aliases: ["Sally League"],
    });
    const held = await seedLeague(t, sportId, "Texas League", { level: "minor", mlbamId: 104 });
    const rows: LeagueIn[] = [
      { name: "Sally League", level: "minor", mlbamId: 5 },
      { name: "New League", level: "minor", mlbamId: 6 },
      { name: "Texas League", level: "minor", mlbamId: 999 },
    ];
    // Unarmed: the write leg refuses, the preview answers.
    await expect(leagues(t, rows)).rejects.toThrow(/not armed/);
    const preview = await previewLeagues(t, rows);
    expect(await allLeagues(t)).toHaveLength(2);
    expect((await league(t, adopted))?.externalIds).toBeUndefined();
    expect(preview.results[0]).toMatchObject({ id: adopted, created: false, nbName: "South Atlantic League" });
    expect(preview.results[1]).toMatchObject({ id: null, created: true, nbName: "New League" });
    expect(preview.results[2]).toMatchObject({ id: null, created: false, nbName: null });

    armed();
    const write = await leagues(t, rows);
    // Same results; only a created row's id differs (null in the preview).
    const shape = (rs: typeof write.results) => rs.map(({ id: _id, ...rest }) => rest);
    expect(shape(write.results)).toEqual(shape(preview.results));
    expect(write.results[1].id).not.toBeNull();
    expect(write.results[2].id).toBeNull();
    expect((await league(t, adopted))?.externalIds?.mlbamId).toBe(5);
    expect((await league(t, held))?.externalIds?.mlbamId).toBe(104);
    expect(await allLeagues(t)).toHaveLength(3);
  });

  test("nbName is NB's name when MLB's differs, on a hit by id and by name", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedLeague(t, sportId, "Pacific Coast League", { level: "minor", mlbamId: 112 });
    await seedLeague(t, sportId, "Carolina League", { level: "minor", aliases: ["CL"] });
    const out = await leagues(t, [
      { name: "PCL", level: "minor", mlbamId: 112 },
      { name: "CL", level: "minor", mlbamId: 120 },
    ]);
    expect(out.results.map((r) => [r.name, r.created, r.nbName])).toEqual([
      ["PCL", false, "Pacific Coast League"],
      ["CL", false, "Carolina League"],
    ]);
  });
});

describe("teams", () => {
  test("a create carries the id and parent clubs, and reports no disagreements", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const parent = await seedTeam(t, sportId, { location: "Houston", name: "Astros", mlbamId: 117 });
    await seedLeague(t, sportId, "Texas League", { level: "minor" });
    const out = await teams(t, [
      {
        key: "k",
        location: "Corpus Christi",
        name: "Hooks",
        league: "Texas League",
        yearsActive: { from: 2005 },
        mlbamId: 640,
        parentClubs: [{ parentTeamId: parent, fromYear: 2005 }],
      },
    ]);
    expect(out.results[0].status).toBe("created");
    expect(out.results[0].disagreements).toBeUndefined();
    const row = await team(t, out.results[0].id!);
    expect(row?.externalIds).toEqual({ mlbamId: 640 });
    expect(row?.parentClubs).toEqual([{ parentTeamId: parent, fromYear: 2005 }]);
    expect(await scheduled(t)).toEqual([]);
  });

  test("step 0 converges with no answers: a renamed club is found by id and its name joins the aliases", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedTeam(t, sportId, {
      location: "Tampa Bay",
      name: "Devil Rays",
      years: { from: 1998 },
      mlbamId: 139,
    });
    const first = await teams(t, [
      { key: "k", location: "Tampa Bay", name: "Rays", yearsActive: { from: 2008 }, mlbamId: 139 },
    ]);
    expect(first.results[0]).toMatchObject({
      id,
      status: "adopted",
      matchedBy: "mlbamId",
      aliasesAdded: 1,
    });
    expect(first.results[0].disagreements).toBeUndefined();
    const row = await team(t, id);
    expect(row?.name).toBe("Devil Rays");
    expect(row?.aliases).toEqual(["Tampa Bay Rays"]);

    const again = await teams(t, [
      { key: "k", location: "Tampa Bay", name: "Rays", yearsActive: { from: 2008 }, mlbamId: 139 },
    ]);
    expect(again.results[0]).toMatchObject({ id, status: "adopted", filled: [], aliasesAdded: 0 });
    expect(await allTeams(t)).toHaveLength(1);
  });

  test("era rows share one id: the season picks the row, an uncovered era is created", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const bkn = await seedTeam(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      years: { from: 1884, to: 1957 },
      mlbamId: 119,
    });
    const la = await seedTeam(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      years: { from: 1958 },
      mlbamId: 119,
    });
    const out = await teams(t, [
      { key: "a", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1960 }, mlbamId: 119 },
      { key: "b", location: "Brooklyn", name: "Dodgers", yearsActive: { from: 1890, to: 1957 }, mlbamId: 119 },
      { key: "c", location: "Brooklyn", name: "Bridegrooms", yearsActive: { from: 1850, to: 1860 }, mlbamId: 119 },
    ]);
    expect(out.results.map((r) => [r.status, r.id])).toEqual([
      ["adopted", la],
      ["adopted", bkn],
      ["created", out.results[2].id],
    ]);
    expect(out.results[2].id).not.toBeNull();
    const created = await team(t, out.results[2].id!);
    expect(created?.externalIds?.mlbamId).toBe(119);
    // Neither seeded era was touched beyond its own gap-fill.
    expect((await team(t, la))?.yearsActive).toEqual({ from: 1958 });
    expect((await team(t, bkn))?.yearsActive).toEqual({ from: 1884, to: 1957 });
  });

  test("two rows covering the same season are a tie: held, never the first", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const a = await seedTeam(t, sportId, { location: "A", name: "One", years: { from: 1990 }, mlbamId: 77 });
    const b = await seedTeam(t, sportId, { location: "B", name: "Two", years: { from: 2000 }, mlbamId: 77 });
    const out = await teams(t, [
      { key: "k", location: "C", name: "Three", yearsActive: { from: 2005 }, mlbamId: 77 },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
    expect(out.results[0].candidates?.map((c) => c.id).sort()).toEqual([a, b].sort());
    expect(await allTeams(t)).toHaveLength(2);
  });

  test("a different id on the row the name found holds the row", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedTeam(t, sportId, { location: "Detroit", name: "Tigers", mlbamId: 116 });
    const out = await teams(t, [
      { key: "k", location: "Detroit", name: "Tigers", mlbamId: 999, yearsActive: { from: 1901 } },
    ]);
    expect(out.results[0]).toMatchObject({
      id: null,
      status: "ambiguous",
      disagreements: [{ field: "mlbamId", nb: "116", mlb: "999" }],
    });
    const row = await team(t, id);
    expect(row?.externalIds?.mlbamId).toBe(116);
    expect(row?.yearsActive).toBeUndefined();
  });

  test("gap-fills: id, league, years and the missing parent-club years; nothing present is changed", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const astros = await seedTeam(t, sportId, { location: "Houston", name: "Astros", mlbamId: 117 });
    const texas = await seedLeague(t, sportId, "Texas League", { level: "minor" });
    const id = await seedTeam(t, sportId, {
      location: "Corpus Christi",
      name: "Hooks",
      parentClubs: [{ parentTeamId: astros, fromYear: 2005, toYear: 2010 }],
    });
    const out = await teams(t, [
      {
        key: "k",
        location: "Corpus Christi",
        name: "Hooks",
        league: "Texas League",
        yearsActive: { from: 2005 },
        mlbamId: 640,
        parentClubs: [{ parentTeamId: astros, fromYear: 2005 }],
      },
    ]);
    expect(out.results[0]).toMatchObject({ id, status: "adopted", matchedBy: "name" });
    expect(out.results[0].filled).toEqual(["leagueId", "yearsActive", "mlbamId", "parentClubs"]);
    expect(out.results[0].disagreements).toBeUndefined();
    const row = await team(t, id);
    expect(row?.leagueId).toBe(texas);
    expect(row?.yearsActive).toEqual({ from: 2005 });
    expect(row?.externalIds?.mlbamId).toBe(640);
    expect(row?.parentClubs).toEqual([
      { parentTeamId: astros, fromYear: 2005, toYear: 2010 },
      { parentTeamId: astros, fromYear: 2011 },
    ]);

    // A rerun fills nothing.
    const again = await teams(t, [
      {
        key: "k",
        location: "Corpus Christi",
        name: "Hooks",
        league: "Texas League",
        yearsActive: { from: 2005 },
        mlbamId: 640,
        parentClubs: [{ parentTeamId: astros, fromYear: 2005 }],
      },
    ]);
    expect(again.results[0]).toMatchObject({ status: "adopted", filled: [] });
  });

  test("each field conflict is reported and writes nothing for that field", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const astros = await seedTeam(t, sportId, { location: "Houston", name: "Astros" });
    const rangers = await seedTeam(t, sportId, { location: "Texas", name: "Rangers" });
    const texas = await seedLeague(t, sportId, "Texas League", { level: "minor" });
    await seedLeague(t, sportId, "Pacific Coast League", { level: "minor" });
    const id = await seedTeam(t, sportId, {
      location: "Round Rock",
      name: "Express",
      leagueId: texas,
      years: { from: 2000, to: 2020 },
      parentClubs: [{ parentTeamId: rangers, fromYear: 2000, toYear: 2020 }],
    });
    const out = await teams(t, [
      {
        key: "k",
        location: "Round Rock",
        name: "Express",
        league: "Pacific Coast League",
        yearsActive: { from: 1998, to: 2020 },
        mlbamId: 102,
        parentClubs: [{ parentTeamId: astros, fromYear: 2010, toYear: 2015 }],
      },
    ]);
    expect(out.results[0].status).toBe("adopted");
    expect(out.results[0].filled).toEqual(["mlbamId"]);
    expect(out.results[0].disagreements).toEqual([
      { field: "league", nb: "Texas League", mlb: "Pacific Coast League" },
      { field: "yearsActive", nb: "2000-2020", mlb: "1998-2020" },
      {
        field: "parentClubs",
        nb: `${rangers} 2000-2020`,
        mlb: `${astros} 2010-2015`,
      },
    ]);
    const row = await team(t, id);
    expect(row?.leagueId).toBe(texas);
    expect(row?.yearsActive).toEqual({ from: 2000, to: 2020 });
    expect(row?.parentClubs).toEqual([{ parentTeamId: rangers, fromYear: 2000, toYear: 2020 }]);
  });

  test("a league two rows answer to holds the team row", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedLeague(t, sportId, "Eastern League");
    await seedLeague(t, sportId, "Other", { aliases: ["Eastern League"] });
    const out = await teams(t, [
      { key: "k", name: "Fisher Cats", league: "Eastern League", mlbamId: 463 },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0]).toMatchObject({ field: "league", mlb: "Eastern League" });
    expect(await allTeams(t)).toEqual([]);
  });

  test("a probable duplicate (same league, overlapping years) is a disagreement; an explicit create lands", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const texas = await seedLeague(t, sportId, "Texas League", { level: "minor" });
    const old = await seedTeam(t, sportId, {
      location: "Frisco",
      name: "RoughRiders",
      leagueId: texas,
      years: { from: 2003 },
    });
    const row: TeamIn = {
      key: "k",
      location: "Frisco",
      name: "Rough Riders",
      league: "Texas League",
      yearsActive: { from: 2003 },
      mlbamId: 540,
    };
    const held = await teams(t, [row]);
    expect(held.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(held.results[0].disagreements?.[0]).toMatchObject({ field: "duplicate" });
    expect(held.results[0].candidates?.map((c) => c.id)).toEqual([old]);
    expect(await allTeams(t)).toHaveLength(1);

    const made = await teams(t, [{ ...row, decision: { create: true } }]);
    expect(made.results[0].status).toBe("created");
    expect(await allTeams(t)).toHaveLength(2);
  });

  test("found only under another label: held as a name disagreement; the adopt answer lands and converges", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedTeam(t, sportId, {
      location: "Montreal",
      name: "Expos",
      years: { from: 1969, to: 2004 },
      aliases: ["Expos de Montreal"],
    });
    const row: TeamIn = {
      key: "k",
      name: "Expos de Montreal",
      yearsActive: { from: 1969, to: 2004 },
      mlbamId: 120,
    };
    const held = await teams(t, [row]);
    expect(held.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(held.results[0].disagreements?.[0]).toMatchObject({ field: "name" });
    expect((await team(t, id))?.externalIds).toBeUndefined();

    const done = await teams(t, [{ ...row, decision: { adopt: id } }]);
    expect(done.results[0]).toMatchObject({ id, status: "adopted", matchedBy: "decision" });
    expect((await team(t, id))?.externalIds?.mlbamId).toBe(120);
    const again = await teams(t, [row]);
    expect(again.results[0]).toMatchObject({ id, matchedBy: "mlbamId", filled: [] });
  });

  test("parent clubs: capped, and every parent must be a team in this sport", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const parent = await seedTeam(t, sportId, { location: "Houston", name: "Astros" });
    const otherSport = await seedSport(t, "Hockey");
    const foreign = await seedTeam(t, otherSport, { name: "Stars" });
    const tooMany = Array.from({ length: MAX_PARENT_CLUBS + 1 }, (_, i) => ({
      parentTeamId: parent,
      fromYear: 1900 + i,
      toYear: 1900 + i,
    }));
    await expect(
      teams(t, [{ key: "k", name: "A", mlbamId: 1, parentClubs: tooMany }]),
    ).rejects.toThrow(/parent clubs/);
    await expect(
      teams(t, [{ key: "k", name: "A", mlbamId: 1, parentClubs: [{ parentTeamId: foreign, fromYear: 2000 }] }]),
    ).rejects.toThrow(/not a team in this sport/);
    expect(await allTeams(t)).toHaveLength(2);
  });

  test("the preview matches what the write does", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedTeam(t, sportId, { location: "Detroit", name: "Tigers" });
    const rows: TeamIn[] = [
      { key: "a", location: "Detroit", name: "Tigers", mlbamId: 116, yearsActive: { from: 1901 } },
      { key: "b", location: "Toledo", name: "Mud Hens", mlbamId: 512, yearsActive: { from: 1965 } },
    ];
    const preview = await previewTeams(t, rows);
    expect(preview.results.map((r) => [r.status, r.id, r.filled])).toEqual([
      ["would-adopt", id, ["yearsActive", "mlbamId"]],
      ["would-create", null, undefined],
    ]);
    expect(await allTeams(t)).toHaveLength(1);
    const real = await teams(t, rows);
    expect(real.results.map((r) => r.status)).toEqual(["adopted", "created"]);
  });
});

describe("players", () => {
  test("a create carries the id and the date, and the date brings its year", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const out = await players(t, await epoch(), [
      { key: "a", name: "Shohei Ohtani", mlbamId: 660271, birthDate: "1994-07-05" },
    ]);
    expect(out.results[0].status).toBe("created");
    const row = await player(t, out.results[0].playerId!);
    expect(row).toMatchObject({
      birthDate: "1994-07-05",
      birthYear: 1994,
      externalIds: { mlbamId: 660271 },
    });
    expect(await scheduled(t)).toEqual([]);
  });

  test("step 0: found by id under any spelling; the date fills with its year, a rerun fills nothing", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Michael Trout", { mlbamId: 545361 });
    const e = await epoch();
    const first = await players(t, e, [
      { key: "a", name: "Mike Trout", mlbamId: 545361, birthDate: "1991-08-07" },
    ]);
    expect(first.results[0]).toMatchObject({
      playerId: id,
      status: "adopted",
      matchedBy: "mlbamId",
      birthYearCheck: "mlbamId",
      filled: ["birthDate", "birthYear"],
    });
    expect(first.results[0].disagreements).toBeUndefined();
    expect(await player(t, id)).toMatchObject({ name: "Michael Trout", birthDate: "1991-08-07", birthYear: 1991 });

    const again = await players(t, e, [
      { key: "a", name: "Mike Trout", mlbamId: 545361, birthDate: "1991-08-07" },
    ]);
    expect(again.results[0]).toMatchObject({ playerId: id, status: "adopted", matchedBy: "mlbamId" });
    expect(again.results[0].filled).toBeUndefined();
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("the date is filled only when NB's year agrees; a dated row's different date is reported", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const agrees = await seedPlayer(t, sportId, "Ada One", { birthYear: 1990, mlbamId: 1 });
    const differs = await seedPlayer(t, sportId, "Bo Two", { birthYear: 1990, birthDate: "1990-01-02", mlbamId: 2 });
    const year = await seedPlayer(t, sportId, "Cy Three", { birthYear: 1991, mlbamId: 3 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Ada One", mlbamId: 1, birthYear: 1990, birthDate: "1990-05-05" },
      { key: "b", name: "Bo Two", mlbamId: 2, birthYear: 1990, birthDate: "1990-03-03" },
      { key: "c", name: "Cy Three", mlbamId: 3, birthDate: "1990-09-09" },
    ]);
    expect(out.results[0]).toMatchObject({ status: "adopted", filled: ["birthDate"] });
    expect((await player(t, agrees))?.birthDate).toBe("1990-05-05");
    expect(out.results[1].disagreements).toEqual([
      { field: "birthDate", nb: "1990-01-02", mlb: "1990-03-03" },
    ]);
    expect((await player(t, differs))?.birthDate).toBe("1990-01-02");
    // Row dated by year only and the date disagrees with it: reported, nothing written.
    expect(out.results[2].disagreements).toEqual([
      { field: "birthDate", nb: "1991", mlb: "1990-09-09" },
    ]);
    expect((await player(t, year))?.birthDate).toBeUndefined();
    expect((await player(t, year))?.birthYear).toBe(1991);
  });

  test("a birth year that contradicts the id holds the row, nothing written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Ada One", { birthYear: 1990, mlbamId: 1 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Ada One", mlbamId: 1, birthYear: 1985, birthDate: "1985-01-01" },
    ]);
    expect(out.results[0]).toMatchObject({ playerId: null, status: "ambiguous" });
    expect(out.results[0].disagreements).toEqual([{ field: "birthYear", nb: "1990", mlb: "1985" }]);
    expect(await player(t, id)).toMatchObject({ birthYear: 1990 });
    expect((await player(t, id))?.birthDate).toBeUndefined();
  });

  test("an id held by another row, or by two, holds the row; a decision cannot take it", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const holder = await seedPlayer(t, sportId, "Mike Trout", { birthYear: 1991, mlbamId: 545361 });
    const namesake = await seedPlayer(t, sportId, "Michael Trout", { birthYear: 1991 });
    await seedPlayer(t, sportId, "Twin A", { mlbamId: 8 });
    await seedPlayer(t, sportId, "Twin B", { mlbamId: 8 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Michael Trout", mlbamId: 545361, birthYear: 1991, decision: { adopt: namesake } },
      { key: "b", name: "Anyone", mlbamId: 8 },
    ]);
    expect(out.results[0]).toMatchObject({ playerId: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0]).toMatchObject({ field: "mlbamId" });
    expect(out.results[0].candidates?.map((c) => c.id)).toEqual([namesake, holder]);
    expect(out.results[1]).toMatchObject({ playerId: null, status: "ambiguous" });
    expect(out.results[1].disagreements?.[0].field).toBe("mlbamId");
    expect((await player(t, namesake))?.externalIds).toBeUndefined();
    expect(await allPlayers(t)).toHaveLength(4);
  });

  test("the player the name found already carries another id: held, never relinked", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Will Smith", { birthYear: 1995, mlbamId: 669257 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Will Smith", mlbamId: 656970, birthYear: 1995 },
    ]);
    expect(out.results[0]).toMatchObject({ playerId: null, status: "ambiguous" });
    expect(out.results[0].disagreements).toEqual([
      { field: "mlbamId", nb: "669257", mlb: "656970" },
    ]);
    expect((await player(t, id))?.externalIds?.mlbamId).toBe(669257);
  });

  test("the adopt-only driver path: a held undated row links on its {adopt} answer, id and date with year", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Juan Soto");
    const e = await epoch();
    const row: PlayerIn = { key: "a", name: "Juan Soto", mlbamId: 665742, birthYear: 1998, birthDate: "1998-10-25" };
    const prev = await previewPlayers(t, e, [row]);
    expect(prev.results[0]).toMatchObject({ status: "held", birthYearCheck: "candidate-undated" });

    const done = await players(t, e, [{ ...row, decision: { adopt: id } }]);
    expect(done.results[0]).toMatchObject({
      playerId: id,
      status: "adopted",
      matchedBy: "decision",
      filled: ["mlbamId", "birthDate", "birthYear"],
    });
    expect(await player(t, id)).toMatchObject({
      birthYear: 1998,
      birthDate: "1998-10-25",
      externalIds: { mlbamId: 665742 },
    });
    // Next run converges with no answer.
    const again = await players(t, e, [row]);
    expect(again.results[0]).toMatchObject({ playerId: id, matchedBy: "mlbamId" });
    expect(again.results[0].filled).toBeUndefined();
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("a decision adopt that contradicts the birth year holds the row instead of failing the chunk", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await seedPlayer(t, sportId, "Juan Soto", { birthYear: 1980 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Juan Soto", mlbamId: 665742, birthYear: 1998, decision: { adopt: id } },
    ]);
    expect(out.results[0]).toMatchObject({ playerId: null, status: "ambiguous" });
    expect(out.results[0].disagreements).toEqual([{ field: "birthYear", nb: "1980", mlb: "1998" }]);
    expect((await player(t, id))?.externalIds).toBeUndefined();
  });

  test("a close-name player with the same or no birth year is a probable duplicate, not a create", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const near = await seedPlayer(t, sportId, "Patrick White", { birthYear: 1980 });
    const e = await epoch();
    const row: PlayerIn = { key: "a", name: "Pat White", mlbamId: 31, birthYear: 1980 };
    const held = await players(t, e, [row]);
    expect(held.results[0].status).toBe("ambiguous");
    expect(held.results[0].disagreements?.[0]).toMatchObject({ field: "name" });
    expect(held.results[0].candidates?.map((c) => c.id)).toEqual([near]);
    expect(await allPlayers(t)).toHaveLength(1);
    const made = await players(t, e, [{ ...row, decision: { create: true } }]);
    expect(made.results[0].status).toBe("created");
    expect(await allPlayers(t)).toHaveLength(2);

    // A different birth year on the neighbour is not a probable duplicate.
    const e2 = await epoch();
    const other = await players(t, e2, [
      { key: "b", name: "Pat White", mlbamId: 32, birthYear: 1975 },
    ]);
    expect(other.results[0].status).toBe("created");
  });

  test("a create-decision cannot mint a second holder of an id", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const holder = await seedPlayer(t, sportId, "Mike Trout", { mlbamId: 545361 });
    const out = await players(t, await epoch(), [
      { key: "a", name: "Somebody Else", mlbamId: 545361, decision: { create: true } },
    ]);
    expect(out.results[0]).toMatchObject({ playerId: null, status: "ambiguous" });
    expect(out.results[0].candidates?.map((c) => c.id)).toEqual([holder]);
    expect(await allPlayers(t)).toHaveLength(1);
  });

  test("no scheduled work from any leg", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedLeague(t, sportId, "Texas League", { level: "minor" });
    await leagues(t, [{ name: "New League", level: "minor", mlbamId: 9 }]);
    await teams(t, [{ key: "k", name: "Hooks", league: "Texas League", mlbamId: 640 }]);
    await players(t, await epoch(), [{ key: "a", name: "Shohei Ohtani", mlbamId: 660271 }]);
    expect(await scheduled(t)).toEqual([]);
  });
});

describe("stintAlreadyPresent keys on the role", () => {
  const teamId = "teams:1" as Id<"teams">;
  test("a manager stint is not a playing stint on the same team", () => {
    expect(
      stintAlreadyPresent([{ teamId, fromYear: 2000, toYear: 2005 }], {
        teamId,
        fromYear: 2000,
        toYear: 2005,
        role: "manager",
      }),
    ).toBe(false);
    expect(
      stintAlreadyPresent([{ teamId, fromYear: 2000, toYear: 2005, role: "manager" }], {
        teamId,
        fromYear: 2003,
        role: "manager",
      }),
    ).toBe(true);
    expect(stintAlreadyPresent([{ teamId, fromYear: 2000 }], { teamId, fromYear: 2001 })).toBe(true);
  });
});
