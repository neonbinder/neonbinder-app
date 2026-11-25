/**
 * NEO-528 round 3 — the parallel build and "Player on every card": each copy
 * keeps what its insert card says (players, cameos), then takes the
 * PARALLEL's own or inherited defaults through the same per-card rule every
 * new card follows; and the Set Team gap: the parallel's own set-level team
 * goes on a copy that arrives with none (fill-empty only). Harness:
 * `parallelChecklistBuild.secondaryPlayers.test.ts`.
 *
 *   Baseball › 2024 › Bowman › Insert (variant type) › Anime (insert)
 *                                                       › Anime Kanji (parallel, BSC only)
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { setCardSecondaryPlayers } from "./cardSecondaryPlayers";
import { teamRowFields } from "./lib/teamRow";
import { MAX_CARD_PLAYERS } from "./features/cardAttention";
import * as parallelBuild from "./parallelChecklistBuild";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo528_parallel_defaults",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo528_parallel_defaults",
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

const bscState = vi.hoisted(() => ({
  cards: [] as StubCard[],
  /** Runs inside the build's BSC fetch: after the hold check, before any copy. */
  duringFetch: null as null | (() => Promise<void>),
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
      handler: async () => {
        await bscState.duringFetch?.();
        return { success: true, cards: bscState.cards };
      },
    }),
  };
});

beforeEach(() => {
  bscState.cards = [];
  bscState.duringFetch = null;
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

const RULED_TEAMLESS = { teamNoneConfirmedAt: NOW, teamNoneConfirmedByUserId: "user_operator" };

const ownsItsTeamState = (extra: Partial<Doc<"cardChecklist">> | undefined) =>
  !!extra &&
  ("teamCheckDoneAt" in extra || "teamNoneConfirmedAt" in extra || "bscTeamName" in extra);

/**
 * An insert card; `players` are linked under their own names. NEO-661: a card
 * waiting on its team lookup (a BSC ref, no team, no stamp) or pink holds the
 * whole build, so a card given neither `teams` nor its own team state in `extra` is one an operator
 * ruled teamless: tidy, and it owes no lookup. A test about a team on the copy
 * passes `teams` and `buildThenDropTeams`.
 */
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
      ...(opts.teams || ownsItsTeamState(opts.extra) ? {} : RULED_TEAMLESS),
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
  return result;
}

/**
 * The copy page meeting a source that has lost its team since the hold check
 * (the only way a teamless, lookup-owing source reaches a copy now): each card
 * in `numbers` starts with a team, so the hold lets the build through, and has
 * none by the time BSC's fetch returns, just before the copy pages.
 */
async function buildThenDropTeams(t: T, fx: Fx, numbers: string[]) {
  bscState.duringFetch = () =>
    t.run(async (ctx) => {
      const cards = await ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", fx.insert))
        .collect();
      for (const c of cards) {
        if (numbers.includes(c.cardNumber)) await ctx.db.patch(c._id, { teamOnCardIds: undefined });
      }
    });
  return build(t, fx);
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

describe("parallel build — the parallel's player defaults (NEO-528 round 3)", () => {
  test("the parallel's own default player fills a copy with none; a copy that names someone keeps them", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { players: [[fx.ohtani, "Shohei Ohtani"]] });
    await insertCard(t, fx, "2");
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes] });
    await build(t, fx);

    const got = await copies(t, fx);
    expect(got.get("1")!.playerIds).toEqual([fx.ohtani]);
    const two = got.get("2")!;
    expect(two.playerIds).toEqual([fx.skenes]);
    expect(two.playerLinks).toEqual([{ playerId: fx.skenes, nameOnCard: "Paul Skenes" }]);
    expect(two.playerIndex).toEqual([fx.skenes]);
    expect(two.listingTitle).toContain("Paul Skenes");
    // The insert card itself is untouched: the default is the parallel's.
    const source = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", fx.insert))
          .collect()
      ).find((c) => c.cardNumber === "2"),
    );
    expect(source!.playerIds).toBeUndefined();
  });

  test("a default inherited from above (the insert, the set) applies, and the parallel's own wins over it", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1");
    await store(t, fx.setName, { defaultPlayerIds: [fx.judge], defaultCameoIds: [fx.soto] });
    await build(t, fx);
    let one = (await copies(t, fx)).get("1")!;
    expect(one.playerIds).toEqual([fx.judge]);
    expect(one.secondaryPlayerIds).toEqual([fx.soto]);

    // The parallel's own value replaces the inherited one, as a whole.
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes], defaultCameoIds: [fx.ohtani] });
    await build(t, fx);
    one = (await copies(t, fx)).get("1")!;
    expect(one.playerIds).toEqual([fx.skenes]);
    expect(one.secondaryPlayerIds).toEqual([fx.ohtani]);
    expect(one.cameoIndex).toEqual([fx.ohtani]);
  });

  // NEO-645 (J3), widened by NEO-661 to any pink card: a source card with a name
  // still waiting is pink, and the build refuses it before it deletes or copies
  // anything, so the default player never lands on a card whose own player is
  // unanswered.
  test("a pending name on the insert card blocks the build: nothing is copied, no default lands", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { extra: { pendingPlayerNames: ["S. Ohtani"] } });
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes], defaultCameoIds: [fx.soto] });
    await stubParallelListing(t, fx);
    const result = await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: fx.parallel });
    expect(result.status).toBe("blocked");
    expect((await copies(t, fx)).size).toBe(0);
  });

  // Jason, 2026-11-15: a card whose listing named anyone, even a name entity
  // review ruled "not a person" (no id, no pending name left), is born blank.
  // Its parallel copy is born from the same listing, so it stays blank too.
  test("an insert card whose listing named someone it does not carry: the copy stays blank, keeps the claim, and takes the cameos", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { extra: { listingNamedPlayer: true } });
    await insertCard(t, fx, "2");
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes], defaultCameoIds: [fx.soto] });
    await build(t, fx);
    const got = await copies(t, fx);

    const one = got.get("1")!;
    expect(one.playerIds).toBeUndefined();
    expect(one.playerLinks).toBeUndefined();
    expect(one.playerIndex).toEqual([]);
    expect(one.listingTitle).not.toContain("Paul Skenes");
    expect(one.secondaryPlayerIds).toEqual([fx.soto]);
    // Carried forward, so a card born from this copy holds the default back.
    expect(one.listingNamedPlayer).toBe(true);

    // The nameless card beside it takes the default, and carries no claim.
    const two = got.get("2")!;
    expect(two.playerIds).toEqual([fx.skenes]);
    expect(two.secondaryPlayerIds).toEqual([fx.soto]);
    expect(two).not.toHaveProperty("listingNamedPlayer");
  });

  test("the claim travels with a card that names its player: the copy keeps the player and the claim", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", {
      players: [[fx.ohtani, "Shohei Ohtani"]],
      extra: { listingNamedPlayer: true },
    });
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes] });
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.playerIds).toEqual([fx.ohtani]);
    expect(one.listingNamedPlayer).toBe(true);
  });

  test("the copy's own cameos come first, then the defaults; a copied cameo who is the default player moves up", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const card1 = await insertCard(t, fx, "1");
    const card2 = await insertCard(t, fx, "2", { players: [[fx.ohtani, "Shohei Ohtani"]] });
    await t.run(async (ctx) => {
      await setCardSecondaryPlayers(ctx, (await ctx.db.get(card1))!, [fx.skenes, fx.judge]);
      await setCardSecondaryPlayers(ctx, (await ctx.db.get(card2))!, [fx.judge]);
    });
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes], defaultCameoIds: [fx.soto, fx.judge] });
    await build(t, fx);
    const got = await copies(t, fx);

    // Card 1 had no player and Skenes as a cameo: Skenes is promoted.
    const one = got.get("1")!;
    expect(one.playerIds).toEqual([fx.skenes]);
    expect(one.secondaryPlayerIds).toEqual([fx.judge, fx.soto]);
    expect([...one.cameoIndex].sort()).toEqual([fx.judge, fx.soto].sort());
    expect(one.listingDescription).toContain("Cameos: Aaron Judge, Juan Soto.");

    // Card 2 names Ohtani: kept; cameos are its own Judge then Soto.
    const two = got.get("2")!;
    expect(two.playerIds).toEqual([fx.ohtani]);
    expect(two.secondaryPlayerIds).toEqual([fx.judge, fx.soto]);
  });

  test("a copied cameo who is no longer in NB is left off; the copy is still made", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    const card1 = await insertCard(t, fx, "1", { players: [[fx.ohtani, "Shohei Ohtani"]] });
    await t.run(async (ctx) => {
      await setCardSecondaryPlayers(ctx, (await ctx.db.get(card1))!, [fx.judge, fx.soto]);
      await ctx.db.delete(fx.judge);
    });
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.secondaryPlayerIds).toEqual([fx.soto]);
    expect(one.cameoIndex).toEqual([fx.soto]);
    expect(one.listingDescription).toContain("Cameo: Juan Soto.");
  });

  test("with no defaults anywhere a copy is the insert card's, exactly as before", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1");
    await build(t, fx);
    const one = (await copies(t, fx)).get("1")!;
    expect(one.playerIds).toBeUndefined();
    expect(one).not.toHaveProperty("secondaryPlayerIds");
    expect(one.teamOnCardIds).toBeUndefined();
  });
});

describe("parallel build — the parallel's own Set Team, fill-empty (the Set Team gap)", () => {
  test("a copy with no team takes the parallel's; a copy with its own team keeps it", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { players: [[fx.ohtani, "Shohei Ohtani"]], teams: [fx.yankees] });
    await insertCard(t, fx, "2", { players: [[fx.judge, "Aaron Judge"]], teams: [fx.yankees] });
    await store(t, fx.parallel, { teamIds: [fx.dodgers] });
    await buildThenDropTeams(t, fx, ["1"]);
    const got = await copies(t, fx);
    const one = got.get("1")!;
    expect(one.teamOnCardIds).toEqual([fx.dodgers]);
    expect(one.teamIndex).toEqual([fx.dodgers]);
    expect(one.listingDescription).toContain("Team: Los Angeles Dodgers.");
    const two = got.get("2")!;
    expect(two.teamOnCardIds).toEqual([fx.yankees]);
    expect(two.teamIndex).toEqual([fx.yankees]);
  });

  test("never over an operator's no-team ruling", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "2", { extra: { teamNoneConfirmedAt: NOW } });
    await store(t, fx.parallel, { teamIds: [fx.yankees] });
    await build(t, fx);
    const got = await copies(t, fx);
    expect(got.get("2")!.teamOnCardIds).toBeUndefined();
    expect(got.get("2")!.teamIndex).toEqual([]);
  });

  // A listing that named a team NB could not match, its lookup already answered
  // and no team on the card, is pink: the build refuses rather than fill the
  // parallel's team over a team the data named (invariant 8; NEO-661).
  test("a listing's unmatched team on a teamless source holds the build: no team is filled over it", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "3", { extra: { bscTeamName: "LA Dodgers", teamCheckDoneAt: NOW } });
    await store(t, fx.parallel, { teamIds: [fx.yankees] });
    await stubParallelListing(t, fx);
    const result = await t
      .withIdentity(ADMIN)
      .action(api.parallelChecklistBuild.buildParallelChecklist, { parallelId: fx.parallel });
    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toBe(parallelBuild.BLOCKED_SOURCE_NOT_TIDY);
    expect((await copies(t, fx)).size).toBe(0);
  });

  test("a team on the insert row only (not the parallel) is not written: the parallel's own value is read", async () => {
    const t = convexTest(schema, modules);
    const fx = await seed(t);
    await insertCard(t, fx, "1", { teams: [fx.yankees] });
    await store(t, fx.insert, { teamIds: [fx.dodgers] });
    await buildThenDropTeams(t, fx, ["1"]);
    expect((await copies(t, fx)).get("1")!.teamOnCardIds).toBeUndefined();
  });
});

describe("parallel build — a page of copies with long cameo lists stops at its write budget and resumes", () => {
  test("every copy is made, over more than one page", async () => {
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
    const COUNT = 60; // 60 copies x 23 writes is past INSERT_PAGE_WRITE_BUDGET
    expect(COUNT * (2 + 1 + MAX_CARD_PLAYERS)).toBeGreaterThan(parallelBuild.INSERT_PAGE_WRITE_BUDGET);
    for (let i = 1; i <= COUNT; i++) await insertCard(t, fx, String(i));
    await store(t, fx.parallel, { defaultPlayerIds: [fx.skenes], defaultCameoIds: cameos });

    const page = parallelBuild.insertParallelCardsPage as unknown as {
      _handler: (...args: unknown[]) => Promise<unknown>;
    };
    const spy = vi.spyOn(page, "_handler");
    try {
      const result = await build(t, fx);
      expect(result.copied).toBe(COUNT);
      expect(spy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
    const got = await copies(t, fx);
    expect(got.size).toBe(COUNT);
    for (const card of got.values()) {
      expect(card.playerIds).toEqual([fx.skenes]);
      expect(card.secondaryPlayerIds).toEqual(cameos);
      expect(card.cameoIndex).toHaveLength(MAX_CARD_PLAYERS);
    }
  });
});
