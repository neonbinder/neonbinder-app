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
import { MAX_MINOR_LEAGUE_CLASSES } from "./lib/leagueClass";
import { TEAM_ERA_SCAN_LIMIT } from "./lib/teamRow";

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
  abbreviation?: string;
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
    // Found by its id (a name match at another level is held, see the NEO-676
    // name-match tests), so the link proceeds with the disagreements reported.
    const id = await seedLeague(t, sportId, "Texas League", {
      level: "minor",
      aliases: ["TL"],
      mlbamId: 104,
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
    expect({ ...after, lastUpdated: 0 }).toEqual({ ...before, lastUpdated: 0 });
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

describe("leagues: found by id stays found by id", () => {
  test("two same-named leagues: the id holder takes the gap-fills, the other is untouched", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    // Inserted first, so a name lookup would return it.
    const decoy = await seedLeague(t, sportId, "Pacific Coast League", { level: "minor" });
    const holder = await seedLeague(t, sportId, "Pacific Coast League", { level: "minor", mlbamId: 112 });
    const decoyBefore = await league(t, decoy);
    const out = await leagues(t, [
      {
        name: "Pacific Coast League",
        abbreviation: "PCL",
        level: "minor",
        mlbamId: 112,
        aliases: ["Coast"],
        yearsActive: { from: 1903 },
      },
    ]);
    expect(out.results[0].id).toBe(holder);
    const held = await league(t, holder);
    expect(held?.abbreviation).toBe("PCL");
    expect(held?.yearsActive).toEqual({ from: 1903 });
    expect(held?.aliases).toEqual(["Coast"]);
    expect(await league(t, decoy)).toEqual(decoyBefore);
    expect(await allLeagues(t)).toHaveLength(2);
  });

  test("a league NB holds at another level is a field conflict: reported, nothing written, id still fills", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    // Found by id, so the level difference is a field conflict, not a hold.
    const id = await seedLeague(t, sportId, "Texas League", { level: "minor", mlbamId: 104 });
    const out = await leagues(t, [{ name: "Texas League", level: "major", mlbamId: 104 }]);
    expect(out.results[0].id).toBe(id);
    expect(out.results[0].disagreements).toEqual([{ field: "level", nb: "minor", mlb: "major" }]);
    const after = await league(t, id);
    expect(after?.level).toBe("minor");
    expect(after?.externalIds).toEqual({ mlbamId: 104 });
  });

  test("MLB seasons outside the league's span are reported; NB's years are not widened", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const id = await t.run(async (ctx) =>
      ctx.db.insert("leagues", {
        name: "Texas League",
        nameNormalized: "texas league",
        sportId,
        level: "minor",
        yearsActive: { from: 1990, to: 2000 },
        lastUpdated: 1_700_000_000_000,
      }),
    );
    const out = await leagues(t, [
      { name: "Texas League", level: "minor", mlbamId: 104, yearsActive: { from: 1985, to: 2005 } },
    ]);
    expect(out.results[0].disagreements).toEqual([
      { field: "yearsActive", nb: "1990-2000", mlb: "1985-2005" },
    ]);
    expect((await league(t, id))?.yearsActive).toEqual({ from: 1990, to: 2000 });
    // Inside the span: no disagreement.
    const again = await leagues(t, [
      { name: "Texas League", level: "minor", mlbamId: 104, yearsActive: { from: 1991, to: 1999 } },
    ]);
    expect(again.results[0].disagreements).toBeUndefined();
  });

  test("a call that sends one MLB id twice is refused, preview and write, naming both rows", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const rows: LeagueIn[] = [
      { name: "League A", level: "minor", mlbamId: 200 },
      { name: "League B", level: "minor", mlbamId: 200 },
    ];
    await expect(leagues(t, rows)).rejects.toThrow(/League A.*League B/);
    await expect(leagues(t, rows, true)).rejects.toThrow(/League A.*League B/);
    expect(await allLeagues(t)).toEqual([]);
  });

  test("more league classes than the cap is refused naming the row", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const classes = Array.from({ length: MAX_MINOR_LEAGUE_CLASSES + 1 }, (_, i) => ({
      class: "aaa" as const,
      fromYear: 1900 + i,
      toYear: 1900 + i,
    }));
    await expect(
      leagues(t, [{ name: "Big League", level: "minor", mlbamId: 9, minorLeagueClasses: classes }]),
    ).rejects.toThrow(/Big League.*limit is 64/);
    // At the cap it is accepted.
    const out = await leagues(t, [
      { name: "Big League", level: "minor", mlbamId: 9, minorLeagueClasses: classes.slice(0, MAX_MINOR_LEAGUE_CLASSES) },
    ]);
    expect(out.results[0].created).toBe(true);
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

  // The id is read before the decision replay, so an {adopt} onto a bare row
  // cannot write an id another era row already holds for overlapping seasons.
  test("a decision adopt of an id onto a row whose seasons overlap another holder of that id does not mint a second holder", async () => {
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

  test("a replayed adopt onto the row the id already places lands", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const holder = await seedTeam(t, sportId, {
      location: "Los Angeles", name: "Dodgers", years: { from: 1958 }, mlbamId: 119,
    });
    const out = await teams(t, [
      { key: "k", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1958 }, mlbamId: 119, decision: { adopt: holder } },
    ]);
    expect(out.results[0]).toMatchObject({ id: holder, status: "adopted" });
  });

  test("a replayed adopt while two era rows hold the id for those seasons is held", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedTeam(t, sportId, { location: "Brooklyn", name: "Dodgers", years: { from: 1901, to: 1957 }, mlbamId: 119 });
    await seedTeam(t, sportId, { location: "Los Angeles", name: "Dodgers", years: { from: 1958 }, mlbamId: 119 });
    const bare = await seedTeam(t, sportId, { location: "Los Angeles", name: "Dodgers" });
    const before = await snap(t);
    const out = await teams(t, [
      { key: "k", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1950, to: 1970 }, mlbamId: 119, decision: { adopt: bare } },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
    expect(await snap(t)).toEqual(before);
  });

  test("a replayed {create:true} onto a season an id already places is held, nothing written", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    const holder = await seedTeam(t, sportId, {
      location: "Los Angeles", name: "Dodgers", years: { from: 1958 }, mlbamId: 119,
    });
    const before = await snap(t);
    const out = await teams(t, [
      { key: "k", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1958 }, mlbamId: 119, decision: { create: true } },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].candidates?.map((c) => c.id)).toEqual([holder]);
    expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
    expect(await snap(t)).toEqual(before);
  });

  test("a replayed {create:true} for an era the id does not place still lands", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    await seedTeam(t, sportId, { location: "Los Angeles", name: "Dodgers", years: { from: 1958 }, mlbamId: 119 });
    const out = await teams(t, [
      { key: "k", location: "Brooklyn", name: "Dodgers", yearsActive: { from: 1901, to: 1957 }, mlbamId: 119, decision: { create: true } },
    ]);
    expect(out.results[0]).toMatchObject({ status: "created" });
    expect((await allTeams(t)).filter((x) => x.externalIds?.mlbamId === 119)).toHaveLength(2);
  });

  test("an id scan that comes back full is a tie: held, never a pick over a window", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    // Sixteen single-season rows hold one id; the seventeenth season would
    // overlap none of the rows read, so a pick over the window would create.
    for (let i = 0; i < TEAM_ERA_SCAN_LIMIT; i++) {
      await seedTeam(t, sportId, {
        location: `Town ${i}`, name: "Club", years: { from: 1900 + i, to: 1900 + i }, mlbamId: 700,
      });
    }
    const before = await snap(t);
    const out = await teams(t, [
      { key: "k", location: "Newtown", name: "Club", yearsActive: { from: 2020 }, mlbamId: 700 },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
    expect(await snap(t)).toEqual(before);
    // One row fewer and the scan is not full: the same row now creates.
    const t2 = convexTest(schema, modules);
    const sport2 = await seedSport(t2);
    for (let i = 0; i < TEAM_ERA_SCAN_LIMIT - 1; i++) {
      await seedTeam(t2, sport2, {
        location: `Town ${i}`, name: "Club", years: { from: 1900 + i, to: 1900 + i }, mlbamId: 700,
      });
    }
    const ok = await teams(t2, [
      { key: "k", location: "Newtown", name: "Club", yearsActive: { from: 2020 }, mlbamId: 700 },
    ]);
    expect(ok.results[0].status).toBe("created");
  });

  test("seasons straddling two eras of one id that both answer to the name are a tie: held, neither row touched", async () => {
    const t = convexTest(schema, modules);
    armed();
    const sportId = await seedSport(t);
    // Two era rows of one name (NB keeps the Jets twice): the name cannot pick.
    await seedTeam(t, sportId, { location: "Los Angeles", name: "Dodgers", years: { from: 1958, to: 1969 }, mlbamId: 119 });
    await seedTeam(t, sportId, { location: "Los Angeles", name: "Dodgers", years: { from: 1965 }, mlbamId: 119 });
    const before = await snap(t);
    const out = await teams(t, [
      { key: "k", location: "Los Angeles", name: "Dodgers", yearsActive: { from: 1960, to: 1970 }, mlbamId: 119 },
    ]);
    expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
    expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
    expect(await snap(t)).toEqual(before);
  });

  describe("one id returning to an earlier name (Angels, id 108)", () => {
    async function angels(t: T) {
      const sportId = await seedSport(t);
      const california = await seedTeam(t, sportId, {
        location: "California", name: "Angels", years: { from: 1965, to: 1996 }, mlbamId: 108,
        // Lets a decision for the LA row name this row without the "different team" refusal.
        aliases: ["Los Angeles Angels"],
      });
      const anaheim = await seedTeam(t, sportId, {
        location: "Anaheim", name: "Angels", years: { from: 1997, to: 2004 }, mlbamId: 108,
      });
      const la = await seedTeam(t, sportId, {
        location: "Los Angeles", name: "Angels", years: { from: 1961 }, mlbamId: 108,
      });
      return { california, anaheim, la };
    }

    test("a California Angels row adopts California", async () => {
      const t = convexTest(schema, modules);
      armed();
      const { california } = await angels(t);
      const out = await teams(t, [
        { key: "k", location: "California", name: "Angels", yearsActive: { from: 1965, to: 1996 }, mlbamId: 108 },
      ]);
      expect(out.results[0]).toMatchObject({ id: california, status: "adopted", matchedBy: "mlbamId" });
    });

    test("a Los Angeles Angels row adopts LA, though its years overlap all three", async () => {
      const t = convexTest(schema, modules);
      armed();
      const { la } = await angels(t);
      const out = await teams(t, [
        { key: "k", location: "Los Angeles", name: "Angels", yearsActive: { from: 1961 }, mlbamId: 108 },
      ]);
      expect(out.results[0]).toMatchObject({ id: la, status: "adopted", matchedBy: "mlbamId" });
    });

    test("a decision adopt of California for the LA row is held, nothing written", async () => {
      const t = convexTest(schema, modules);
      armed();
      const { california } = await angels(t);
      const before = await snap(t);
      const out = await teams(t, [
        {
          key: "k", location: "Los Angeles", name: "Angels", yearsActive: { from: 1961 }, mlbamId: 108,
          decision: { adopt: california },
        },
      ]);
      expect(out.results[0]).toMatchObject({ id: null, status: "ambiguous" });
      expect(out.results[0].disagreements?.[0].field).toBe("mlbamId");
      expect(await snap(t)).toEqual(before);
    });

    test("a row whose name matches none of the overlapping eras creates its own era row with the id; the holders are untouched", async () => {
      const t = convexTest(schema, modules);
      armed();
      await angels(t);
      const before = await snap(t);
      const out = await teams(t, [
        { key: "k", location: "Orange County", name: "Angels", yearsActive: { from: 1961 }, mlbamId: 108 },
      ]);
      expect(out.results[0].status).toBe("created");
      const rows = await allTeams(t);
      expect(rows).toHaveLength(4);
      expect(rows.find((r) => r._id === out.results[0].id)?.externalIds?.mlbamId).toBe(108);
      expect(rows.filter((r) => r._id !== out.results[0].id)).toEqual(before.teams);
    });
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

  test("a call that sends one MLB id twice is refused, preview and write, naming both keys", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const e = await epoch();
    const rows: PlayerIn[] = [
      { key: "a", name: "Shohei Ohtani", mlbamId: 660271 },
      { key: "b", name: "Shohei Ohtani", mlbamId: 660271 },
    ];
    await expect(players(t, e, rows)).rejects.toThrow(/"a".*"b"/);
    await expect(previewPlayers(t, e, rows)).rejects.toThrow(/"a".*"b"/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("the same id in two calls lands on one player", async () => {
    const t = convexTest(schema, modules);
    armed();
    await seedSport(t);
    const e = await epoch();
    await players(t, e, [{ key: "a", name: "Shohei Ohtani", mlbamId: 660271 }]);
    await players(t, e, [{ key: "b", name: "Shohei Ohtani", mlbamId: 660271 }]);
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
