/**
 * NEO-569 — the armed move from the free-text `features.league` to NB league
 * ids: every bucket each phase reports, the NEO-214 arming pair, and the strip
 * that keeps what does not resolve.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { insertTestCard } from "../lib/testing/card-row";
import { LEAGUE_BACKFILL_CONFIRM, LEAGUE_BACKFILL_ENV_FLAG, legacyLeagueText } from "./leagueBackfill";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;
type SelId = Id<"selectorOptions">;

afterEach(() => {
  vi.unstubAllEnvs();
});

const arm = () => vi.stubEnv(LEAGUE_BACKFILL_ENV_FLAG, "1");

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: "sport" | "year" | "manufacturer" | "setName" | "variantType" | "insert" | "parallel",
      value: string,
      parentId: SelId | undefined,
      features?: Record<string, string>,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        ...(features ? { features } : {}),
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball", undefined, { league: "MLB" });
    const year = await row("year", "2024", sport, { league: "MLB" });
    const brand = await row("manufacturer", "Topps", year, { league: "MLB" });
    // A set whose text resolves by alias, a set by abbreviation, one that
    // does not resolve, one with no text, and one already done.
    const byAlias = await row("setName", "Chrome", brand, { league: "MLB", era: "Modern (1980-Now)" });
    const byAbbr = await row("setName", "Bowman U", brand, { league: "ncaa" });
    const unresolved = await row("setName", "Mystery", brand, { league: "Imaginary Circuit" });
    const noText = await row("setName", "Plain", brand, { era: "Modern (1980-Now)" });
    const done = await row("setName", "Done", brand, { league: "MLB" });
    // Under Chrome: a copy of the set's text, and an insert type that says
    // something else.
    const base = await row("variantType", "Base", byAlias, { league: "MLB" });
    const prospects = await row("variantType", "Prospects", byAlias, { league: "NCAA" });
    const league = (name: string, level: "major" | "college", extra: { aliases?: string[]; abbreviation?: string }) =>
      ctx.db.insert("leagues", {
        name,
        nameNormalized: name.toLowerCase(),
        sportId: sport,
        level,
        ...extra,
        lastUpdated: NOW,
      });
    const mlb = await league("Major League Baseball", "major", { aliases: ["MLB"] });
    const ncaa = await league("NCAA Division I", "college", { abbreviation: "NCAA" });
    await ctx.db.patch(done, { leagueIds: [ncaa] });
    const team = (name: string, leagueId?: Id<"leagues">) =>
      ctx.db.insert("teams", {
        name,
        nameNormalized: normalizeEntityName(name),
        sportId: sport,
        ...(leagueId ? { leagueId } : {}),
        lastUpdated: NOW,
      });
    const padres = await team("San Diego Padres", mlb);
    const badgers = await team("Wisconsin Badgers", ncaa);
    const nowhere = await team("Nowhere Nine");
    return { sport, year, brand, byAlias, byAbbr, unresolved, noText, done, base, prospects, mlb, ncaa, padres, badgers, nowhere };
  });
}

const get = (t: T, id: SelId) => t.run((ctx) => ctx.db.get(id));

describe("legacyLeagueText", () => {
  test("trims, and treats blank as none", () => {
    expect(legacyLeagueText({ league: "  MLB " })).toBe("MLB");
    expect(legacyLeagueText({ league: "   " })).toBeUndefined();
    expect(legacyLeagueText(undefined)).toBeUndefined();
  });
});

describe("phase 1 — sets", () => {
  test("a dry run reports every bucket and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const report = await t.action(internal.leagueBackfill.run, { phase: "sets" });
    expect(report.armed).toBe(false);
    expect(report.complete).toBe(true);
    expect(report.message).toMatch(/^Dry run/);
    expect(report.counts).toMatchObject({
      alreadySet: 1,
      byNameOrAlias: 1,
      byAbbreviation: 2, // the "ncaa" set and the Prospects type
      copyOfParent: 1,
      noLegacyText: 1,
      unresolved: 1,
      written: 3,
    });
    expect(report.unresolved).toEqual([{ text: "Imaginary Circuit", count: 1 }]);
    expect((await get(t, s.byAlias))!.leagueIds).toBeUndefined();
  });

  test("confirmed but not armed: refused in the report, nothing written", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const report = await t.action(internal.leagueBackfill.run, {
      phase: "sets",
      confirm: LEAGUE_BACKFILL_CONFIRM,
    });
    expect(report.armed).toBe(false);
    expect(report.message).toMatch(/^Refused: this deployment is not armed/);
    expect((await get(t, s.byAlias))!.leagueIds).toBeUndefined();
  });

  test("armed: writes the resolved lists, never a copy, never a new league", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    arm();
    const report = await t.action(internal.leagueBackfill.run, {
      phase: "sets",
      confirm: LEAGUE_BACKFILL_CONFIRM,
    });
    expect(report.armed).toBe(true);
    expect((await get(t, s.byAlias))!.leagueIds).toEqual([s.mlb]);
    expect((await get(t, s.byAbbr))!.leagueIds).toEqual([s.ncaa]);
    expect((await get(t, s.prospects))!.leagueIds).toEqual([s.ncaa]);
    expect((await get(t, s.base))!.leagueIds).toBeUndefined();
    expect((await get(t, s.unresolved))!.leagueIds).toBeUndefined();
    expect((await get(t, s.sport))!.leagueIds).toBeUndefined();
    expect((await get(t, s.done))!.leagueIds).toEqual([s.ncaa]);
    expect(await t.run((ctx) => ctx.db.query("leagues").collect())).toHaveLength(2);

    // Idempotent: a re-run writes nothing more.
    const again = await t.action(internal.leagueBackfill.run, {
      phase: "sets",
      confirm: LEAGUE_BACKFILL_CONFIRM,
    });
    expect(again.counts.written ?? 0).toBe(0);
  });

  test("a page applied on an unarmed deployment throws", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    await expect(
      t.mutation(internal.leagueBackfill.page, { phase: "sets", stage: 0, cursor: null, apply: true }),
    ).rejects.toThrow(/not armed/);
  });

  test("a cursor this backfill never returned is refused", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.leagueBackfill.run, { phase: "sets", cursor: "nonsense" }),
    ).rejects.toThrow(/That cursor is not one this backfill returned\./);
  });
});

describe("phase 2 — cards", () => {
  test("every bucket, and only the right ones written", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    arm();
    await t.action(internal.leagueBackfill.run, { phase: "sets", confirm: LEAGUE_BACKFILL_CONFIRM });
    const card = (
      selectorOptionId: SelId,
      extra: {
        teamOnCardIds?: Array<Id<"teams">>;
        features?: Record<string, string>;
        leagueId?: Id<"leagues">;
      },
    ) =>
      t.run((ctx) =>
        insertTestCard(ctx, {
          selectorOptionId,
          cardNumber: String(Math.random()).slice(2, 8),
          cardName: "Card",
          sortOrder: 0,
          platformData: {},
          lastUpdated: NOW,
          ...extra,
        }),
      );
    const already = await card(s.base, { leagueId: s.ncaa, teamOnCardIds: [s.padres] });
    const fromTeams = await card(s.base, { teamOnCardIds: [s.padres] });
    const mixed = await card(s.base, { teamOnCardIds: [s.padres, s.badgers], features: { league: "MLB" } });
    const teamWithoutLeague = await card(s.base, { teamOnCardIds: [s.nowhere], features: { league: "NCAA" } });
    const legacyUnresolved = await card(s.base, { features: { league: "Imaginary Circuit" } });
    const fromSet = await card(s.base, {});
    const noSignal = await card(s.noText, {});

    const dry = await t.action(internal.leagueBackfill.run, { phase: "cards" });
    expect(dry.counts).toMatchObject({
      alreadySet: 1,
      fromTeams: 1,
      mixedTeamLeagues: 1,
      teamWithoutLeague: 1,
      fromLegacyText: 1,
      legacyUnresolved: 1,
      fromSetOnlyLeague: 1,
      noSignal: 1,
      written: 3,
    });
    expect(dry.unresolved).toEqual([{ text: "Imaginary Circuit", count: 1 }]);

    await t.action(internal.leagueBackfill.run, { phase: "cards", confirm: LEAGUE_BACKFILL_CONFIRM });
    const league = (id: Id<"cardChecklist">) => t.run(async (ctx) => (await ctx.db.get(id))?.leagueId ?? null);
    expect(await league(already)).toBe(s.ncaa);
    expect(await league(fromTeams)).toBe(s.mlb);
    expect(await league(mixed)).toBeNull();
    expect(await league(teamWithoutLeague)).toBe(s.ncaa);
    expect(await league(legacyUnresolved)).toBeNull();
    expect(await league(fromSet)).toBe(s.mlb);
    expect(await league(noSignal)).toBeNull();
  });
});

describe("phase 3 — strip", () => {
  test("removes the key where it resolves (year and brand rows too), keeps what does not, never a sport row", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const cardId = await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "1",
        cardName: "Card",
        sortOrder: 0,
        platformData: {},
        features: { league: "MLB" },
        lastUpdated: NOW,
      }),
    );
    arm();
    const report = await t.action(internal.leagueBackfill.run, {
      phase: "strip",
      confirm: LEAGUE_BACKFILL_CONFIRM,
    });
    expect(report.complete).toBe(true);
    expect(report.counts).toMatchObject({
      setRowsStripped: 5,
      yearOrBrandRowsStripped: 2,
      cardsStripped: 1,
      keptUnresolved: 1,
    });
    expect((await get(t, s.byAlias))!.features).toEqual({ era: "Modern (1980-Now)" });
    expect((await get(t, s.done))!.features).toBeUndefined(); // emptied map dropped
    expect((await get(t, s.unresolved))!.features).toEqual({ league: "Imaginary Circuit" });
    expect((await get(t, s.sport))!.features).toEqual({ league: "MLB" });
    expect((await get(t, s.year))!.features).toBeUndefined();
    expect((await get(t, s.brand))!.features).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(cardId)))!.features).toBeUndefined();

    const all = await t.action(internal.leagueBackfill.run, {
      phase: "strip",
      confirm: LEAGUE_BACKFILL_CONFIRM,
      includeUnresolved: true,
    });
    expect(all.counts.setRowsStripped).toBe(1);
    expect((await get(t, s.unresolved))!.features).toBeUndefined();
  });
});
