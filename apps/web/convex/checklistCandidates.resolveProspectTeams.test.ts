/**
 * NEO-591 — `checklistCandidates.resolveProspectTeams`: the fetch's settling of
 * a "Prospect (X)" cell. X is settled only when exactly one MINOR or COLLEGE
 * team answers to it and the commit's own lookup on that team's full name
 * lands on the same row; everything else is held. Held is the safe answer
 * (product invariant 8): an X is never turned into an MLB team, a guess, or a
 * team string the commit would resolve elsewhere.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  MAX_PROSPECT_TEAMS_PER_QUERY,
  PROSPECT_TEAM_SEARCH_HITS,
} from "./checklistCandidates";
import { teamRowFields } from "./lib/teamRow";
import { normalizeEntityName } from "./lib/entityNearMatch";
import { MAX_PLAYER_NAME_LENGTH } from "../lib/players/name-limits";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type Level = "major" | "minor" | "college" | "international" | "independent" | "other";
const NOW = 1_700_000_000_000;

type World = {
  leafId: Id<"selectorOptions">;
  sportId: Id<"selectorOptions">;
  leagues: Record<Level, Id<"leagues">>;
};

/** Baseball -> 2026 -> a leaf, and one league of every level. */
async function seedWorld(t: T, year = "2026"): Promise<World> {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: year,
      parentId: sportId,
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      parentId: yearId,
      platformData: {},
      children: [],
      lastUpdated: NOW,
    });
    const league = async (name: string, level: Level) =>
      ctx.db.insert("leagues", {
        name,
        nameNormalized: name.toLowerCase(),
        sportId,
        level,
        lastUpdated: NOW,
      });
    return {
      leafId,
      sportId,
      leagues: {
        major: await league("Major League Baseball", "major"),
        minor: await league("Triple-A", "minor"),
        college: await league("NCAA Division I", "college"),
        international: await league("World Baseball Classic", "international"),
        independent: await league("Frontier League", "independent"),
        other: await league("Exhibition", "other"),
      },
    };
  });
}

async function addTeam(
  t: T,
  world: World,
  opts: {
    name: string;
    location?: string;
    level?: Level | null;
    aliases?: string[];
    yearsActive?: { from: number; to?: number };
    sportId?: Id<"selectorOptions">;
  },
): Promise<Id<"teams">> {
  const sportId = opts.sportId ?? world.sportId;
  return t.run(async (ctx) => {
    const fields = teamRowFields({ name: opts.name, location: opts.location });
    const id = await ctx.db.insert("teams", {
      ...fields,
      sportId,
      ...(opts.level ? { leagueId: world.leagues[opts.level] } : {}),
      ...(opts.aliases?.length ? { aliases: opts.aliases } : {}),
      ...(opts.yearsActive ? { yearsActive: opts.yearsActive } : {}),
      lastUpdated: NOW,
    });
    for (const alias of opts.aliases ?? []) {
      await ctx.db.insert("teamAliases", { teamId: id, sportId, aliasNormalized: normalizeEntityName(alias) });
    }
    return id;
  });
}

const held = { kind: "held" } as const;
const settled = (name: string) => ({ kind: "team", name }) as const;

async function resolve(t: T, world: World, texts: string[]) {
  return t.query(internal.checklistCandidates.resolveProspectTeams, {
    selectorOptionId: world.leafId,
    texts,
  });
}

describe("resolveProspectTeams — settled", () => {
  test("a college team found by its place: Prospect (Oklahoma) is the Oklahoma Sooners", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    expect(await resolve(t, world, ["Oklahoma"])).toEqual([settled("Oklahoma Sooners")]);
  });

  test("a minor-league team found by its place", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "RoughRiders", location: "Frisco", level: "minor" });
    expect(await resolve(t, world, ["Frisco"])).toEqual([settled("Frisco RoughRiders")]);
  });

  test("a team found by its full name", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "RoughRiders", location: "Frisco", level: "minor" });
    expect(await resolve(t, world, ["Frisco RoughRiders"])).toEqual([settled("Frisco RoughRiders")]);
  });

  test("a team found by an alias the operator taught (LSU)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Tigers", location: "Louisiana State", level: "college", aliases: ["LSU"] });
    expect(await resolve(t, world, ["LSU"])).toEqual([settled("Louisiana State Tigers")]);
  });

  test("a multi-word place (Dallas Baptist)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Patriots", location: "Dallas Baptist", level: "college" });
    expect(await resolve(t, world, ["Dallas Baptist"])).toEqual([settled("Dallas Baptist Patriots")]);
  });

  test("the place folds for case and spacing", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    expect(await resolve(t, world, ["  OKLAHOMA "])).toEqual([settled("Oklahoma Sooners")]);
  });

  test("a MLB club sharing the place does not stand in the way: only the college team qualifies", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Diamondbacks", location: "Arizona", level: "major" });
    await addTeam(t, world, { name: "Wildcats", location: "Arizona", level: "college" });
    expect(await resolve(t, world, ["Arizona"])).toEqual([settled("Arizona Wildcats")]);
  });

  test("a lone team whose era ended before the set year is still the team (a card may show a team's past)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Avalanche", location: "Salem", level: "minor", yearsActive: { from: 1980, to: 1990 } });
    expect(await resolve(t, world, ["Salem"])).toEqual([settled("Salem Avalanche")]);
  });

  test("two eras of one college place are told apart by the set year", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t, "1985");
    await addTeam(t, world, { name: "Aggies", location: "Mesa", level: "college", yearsActive: { from: 1950, to: 1990 } });
    await addTeam(t, world, { name: "Wolves", location: "Mesa", level: "college", yearsActive: { from: 1991 } });
    expect(await resolve(t, world, ["Mesa"])).toEqual([settled("Mesa Aggies")]);
  });

  test("answers each text in order, mixing settled and held", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    expect(await resolve(t, world, ["Nowhere", "Oklahoma", "Nowhere"])).toEqual([
      held,
      settled("Oklahoma Sooners"),
      held,
    ]);
  });
});

describe("resolveProspectTeams — held, never a guess", () => {
  test("held when only an MLB club answers to X (an MLB team never takes a Prospect (X))", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Diamondbacks", location: "Arizona", level: "major", aliases: ["Arizona"] });
    expect(await resolve(t, world, ["Arizona"])).toEqual([held]);
  });

  test("held when X is an MLB club's own full name", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Yankees", location: "New York", level: "major" });
    expect(await resolve(t, world, ["New York Yankees", "New York"])).toEqual([held, held]);
  });

  test("held when two college teams answer to the place", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    await addTeam(t, world, { name: "Bison", location: "Oklahoma", level: "college" });
    expect(await resolve(t, world, ["Oklahoma"])).toEqual([held]);
  });

  test("held when a minor and a college team share the place", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Jayhawks", location: "Kansas", level: "college" });
    await addTeam(t, world, { name: "T-Bones", location: "Kansas", level: "minor" });
    expect(await resolve(t, world, ["Kansas"])).toEqual([held]);
  });

  test("held when the only team has no league", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Ghosts", location: "Orlando", level: null });
    expect(await resolve(t, world, ["Orlando"])).toEqual([held]);
  });

  test.each(["independent", "other", "international"] as const)(
    "held when the only team is in a %s league",
    async (level) => {
      const t = convexTest(schema, modules);
      const world = await seedWorld(t);
      await addTeam(t, world, { name: "Slammers", location: "Joliet", level });
      expect(await resolve(t, world, ["Joliet"])).toEqual([held]);
    },
  );

  test("held when no team answers to X at all", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    expect(await resolve(t, world, ["Texas"])).toEqual([held]);
  });

  test("held when X is only part of a team's place (Oklahoma is not Oklahoma State)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Cowboys", location: "Oklahoma State", level: "college" });
    expect(await resolve(t, world, ["Oklahoma"])).toEqual([held]);
  });

  test("held when the team belongs to another sport", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const otherSport = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", { level: "sport", value: "Football", platformData: {}, children: [], lastUpdated: NOW }),
    );
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college", sportId: otherSport });
    expect(await resolve(t, world, ["Oklahoma"])).toEqual([held]);
  });

  test("held when the one team's era had not begun at the set year (a card never shows a team's future)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Later", location: "Plano", level: "college", yearsActive: { from: 2030 } });
    expect(await resolve(t, world, ["Plano"])).toEqual([held]);
  });

  test("held when the set year cannot separate two dated eras", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Aggies", location: "Mesa", level: "college", yearsActive: { from: 1950, to: 1960 } });
    await addTeam(t, world, { name: "Wolves", location: "Mesa", level: "college", yearsActive: { from: 1970, to: 1980 } });
    expect(await resolve(t, world, ["Mesa"])).toEqual([held]);
  });

  test("held when the commit's own lookup on the team's full name would not land on the same row", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    // The college team is the only one that qualifies for X ...
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "college" });
    // ... but an MLB row answers to the very same full name, so the commit cannot tell them apart.
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "major" });
    expect(await resolve(t, world, ["Houston"])).toEqual([held]);
  });

  test("held when another team holds the college team's full name as an alias", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "college" });
    await addTeam(t, world, { name: "Astros", location: "Houston", level: "major", aliases: ["Houston Cougars"] });
    expect(await resolve(t, world, ["Houston"])).toEqual([held]);
  });

  test("held for blank X and for X over a name's length", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    expect(await resolve(t, world, ["", "   ", "x".repeat(MAX_PLAYER_NAME_LENGTH + 1)])).toEqual([held, held, held]);
  });

  test("answers held for every text when the card's set has no sport above it", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    const orphan = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", { level: "variantType", value: "Base", platformData: {}, children: [], lastUpdated: NOW }),
    );
    const out = await t.query(internal.checklistCandidates.resolveProspectTeams, {
      selectorOptionId: orphan,
      texts: ["Oklahoma", "Oklahoma"],
    });
    expect(out).toEqual([held, held]);
  });

  test("holds every text past the per-call cap, even one that would settle", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    const texts = Array.from({ length: MAX_PROSPECT_TEAMS_PER_QUERY + 2 }, () => "Oklahoma");
    const out = await resolve(t, world, texts);
    expect(out).toHaveLength(MAX_PROSPECT_TEAMS_PER_QUERY + 2);
    expect(out.slice(0, MAX_PROSPECT_TEAMS_PER_QUERY).every((r) => r.kind === "team")).toBe(true);
    expect(out.slice(MAX_PROSPECT_TEAMS_PER_QUERY)).toEqual([held, held]);
  });

  test("never turns a held X into a team string: no answer names a row of the wrong level", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const mlb = await addTeam(t, world, { name: "Diamondbacks", location: "Arizona", level: "major", aliases: ["Arizona", "AZ"] });
    const answers = await resolve(t, world, ["Arizona", "AZ", "Arizona Diamondbacks", "Diamondbacks"]);
    expect(answers).toEqual([held, held, held, held]);
    expect(mlb).toBeDefined();
  });
});

describe("resolveProspectTeams — an X cannot be steered onto the wrong level", () => {
  test("held when the team's league row is gone (its level cannot be shown to be minor or college)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const id = await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    await t.run(async (ctx) => {
      const team = await ctx.db.get(id);
      await ctx.db.delete(team!.leagueId!);
    });
    expect(await resolve(t, world, ["Oklahoma"])).toEqual([held]);
  });

  test("held when an MLB club's alias is the X and a minor team shares only the place", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    // X = "Arizona" is the D-backs' alias (a full-name hit on a MAJOR row) ...
    await addTeam(t, world, { name: "Diamondbacks", location: "Phoenix", level: "major", aliases: ["Arizona"] });
    // ... and a minor team that merely has Arizona as its place is the one qualifying row.
    await addTeam(t, world, { name: "Hot Shots", location: "Arizona", level: "minor" });
    // Exactly one qualifying team, and its own full name resolves back to it: settled to the MINOR team, never the MLB club.
    expect(await resolve(t, world, ["Arizona"])).toEqual([settled("Arizona Hot Shots")]);
  });

  test("an X naming an MLB club's full name is held even when a college team shares its nickname", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Wildcats", location: "Kentucky", level: "college" });
    await addTeam(t, world, { name: "Wildcats", location: "Arizona", level: "major" });
    expect(await resolve(t, world, ["Arizona Wildcats"])).toEqual([held]);
  });

  test("search-syntax and stop-word text never errors and never reaches another team", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Sooners", location: "Oklahoma", level: "college" });
    await addTeam(t, world, { name: "Diamondbacks", location: "Texas", level: "major" });
    // Punctuation folds away like any team name ("Oklahoma*" is Oklahoma); an operator or a
    // phrase never widens the read to another place, and an MLB place stays held.
    expect(await resolve(t, world, ["Oklahoma*", "\"Oklahoma\" OR Texas", "the of and", "()", "%", "Texas"])).toEqual([
      settled("Oklahoma Sooners"),
      held,
      held,
      held,
      held,
      held,
    ]);
  });
});

describe("resolveProspectTeams — the place search is bounded", () => {
  test("a place held by more teams than the search reads still answers (held), never throws", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    for (let i = 0; i < PROSPECT_TEAM_SEARCH_HITS + 4; i++) {
      await addTeam(t, world, { name: `Club ${i}`, location: "Crowded", level: "college" });
    }
    expect(await resolve(t, world, ["Crowded"])).toEqual([held]);
  });
});
