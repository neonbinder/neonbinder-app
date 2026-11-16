/**
 * NEO-556 — the parallel build under a parallel's "No Team".
 *
 * The parallel's team default is copied down at its creation, in all three
 * states. Under No Team, a copy that would be born with no team and no ruling
 * is stamped "No Team" (credited to whoever set it) when `noTeamCardVerdict`
 * says so: never over a team, a pending team name, or a listing's unmatched
 * team (product invariant 8), and not while the copy's own BSC lookup is
 * outstanding — `applyBscTeamResolution` stamps it once BSC answers with no
 * team. Harness: `parallelChecklistBuild.playerDefaults.test.ts`.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { teamRowFields } from "./lib/teamRow";
import { isAwaitingTeamLookup } from "./features/cardAttention";
import {
  captureBscTeamLane,
  runBscTeamLane,
  type BscTeamLaneItem,
} from "../lib/testing/bsc-team-lane";
import { drainScheduled } from "../lib/testing/drain-scheduled";
import * as parallelBuild from "./parallelChecklistBuild";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo556_parallel_no_team",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo556_parallel_no_team",
  role: "admin",
};

const NOW = 1_700_000_000_000;

type StubCard = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  platformRef: string;
  sourceBscSetSlug?: string;
};

const bscState = vi.hoisted(() => ({ cards: [] as StubCard[] }));
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
      handler: async () => ({ success: true, cards: bscState.cards }),
    }),
  };
});

// The `bscTeamPool` component is not mounted under convex-test: every item
// the build's scheduled enqueue hands the lane lands in `lane` instead
// (lib/testing/bsc-team-lane.ts), and a test that wants the answer runs it.
let lane: BscTeamLaneItem[] = [];
beforeEach(() => {
  bscState.cards = [];
  lane = captureBscTeamLane();
  // Only the lane's own BSC call may reach `fetch`; a test that runs the lane
  // stubs the answer.
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      throw new Error(`NEO-556: this test file must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type T = ReturnType<typeof convexTest>;
type RowId = Id<"selectorOptions">;

async function seed(t: T) {
  return t.run(async (ctx) => {
    const mk = (
      level: "sport" | "year" | "setName" | "variantType" | "insert" | "parallel",
      value: string,
      parentId: RowId | undefined,
      platformData: { bsc?: Record<string, string> },
      extra: { platformFacets?: { bsc: Record<string, "variant" | "variantName"> } } = {},
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData,
        children: [],
        lastUpdated: NOW,
        ...extra,
      });
    const sport = await mk("sport", "Baseball", undefined, { bsc: { b0: "baseball" } });
    const year = await mk("year", "2024", sport, { bsc: { b0: "2024" } });
    const setName = await mk("setName", "Bowman", year, { bsc: { b0: "bowman" } });
    const variantType = await mk("variantType", "Insert", setName, { bsc: { b0: "insert" } }, {
      platformFacets: { bsc: { b0: "variant" } },
    });
    const insert = await mk("insert", "Anime", variantType, { bsc: { b0: "anime" } });
    const parallel = await mk("parallel", "Anime Kanji", insert, { bsc: { b0: "anime-kanji" } }, {
      platformFacets: { bsc: { b0: "variantName" } },
    });
    const player = (name: string) =>
      ctx.db.insert("players", { name, nameNormalized: name.toLowerCase(), sportId: sport, lastUpdated: NOW });
    const team = (location: string, name: string) =>
      ctx.db.insert("teams", { ...teamRowFields({ location, name }), sportId: sport, lastUpdated: NOW });
    return {
      sport,
      setName,
      insert,
      parallel,
      ohtani: await player("Shohei Ohtani"),
      judge: await player("Aaron Judge"),
      soto: await player("Juan Soto"),
      skenes: await player("Paul Skenes"),
      dodgers: await team("Los Angeles", "Dodgers"),
      yankees: await team("New York", "Yankees"),
    };
  });
}
type Fx = Awaited<ReturnType<typeof seed>>;

/** An insert card; `players` are linked under their own names. */
async function insertCard(
  t: T,
  fx: Fx,
  n: string,
  opts: {
    players?: Array<[Id<"players">, string]>;
    teams?: Array<Id<"teams">>;
    extra?: Partial<Doc<"cardChecklist">>;
  } = {},
) {
  return t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: fx.insert,
      cardNumber: n,
      cardName: opts.players?.[0]?.[1] ?? `Card ${n}`,
      ...(opts.players
        ? {
            playerIds: opts.players.map(([id]) => id),
            playerLinks: opts.players.map(([playerId, nameOnCard]) => ({ playerId, nameOnCard })),
          }
        : {}),
      ...(opts.teams ? { teamOnCardIds: opts.teams } : {}),
      platformData: { bsc: { ref: `ins-${n}`, src: "b0" } },
      sortOrder: Number(n),
      lastUpdated: NOW,
      ...opts.extra,
    }),
  );
}

/** What BSC lists for the parallel: one card per insert card, same number and name. */
async function stubParallelListing(t: T, fx: Fx) {
  const cards = await t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", fx.insert))
      .collect(),
  );
  bscState.cards = cards.map((c) => ({
    cardNumber: c.cardNumber,
    cardName: c.cardName,
    players: (c.playerLinks ?? []).map((l) => l.nameOnCard),
    platformRef: `k-${c.cardNumber}`,
    sourceBscSetSlug: "anime-kanji",
  }));
}

async function build(t: T, fx: Fx) {
  await stubParallelListing(t, fx);
  const result = await t
    .withIdentity(ADMIN)
    .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: fx.parallel });
  expect(result.status).toBe("built");
  // The page's lookup enqueue is a `runAfter(0)`: settle it into `lane`.
  await drainScheduled(t);
  return result;
}

async function copies(t: T, fx: Fx) {
  // `t.run` cannot hand back a Map; the entries cross, the Map is built here.
  const entries = await t.run(async (ctx) => {
    const cards = await ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", fx.parallel))
      .collect();
    const out: Array<
      [string, Doc<"cardChecklist"> & { playerIndex: string[]; cameoIndex: string[]; teamIndex: string[] }]
    > = [];
    for (const c of cards) {
      const playerIndex = (await ctx.db.query("cardPlayerLinks").collect())
        .filter((l) => l.cardChecklistId === c._id)
        .map((l) => l.playerId as string);
      const cameoIndex = (
        await ctx.db
          .query("cardSecondaryPlayerLinks")
          .withIndex("by_card", (q) => q.eq("cardChecklistId", c._id))
          .collect()
      ).map((l) => l.playerId as string);
      const teamIndex = (await ctx.db.query("cardTeamLinks").collect())
        .filter((l) => l.cardChecklistId === c._id)
        .map((l) => l.teamId as string);
      out.push([c.cardNumber, { ...c, playerIndex, cameoIndex, teamIndex }]);
    }
    return out;
  });
  return new Map(entries);
}

const store = (t: T, id: RowId, values: Partial<Doc<"selectorOptions">>) =>
  t.run(async (ctx) => ctx.db.patch(id, values));

const SETTER = "user_neo556_parallel_setter";
const NO_TEAM = { setAt: NOW, setByUserId: SETTER };
/** A lookup that has been and gone (BSC answered with no team). */
const ANSWERED = { teamCheckDoneAt: NOW, teamCheckOutcome: "answered" as const };

describe("parallel build — the parallel's No Team (NEO-556)", () => {
  test("a teamless copy whose lookup has answered is born No Team, credited to whoever set it", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { extra: ANSWERED });
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    const before = Date.now();
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.teamNoneConfirmedAt).toBeGreaterThanOrEqual(before);
    expect(one.teamNoneConfirmedByUserId).toBe(SETTER);
    expect(one.teamOnCardIds).toBeUndefined();
    expect(one.teamIndex).toEqual([]);
    // The insert card itself is untouched: the No Team is the parallel's.
    const source = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", fx.insert))
          .collect()
      ).find((c) => c.cardNumber === "1"),
    );
    expect(source!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("never over a team, a pending team name, a listing's unmatched team, or a lookup that gave up", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { teams: [fx.yankees], extra: ANSWERED });
    await insertCard(t, fx, "2", { extra: { ...ANSWERED, pendingTeamNames: ["Dodgers"] } });
    await insertCard(t, fx, "3", { extra: { ...ANSWERED, bscTeamName: "LA Dodgers" } });
    await insertCard(t, fx, "4", { extra: { teamCheckDoneAt: NOW, teamCheckOutcome: "gaveUp" } });
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    await build(t, fx);
    const got = await copies(t, fx);
    for (const n of ["1", "2", "3", "4"]) {
      expect(got.get(n)!.teamNoneConfirmedAt, n).toBeUndefined();
    }
    expect(got.get("1")!.teamOnCardIds).toEqual([fx.yankees]);
    expect(got.get("1")!.teamIndex).toEqual([fx.yankees]);
    expect(got.get("2")!.pendingTeamNames).toEqual(["Dodgers"]);
    expect(got.get("3")!.bscTeamName).toBe("LA Dodgers");
  });

  test("a copy whose BSC lookup is outstanding waits, then the lookup's empty answer stamps it", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1");
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.platformData?.bsc?.ref).toBe("k-1");
    expect(one.teamCheckDoneAt).toBeUndefined();
    expect(one.teamNoneConfirmedAt).toBeUndefined();

    await t.mutation(internal.cardChecklist.applyBscTeamResolution, {
      cardChecklistId: one._id,
      rawTeamName: "",
      teamNames: [],
    });
    const after = await t.run(async (ctx) => ctx.db.get(one._id));
    expect(after!.teamNoneConfirmedAt).toBeTypeOf("number");
    expect(after!.teamNoneConfirmedByUserId).toBe(SETTER);
  });

  test("a source an operator ruled teamless passes its own ruling on, not the parallel's", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", {
      extra: { ...ANSWERED, teamNoneConfirmedAt: 7, teamNoneConfirmedByUserId: "user_operator" },
    });
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.teamNoneConfirmedAt).toBe(7);
    expect(one.teamNoneConfirmedByUserId).toBe("user_operator");
  });

  test("No Team on the insert only (not the parallel) stamps nothing: the parallel's own value is read", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { extra: ANSWERED });
    await store(t, fx.insert, { noTeamDefault: NO_TEAM });
    await build(t, fx);
    expect((await copies(t, fx)).get("1")!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a parallel with a team still fills it, and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { extra: ANSWERED });
    await store(t, fx.parallel, { teamIds: [fx.dodgers] });
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.teamOnCardIds).toEqual([fx.dodgers]);
    expect(one.teamNoneConfirmedAt).toBeUndefined();
  });
});

/**
 * NEO-556 — the copy's OWN BSC team lookup. A copy is born with its own BSC
 * link; when its source's lookup never ran (a hand-added card) or has not run
 * yet (still queued on the lane when the build runs), the copy owes a lookup
 * of its own and the build queues it. Before this, nothing did: the checklist
 * said "Still looking up teams" forever and the No Team stamp never landed.
 */
describe("parallel build — the copy's own BSC team lookup (NEO-556)", () => {
  /** BSC's card-listing answer per copy ref (`k-<n>`); "" = no team on file. */
  function stubCardListing(teams: Record<string, string>) {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (url: string | URL | Request) => {
        const ref = String(url).match(/\/marketplace\/card\/([^/]+)\/card-listing/)?.[1] ?? "";
        const teamName = teams[ref];
        if (teamName === undefined) throw new Error(`unexpected fetch: ${String(url)}`);
        asked.push(ref);
        return new Response(JSON.stringify({ teamName }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch,
    );
    return asked;
  }

  /** Plays the lane's one slot on a fake clock (its 1.7 s pacing pause). */
  async function runLane(t: T) {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    return runBscTeamLane(t, lane, 10);
  }

  test("a copy whose source's lookup never ran is queued, and BSC's 'no team' stamps the parallel's No Team", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    // "1": the insert card's own lookup still queued (a BSC ref, no stamp).
    await insertCard(t, fx, "1");
    // "2": hand-added, never linked to BSC on the insert.
    await insertCard(t, fx, "2", { extra: { platformData: {} } });
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    await build(t, fx);

    const before = await copies(t, fx);
    const queued = lane.map((l) => l.item.cardChecklistId as string).sort();
    expect(queued).toEqual([before.get("1")!._id, before.get("2")!._id].sort());
    for (const n of ["1", "2"]) {
      // Held back while the lookup is owed (rule 8), and on the lane, so the
      // "Still looking up teams" line it reads is true.
      expect(before.get(n)!.teamNoneConfirmedAt, n).toBeUndefined();
      expect(isAwaitingTeamLookup(before.get(n)!), n).toBe(true);
    }

    const asked = stubCardListing({ "k-1": "", "k-2": "" });
    expect(await runLane(t)).toBe(2);
    // Each copy is asked by ITS OWN ref, never its source's.
    expect(asked.sort()).toEqual(["k-1", "k-2"]);

    const after = await copies(t, fx);
    for (const n of ["1", "2"]) {
      const copy = after.get(n)!;
      expect(copy.teamCheckDoneAt, n).toBeTypeOf("number");
      expect(copy.teamCheckOutcome, n).toBe("answered");
      expect(copy.teamNoneConfirmedAt, n).toBeTypeOf("number");
      expect(copy.teamNoneConfirmedByUserId, n).toBe(SETTER);
      expect(isAwaitingTeamLookup(copy), n).toBe(false);
    }
  });

  test("BSC naming a team lands the team as it always has, and stamps nothing", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1");
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    await build(t, fx);

    stubCardListing({ "k-1": "Los Angeles Dodgers" });
    expect(await runLane(t)).toBe(1);

    const copy = (await copies(t, fx)).get("1")!;
    expect(copy.teamOnCardIds).toEqual([fx.dodgers]);
    expect(copy.teamIndex).toEqual([fx.dodgers]);
    expect(copy.teamCheckOutcome).toBe("answered");
    expect(copy.teamNoneConfirmedAt).toBeUndefined();
  });

  test("an ordinary parallel (no No Team, no set team) owes the lookup, and BSC's team lands on the copy with no stamp", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1");
    await build(t, fx);

    const before = (await copies(t, fx)).get("1")!;
    expect(lane.map((l) => l.item.cardChecklistId)).toEqual([before._id]);
    expect(before.teamOnCardIds).toBeUndefined();

    await t.mutation(internal.cardChecklist.applyBscTeamResolution, {
      cardChecklistId: before._id,
      rawTeamName: "Los Angeles Dodgers",
      teamNames: ["Los Angeles Dodgers"],
    });

    const copy = (await copies(t, fx)).get("1")!;
    expect(copy.teamOnCardIds).toEqual([fx.dodgers]);
    expect(copy.teamIndex).toEqual([fx.dodgers]);
    expect(copy.teamNoneConfirmedAt).toBeUndefined();
    expect(copy.teamNoneConfirmedByUserId).toBeUndefined();
  });

  test("the page's write-budget break leaves room for the lookup schedule: it stops one copy earlier than without", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const cameos = await t.run(async (ctx) => {
      const out: Array<Id<"players">> = [];
      for (let i = 0; i < MAX_CARD_PLAYERS; i++) {
        out.push(
          await ctx.db.insert("players", { name: `Cameo ${i}`, nameNormalized: `cameo ${i}`, sportId: fx.sport, lastUpdated: NOW }),
        );
      }
      return out;
    });
    // A copy writes row + SKU + 1 player + 20 cameos = 23. After 50 copies the
    // page holds 1150, and 1150 + the most one copy can write (50) is exactly
    // the budget: without the schedule's write it would take a 51st copy.
    const perCopy = 2 + 1 + MAX_CARD_PLAYERS;
    const maxCopy = 2 + MAX_CARD_PLAYERS + MAX_CARD_TEAMS + MAX_CARD_PLAYERS;
    const fits = 50;
    expect(fits * perCopy + maxCopy).toBe(parallelBuild.INSERT_PAGE_WRITE_BUDGET);
    for (let i = 1; i <= fits + 2; i++) await insertCard(t, fx, String(i));
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes], defaultCameoIds: cameos });

    const page = parallelBuild.insertParallelCardsPage as unknown as {
      _handler: (...args: unknown[]) => Promise<{ processed: number }>;
    };
    const spy = vi.spyOn(page, "_handler");
    try {
      const result = await build(t, fx);
      expect(result.copied).toBe(fits + 2);
      const processed = await Promise.all(spy.mock.results.map((r) => r.value as Promise<{ processed: number }>));
      expect(processed[0].processed).toBe(fits);
      expect(processed.length).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("a copy whose source's lookup has finished carries that answer and is not asked again", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { extra: ANSWERED });
    await insertCard(t, fx, "2", { extra: { teamCheckDoneAt: NOW, teamCheckOutcome: "gaveUp" } });
    await insertCard(t, fx, "3", { extra: { ...ANSWERED, bscTeamName: "LA Dodgers" } });
    await store(t, fx.parallel, { noTeamDefault: NO_TEAM });
    await build(t, fx);

    expect(lane).toEqual([]);
    const got = await copies(t, fx);
    expect(got.get("1")!.teamCheckDoneAt).toBe(NOW);
    expect(got.get("2")!.teamCheckOutcome).toBe("gaveUp");
    expect(got.get("3")!.bscTeamName).toBe("LA Dodgers");
  });

  test("a copy born with a team or a ruling owes no lookup", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    // The source's own team, and an operator's ruling, both unlooked-up.
    await insertCard(t, fx, "1", { teams: [fx.yankees] });
    await insertCard(t, fx, "2", {
      extra: { teamNoneConfirmedAt: 7, teamNoneConfirmedByUserId: "user_operator" },
    });
    await build(t, fx);
    expect(lane).toEqual([]);

    // The parallel's set team fills a teamless copy: that copy has a team.
    const t2 = convexTest(schema, modules);
    const fx2 = await seed(t2);
    await insertCard(t2, fx2, "1");
    await store(t2, fx2.parallel, { teamIds: [fx2.dodgers] });
    await build(t2, fx2);
    expect(lane).toEqual([]);
    expect((await copies(t2, fx2)).get("1")!.teamOnCardIds).toEqual([fx2.dodgers]);
  });
});
