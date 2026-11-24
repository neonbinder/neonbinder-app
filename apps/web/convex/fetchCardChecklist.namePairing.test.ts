/**
 * NEO-496 — the BuySportsCards ↔ SportLots player-name pairing in
 * `fetchCardChecklist` (step 1's fuzzy fallback), moved onto
 * `lib/cards/name-similarity.ts`.
 *
 * Pinned first as it behaved before the move (a BSC card no id or number
 * paired takes the unclaimed SportLots card whose name scores ≥ 0.92 against
 * its first player), then the rule 8 fix the move carries: a tie on either
 * side, or a SportLots card two BSC cards both want, is left unmatched for the
 * operator instead of going to whichever came first.
 *
 * Adapter mocking follows convex/fetchCardChecklist.nameConflict.test.ts.
 * No checklist is pasted or stored, so the stored-rows read (D9) answers
 * "none" and these runs pair marketplaces only.
 */

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";

type Card = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  cardVariation?: string;
  isVariation?: boolean;
  platformRef?: string;
  sportlotsRef?: string;
  sourceBscSetSlug?: string;
  sourceSlSetId?: string;
};

const mockState = vi.hoisted(() => ({
  bscCards: [] as Card[],
  slCards: [] as Card[],
}));

vi.mock("./adapters/buysportscards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./adapters/buysportscards")>();
  const { action, internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  return {
    ...actual,
    fetchBscChecklist: action({
      args: {
        parentFilters: v.record(v.string(), v.string()),
        platformFilters: v.optional(v.record(v.string(), v.array(v.string()))),
        facetFilters: v.optional(v.record(v.string(), v.array(v.string()))),
        sourceFacet: v.optional(
          v.union(v.literal("setName"), v.literal("variantName")),
        ),
      },
      returns: v.object({
        success: v.boolean(),
        cards: v.array(v.any()),
        message: v.optional(v.string()),
        collisions: v.optional(v.array(v.any())),
      }),
      handler: async () => ({ success: true, cards: mockState.bscCards }),
    }),
    // NEO-335: one entry per requested id; an empty list reads as every
    // lookup failed, which the caller treats exactly as "no team" before.
    fetchBscCardTeamNames: internalAction({
      args: { bscCardIds: v.array(v.string()) },
      returns: v.array(
        v.object({
          bscCardId: v.string(),
          teamName: v.string(),
          success: v.boolean(),
        }),
      ),
      handler: async () => [],
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
      returns: v.object({
        success: v.boolean(),
        cards: v.array(v.any()),
        message: v.optional(v.string()),
      }),
      handler: async () => ({ success: true, cards: mockState.slCards }),
    }),
  };
});

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_user_496_names",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_496_names",
  name: "Admin",
  role: "admin",
};

async function seedTree(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      // NEO-239 — SportLots is scoped by `sprt` + `yr`, so those two ids are
      // what make the SL side of this chain resolvable at all. Without them
      // SportLots is SKIPPED rather than queried by display name.
      platformData: { bsc: { b0: "baseball" }, sportlots: { s0: "BB" } },
      platformSlotSeq: { bsc: 1, sportlots: 1 },
      children: [],
      lastUpdated: Date.now(),
    });
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "2021",
      platformData: { bsc: { b0: "2021" }, sportlots: { s0: "2021" } },
      platformSlotSeq: { bsc: 1, sportlots: 1 },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Topps",
      platformData: { bsc: { b0: "topps" } },
      platformSlotSeq: { bsc: 1 },
      parentId: yearId,
      children: [],
      lastUpdated: Date.now(),
    });
    return await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: { bsc: { b0: "base" }, sportlots: { s0: "189991" } },
      // NEO-239 — the BSC slot names its facet; without the tag the row has no
      // `variant` axis and BSC is skipped.
      platformFacets: { bsc: { b0: "variant" } },
      primaryPlatformId: { bsc: "b0", sportlots: "s0" },
      platformSlotSeq: { bsc: 1, sportlots: 1 },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
  });
}

/** One BSC row and one SL row on the same number, so they auto-match. */
function pairOn(n: string, bscName: string, slName: string) {
  mockState.bscCards.push({
    cardNumber: n,
    cardName: bscName,
    platformRef: `bsc-${n}`,
    sourceBscSetSlug: "base",
  });
  mockState.slCards.push({
    cardNumber: n,
    cardName: slName,
    platformRef: `2021 Topps #${n} ${slName}`,
    sourceSlSetId: "189991",
  });
}

function bsc(n: string, player: string) {
  mockState.bscCards.push({
    cardNumber: n,
    cardName: player,
    players: [player],
    platformRef: `bsc-${n}`,
    sourceBscSetSlug: "base",
  });
}

function sl(n: string, name: string) {
  mockState.slCards.push({
    cardNumber: n,
    cardName: name,
    platformRef: `2021 Topps #${n} ${name}`,
    sourceSlSetId: "189991",
  });
}

async function fetch(t: ReturnType<typeof convexTest>, id: Id<"selectorOptions">) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.fetchCardChecklist, {
    selectorOptionId: id,
  });
}

async function buckets(t: ReturnType<typeof convexTest>, id: Id<"selectorOptions">) {
  const live = await t
    .withIdentity(ADMIN)
    .query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });
  return {
    matched: live.cards.filter((c) => c.bucket === "matched"),
    bscOnly: live.cards.filter((c) => c.bucket === "bscOnly"),
    slOnly: live.cards.filter((c) => c.bucket === "slOnly"),
  };
}

beforeEach(() => {
  mockState.bscCards = [];
  mockState.slCards = [];
});

describe("fetchCardChecklist — BSC ↔ SportLots name pairing (pinned before NEO-496)", () => {
  test("a near name on a different number pairs, with its score as the confidence", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    sl("T-10", "Mike Troutt");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.bsc?.ref).toBe("bsc-10");
    expect(matched[0].platformData.sportlots?.ref).toBe("2021 Topps #T-10 Mike Troutt");
    // The name score, whole: "10" and "T-10" agree (a leading letter prefix is
    // the same number), so nothing lowers it. Below 1, so it is shown with a %.
    expect(matched[0].confidence).toBeGreaterThanOrEqual(0.92);
    expect(matched[0].confidence).toBeLessThan(1);
    // NEO-640 — a name pair says so, so the client never skips Match Cards on
    // it; the numbers the sources printed ride with it for the picker.
    expect(matched[0].pairedBy).toBe("name");
    expect(matched[0].sourceNumbers).toEqual({ bsc: "10", sportlots: "T-10" });
    expect(bscOnly).toHaveLength(0);
    expect(slOnly).toHaveLength(0);
  });

  test("a name below 0.92 does not pair", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    sl("T-10", "Mike Stanton");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(1);
    expect(slOnly).toHaveLength(1);
  });

  test("a unique number pairs a card whose name matches too, and the numbered SportLots card is not offered to a name", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("1", "Mike Trout");
    bsc("2", "Shohei Ohtani");
    sl("1", "Mike Trout");
    sl("T-9", "Shohei Ohtani");

    await fetch(t, id);
    const { matched } = await buckets(t, id);

    const byBsc = new Map(matched.map((m) => [m.platformData.bsc?.ref, m]));
    expect(byBsc.get("bsc-1")?.platformData.sportlots?.ref).toBe("2021 Topps #1 Mike Trout");
    expect(byBsc.get("bsc-1")?.confidence).toBe(1);
    // Names first (NEO-591): the same roster pairs, and the number confirms it.
    expect(byBsc.get("bsc-1")?.pairedBy).toBe("name");
    expect(byBsc.get("bsc-2")?.platformData.sportlots?.ref).toBe("2021 Topps #T-9 Shohei Ohtani");
    expect(byBsc.get("bsc-2")?.pairedBy).toBe("name");
    // "2" against "T-9": different numbers, so the pair is scored lower (rule 7).
    expect(byBsc.get("bsc-2")?.confidence).toBeCloseTo(0.9, 6);
  });

  test("an exact name on a different number is a name pair at a lesser confidence, and carries both numbers (NEO-640, rule 7)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    sl("T-9", "Mike Trout");

    await fetch(t, id);
    const { matched } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].pairedBy).toBe("name");
    expect(matched[0].sourceNumbers).toEqual({ bsc: "10", sportlots: "T-9" });
    expect(matched[0].confidence).toBeCloseTo(0.9, 6);
    expect(matched[0].confidence).toBeLessThan(1);
  });

  test("a name pair whose numbers agree stays at 1 (NEO-640)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    // BSC lists the card as 38a, SportLots as 38: "38a" finds no SportLots
    // number, so only the name pairs it, but rule 7 says the numbers agree.
    mockState.bscCards.push({
      cardNumber: "38a",
      cardName: "Mike Trout",
      players: ["Mike Trout"],
      platformRef: "bsc-38a",
      sourceBscSetSlug: "base",
    });
    sl("38", "Mike Trout");

    await fetch(t, id);
    const { matched } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].pairedBy).toBe("name");
    expect(matched[0].confidence).toBe(1);
    // "38a" and "38" agree, but they are printed differently: the picker is
    // offered (an automatic number choice is never final), so the dialog opens.
    expect(matched[0].sourceNumbers).toEqual({ bsc: "38a", sportlots: "38" });
  });

  test("a prefix-stripped number pairs by number (NEO-640)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { metadata: { cardNumberPrefix: "OV-" } });
    });
    bsc("OV-5", "Mike Trout");
    sl("5", "Someone Else");

    await fetch(t, id);
    const { matched } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.sportlots?.ref).toBe("2021 Topps #5 Someone Else");
    expect(matched[0].pairedBy).toBe("number");
  });

  test("BSC's own SportLots cross-reference pairs across different numbers and names (NEO-640)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    mockState.bscCards.push({
      cardNumber: "10",
      cardName: "Mike Trout",
      players: ["Mike Trout"],
      platformRef: "bsc-10",
      sportlotsRef: "X-77",
      sourceBscSetSlug: "base",
    });
    mockState.slCards.push({
      cardNumber: "T-99",
      cardName: "Someone Else Entirely",
      platformRef: "2021 Topps #T-99 Someone Else Entirely",
      sportlotsRef: "X-77",
      sourceSlSetId: "189991",
    });

    await fetch(t, id);
    const { matched } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].confidence).toBe(1);
    expect(matched[0].pairedBy).toBe("crossRef");
  });

  test("an unmatched card carries no pairedBy (NEO-640)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    sl("T-10", "Mike Stanton");

    await fetch(t, id);
    const live = await t
      .withIdentity(ADMIN)
      .query(api.checklistCandidates.getReadyCandidates, { selectorOptionId: id });

    expect(live.cards).toHaveLength(2);
    for (const c of live.cards) expect(c.pairedBy).toBeUndefined();
  });

  test("each name pairs with its own best when two different players are left over", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    bsc("11", "Mookie Betts");
    sl("A", "Mooky Betts");
    sl("B", "Mike Troutt");

    await fetch(t, id);
    const { matched } = await buckets(t, id);

    const byBsc = new Map(matched.map((m) => [m.platformData.bsc?.ref, m]));
    expect(byBsc.get("bsc-10")?.platformData.sportlots?.ref).toBe("2021 Topps #B Mike Troutt");
    expect(byBsc.get("bsc-11")?.platformData.sportlots?.ref).toBe("2021 Topps #A Mooky Betts");
  });
});

describe("fetchCardChecklist — a name tie goes to the operator (NEO-496, rule 8)", () => {
  test("two SportLots cards with the same name: the BSC card pairs with neither", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    sl("A", "Mike Troutt");
    sl("B", "Mike Troutt");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(1);
    expect(slOnly).toHaveLength(2);
  });

  test("two BSC cards wanting one SportLots card equally: neither gets it (was: the first in list order)", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout");
    bsc("11", "Mike Trout");
    sl("A", "Mike Troutt");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(2);
    expect(slOnly).toHaveLength(1);
  });

  test("a SportLots card a later BSC card claims by number is never taken by an earlier card's name", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("10", "Mike Trout"); // no number match; its best name is SportLots #11
    bsc("11", "Mike Trout"); // pairs with SportLots #11 by number
    sl("11", "Mike Trout");

    await fetch(t, id);
    const { matched, bscOnly } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.bsc?.ref).toBe("bsc-11");
    expect(matched[0].confidence).toBe(1);
    expect(bscOnly.map((c) => c.platformData.bsc?.ref)).toEqual(["bsc-10"]);
  });
});

describe("fetchCardChecklist — a number listed twice by one source (NEO-640, rule 7)", () => {
  test("SportLots lists one number on two cards: BSC's card with that number pairs with neither", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("5", "Mike Trout");
    sl("5", "Cal Raleigh");
    sl("5", "Julio Rodriguez");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    // Was: the first SportLots row listed took BSC's #5, silently.
    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(1);
    expect(slOnly).toHaveLength(2);
  });

  test("a repeated number blocks only number-keyed pairing: an exactly-one name still pairs, a differing digit number does not", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    // Names first (NEO-591): BSC #5 Cal Raleigh and SportLots' #5 Cal Raleigh
    // are the one roster on each side, and their numbers agree. BSC #6 Julio
    // Rodriguez names SportLots' other #5, but 6 and 5 are two different plain
    // numbers, which never pair automatically: both wait for the operator.
    bsc("5", "Cal Raleigh");
    bsc("6", "Julio Rodriguez");
    sl("5", "Cal Raleigh");
    sl("5", "Julio Rodriguez");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    expect(matched.map((m) => m.platformData.bsc?.ref)).toEqual(["bsc-5"]);
    expect(matched[0].pairedBy).toBe("name");
    expect(matched[0].confidence).toBe(1);
    expect(bscOnly.map((c) => c.platformData.bsc?.ref)).toEqual(["bsc-6"]);
    expect(slOnly).toHaveLength(1);
  });

  test("BSC lists one number on two cards: neither pairs with the one SportLots row, and the row waits too", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    mockState.bscCards.push(
      {
        cardNumber: "5",
        cardName: "Mike Trout",
        players: ["Mike Trout"],
        platformRef: "bsc-5-a",
        sourceBscSetSlug: "base",
      },
      {
        cardNumber: "5",
        cardName: "Mike Trout",
        players: ["Mike Trout"],
        platformRef: "bsc-5-b",
        sourceBscSetSlug: "base",
      },
    );
    sl("5", "Mike Trout");

    await fetch(t, id);
    const { matched, bscOnly, slOnly } = await buckets(t, id);

    // Was: both BSC cards were stamped as paired to the same SportLots row.
    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(2);
    expect(slOnly).toHaveLength(1);
  });

  test("a tie on one number leaves the other numbers pairing as usual", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("5", "Mike Trout");
    bsc("6", "Mookie Betts");
    sl("5", "Cal Raleigh");
    sl("5", "Julio Rodriguez");
    sl("6", "Mookie Betts");

    await fetch(t, id);
    const { matched, bscOnly } = await buckets(t, id);

    expect(matched.map((m) => m.platformData.bsc?.ref)).toEqual(["bsc-6"]);
    expect(matched[0].pairedBy).toBe("name");
    expect(bscOnly.map((c) => c.platformData.bsc?.ref)).toEqual(["bsc-5"]);
  });

  test("a base card and its variation under one SportLots number is not a tie", async () => {
    const t = convexTest(schema, modules);
    const id = await seedTree(t);
    bsc("11", "Alec Bohm");
    sl("11", "Alec Bohm");
    mockState.slCards.push({
      cardNumber: "11",
      cardName: "Alec Bohm",
      cardVariation: "Action Image",
      isVariation: true,
      platformRef: "2021 Topps #11 Alec Bohm [ VAR Action Image ]",
      sourceSlSetId: "189991",
    });

    await fetch(t, id);
    const { matched, slOnly } = await buckets(t, id);

    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.sportlots?.ref).toBe("2021 Topps #11 Alec Bohm");
    expect(matched[0].pairedBy).toBe("name");
    expect(slOnly).toHaveLength(1);
  });
});
