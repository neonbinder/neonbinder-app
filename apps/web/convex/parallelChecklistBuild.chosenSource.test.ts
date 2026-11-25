/**
 * NEO-673 — a set with no Base builds its parallels from the base parallel the
 * operator picked (`parallelSourceId` on the Parallel variant type, written by
 * `parallelTypeSource.setParallelTypeSource`, read by `sourceOfParallelType`).
 *
 * Tree: sport → year → setName(Pulse Premier) → variantType "Parallel"
 *         ─┬─ insert "Silver"   (the pick)
 *          ├─ insert "Gold"
 *          └─ insert "Blue"
 * (a variantType "Base" sibling is added where a test needs a real Base).
 *
 * Same adapter stubs as `parallelChecklistBuild.base.test.ts`; the rule that a
 * real Base always wins is asserted against that same shape.
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BLOCKED_MANY_BASES,
  BLOCKED_NO_BASE,
  NOT_BUILT_IS_THE_SOURCE,
  resolveBuildSource,
} from "./parallelChecklistBuild";
import {
  NOT_A_PARALLEL_TYPE,
  PARALLEL_SOURCE_GONE,
  PARALLEL_SOURCE_NOT_HERE,
} from "./parallelTypeSource";
import { printingLevelLeaves } from "./tidyPrintingLevel";
import { assessParallelCopyTitle } from "./features/carriedTitle";
import { insertTestCard, testCardSport } from "../lib/testing/card-row";
import { teamRowFields } from "./lib/teamRow";
import type { MutationCtx } from "./_generated/server";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo673",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo673",
  role: "admin",
};

const SENTINEL = 1_700_000_000_000;

type StubCard = { cardNumber: string; cardName: string; platformRef: string };

const bscState = vi.hoisted(() => ({
  cards: [] as StubCard[],
  calls: [] as Array<Record<string, string[]>>,
}));
vi.mock("./adapters/buysportscards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/buysportscards")>();
  const { action } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    fetchBscChecklist: action({
      args: {
        parentFilters: v.record(v.string(), v.string()),
        platformFilters: v.optional(v.record(v.string(), v.array(v.string()))),
        facetFilters: v.optional(v.record(v.string(), v.array(v.string()))),
        sourceFacet: v.optional(v.string()),
      },
      returns: v.any(),
      handler: async (_ctx, args) => {
        bscState.calls.push(args.facetFilters ?? {});
        return { success: true, cards: bscState.cards };
      },
    }),
  };
});
vi.mock("./adapters/sportlots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/sportlots")>();
  const { action } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    fetchSportLotsChecklist: action({
      args: {
        parentFilters: v.record(v.string(), v.string()),
        platformFilters: v.optional(v.record(v.string(), v.string())),
      },
      returns: v.any(),
      handler: async () => ({ success: true, cards: [] }),
    }),
  };
});

beforeEach(() => {
  bscState.cards = [];
  bscState.calls = [];
});

type T = ReturnType<typeof convexTest>;

/**
 * No Base (unless asked for). Every base parallel carries its own BSC slug and
 * the Parallel type holds the `variant` facet, as a real synced set does.
 */
async function seedSet(t: T, opts: { withBase?: boolean; pick?: "silver" | null } = {}) {
  return t.run(async (ctx) => {
    const sport = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: { bsc: { b0: "baseball" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const year = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "2024",
      parentId: sport,
      platformData: { bsc: { b0: "2024" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const setName = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Pulse Premier",
      parentId: year,
      platformData: { bsc: { b0: "pulse-premier" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const base = opts.withBase
      ? await ctx.db.insert("selectorOptions", {
          level: "variantType",
          value: "Base",
          parentId: setName,
          platformData: { bsc: { b0: "base" } },
          platformFacets: { bsc: { b0: "variant" } },
          children: [],
          lastUpdated: SENTINEL,
        })
      : undefined;
    const parallelType = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Parallel",
      parentId: setName,
      platformData: { bsc: { b0: "parallel" } },
      platformFacets: { bsc: { b0: "variant" } },
      children: [],
      lastUpdated: SENTINEL,
    });
    const insert = (value: string, slug: string) =>
      ctx.db.insert("selectorOptions", {
        level: "insert",
        value,
        parentId: parallelType,
        platformData: { bsc: { b0: slug } },
        platformFacets: { bsc: { b0: "variantName" } },
        features: { cardType: "Parallel", parallelName: "Base" },
        children: [],
        lastUpdated: SENTINEL,
      });
    const silver = await insert("Silver", "silver");
    const gold = await insert("Gold", "gold");
    const blue = await insert("Blue", "blue");
    await ctx.db.patch(parallelType, {
      children: [silver, gold, blue],
      ...(opts.pick === null ? {} : { parallelSourceId: silver }),
    });
    return { sport, year, setName, base, parallelType, silver, gold, blue };
  });
}

async function neutralTeam(
  ctx: Pick<MutationCtx, "db">,
  selectorOptionId: Id<"selectorOptions">,
): Promise<Id<"teams">> {
  const sportId = await testCardSport(ctx, selectorOptionId);
  const existing = (await ctx.db.query("teams").collect()).find(
    (team) => team.sportId === sportId && team.name === "Neutrals",
  );
  if (existing) return existing._id;
  return ctx.db.insert("teams", {
    ...teamRowFields({ location: "Neutral", name: "Neutrals" }),
    sportId,
    lastUpdated: SENTINEL,
  });
}

async function addCard(
  t: T,
  selectorOptionId: Id<"selectorOptions">,
  card: Partial<Doc<"cardChecklist">> & { cardNumber: string; cardName: string },
) {
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      platformData: {},
      teamOnCardIds: [await neutralTeam(ctx, selectorOptionId)],
      sortOrder: 0,
      lastUpdated: SENTINEL,
      ...card,
    }),
  );
}

const cardsOn = (t: T, selectorOptionId: Id<"selectorOptions">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", selectorOptionId))
      .collect(),
  );

const listFor = (t: T, sourceId: Id<"selectorOptions">) =>
  t
    .withIdentity(ADMIN)
    .query(api.parallelChecklistBuild.getParallelsForBuild, { sourceId });

const resolve = (t: T, id: Id<"selectorOptions">) =>
  t.run(async (ctx) => {
    const row = await ctx.db.get(id);
    return resolveBuildSource(ctx, row!);
  });

describe("getParallelsForBuild — the Parallel type of a set with no Base", () => {
  test("no Base and no pick: blocked as no Base, and the pick is offered", async () => {
    const t = convexTest(schema, modules);
    const { parallelType } = await seedSet(t, { pick: null });
    const result = await listFor(t, parallelType);
    expect(result.source).toBeUndefined();
    expect(result.sourceBlocked).toBe(BLOCKED_NO_BASE);
    expect(result.sourcePickable).toBe(true);
    expect(result.parallels).toHaveLength(3);
  });

  test("a valid pick is the source (kind chosenParallel), left out of the parallels; the button count is its siblings", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver, gold, blue } = await seedSet(t);
    await addCard(t, silver, { cardNumber: "1", cardName: "Aaron Judge" });
    const result = await listFor(t, parallelType);
    expect(result.source).toEqual({
      id: silver,
      value: "Silver",
      kind: "chosenParallel",
      hasCards: true,
      // Silver is first among Silver, Gold, Blue.
      position: 0,
    });
    expect(result.sourceBlocked).toBeUndefined();
    expect(result.sourcePickable).toBe(true);
    const ids = result.parallels.map((p) => p._id);
    expect(ids).not.toContain(silver);
    expect(ids.slice().sort()).toEqual([gold, blue].sort());
    expect(result.parallels).toHaveLength(2);
  });

  test("the source says where it sits in the type's child order, so the picker can slot it back", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver, gold, blue } = await seedSet(t);
    await t.run((ctx) =>
      ctx.db.patch(parallelType, { parallelSourceId: gold }),
    );
    const middle = await listFor(t, parallelType);
    expect(middle.source?.position).toBe(1);
    expect(middle.parallels.map((p) => p._id)).toEqual([silver, blue]);

    // Reordered children move it; the list stays in the same order.
    await t.run((ctx) =>
      ctx.db.patch(parallelType, { children: [blue, silver, gold] }),
    );
    const last = await listFor(t, parallelType);
    expect(last.source?.position).toBe(2);
    expect(last.parallels.map((p) => p._id)).toEqual([blue, silver]);
  });

  test("a real Base carries no position (parity with a set that has a Base)", async () => {
    const t = convexTest(schema, modules);
    const { parallelType } = await seedSet(t, { withBase: true });
    const result = await listFor(t, parallelType);
    expect(result.source).toBeDefined();
    expect(result.source).not.toHaveProperty("position");
  });

  test.each([
    [
      "the row was deleted",
      (ctx: MutationCtx, ids: { silver: Id<"selectorOptions"> }) => ctx.db.delete(ids.silver),
    ],
    [
      "the row moved to another level",
      (ctx: MutationCtx, ids: { silver: Id<"selectorOptions"> }) =>
        ctx.db.patch(ids.silver, { level: "parallel" }),
    ],
    [
      "the row was reparented",
      (ctx: MutationCtx, ids: { silver: Id<"selectorOptions">; setName: Id<"selectorOptions"> }) =>
        ctx.db.patch(ids.silver, { parentId: ids.setName }),
    ],
  ])("a stale pick reads as no pick: %s", async (_label, mutate) => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    await t.run(async (ctx) => {
      await mutate(ctx, ids);
    });
    const result = await listFor(t, ids.parallelType);
    expect(result.source).toBeUndefined();
    expect(result.sourceBlocked).toBe(BLOCKED_NO_BASE);
    // The type still holds base parallels, so the operator can pick again.
    expect(result.sourcePickable).toBe(result.parallels.length > 0);
    // A gold build on the stale pick is blocked, not copied from nowhere.
    const resolved = await resolve(t, ids.gold);
    expect(resolved).toEqual({
      status: "blocked",
      kind: "base",
      blockedReason: BLOCKED_NO_BASE,
    });
  });

  test("a real Base wins: the pick is ignored and Silver is listed as a parallel of Base, as today", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, base, silver, gold, blue } = await seedSet(t, { withBase: true });
    const result = await listFor(t, parallelType);
    expect(result.source).toEqual({ id: base, value: "Base", kind: "base", hasCards: false });
    expect(result.sourcePickable).toBe(false);
    expect(result.parallels.map((p) => p._id).sort()).toEqual([silver, gold, blue].sort());
    const resolved = await resolve(t, silver);
    expect(resolved.status).toBe("ok");
    if (resolved.status === "ok") {
      expect(resolved.kind).toBe("base");
      expect(resolved.source._id).toBe(base);
    }
  });

  test("more than one Base stays blocked and is not pickable, whatever is stored", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, setName, silver } = await seedSet(t, { withBase: true });
    await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Bases",
        parentId: setName,
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
    const result = await listFor(t, parallelType);
    expect(result.source).toBeUndefined();
    expect(result.sourceBlocked).toBe(BLOCKED_MANY_BASES);
    expect(result.sourcePickable).toBe(false);
    const resolved = await resolve(t, silver);
    expect(resolved).toEqual({
      status: "blocked",
      kind: "base",
      blockedReason: BLOCKED_MANY_BASES,
    });
  });

  test("a Parallel type with no base parallels is not pickable", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver, gold, blue } = await seedSet(t, { pick: null });
    await t.run(async (ctx) => {
      for (const id of [silver, gold, blue]) await ctx.db.delete(id);
    });
    const result = await listFor(t, parallelType);
    expect(result.sourcePickable).toBe(false);
  });

  test("standing on an insert is never pickable", async () => {
    const t = convexTest(schema, modules);
    const { gold } = await seedSet(t, { pick: null });
    expect((await listFor(t, gold)).sourcePickable).toBe(false);
  });
});

describe("resolveBuildSource — the chosen source", () => {
  test("a sibling resolves to the pick; the pick itself is not buildable", async () => {
    const t = convexTest(schema, modules);
    const { silver, gold, parallelType } = await seedSet(t);
    const sibling = await resolve(t, gold);
    expect(sibling.status).toBe("ok");
    if (sibling.status === "ok") {
      expect(sibling.kind).toBe("chosenParallel");
      expect(sibling.source._id).toBe(silver);
      expect(sibling.parent._id).toBe(parallelType);
    }
    expect(await resolve(t, silver)).toEqual({
      status: "notBuildable",
      message: NOT_BUILT_IS_THE_SOURCE,
    });
  });

  test("with a Base present the picked row is built from the Base like any sibling", async () => {
    const t = convexTest(schema, modules);
    const { silver } = await seedSet(t, { withBase: true });
    const resolved = await resolve(t, silver);
    expect(resolved.status).toBe("ok");
  });

  test("buildParallelChecklist refuses the pick itself and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { silver } = await seedSet(t);
    await expect(
      t
        .withIdentity(ADMIN)
        .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: silver }),
    ).rejects.toThrow(NOT_BUILT_IS_THE_SOURCE);
    expect(bscState.calls).toHaveLength(0);
  });
});

describe("building from a chosen source", () => {
  test("Gold copies Silver's cards, and no title carries the name Silver", async () => {
    const t = convexTest(schema, modules);
    const { silver, gold } = await seedSet(t);
    // Silver's own card features say what it is; the copy must be named Gold.
    await addCard(t, silver, {
      cardNumber: "7",
      cardName: "Aaron Judge",
      features: { cardType: "Parallel", parallelName: "Silver" },
    });
    bscState.cards = [{ cardNumber: "7", cardName: "Aaron Judge", platformRef: "bsc-gold-7" }];

    const result = await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: gold });
    expect(result.status).toBe("built");
    expect(result.copied).toBe(1);
    // Scoped by Gold's own id; Silver's slug is never asked for.
    expect(bscState.calls[0].variantName).toEqual(["gold"]);

    const [copy] = await cardsOn(t, gold);
    expect(copy.cardNumber).toBe("7");
    expect(copy.features?.parallelName).toBe("Gold");
    expect(copy.listingTitle).toContain("Gold");
    expect(copy.listingTitle ?? "").not.toMatch(/silver/i);
    // Silver's own card is untouched.
    const [still] = await cardsOn(t, silver);
    expect(still.platformData).toEqual({});
  });

  test("a hand-edited Silver title that says Silver does not carry the name into the copy", async () => {
    const t = convexTest(schema, modules);
    const { silver, gold } = await seedSet(t);
    await addCard(t, silver, {
      cardNumber: "7",
      cardName: "Aaron Judge",
      features: { cardType: "Parallel", parallelName: "Silver" },
      listingTitle: "2024 Pulse Premier Silver Aaron Judge Yankees Rookie",
    });
    bscState.cards = [{ cardNumber: "7", cardName: "Aaron Judge", platformRef: "bsc-gold-7" }];
    await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: gold });
    const [copy] = await cardsOn(t, gold);
    expect(copy.listingTitle ?? "").not.toMatch(/silver/i);
  });

  test("insertParallelCardsPage for a page naming the wrong source reports the move", async () => {
    const t = convexTest(schema, modules);
    const { silver, gold, blue } = await seedSet(t);
    const card = await addCard(t, silver, { cardNumber: "1", cardName: "Aaron Judge" });
    const page = (sourceId: Id<"selectorOptions">) =>
      t.run((ctx) =>
        ctx.runMutation(internal.parallelChecklistBuild.insertParallelCardsPage, {
          parallelId: gold,
          sourceId,
          copies: [
            {
              sourceCardId: card,
              expect: { cardNumber: "1", cardName: "Aaron Judge", namesOnCard: [] },
              bsc: { ref: "bsc-1" },
            },
          ],
          remap: [],
        }),
      );
    expect((await page(blue)).changed).toBe(true);
    expect(await cardsOn(t, gold)).toHaveLength(0);
    const ok = await page(silver);
    expect(ok.changed).toBe(false);
    expect(ok.created).toHaveLength(1);
  });

  test("a re-pick between pages stops the build on the source move, writing nothing", async () => {
    const t = convexTest(schema, modules);
    const { silver, gold, blue, parallelType } = await seedSet(t);
    const card = await addCard(t, silver, { cardNumber: "1", cardName: "Aaron Judge" });
    await t.run((ctx) => ctx.db.patch(parallelType, { parallelSourceId: blue }));
    const result = await t.run((ctx) =>
      ctx.runMutation(internal.parallelChecklistBuild.insertParallelCardsPage, {
        parallelId: gold,
        sourceId: silver,
        copies: [
          {
            sourceCardId: card,
            expect: { cardNumber: "1", cardName: "Aaron Judge", namesOnCard: [] },
            bsc: { ref: "bsc-1" },
          },
        ],
        remap: [],
      }),
    );
    expect(result.changed).toBe(true);
    expect(await cardsOn(t, gold)).toHaveLength(0);
  });
});

describe("setParallelTypeSource", () => {
  const pick = (t: T, parallelTypeId: Id<"selectorOptions">, sourceId: Id<"selectorOptions">) =>
    t.withIdentity(ADMIN).mutation(api.parallelTypeSource.setParallelTypeSource, {
      parallelTypeId,
      sourceId,
    });
  const stored = (t: T, id: Id<"selectorOptions">) =>
    t.run(async (ctx) => (await ctx.db.get(id))?.parallelSourceId ?? null);

  test("stores the pick on the Parallel type, and the build then reads it", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver, gold } = await seedSet(t, { pick: null });
    expect(await stored(t, parallelType)).toBeNull();
    await pick(t, parallelType, silver);
    expect(await stored(t, parallelType)).toBe(silver);
    const resolved = await resolve(t, gold);
    expect(resolved.status === "ok" && resolved.source._id).toBe(silver);
  });

  test("a second pick changes it (Change), and the old pick is a sibling again", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver, gold } = await seedSet(t);
    await pick(t, parallelType, gold);
    expect(await stored(t, parallelType)).toBe(gold);
    const list = await listFor(t, parallelType);
    expect(list.source?.id).toBe(gold);
    expect(list.parallels.map((p) => p._id)).toContain(silver);
    expect(list.parallels.map((p) => p._id)).not.toContain(gold);
  });

  test("picking the stored row again is allowed and leaves the row as it was", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver } = await seedSet(t);
    await pick(t, parallelType, silver);
    expect(await stored(t, parallelType)).toBe(silver);
  });

  test("a type that is not a Parallel type is refused, nothing written", async () => {
    const t = convexTest(schema, modules);
    const { base, silver } = await seedSet(t, { withBase: true, pick: null });
    await expect(pick(t, base!, silver)).rejects.toThrow(NOT_A_PARALLEL_TYPE);
    expect(await stored(t, base!)).toBeNull();
  });

  test("an insert id given as the type is refused", async () => {
    const t = convexTest(schema, modules);
    const { gold, silver } = await seedSet(t, { pick: null });
    await expect(pick(t, gold, silver)).rejects.toThrow(NOT_A_PARALLEL_TYPE);
  });

  test("a deleted row is refused, nothing written", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver } = await seedSet(t, { pick: null });
    await t.run((ctx) => ctx.db.delete(silver));
    await expect(pick(t, parallelType, silver)).rejects.toThrow(PARALLEL_SOURCE_GONE);
    expect(await stored(t, parallelType)).toBeNull();
  });

  test("a row under another type is refused, nothing written", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, setName } = await seedSet(t, { pick: null });
    const otherType = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Parallels",
        parentId: setName,
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
    const foreign = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "insert",
        value: "Red",
        parentId: otherType,
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
    await expect(pick(t, parallelType, foreign)).rejects.toThrow(PARALLEL_SOURCE_NOT_HERE);
    expect(await stored(t, parallelType)).toBeNull();
  });

  test("a row that is not an insert is refused", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver } = await seedSet(t, { pick: null });
    const child = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "parallel",
        value: "Silver Prizm",
        parentId: silver,
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
    await expect(pick(t, parallelType, child)).rejects.toThrow(PARALLEL_SOURCE_NOT_HERE);
  });

  test("the pick is stored even where a Base exists, and stays inert", async () => {
    const t = convexTest(schema, modules);
    const { parallelType, silver, base } = await seedSet(t, { withBase: true, pick: null });
    await pick(t, parallelType, silver);
    expect(await stored(t, parallelType)).toBe(silver);
    const list = await listFor(t, parallelType);
    expect(list.source?.id).toBe(base);
    expect(list.source?.kind).toBe("base");
  });
});

describe("printingLevelLeaves — Apply to all on a chosen-source set", () => {
  const leaves = (t: T, id: Id<"selectorOptions">) =>
    t.run((ctx) => printingLevelLeaves(ctx, id));

  async function withChildren(t: T, ids: { silver: Id<"selectorOptions">; gold: Id<"selectorOptions"> }) {
    return t.run(async (ctx) => {
      const mk = (parentId: Id<"selectorOptions">, value: string) =>
        ctx.db.insert("selectorOptions", {
          level: "parallel",
          value,
          parentId,
          platformData: {},
          children: [],
          lastUpdated: SENTINEL,
        });
      return { silverChild: await mk(ids.silver, "Silver Wave"), goldChild: await mk(ids.gold, "Gold Wave") };
    });
  }

  test("from Gold it reaches Silver, Blue and their parallels", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSet(t);
    const kids = await withChildren(t, s);
    const out = await leaves(t, s.gold);
    expect(out.slice().sort()).toEqual(
      [s.silver, s.gold, s.blue, kids.silverChild, kids.goldChild].sort(),
    );
  });

  test("from Silver (the pick) it reaches the same set of rows", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSet(t);
    const kids = await withChildren(t, s);
    const out = await leaves(t, s.silver);
    expect(out.slice().sort()).toEqual(
      [s.silver, s.gold, s.blue, kids.silverChild, kids.goldChild].sort(),
    );
  });

  test("with a Base the siblings stay apart: Gold reaches the Base and every base parallel (unchanged)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSet(t, { withBase: true });
    const kids = await withChildren(t, s);
    const out = await leaves(t, s.gold);
    expect(out.slice().sort()).toEqual(
      [s.base!, s.silver, s.gold, s.blue, kids.silverChild, kids.goldChild].sort(),
    );
    // Opening on Silver while a Base exists is exactly the same walk.
    expect((await leaves(t, s.silver)).slice().sort()).toEqual(out.slice().sort());
  });

  test("with no pick, a base parallel reaches only its own parallels", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSet(t, { pick: null });
    const kids = await withChildren(t, s);
    expect((await leaves(t, s.gold)).slice().sort()).toEqual([s.gold, kids.goldChild].sort());
  });
});

describe("Card titles dialog on a chosen-source set (dropName threading)", () => {
  const LONG = "Kanji Orange Wave Refractor Sapphire Gold XYZW";
  const failing = (t: T, parallelId: Id<"selectorOptions">) =>
    t.withIdentity(ADMIN).query(api.parallelCopyTitles.failingTitles, { parallelId });

  async function seedLong(t: T, sourceTitle: string, playerName = "Mike Trout") {
    const s = await seedSet(t);
    await t.run((ctx) => ctx.db.patch(s.gold, { value: LONG }));
    const player = await t.run(async (ctx) =>
      ctx.db.insert("players", {
        name: playerName,
        nameNormalized: playerName.toLowerCase(),
        sportId: s.sport,
        lastUpdated: SENTINEL,
      }),
    );
    await addCard(t, s.silver, {
      cardNumber: "1",
      cardName: playerName,
      playerIds: [player],
      listingTitle: sourceTitle,
    });
    bscState.cards = [{ cardNumber: "1", cardName: playerName, platformRef: "bsc-1" }];
    const built = await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: s.gold });
    return { ...s, built };
  }

  const BOX = "Pulse Premier Kanji Orange Wave Refractor Sapphire Gold XYZW Extra Ex";
  const TITLE = "Pulse Premier Silver Trout SILVER Halos Angels Rookie Card";

  test("failingTitles offers the carried rest without the chosen source's own name", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t, TITLE);
    expect(s.built.titlesToFix).toBe(1);
    const page = await failing(t, s.gold);
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0].carriedRest).toBe("Trout Halos Angels Rookie Card");
  });

  test("the build writes the carried hand edit without the chosen source's name", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t, "Pulse Premier Silver Trout SILVER");
    expect(s.built.titlesToFix).toBe(0);
    const [copy] = await cardsOn(t, s.gold);
    expect(copy.listingTitle).toBe(`Pulse Premier ${LONG} Trout`);
  });

  test("the same title on a set with a Base keeps the word: nothing is dropped without a chosen source", async () => {
    const t = convexTest(schema, modules);
    const s = await seedSet(t, { withBase: true });
    await t.run((ctx) => ctx.db.patch(s.gold, { value: LONG }));
    const player = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Mike Trout",
        nameNormalized: "mike trout",
        sportId: s.sport,
        lastUpdated: SENTINEL,
      }),
    );
    // Copied from the Base; its title is hand-edited and names the word Silver.
    await addCard(t, s.base!, {
      cardNumber: "1",
      cardName: "Mike Trout",
      playerIds: [player],
      listingTitle: "Pulse Premier Base Trout Silver Halos Angels Rookie Card",
    });
    bscState.cards = [{ cardNumber: "1", cardName: "Mike Trout", platformRef: "bsc-1" }];
    await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: s.gold });
    const page = await failing(t, s.gold);
    expect(page.cards[0]?.carriedRest).toBe("Trout Silver Halos Angels Rookie Card");
  });

  test("saving a box: the title the dialog showed (built from carriedRest) is the one the server writes", async () => {
    const t = convexTest(schema, modules);
    const s = await seedLong(t, "Pulse Premier Silver Trout SILVER");
    const [card] = await cardsOn(t, s.gold);
    // The build flagged it for the dialog; stored as such so the save sees it.
    await t.run((ctx) => ctx.db.patch(card._id, { listingTitleTruncated: true }));
    const [row] = (await failing(t, s.gold)).cards;
    // What the dialog shows for the new box: the shared assess, same inputs.
    const shown = assessParallelCopyTitle({ ...row.inputs, setShortName: BOX }, row.carriedRest);
    expect(shown.title).toBe(`${BOX} Trout`);

    const out = await t.withIdentity(ADMIN).mutation(api.parallelCopyTitles.saveTitleFixes, {
      parallelId: s.gold,
      listingShortName: BOX,
      cards: [{ cardId: card._id, kept: shown.title }],
    });
    expect(out.rewritten).toBe(1);
    const [after] = await cardsOn(t, s.gold);
    expect(after.listingTitle).toBe(shown.title);
  });
});
