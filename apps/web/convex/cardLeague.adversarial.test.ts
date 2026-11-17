/**
 * NEO-569 — adversarial pass over the card/set league writers: the cascade's
 * paging and guard, `recomputeTeamCards` under overlapping chains and past one
 * page, `effectiveSetLeagueIds` nearest-wins, and `setSelectorOptionLeagues`
 * validation edges. Beside `cardLeague.test.ts`; same fixtures.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { TEAM_LEAGUE_RECOMPUTE_PAGE, LEAGUE_CASCADE_STALE_MS } from "./cardLeague";
import { effectiveSetLeagueIds, newSelectorLeagueCache } from "./lib/selectorLeagues";
import { MAX_SET_LEAGUES } from "./leagues";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_admin", role: "admin" };
const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;
type SelId = Id<"selectorOptions">;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: "sport" | "year" | "manufacturer" | "setName" | "variantType" | "insert" | "parallel",
      value: string,
      parentId?: SelId,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const otherSport = await row("sport", "Football");
    const year = await row("year", "2024", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Chrome", brand);
    const base = await row("variantType", "Base", set);
    const parallelType = await row("variantType", "Parallels", set);
    const parallel = await row("parallel", "Refractor", parallelType);
    await ctx.db.patch(set, { children: [base, parallelType] });
    await ctx.db.patch(parallelType, { children: [parallel] });
    const league = (name: string, sportId: SelId) =>
      ctx.db.insert("leagues", {
        level: "major",
        name,
        nameNormalized: name.toLowerCase(),
        sportId,
        lastUpdated: NOW,
      });
    const mlb = await league("Major League Baseball", sport);
    const nl = await league("Negro National League", sport);
    const ncaa = await league("NCAA Division I", sport);
    const nfl = await league("National Football League", otherSport);
    await ctx.db.patch(set, { leagueIds: [mlb] });
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
    return { sport, otherSport, brand, set, base, parallelType, parallel, mlb, nl, ncaa, nfl, padres, badgers };
  });
}

const cardLeague = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.leagueId ?? null);

const bareCard = (t: T, selectorOptionId: SelId, extra: Partial<Doc<"cardChecklist">> = {}) =>
  t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      cardNumber: String(Math.random()).slice(2, 9),
      cardName: "Card",
      sortOrder: 0,
      platformData: {},
      lastUpdated: NOW,
      ...extra,
    }),
  );

const link = (t: T, cardId: Id<"cardChecklist">, teamId: Id<"teams">) =>
  t.run((ctx) => ctx.db.insert("cardTeamLinks", { cardChecklistId: cardId, teamId }));

describe("effectiveSetLeagueIds — nearest wins", () => {
  type Row = Pick<Doc<"selectorOptions">, "_id" | "level" | "parentId" | "leagueIds">;
  const fake = (rows: Record<string, Partial<Row> & { level: string }>) => {
    const reads: string[] = [];
    return {
      reads,
      ctx: {
        db: {
          get: async (id: string) => {
            reads.push(id);
            const r = rows[id];
            return r ? ({ _id: id, ...r } as unknown as Row) : null;
          },
        },
      },
    };
  };
  const id = (s: string) => s as Id<"selectorOptions">;
  const lg = (s: string) => s as Id<"leagues">;

  test("a parallel under the Parallel variantType answers with that type's list, never the Base type's", async () => {
    const { ctx } = fake({
      set: { level: "setName", parentId: id("brand"), leagueIds: [lg("mlb")] },
      brand: { level: "manufacturer", leagueIds: [lg("poison")] },
      base: { level: "variantType", parentId: id("set"), leagueIds: [lg("ncaa")] },
      ptype: { level: "variantType", parentId: id("set") },
      par: { level: "parallel", parentId: id("ptype") },
    });
    expect(await effectiveSetLeagueIds(ctx, id("par"))).toEqual([lg("mlb")]);
    expect(await effectiveSetLeagueIds(ctx, id("base"))).toEqual([lg("ncaa")]);
  });

  test("the walk stops after the setName: a brand's list is never read", async () => {
    const { ctx } = fake({
      set: { level: "setName", parentId: id("brand") },
      brand: { level: "manufacturer", leagueIds: [lg("poison")] },
      v: { level: "variantType", parentId: id("set") },
    });
    expect(await effectiveSetLeagueIds(ctx, id("v"))).toEqual([]);
  });

  test("an empty stored list is no list: the walk goes on", async () => {
    const { ctx } = fake({
      set: { level: "setName", leagueIds: [lg("mlb")] },
      v: { level: "variantType", parentId: id("set"), leagueIds: [] },
    });
    expect(await effectiveSetLeagueIds(ctx, id("v"))).toEqual([lg("mlb")]);
  });

  test("a row above the set, or a gone row, answers none", async () => {
    const { ctx } = fake({ brand: { level: "manufacturer", leagueIds: [lg("x")] } });
    expect(await effectiveSetLeagueIds(ctx, id("brand"))).toEqual([]);
    expect(await effectiveSetLeagueIds(ctx, id("gone"))).toEqual([]);
  });

  test("a parentId cycle terminates", async () => {
    const { ctx } = fake({
      a: { level: "variantType", parentId: id("b") },
      b: { level: "variantType", parentId: id("a") },
    });
    expect(await effectiveSetLeagueIds(ctx, id("a"))).toEqual([]);
  });

  test("the cache means a second ask for the same row reads nothing", async () => {
    const { ctx, reads } = fake({
      set: { level: "setName", leagueIds: [lg("mlb")] },
      v: { level: "variantType", parentId: id("set") },
    });
    const cache = newSelectorLeagueCache();
    expect(await effectiveSetLeagueIds(ctx, id("v"), cache)).toEqual([lg("mlb")]);
    const afterFirst = reads.length;
    expect(await effectiveSetLeagueIds(ctx, id("v"), cache)).toEqual([lg("mlb")]);
    expect(await effectiveSetLeagueIds(ctx, id("set"), cache)).toEqual([lg("mlb")]);
    expect(reads.length).toBe(afterFirst);
  });
});

describe("setSelectorOptionLeagues — validation edges", () => {
  async function many(t: T, sportId: SelId, n: number) {
    return t.run(async (ctx) => {
      const out: Array<Id<"leagues">> = [];
      for (let i = 0; i < n; i++) {
        out.push(
          await ctx.db.insert("leagues", {
            level: "minor",
            name: `League ${i}`,
            nameNormalized: `league ${i}`,
            sportId,
            lastUpdated: NOW,
          }),
        );
      }
      return out;
    });
  }

  test("exactly the cap is accepted; one over with a duplicate dedupes to the cap", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const ids = await many(t, s.sport, MAX_SET_LEAGUES + 1);
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: ids.slice(0, MAX_SET_LEAGUES),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toHaveLength(MAX_SET_LEAGUES);

    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [...ids.slice(0, MAX_SET_LEAGUES), ids[0]],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toHaveLength(MAX_SET_LEAGUES);

    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: ids,
      }),
    ).rejects.toThrow(/up to 12 leagues/);
  });

  test("a deleted league is refused and nothing is written or scheduled", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.delete(s.ncaa));
    await expect(
      t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: [s.mlb, s.ncaa],
      }),
    ).rejects.toThrow(/That league no longer exists\./);
    const row = await t.run((ctx) => ctx.db.get(s.set));
    expect(row!.leagueIds).toEqual([s.mlb]);
    expect(row!.leagueCascadeStartedAt).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });

  test("a parallel row takes its own list; a sport row is refused", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.parallel,
      leagueIds: [s.ncaa],
    });
    expect((await t.run((ctx) => ctx.db.get(s.parallel)))!.leagueIds).toEqual([s.ncaa]);
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.sport,
        leagueIds: [s.mlb],
      }),
    ).rejects.toThrow(/Pick leagues on the set/);
  });

  test("a league of another sport is refused on a row under that other sport too", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    // The same list is fine for a football set and refused for a baseball one.
    const fbSet = await t.run(async (ctx) => {
      const y = await ctx.db.insert("selectorOptions", {
        level: "year", value: "2024", parentId: s.otherSport, platformData: {}, children: [], lastUpdated: NOW,
      });
      const b = await ctx.db.insert("selectorOptions", {
        level: "manufacturer", value: "Topps", parentId: y, platformData: {}, children: [], lastUpdated: NOW,
      });
      return ctx.db.insert("selectorOptions", {
        level: "setName", value: "Chrome", parentId: b, platformData: {}, children: [], lastUpdated: NOW,
      });
    });
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: fbSet,
      leagueIds: [s.nfl],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(fbSet)))!.leagueIds).toEqual([s.nfl]);
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: fbSet,
        leagueIds: [s.mlb],
      }),
    ).rejects.toThrow(/Major League Baseball is a league in another sport\./);
  });

  test("an empty list on a row that already inherits is a no-op: no cascade, no stamp", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.base,
      leagueIds: [],
    });
    const row = await t.run((ctx) => ctx.db.get(s.base));
    expect(row!.leagueIds).toBeUndefined();
    expect(row!.leagueCascadeStartedAt).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });

  test("emptying the set's own list clears teamless cards that followed it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const c = await bareCard(t, s.base, { leagueId: s.mlb });
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toBeUndefined();
    expect(await cardLeague(t, c)).toBeNull();
  });

  test("a non-admin is refused", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.withIdentity({ subject: "user_plain" }).mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: [s.nl],
      }),
    ).rejects.toThrow();
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toEqual([s.mlb]);
  });
});

describe("cascadeSetLeagues — paging and the guard", () => {
  test("more cards than one page: every teamless follower is re-derived, the rest are not, the guard is released", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const followers: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < 230; i++) {
      // Alternate "was the single league" and "never settled": both follow.
      followers.push(await bareCard(t, s.base, i % 2 ? { leagueId: s.mlb } : {}));
    }
    const picked = await bareCard(t, s.base, { leagueId: s.nl });
    const withTeam = await bareCard(t, s.base, { teamOnCardIds: [s.padres], leagueId: s.mlb });
    // Cards under the second node, past the first page, too.
    const underParallel = await bareCard(t, s.parallel, { leagueId: s.mlb });

    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.ncaa],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    for (const id of followers) expect(await cardLeague(t, id)).toBe(s.ncaa);
    expect(await cardLeague(t, underParallel)).toBe(s.ncaa);
    expect(await cardLeague(t, picked)).toBe(s.nl);
    expect(await cardLeague(t, withTeam)).toBe(s.mlb);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBeUndefined();
  });

  test("the guard: fresh refuses, an expired stamp lets the edit through", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    vi.setSystemTime(NOW);
    await t.run((ctx) => ctx.db.patch(s.set, { leagueCascadeStartedAt: NOW - LEAGUE_CASCADE_STALE_MS + 1000 }));
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, { selectorOptionId: s.set, leagueIds: [s.ncaa] }),
    ).rejects.toThrow(/Still applying/);

    await t.run((ctx) => ctx.db.patch(s.set, { leagueCascadeStartedAt: NOW - LEAGUE_CASCADE_STALE_MS - 1 }));
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, { selectorOptionId: s.set, leagueIds: [s.ncaa] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toEqual([s.ncaa]);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBeUndefined();
  });

  test("an expired stamp is wiped by an edit that changes nothing a card sees", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    vi.setSystemTime(NOW);
    await t.run((ctx) => ctx.db.patch(s.set, { leagueCascadeStartedAt: NOW - LEAGUE_CASCADE_STALE_MS - 1 }));
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.mlb],
    });
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBeUndefined();
  });

  test("a late run from an older edit does not release a newer edit's guard", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.set, { leagueCascadeStartedAt: 222 }));
    await t.mutation(internal.cardLeague.cascadeSetLeagues, { rootId: s.set, startedAt: 111 });
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBe(222);
    await t.mutation(internal.cardLeague.cascadeSetLeagues, { rootId: s.set, startedAt: 222 });
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBeUndefined();
  });

  test("a cascade whose root is gone finishes quietly", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.delete(s.parallelType));
    await expect(
      t.mutation(internal.cardLeague.cascadeSetLeagues, { rootId: s.parallelType, nextLeagueId: s.ncaa }),
    ).resolves.toBeNull();
  });

  test("the cascade prunes a child with its own list and everything under it", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.parallelType, { leagueIds: [s.nl] }));
    const under = await bareCard(t, s.parallel, { leagueId: s.nl });
    const baseCard = await bareCard(t, s.base, { leagueId: s.mlb });
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.ncaa],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await cardLeague(t, under)).toBe(s.nl);
    expect(await cardLeague(t, baseCard)).toBe(s.ncaa);
  });
});

describe("recomputeTeamCards — chains and pages", () => {
  test("two overlapping chains converge on the live team league in either order", async () => {
    for (const order of ["newerFirst", "olderFirst"] as const) {
      const t = convexTest(schema, modules);
      const s = await seed(t);
      const card = await bareCard(t, s.base, { teamOnCardIds: [s.padres], leagueId: s.mlb });
      await link(t, card, s.padres);
      // mlb → ncaa → nl, two quick edits; the live row says nl.
      await t.run((ctx) => ctx.db.patch(s.padres, { leagueId: s.nl }));
      const older = { teamId: s.padres, previousLeagueId: s.mlb };
      const newer = { teamId: s.padres, previousLeagueId: s.ncaa };
      const first = order === "newerFirst" ? newer : older;
      const second = order === "newerFirst" ? older : newer;
      await t.mutation(internal.cardLeague.recomputeTeamCards, first);
      await t.mutation(internal.cardLeague.recomputeTeamCards, second);
      expect(await cardLeague(t, card)).toBe(s.nl);
    }
  });

  test("more links than one page: every card that followed is re-derived and every pick stays", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const followers: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < TEAM_LEAGUE_RECOMPUTE_PAGE + 20; i++) {
      const c = await bareCard(t, s.base, { teamOnCardIds: [s.padres], leagueId: s.mlb });
      await link(t, c, s.padres);
      followers.push(c);
    }
    const pick = await bareCard(t, s.base, { teamOnCardIds: [s.padres], leagueId: s.nl });
    await link(t, pick, s.padres);
    await t.run((ctx) => ctx.db.patch(s.padres, { leagueId: s.ncaa }));
    await t.mutation(internal.cardLeague.recomputeTeamCards, { teamId: s.padres, previousLeagueId: s.mlb });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of followers) expect(await cardLeague(t, id)).toBe(s.ncaa);
    expect(await cardLeague(t, pick)).toBe(s.nl);
  });

  test("a link to a card that is gone is skipped, not fatal", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const gone = await bareCard(t, s.base, { teamOnCardIds: [s.padres] });
    await link(t, gone, s.padres);
    await t.run((ctx) => ctx.db.delete(gone));
    const live = await bareCard(t, s.base, { teamOnCardIds: [s.padres] });
    await link(t, live, s.padres);
    await expect(
      t.mutation(internal.cardLeague.recomputeTeamCards, { teamId: s.padres }),
    ).resolves.toBeNull();
    expect(await cardLeague(t, live)).toBe(s.mlb);
  });

  test("a team that lost its league: a card that followed it goes blank, never keeps the stale league", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const card = await bareCard(t, s.base, { teamOnCardIds: [s.padres], leagueId: s.mlb });
    await link(t, card, s.padres);
    await t.run((ctx) => ctx.db.patch(s.padres, { leagueId: undefined }));
    await t.mutation(internal.cardLeague.recomputeTeamCards, { teamId: s.padres, previousLeagueId: s.mlb });
    expect(await cardLeague(t, card)).toBeNull();
  });

  test("with no previous league only a league-less card follows; an admin's pick stays", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.padres, { leagueId: undefined }));
    const blank = await bareCard(t, s.base, { teamOnCardIds: [s.padres] });
    const pick = await bareCard(t, s.base, { teamOnCardIds: [s.padres], leagueId: s.nl });
    await link(t, blank, s.padres);
    await link(t, pick, s.padres);
    await t.run((ctx) => ctx.db.patch(s.padres, { leagueId: s.ncaa }));
    await t.mutation(internal.cardLeague.recomputeTeamCards, { teamId: s.padres });
    expect(await cardLeague(t, blank)).toBe(s.ncaa);
    expect(await cardLeague(t, pick)).toBe(s.nl);
  });
});
