/**
 * NEO-591 (collector review) — `resolveChecklistPlaceTeams` and the batching
 * wrapper `resolveChecklistPlaceTexts`, plus `resolveTeamIdentities` and its
 * wrapper `resolveChecklistTeamIdentities`.
 *
 * Onyx prints teams as places ("Seattle"). A place settles to a team only when
 * exactly one team in the set's league(s), across ALL its eras, has that
 * location and the commit's own lookup lands on the same row; everything else
 * is left as printed (rule 8: nothing picks the first candidate, and the set
 * year never chooses between a place's eras, Jason 2026-11-20; the card's
 * players decide at the gate and the commit, else the operator).
 */

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import {
  MAX_TEAM_IDENTITY_TEXTS,
  MAX_PLACE_TEXTS_PER_QUERY,
  PLACE_TEAM_SEARCH_HITS,
} from "./checklistCandidates";
import {
  MAX_PLACE_TEAM_TEXTS,
  resolveChecklistPlaceSets,
  resolveChecklistPlaceTexts,
  resolveChecklistTeamIdentities,
} from "./selectorOptions";
import { TEAM_ERA_SCAN_LIMIT, teamRowFields } from "./lib/teamRow";
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

/** Baseball -> year -> a leaf, and one league of every level. */
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

/** The set's league(s), the way a set carries them (read by `effectiveSetLeagueIds`). */
async function inLeague(t: T, world: World, level: Level) {
  await t.run((ctx) => ctx.db.patch(world.leafId, { leagueIds: [world.leagues[level]] }));
}

async function resolvePlaces(t: T, world: World, texts: string[]) {
  return t.query(internal.checklistCandidates.resolveChecklistPlaceTeams, {
    selectorOptionId: world.leafId,
    texts,
  });
}

describe("resolveChecklistPlaceTeams — a team printed as a place", () => {
  test("Seattle in an MLB set is the Mariners; the other leagues' Seattle teams do not count", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    await addTeam(t, world, { name: "Kraken", location: "Seattle", level: "other" });
    await addTeam(t, world, { name: "Redhawks", location: "Seattle", level: "college" });
    expect(await resolvePlaces(t, world, ["Seattle"])).toEqual(["Seattle Mariners"]);
  });

  test("two teams in the set's league share the place: left as printed (nothing picks the first)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Yankees", location: "New York", level: "major" });
    await addTeam(t, world, { name: "Mets", location: "New York", level: "major" });
    expect(await resolvePlaces(t, world, ["New York", "New York (A)"])).toEqual([null, null]);
  });

  test("a set with no league skips the location leg entirely", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    expect(await resolvePlaces(t, world, ["Seattle"])).toEqual([null]);
  });

  test("a set league the place's team is not in settles nothing", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "college");
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    expect(await resolvePlaces(t, world, ["Seattle"])).toEqual([null]);
  });

  test("a text some team already answers to by name or alias is left alone", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major", aliases: ["Seattle"] });
    await addTeam(t, world, { name: "Rays", location: "Tampa Bay", level: "major" });
    expect(await resolvePlaces(t, world, ["Seattle", "Tampa Bay Rays"])).toEqual([null, null]);
  });

  test("several eras at one place are left as printed: the set year does not pick the Mariners over the Pilots", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t, "2001");
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Pilots", location: "Seattle", level: "major", yearsActive: { from: 1969, to: 1969 } });
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major", yearsActive: { from: 1977 } });
    expect(await resolvePlaces(t, world, ["Seattle"])).toEqual([null]);
  });

  test("a lone place team of another era than the set's still settles: a card can show a team's past, never its future", async () => {
    // Only the past era exists in the league: it is the one team at the place.
    const past = convexTest(schema, modules);
    const w2 = await seedWorld(past, "2001");
    await inLeague(past, w2, "major");
    await addTeam(past, w2, { name: "Pilots", location: "Seattle", level: "major", yearsActive: { from: 1969, to: 1969 } });
    expect(await resolvePlaces(past, w2, ["Seattle"])).toEqual(["Seattle Pilots"]);

    // A lone team that had not begun by the set year settles nothing.
    const future = convexTest(schema, modules);
    const w3 = await seedWorld(future, "1960");
    await inLeague(future, w3, "major");
    await addTeam(future, w3, { name: "Mariners", location: "Seattle", level: "major", yearsActive: { from: 1977 } });
    expect(await resolvePlaces(future, w3, ["Seattle"])).toEqual([null]);
  });

  test("an other-league team of another era does not make the place ambiguous", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t, "2001");
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major", yearsActive: { from: 1977 } });
    await addTeam(t, world, { name: "Rainiers", location: "Seattle", level: "minor", yearsActive: { from: 1955, to: 1969 } });
    expect(await resolvePlaces(t, world, ["Seattle"])).toEqual(["Seattle Mariners"]);
  });

  test("left as printed when the commit's own lookup on the team's full name would not land on it", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "major" });
    // Another league's row answers to the very same full name.
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "college" });
    expect(await resolvePlaces(t, world, ["Houston"])).toEqual([null]);
  });

  test("left as printed when the search window is full (a second team may be past it)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Sooners", location: "Crowded", level: "major" });
    for (let i = 0; i < PLACE_TEAM_SEARCH_HITS - 1; i++) {
      await addTeam(t, world, { name: `Club ${i}`, location: "Crowded", level: "college" });
    }
    await addTeam(t, world, {
      name: "Some Very Long Nickname With Many Additional Words In It Here",
      location: "Crowded",
      level: "major",
    });
    expect(await resolvePlaces(t, world, ["Crowded"])).toEqual([null]);
  });

  test("a text with a comma, a blank and an over-long text are left alone; texts past the per-call cap too", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    const out = await resolvePlaces(t, world, [
      "Seattle, Washington",
      "  ",
      "x".repeat(MAX_PLAYER_NAME_LENGTH + 1),
      ...Array.from({ length: MAX_PLACE_TEXTS_PER_QUERY - 3 }, () => "Seattle"),
      "Seattle",
    ]);
    expect(out).toHaveLength(MAX_PLACE_TEXTS_PER_QUERY + 1);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]).toBe("Seattle Mariners");
    expect(out[MAX_PLACE_TEXTS_PER_QUERY - 1]).toBe("Seattle Mariners");
    expect(out.at(-1)).toBeNull();
  });

  test("a comma text and an over-long text are not read as places even when a team's location is that very text", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    const longPlace = "Lake " + "Wobegon ".repeat(Math.ceil(MAX_PLAYER_NAME_LENGTH / 8));
    await addTeam(t, world, { name: "Loons", location: "Seattle, WA", level: "major" });
    await addTeam(t, world, { name: "Pike", location: longPlace.trim(), level: "major" });
    expect(longPlace.trim().length).toBeGreaterThan(MAX_PLAYER_NAME_LENGTH);
    expect(await resolvePlaces(t, world, ["Seattle, WA", longPlace.trim()])).toEqual([null, null]);
  });

  test("a team of another sport is never offered", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", { level: "sport", value: "Football", platformData: {}, children: [], lastUpdated: NOW }),
    );
    await addTeam(t, world, { name: "Seahawks", location: "Seattle", level: "major", sportId: football });
    expect(await resolvePlaces(t, world, ["Seattle"])).toEqual([null]);
  });
});

async function resolvePlaceIds(t: T, world: World, texts: string[]) {
  return t.query(internal.checklistCandidates.resolveChecklistPlaceTeamIds, {
    selectorOptionId: world.leafId,
    texts,
  });
}

// Jason, 2026-11-20 — the places `resolveChecklistPlaceTeams` leaves as printed
// still say which teams they could mean, so a marketplace team among them
// agrees with the checklist.
describe("resolveChecklistPlaceTeamIds — every in-league team a printed place could mean", () => {
  test("several eras at one place: all of them, the set year choosing none; other leagues' teams excluded", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t, "2001");
    await inLeague(t, world, "major");
    const pilots = await addTeam(t, world, { name: "Pilots", location: "Seattle", level: "major", yearsActive: { from: 1969, to: 1969 } });
    const mariners = await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major", yearsActive: { from: 1977 } });
    await addTeam(t, world, { name: "Kraken", location: "Seattle", level: "other" });
    const [ids] = await resolvePlaceIds(t, world, ["Seattle"]);
    expect([...(ids ?? [])].sort()).toEqual([pilots, mariners].sort());
  });

  test("a lone team answers as a set of one", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    const mariners = await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    expect(await resolvePlaceIds(t, world, ["Seattle"])).toEqual([[mariners]]);
  });

  test("the same null guards as the settling query", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major", aliases: ["Sea"] });
    await addTeam(t, world, { name: "Rays", location: "Tampa Bay", level: "major" });
    const out = await resolvePlaceIds(t, world, [
      "Sea", // some team answers to it by alias
      "Tampa Bay Rays", // a team's full name, not a place
      "Seattle, Washington", // a comma
      "  ",
      "x".repeat(MAX_PLAYER_NAME_LENGTH + 1),
      "Nowhere", // no team there
    ]);
    expect(out).toEqual([null, null, null, null, null, null]);
  });

  test("no league on the set, or a league the place's teams are not in, answers null", async () => {
    const none = convexTest(schema, modules);
    const w1 = await seedWorld(none);
    await addTeam(none, w1, { name: "Mariners", location: "Seattle", level: "major" });
    expect(await resolvePlaceIds(none, w1, ["Seattle"])).toEqual([null]);
    const wrong = convexTest(schema, modules);
    const w2 = await seedWorld(wrong);
    await inLeague(wrong, w2, "college");
    await addTeam(wrong, w2, { name: "Mariners", location: "Seattle", level: "major" });
    expect(await resolvePlaceIds(wrong, w2, ["Seattle"])).toEqual([null]);
  });

  test("a full search window answers null (a count read from a window is not trusted)", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    await addTeam(t, world, { name: "Sooners", location: "Crowded", level: "major" });
    for (let i = 0; i < PLACE_TEAM_SEARCH_HITS - 1; i++) {
      await addTeam(t, world, { name: `Club ${i}`, location: "Crowded", level: "college" });
    }
    await addTeam(t, world, { name: "Some Very Long Nickname With Many Additional Words In It Here", location: "Crowded", level: "major" });
    expect(await resolvePlaceIds(t, world, ["Crowded"])).toEqual([null]);
  });

  test("texts past the per-call cap answer null", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await inLeague(t, world, "major");
    const mariners = await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    const out = await resolvePlaceIds(t, world, Array.from({ length: MAX_PLACE_TEXTS_PER_QUERY + 1 }, () => "Seattle"));
    expect(out[MAX_PLACE_TEXTS_PER_QUERY - 1]).toEqual([mariners]);
    expect(out.at(-1)).toBeNull();
  });
});

describe("resolveChecklistPlaceSets — the wrapper asks only for the places that can matter", () => {
  type Args = { selectorOptionId: string; texts: string[] };
  const id = "sel" as Id<"selectorOptions">;
  const ctxWith = (answer: (texts: string[]) => Array<string[] | null> | Error) => {
    const runQuery = vi.fn(async (_ref: unknown, args: Args) => {
      const got = answer(args.texts);
      if (got instanceof Error) throw got;
      return got;
    });
    return { ctx: { runQuery } as never, runQuery };
  };
  const asked = (runQuery: ReturnType<typeof ctxWith>["runQuery"]) =>
    runQuery.mock.calls.flatMap((c) => (c[1] as Args).texts);

  test("distinct plain texts the place resolver left as printed, on rows paired with a card that has a team", async () => {
    const { ctx, runQuery } = ctxWith((texts) => texts.map((x) => [`team of ${x}`]));
    const resolve = await resolveChecklistPlaceSets(
      ctx,
      id,
      [
        { card: { teams: ["Seattle Mariners"] }, row: { teams: ["Seattle", "Tampa", "Seattle, Boston", "  "] } },
        { card: { team: "Chicago Cubs" }, row: { teams: ["SEATTLE", "Chicago"] } },
        { card: {}, row: { teams: ["Houston"] } }, // no marketplace team: nothing to agree with
      ],
      (text) => (text === "Tampa" ? "Tampa Bay Rays" : null), // settled: not asked
    );
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(asked(runQuery)).toEqual(["Seattle", "Chicago"]);
    expect(resolve(" seattle ")).toEqual(["team of Seattle"]);
    expect(resolve("Tampa")).toBeNull();
    expect(resolve("Houston")).toBeNull();
  });

  test("nothing to ask means no query", async () => {
    const { ctx, runQuery } = ctxWith(() => []);
    const resolve = await resolveChecklistPlaceSets(ctx, id, [{ card: {}, row: { teams: ["Seattle"] } }]);
    expect(runQuery).not.toHaveBeenCalled();
    expect(resolve("Seattle")).toBeNull();
  });

  test("a failed batch leaves only its texts unanswered; the rest are asked in batches of the per-query cap", async () => {
    const first = Array.from({ length: MAX_PLACE_TEXTS_PER_QUERY }, (_, i) => `Aaa${String.fromCharCode(97 + i)}`);
    const { ctx, runQuery } = ctxWith((texts) =>
      texts.includes("Seattle") ? texts.map(() => ["team-x"]) : new Error("boom"),
    );
    const resolve = await resolveChecklistPlaceSets(ctx, id, [
      { card: { teams: ["Seattle Mariners"] }, row: { teams: [...first, "Seattle"] } },
    ]);
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(resolve(first[0])).toBeNull();
    expect(resolve("Seattle")).toEqual(["team-x"]);
  });

  test("distinct texts past the call cap are never asked", async () => {
    const { ctx, runQuery } = ctxWith((texts) => texts.map(() => ["team-x"]));
    const texts = Array.from({ length: MAX_PLACE_TEAM_TEXTS + 5 }, (_, i) => `Town ${i}`);
    const resolve = await resolveChecklistPlaceSets(ctx, id, [{ card: { teams: ["A"] }, row: { teams: texts } }]);
    expect(asked(runQuery)).toHaveLength(MAX_PLACE_TEAM_TEXTS);
    expect(resolve(`Town ${MAX_PLACE_TEAM_TEXTS - 1}`)).toEqual(["team-x"]);
    expect(resolve(`Town ${MAX_PLACE_TEAM_TEXTS}`)).toBeNull();
  });
});

describe("resolveChecklistPlaceTexts — the batching wrapper", () => {
  type Args = { selectorOptionId: string; texts: string[] };
  const fakeCtx = (answer: (texts: string[]) => Array<string | null> | Error) => {
    const runQuery = vi.fn(async (_ref: unknown, args: Args) => {
      const got = answer(args.texts);
      if (got instanceof Error) throw got;
      return got;
    });
    return { ctx: { runQuery } as never, runQuery };
  };
  const id = "sel" as Id<"selectorOptions">;

  test("asks distinct, folded, comma-free texts in batches of the per-query cap, and maps answers back", async () => {
    const n = MAX_PLACE_TEXTS_PER_QUERY * 2 + 1;
    const texts = Array.from({ length: n }, (_, i) => `Place${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`);
    const { ctx, runQuery } = fakeCtx((batch) => batch.map((x) => `Team of ${x}`));
    const resolve = await resolveChecklistPlaceTexts(ctx, id, [
      ...texts,
      texts[0].toUpperCase(), // folds onto the first
      "Seattle, Washington", // comma text: not asked
      "  ", // blank: not asked
    ]);
    expect(runQuery).toHaveBeenCalledTimes(3);
    expect(runQuery.mock.calls.map((c) => (c[1] as Args).texts.length)).toEqual([
      MAX_PLACE_TEXTS_PER_QUERY,
      MAX_PLACE_TEXTS_PER_QUERY,
      1,
    ]);
    const asked = runQuery.mock.calls.flatMap((c) => (c[1] as Args).texts);
    expect(asked).toEqual(texts);
    expect(resolve(texts[0])).toBe(`Team of ${texts[0]}`);
    expect(resolve(texts[0].toUpperCase())).toBe(`Team of ${texts[0]}`);
    expect(resolve(texts[n - 1])).toBe(`Team of ${texts[n - 1]}`);
    expect(resolve("Seattle, Washington")).toBeNull();
    expect(resolve("never asked")).toBeNull();
  });

  test("a failed batch leaves only its texts as printed; other batches still answer", async () => {
    const first = Array.from({ length: MAX_PLACE_TEXTS_PER_QUERY }, (_, i) => `Aaa${String.fromCharCode(97 + i)}`);
    const second = ["Seattle"];
    const { ctx } = fakeCtx((batch) => (batch.includes("Seattle") ? batch.map(() => "Seattle Mariners") : new Error("boom")));
    const resolve = await resolveChecklistPlaceTexts(ctx, id, [...first, ...second]);
    expect(resolve(first[0])).toBeNull();
    expect(resolve("Seattle")).toBe("Seattle Mariners");
  });

  test("distinct texts past the call cap answer null and are never asked", async () => {
    const { ctx, runQuery } = fakeCtx((batch) => batch.map(() => "T"));
    const texts = Array.from({ length: 205 }, (_, i) => `Town ${i}`);
    const resolve = await resolveChecklistPlaceTexts(ctx, id, texts);
    const asked = runQuery.mock.calls.flatMap((c) => (c[1] as Args).texts);
    expect(asked).toHaveLength(200);
    expect(resolve("Town 199")).toBe("T");
    expect(resolve("Town 200")).toBeNull();
  });
});

describe("resolveTeamIdentities — which NB team a name means", () => {
  async function identities(t: T, world: World, names: string[]) {
    return t.query(internal.checklistCandidates.resolveTeamIdentities, {
      selectorOptionId: world.leafId,
      names,
    });
  }

  test("an alias and the full name resolve to the same team id", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const id = await addTeam(t, world, {
      name: "Athletics",
      location: "Oakland",
      level: "major",
      aliases: ["Oakland A's"],
    });
    expect(await identities(t, world, ["Oakland Athletics", "Oakland A's", "  Oakland A's  "])).toEqual([id, id, id]);
  });

  test("a name no team answers to is null", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    expect(await identities(t, world, ["Nowhere Nobodies"])).toEqual([null]);
  });

  test("two teams the year cannot separate answer null, never the first", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "major" });
    await addTeam(t, world, { name: "Cougars", location: "Houston", level: "college" });
    expect(await identities(t, world, ["Houston Cougars"])).toEqual([null]);
  });

  test("NEO-602: a name the year reaches only as an alias, while another team holds it as its own name, is null", async () => {
    const t = convexTest(schema, modules);
    // A 2026 set. The 1968-2024 Oakland franchise owns "Oakland Athletics";
    // the 2025- Athletics carries it as an alias. The year alone would pick the
    // Athletics (the mis-link NEO-602 fixed); the cards' players are not known
    // at pairing time, so the name answers null and the operator is asked.
    const world = await seedWorld(t);
    await addTeam(t, world, {
      name: "Athletics",
      location: "Oakland",
      level: "major",
      yearsActive: { from: 1968, to: 2024 },
    });
    const athletics = await addTeam(t, world, {
      name: "Athletics",
      location: "Sacramento",
      level: "major",
      aliases: ["Oakland Athletics"],
      yearsActive: { from: 2025 },
    });
    expect(await identities(t, world, ["Oakland Athletics", "Sacramento Athletics"])).toEqual([null, athletics]);
  });

  test("a set with no sport above it answers null for every name", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    const orphan = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", { level: "variantType", value: "Base", platformData: {}, children: [], lastUpdated: NOW }),
    );
    expect(
      await t.query(internal.checklistCandidates.resolveTeamIdentities, {
        selectorOptionId: orphan,
        names: ["Seattle Mariners", "Mariners"],
      }),
    ).toEqual([null, null]);
  });

  test("an over-long name answers null even when a team really carries that name", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const long = "Wobegon ".repeat(Math.ceil(MAX_PLAYER_NAME_LENGTH / 8) + 1).trim();
    const id = await addTeam(t, world, { name: long, level: "major" });
    expect(long.length).toBeGreaterThan(MAX_PLAYER_NAME_LENGTH);
    expect(await identities(t, world, [long, "Wobegon"])).not.toContain(id);
  });

  test("blank, over-long and past-the-cap names answer null", async () => {
    const t = convexTest(schema, modules);
    const world = await seedWorld(t);
    const id = await addTeam(t, world, { name: "Mariners", location: "Seattle", level: "major" });
    const out = await identities(t, world, [
      "  ",
      "x".repeat(MAX_PLAYER_NAME_LENGTH + 1),
      ...Array.from({ length: MAX_TEAM_IDENTITY_TEXTS - 2 }, () => "Seattle Mariners"),
      "Seattle Mariners",
    ]);
    expect(out).toHaveLength(MAX_TEAM_IDENTITY_TEXTS + 1);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(id);
    expect(out[MAX_TEAM_IDENTITY_TEXTS - 1]).toBe(id);
    expect(out.at(-1)).toBeNull();
  });
});

describe("resolveChecklistTeamIdentities — asks only for the names applyChecklistRow compares", () => {
  const id = "sel" as Id<"selectorOptions">;
  const none = () => null;
  type Args = { selectorOptionId: string; names: string[] };
  const ctxWith = (impl: (names: string[]) => Array<string | null>) => {
    const runQuery = vi.fn(async (_ref: unknown, args: Args) => impl(args.names));
    return { ctx: { runQuery } as never, runQuery };
  };
  const asked = (runQuery: ReturnType<typeof ctxWith>["runQuery"]) =>
    runQuery.mock.calls.flatMap((c) => (c[1] as Args).names);

  test("card teams, comma text through resolveText, plain text through resolvePlace; legacy single team used", async () => {
    const { ctx, runQuery } = ctxWith((names) => names.map((n) => `id:${n}`));
    const resolveText = vi.fn((text: string) => (text === "Seattle, Boston" ? ["Seattle Mariners", "Boston Red Sox"] : null));
    const resolvePlace = vi.fn((text: string) => (text === "Tampa" ? "Tampa Bay Rays" : null));
    const resolve = await resolveChecklistTeamIdentities(
      ctx,
      id,
      [
        { card: { teams: ["Oakland Athletics"] }, row: { teams: ["Seattle, Boston", "Tampa", "Texas Rangers"] } },
        { card: { team: "Chicago Cubs" }, row: { teams: [] } },
      ],
      resolveText,
      resolvePlace,
    );
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(asked(runQuery)).toEqual([
      "Oakland Athletics",
      "Seattle Mariners",
      "Boston Red Sox",
      "Tampa Bay Rays",
      "Texas Rangers",
      "Chicago Cubs",
    ]);
    expect(resolveText).toHaveBeenCalledWith("Seattle, Boston");
    expect(resolvePlace).not.toHaveBeenCalledWith("Seattle, Boston");
    expect(resolve("  Tampa Bay Rays ")).toBe("id:Tampa Bay Rays");
    expect(resolve("Never Asked")).toBeNull();
  });

  test("a card with no marketplace team asks nothing about its row, and no names means no query", async () => {
    const { ctx, runQuery } = ctxWith((names) => names.map(() => "x"));
    const resolve = await resolveChecklistTeamIdentities(
      ctx,
      id,
      [{ card: {}, row: { teams: ["Seattle Mariners"] } }],
      none,
    );
    expect(runQuery).not.toHaveBeenCalled();
    expect(resolve("Seattle Mariners")).toBeNull();
  });

  test("a settled Prospect X (the place resolver's answer) is asked in place of the printed text", async () => {
    const { ctx, runQuery } = ctxWith((names) => names.map((n) => `id:${n}`));
    await resolveChecklistTeamIdentities(
      ctx,
      id,
      [{ card: { teams: ["Frisco RoughRiders"] }, row: { teams: ["Frisco"] } }],
      none,
      (text) => (text === "Frisco" ? "Frisco RoughRiders" : null),
    );
    expect(asked(runQuery)).toEqual(["Frisco RoughRiders"]);
  });

  test("a failed runQuery leaves every name unresolved without throwing", async () => {
    const runQuery = vi.fn(async () => {
      throw new Error("down");
    });
    const resolve = await resolveChecklistTeamIdentities(
      { runQuery } as never,
      id,
      [{ card: { teams: ["Oakland Athletics"] }, row: { teams: ["Oakland A's"] } }],
      none,
    );
    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(resolve("Oakland Athletics")).toBeNull();
    expect(resolve("Oakland A's")).toBeNull();
  });

  test("names past MAX_TEAM_IDENTITY_TEXTS are not asked", async () => {
    const { ctx, runQuery } = ctxWith((names) => names.map((n) => `id:${n}`));
    const teams = Array.from({ length: MAX_TEAM_IDENTITY_TEXTS + 5 }, (_, i) => `Team ${i}`);
    const resolve = await resolveChecklistTeamIdentities(ctx, id, [{ card: { teams }, row: { teams: [] } }], none);
    expect(asked(runQuery)).toHaveLength(MAX_TEAM_IDENTITY_TEXTS);
    expect(resolve(`Team ${MAX_TEAM_IDENTITY_TEXTS - 1}`)).toBe(`id:Team ${MAX_TEAM_IDENTITY_TEXTS - 1}`);
    expect(resolve(`Team ${MAX_TEAM_IDENTITY_TEXTS}`)).toBeNull();
  });
});
