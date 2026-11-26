/**
 * NEO-676 unit 1 — the new storage fields (`externalIds.mlbamId`,
 * `leagues.minorLeagueClasses`, `teams.parentClubs`, `players.birthDate`,
 * stint `role`) must survive every strict read and every existing save path.
 *
 * Convex checks a `returns` validator against the REAL document, so a field the
 * schema admits but a validator omits makes the reader throw for every screen
 * the moment a row holds one. Typecheck cannot see that, so each reader below
 * is called against rows that carry every new field.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeLeagueName } from "./leagues";
import { teamRowFields } from "./lib/teamRow";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "user_mlb_fields_admin",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_mlb_fields_admin",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;

async function seedWorld(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      sportConfig: { skuCode: "BB", league: "MLB" },
      lastUpdated: 1,
    });
    const leagueId = await ctx.db.insert("leagues", {
      name: "Pacific Coast League",
      nameNormalized: normalizeLeagueName("Pacific Coast League"),
      sportId,
      level: "minor",
      externalIds: { wikidataId: "Q1111", mlbamId: 103 },
      minorLeagueClasses: [
        { class: "aaa", fromYear: 1946, toYear: 2020 },
        { class: "aaa", fromYear: 2021 },
        { class: "short-season-a", fromYear: 1900, toYear: 1910 },
      ],
      lastUpdated: 1,
    });
    const parentId = await ctx.db.insert("teams", {
      ...teamRowFields({ name: "Padres", location: "San Diego" }),
      sportId,
      externalIds: { mlbamId: 135 },
      lastUpdated: 1,
    });
    const teamId = await ctx.db.insert("teams", {
      ...teamRowFields({ name: "Chihuahuas", location: "El Paso" }),
      sportId,
      leagueId,
      externalIds: { wikidataId: "Q2222", espnId: "12", mlbamId: 4904 },
      parentClubs: [
        { parentTeamId: parentId, fromYear: 2014, toYear: 2020 },
        { parentTeamId: parentId, fromYear: 2021 },
      ],
      lastUpdated: 1,
    });
    const playerId = await ctx.db.insert("players", {
      name: "Pete Rose",
      nameNormalized: normalizePlayerName("Pete Rose"),
      sportId,
      birthYear: 1941,
      birthDate: "1941-04-14",
      externalIds: { wikidataId: "Q3333", mlbamId: 121311 },
      teamYears: [
        { teamId: parentId, fromYear: 1963, toYear: 1978 },
        { teamId: parentId, fromYear: 1984, toYear: 1986 },
        { teamId: parentId, fromYear: 1984, toYear: 1989, role: "manager" },
      ],
      createdByUserId: "user_seed",
      lastUpdated: 1,
    });
    return { sportId, leagueId, parentId, teamId, playerId };
  });
}

describe("NEO-676: every strict reader admits a row holding the new fields", () => {
  test("leagues readers", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    const asAdmin = t.withIdentity(ADMIN);
    const wanted = {
      externalIds: { wikidataId: "Q1111", mlbamId: 103 },
      minorLeagueClasses: [
        { class: "aaa", fromYear: 1946, toYear: 2020 },
        { class: "aaa", fromYear: 2021 },
        { class: "short-season-a", fromYear: 1900, toYear: 1910 },
      ],
    };

    const list = await asAdmin.query(api.leagues.list, { sportId: w.sportId });
    expect(list[0]).toMatchObject(wanted);
    const managed = await asAdmin.query(api.leagues.listForManagement, {});
    expect(managed.leagues[0]).toMatchObject(wanted);
    const byParam = await asAdmin.query(api.leagues.getByIdParam, { id: w.leagueId });
    expect(byParam).toMatchObject(wanted);
    const internalRow = await t.query(internal.leagues.getInternal, { id: w.leagueId });
    expect(internalRow).toMatchObject(wanted);
  });

  test("teams readers", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    const asAdmin = t.withIdentity(ADMIN);
    const wanted = {
      externalIds: { wikidataId: "Q2222", espnId: "12", mlbamId: 4904 },
      parentClubs: [
        { parentTeamId: w.parentId, fromYear: 2014, toYear: 2020 },
        { parentTeamId: w.parentId, fromYear: 2021 },
      ],
    };

    expect(await asAdmin.query(api.teams.get, { id: w.teamId })).toMatchObject(wanted);
    expect(await asAdmin.query(api.teams.getByIdParam, { id: w.teamId })).toMatchObject(wanted);
    const many = await asAdmin.query(api.teams.getManyByIds, { ids: [w.teamId] });
    expect(many[0]).toMatchObject(wanted);
    expect(await t.query(internal.teams.getInternal, { id: w.teamId })).toMatchObject(wanted);

    const picker = await asAdmin.query(api.teams.listForPicker, { sportId: w.sportId });
    expect(picker.find((r) => r._id === w.teamId)).toMatchObject(wanted);
    const managed = await asAdmin.query(api.teams.listForManagement, {});
    expect(managed.teams.find((r) => r._id === w.teamId)).toMatchObject(wanted);
    const search = await asAdmin.query(api.teams.search, { query: "Chihuahuas" });
    expect(search.find((r) => r._id === w.teamId)).toMatchObject(wanted);
    const searchMgmt = await asAdmin.query(api.teams.searchForManagement, { query: "Chihuahuas" });
    expect(searchMgmt.teams.find((r) => r._id === w.teamId)).toMatchObject(wanted);
    const candidates = await asAdmin.query(api.teams.pickerCandidates, {
      query: "Chihuahuas",
      sportId: w.sportId,
    });
    expect(candidates.find((r) => r.team._id === w.teamId)?.team).toMatchObject(wanted);
  });

  test("a parent row that is gone does not break a reader", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    // The parent row is removed; the affiliation still names it.
    await t.run(async (ctx) => {
      await ctx.db.patch(w.playerId, { teamYears: [] });
      await ctx.db.delete(w.parentId);
    });
    const row = await t.withIdentity(ADMIN).query(api.teams.get, { id: w.teamId });
    expect(row?.parentClubs).toHaveLength(2);
  });

  test("players readers", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    const asAdmin = t.withIdentity(ADMIN);
    const wanted = {
      birthYear: 1941,
      birthDate: "1941-04-14",
      externalIds: { wikidataId: "Q3333", mlbamId: 121311 },
      teamYears: [
        { teamId: w.parentId, fromYear: 1963, toYear: 1978 },
        { teamId: w.parentId, fromYear: 1984, toYear: 1986 },
        { teamId: w.parentId, fromYear: 1984, toYear: 1989, role: "manager" },
      ],
    };

    expect(
      await asAdmin.query(api.players.findByNameAndSport, { name: "Pete Rose", sportId: w.sportId }),
    ).toMatchObject(wanted);
    const list = await asAdmin.query(api.players.list, { sportId: w.sportId });
    expect(list[0]).toMatchObject(wanted);
    const search = await asAdmin.query(api.players.search, { query: "Rose" });
    expect(search[0]).toMatchObject(wanted);
    expect(await asAdmin.query(api.players.get, { id: w.playerId })).toMatchObject(wanted);
    expect(await asAdmin.query(api.players.getByIdParam, { id: w.playerId })).toMatchObject(wanted);
    const many = await asAdmin.query(api.players.getManyByIds, { ids: [w.playerId] });
    expect(many[0]).toMatchObject(wanted);
    const managed = await asAdmin.query(api.players.listForManagement, {});
    expect(managed.players[0]).toMatchObject(wanted);
    expect(await t.query(internal.players.getInternal, { id: w.playerId })).toMatchObject(wanted);
    // nearMatches reads the stints to build its career line.
    await asAdmin.query(api.players.nearMatches, { name: "Pete Rose", sportId: w.sportId });
  });
});

describe("NEO-676: a manager stint is kept by the existing writers", () => {
  const stintsOf = (t: T, id: Id<"players">): Promise<NonNullable<Doc<"players">["teamYears"]>> =>
    t.run(async (ctx) => (await ctx.db.get(id))?.teamYears ?? []);

  test("savePlayerFields round-trips role, and a player-manager holds both in one season", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    const asAdmin = t.withIdentity(ADMIN);
    const before = await stintsOf(t, w.playerId);

    // The editor sends the stints back unchanged plus one more.
    await asAdmin.mutation(api.players.savePlayerFields, {
      id: w.playerId,
      teamYears: [...before, { teamId: w.teamId, fromYear: 1990 }],
    });
    const after = await stintsOf(t, w.playerId);
    expect(after).toHaveLength(4);
    expect(after.filter((s) => s.role === "manager")).toEqual([
      { teamId: w.parentId, fromYear: 1984, toYear: 1989, role: "manager" },
    ]);

    // A playing and a managing stint on the same team and start year are not
    // duplicates of each other.
    await asAdmin.mutation(api.players.savePlayerFields, {
      id: w.playerId,
      teamYears: [
        { teamId: w.parentId, fromYear: 1985, toYear: 1985 },
        { teamId: w.parentId, fromYear: 1985, toYear: 1986, role: "manager" },
      ],
    });
    expect(await stintsOf(t, w.playerId)).toHaveLength(2);

    // ...but two of the same role still are.
    await expect(
      asAdmin.mutation(api.players.savePlayerFields, {
        id: w.playerId,
        teamYears: [
          { teamId: w.parentId, fromYear: 1985, role: "manager" },
          { teamId: w.parentId, fromYear: 1985, role: "manager" },
        ],
      }),
    ).rejects.toThrow(/listed twice/);
    await expect(
      asAdmin.mutation(api.players.savePlayerFields, {
        id: w.playerId,
        teamYears: [
          { teamId: w.parentId, fromYear: 1985 },
          { teamId: w.parentId, fromYear: 1985 },
        ],
      }),
    ).rejects.toThrow(/listed twice/);
  });

  test("a forced re-enrich replaces the dated playing stints and keeps the manager stint", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.mutation(internal.players.applyEnrichmentInternal, {
      id: w.playerId,
      teamYears: [{ teamId: w.teamId, fromYear: 1960, toYear: 1962 }],
    });
    const after = await stintsOf(t, w.playerId);
    expect(after).toEqual([
      { teamId: w.teamId, fromYear: 1960, toYear: 1962 },
      { teamId: w.parentId, fromYear: 1984, toYear: 1989, role: "manager" },
    ]);
    // The mlbam id sits beside the Wikidata id it rewrites.
    const row = await t.run(async (ctx) => ctx.db.get(w.playerId));
    expect(row?.externalIds?.mlbamId).toBe(121311);
  });

  test("appendCareerStints: a manager stint on the same team-year is not a duplicate of a playing one", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.playerId, {
        teamYears: [{ teamId: w.parentId, fromYear: 1990, toYear: 1991, role: "manager" }],
      });
    });
    const out = await t.mutation(internal.players.appendCareerStints, {
      stints: [{ playerId: w.playerId, teamId: w.parentId, fromYear: 1990, toYear: 1991 }],
    });
    expect(out).toEqual({ added: 1, existing: 0, skipped: 0 });
    const stints = await stintsOf(t, w.playerId);
    expect(stints).toHaveLength(2);
    expect(stints.filter((s) => s.role === "manager")).toHaveLength(1);

    // A second identical playing stint is now a duplicate.
    const again = await t.mutation(internal.players.appendCareerStints, {
      stints: [{ playerId: w.playerId, teamId: w.parentId, fromYear: 1990, toYear: 1991 }],
    });
    expect(again).toEqual({ added: 0, existing: 1, skipped: 0 });
  });

  test("createCareerNewPlayers: adopting a row keeps its manager stint and adds the playing one", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    const args = {
      sportId: w.sportId,
      userId: "user_seed",
      players: [
        {
          ref: "ref1",
          name: "Pat Manager",
          stints: [{ teamId: w.parentId, fromYear: 1990, toYear: 1991 }],
        },
      ],
    };
    const first = await t.mutation(internal.players.createCareerNewPlayers, args);
    const id = first.players[0].id;
    await t.run(async (ctx) => {
      await ctx.db.patch(id, {
        teamYears: [{ teamId: w.parentId, fromYear: 1990, toYear: 1991, role: "manager" }],
      });
    });
    const second = await t.mutation(internal.players.createCareerNewPlayers, args);
    expect(second.players[0].created).toBe(false);
    expect(second.stintsAdded).toBe(1);
    const stints = await stintsOf(t, id);
    expect(stints).toHaveLength(2);
    expect(stints.filter((s) => s.role === "manager")).toHaveLength(1);
  });
});

describe("NEO-676: saves keep the fields they do not own", () => {
  test("clearing a player's wikidataId keeps mlbamId", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.withIdentity(ADMIN).mutation(api.players.savePlayerFields, {
      id: w.playerId,
      wikidataId: null,
    });
    const row = await t.run(async (ctx) => ctx.db.get(w.playerId));
    expect(row?.externalIds).toEqual({ mlbamId: 121311 });
  });

  test("clearing a league's wikidataId keeps mlbamId", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.withIdentity(ADMIN).mutation(api.leagues.saveLeagueFields, {
      id: w.leagueId,
      wikidataId: null,
    });
    const row = await t.run(async (ctx) => ctx.db.get(w.leagueId));
    expect(row?.externalIds).toEqual({ mlbamId: 103 });
  });

  test("a team's saves leave mlbamId and parentClubs alone", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.withIdentity(ADMIN).mutation(api.teams.saveTeamFields, {
      id: w.teamId,
      yearsActive: { from: 2014 },
    });
    const row = await t.run(async (ctx) => ctx.db.get(w.teamId));
    expect(row?.externalIds?.mlbamId).toBe(4904);
    expect(row?.parentClubs).toHaveLength(2);
  });

  test("a birthYear edit that disagrees with birthDate keeps both", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.withIdentity(ADMIN).mutation(api.players.savePlayerFields, {
      id: w.playerId,
      birthYear: 1950,
    });
    const row = await t.run(async (ctx) => ctx.db.get(w.playerId));
    expect(row?.birthYear).toBe(1950);
    expect(row?.birthDate).toBe("1941-04-14");
    // Clearing the year leaves the date too.
    await t.withIdentity(ADMIN).mutation(api.players.savePlayerFields, {
      id: w.playerId,
      birthYear: null,
    });
    const cleared = await t.run(async (ctx) => ctx.db.get(w.playerId));
    expect(cleared?.birthYear).toBeUndefined();
    expect(cleared?.birthDate).toBe("1941-04-14");
  });

  test("moving a league's level off minor clears its classes; staying minor keeps them", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    const asAdmin = t.withIdentity(ADMIN);
    await asAdmin.mutation(api.leagues.saveLeagueFields, { id: w.leagueId, level: "minor" });
    expect(
      (await t.run(async (ctx) => ctx.db.get(w.leagueId)))?.minorLeagueClasses,
    ).toHaveLength(3);

    await asAdmin.mutation(api.leagues.saveLeagueFields, { id: w.leagueId, abbreviation: "PCL" });
    expect(
      (await t.run(async (ctx) => ctx.db.get(w.leagueId)))?.minorLeagueClasses,
    ).toHaveLength(3);

    await asAdmin.mutation(api.leagues.saveLeagueFields, { id: w.leagueId, level: "major" });
    const row = await t.run(async (ctx) => ctx.db.get(w.leagueId));
    expect(row?.level).toBe("major");
    expect(row?.minorLeagueClasses).toBeUndefined();
    expect(row?.externalIds?.mlbamId).toBe(103);
  });
});

describe("NEO-676: indexes", () => {
  test("by_mlbam_id finds a player and every team row sharing one MLB id", async () => {
    const t = convexTest(schema, modules);
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("teams", {
        ...teamRowFields({ name: "Expos", location: "Montreal" }),
        sportId: w.sportId,
        externalIds: { mlbamId: 120 },
        lastUpdated: 1,
      });
      await ctx.db.insert("teams", {
        ...teamRowFields({ name: "Nationals", location: "Washington" }),
        sportId: w.sportId,
        externalIds: { mlbamId: 120 },
        lastUpdated: 1,
      });
      const players = await ctx.db
        .query("players")
        .withIndex("by_mlbam_id", (q) => q.eq("externalIds.mlbamId", 121311))
        .take(2);
      expect(players.map((p) => p._id)).toEqual([w.playerId]);
      const teams = await ctx.db
        .query("teams")
        .withIndex("by_mlbam_id", (q) => q.eq("externalIds.mlbamId", 120))
        .take(5);
      expect(teams).toHaveLength(2);
    });
  });
});
