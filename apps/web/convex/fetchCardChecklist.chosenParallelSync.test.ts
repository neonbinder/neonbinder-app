/**
 * NEO-673 risk R1 — the chosen source parallel (Silver) of a set with no Base
 * is synced from its own Parallel-type chain: set → Parallel type → Silver.
 * Its checklist is fetched by `fetchCardChecklist` (Sync), while its siblings
 * are built by `buildParallelChecklist`, whose side plan
 * (`planParallelSides`) scopes every request. If those two scoped a row
 * differently, Silver would fetch the wrong list and every sibling would be
 * copied from it.
 *
 * Asserted at the wire (the body BSC receives), as `facetSources.test.ts`
 * does: Silver's Sync sends exactly the filters the side plan holds for the
 * same chain, and a sibling's build sends the same shape with its own
 * variantName.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { planParallelSides } from "./parallelChecklistBuild";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_user_673",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_673",
  name: "Admin",
  role: "admin",
};

vi.mock("./credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credentials")>();
  const { internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  const getSiteToken = internalAction({
    args: { site: v.string() },
    returns: v.any(),
    handler: async () => ({ token: "test-bsc-token" }),
  });
  return {
    ...actual,
    getSiteToken,
    siteTokenForCurrentUser: (ctx: unknown, site: string) =>
      (getSiteToken as unknown as { _handler: (c: unknown, a: { site: string }) => unknown })._handler(ctx, { site }),
    authenticateBsc: internalAction({
      args: { userId: v.optional(v.string()), tokenRefused: v.optional(v.boolean()) },
      returns: v.any(),
      handler: async () => ({ success: true }),
    }),
  };
});
// See `fetchCardChecklist.facetSources.test.ts` for why the mocked module is
// warmed once before any test.
await import("./credentials");

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

type Recorded = Record<string, string[]>;
const recorded: Recorded[] = [];

beforeEach(() => {
  recorded.length = 0;
  vi.stubGlobal("fetch", (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).includes("/search/bulk-upload/results")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    recorded.push((body.filters ?? {}) as Recorded);
    return new Response(
      JSON.stringify([{ id: "x-1", cardNo: "1", players: "Aaron Judge", setName: "pulse-premier" }]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type T = ReturnType<typeof convexTest>;

/** sport → year → setName → Parallel type → Silver, Gold (no Base). */
async function seedTree(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: "sport" | "year" | "setName",
      value: string,
      slug: string,
      parentId?: Id<"selectorOptions">,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        platformData: { bsc: { b0: slug } },
        platformSlotSeq: { bsc: 1 },
        ...(parentId ? { parentId } : {}),
        children: [],
        lastUpdated: Date.now(),
      });
    const sport = await row("sport", "Baseball", "baseball");
    const year = await row("year", "2024", "2024", sport);
    const setName = await row("setName", "Pulse Premier", "pulse-premier", year);
    const parallelType = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Parallel",
      parentId: setName,
      platformData: { bsc: { b0: "parallel" } },
      platformFacets: { bsc: { b0: "variant" } },
      platformSlotSeq: { bsc: 1 },
      primaryPlatformId: { bsc: "b0" },
      children: [],
      lastUpdated: Date.now(),
    });
    const insert = (value: string, slug: string) =>
      ctx.db.insert("selectorOptions", {
        level: "insert",
        value,
        parentId: parallelType,
        platformData: { bsc: { b0: slug } },
        platformFacets: { bsc: { b0: "variantName" } },
        platformSlotSeq: { bsc: 1 },
        primaryPlatformId: { bsc: "b0" },
        children: [],
        lastUpdated: Date.now(),
      });
    const silver = await insert("Silver", "silver");
    const gold = await insert("Gold", "gold");
    await ctx.db.patch(parallelType, { children: [silver, gold], parallelSourceId: silver });
    return { parallelType, silver, gold };
  });
}

const syncOf = (t: T, selectorOptionId: Id<"selectorOptions">) =>
  t.withIdentity(ADMIN).action(api.selectorOptions.fetchCardChecklist, { selectorOptionId });

describe("Silver's own Sync on a set with no Base (R1)", () => {
  test("asks BSC for the sport, year, set, the Parallel type's variant and Silver's own variantName", async () => {
    const t = convexTest(schema, modules);
    const { silver } = await seedTree(t);
    const result = await syncOf(t, silver);
    expect(result.success).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual({
      sport: ["baseball"],
      year: ["2024"],
      setName: ["pulse-premier"],
      variant: ["parallel"],
      variantName: ["silver"],
    });
  });

  test("sends exactly the filters the parallel build's side plan holds for Silver's chain", async () => {
    const t = convexTest(schema, modules);
    const { silver } = await seedTree(t);
    await syncOf(t, silver);

    const chain = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getAncestorChain, { id: silver });
    const plan = planParallelSides(chain as never);
    expect(plan.fetch.bsc).toBe(true);
    expect(plan.bscFilters).toEqual(recorded[0]);
  });

  test("a sibling's build sends the same request with only its own variantName", async () => {
    const t = convexTest(schema, modules);
    const { silver, gold } = await seedTree(t);
    await syncOf(t, silver);
    const syncFilters = { ...recorded[0] };
    recorded.length = 0;

    const chain = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getAncestorChain, { id: gold });
    const plan = planParallelSides(chain as never);
    expect(plan.bscFilters).toEqual({ ...syncFilters, variantName: ["gold"] });
    // Cards are attributed by the variantName id in both flows.
    const silverChain = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getAncestorChain, { id: silver });
    expect(plan.bscSourceFacet).toBe("variantName");
    expect(planParallelSides(silverChain as never).bscSourceFacet).toBe(plan.bscSourceFacet);
  });
});
