/**
 * NEO-591 — `fetchCardChecklist` pairs NAMES FIRST with the numbers confirming
 * (product rule 7, rewritten 2026-11-18), on both seams:
 *
 *  - BuySportsCards against SportLots (steps 1a-1c): the identity links (the
 *    operator's stored pairing, BSC's `sportlotsRef`, the variation label)
 *    stay ahead of names; the number lookups with no exactly-one guard are
 *    gone, so two BSC "#1"s no longer both claim one SportLots "#1"; a pair
 *    made by name whose numbers differ is kept at 0.9 with `sourceNumbers`.
 *  - The operator's publisher checklist against the cards (step 3c): an Onyx
 *    set (letter numbers on BSC, an all-NNO publisher PDF) pairs 56 of 56 by
 *    name, and the pair carries the more specific number.
 *
 * The pairing core's own rules are in `lib/cards/pair-names-first.test.ts`;
 * these runs pin what the fetch does with them. Adapter mocking follows
 * `fetchCardChecklist.namePairing.test.ts`.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeTeamName } from "./teams";
import { NAMES_UNCONFIRMED_FACTOR } from "../lib/cards/pair-names-first";

type Card = {
  cardNumber: string;
  cardName: string;
  players?: string[];
  teams?: string[];
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
        waitKey: v.optional(v.string()),
      },
      returns: v.object({
        success: v.boolean(),
        cards: v.array(v.any()),
        message: v.optional(v.string()),
        collisions: v.optional(v.array(v.any())),
      }),
      handler: async () => ({ success: true, cards: mockState.bscCards }),
    }),
    // An empty list reads as every lookup failed ("no team"), which is all
    // these pairings need.
    fetchBscCardTeamNames: internalAction({
      args: { bscCardIds: v.array(v.string()), waitKey: v.optional(v.string()) },
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
  subject: "admin_user_591_names_first",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_591_names_first",
  name: "Admin",
  role: "admin",
};

async function seedTree(
  t: ReturnType<typeof convexTest>,
  cardNumberPrefix?: string,
): Promise<{ leafId: Id<"selectorOptions">; sportId: Id<"selectorOptions"> }> {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
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
      ...(cardNumberPrefix ? { metadata: { cardNumberPrefix } } : {}),
      platformData: { bsc: { b0: "topps" } },
      platformSlotSeq: { bsc: 1 },
      parentId: yearId,
      children: [],
      lastUpdated: Date.now(),
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: { bsc: { b0: "base" }, sportlots: { s0: "189991" } },
      platformFacets: { bsc: { b0: "variant" } },
      primaryPlatformId: { bsc: "b0", sportlots: "s0" },
      platformSlotSeq: { bsc: 1, sportlots: 1 },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    return { leafId, sportId };
  });
}

type ChecklistRow = {
  number: string;
  players: string[];
  teams: string[];
  noNumber?: boolean;
  variationName?: string;
};

async function fetchSet(
  t: ReturnType<typeof convexTest>,
  id: Id<"selectorOptions">,
  rows?: ChecklistRow[],
) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.fetchCardChecklist, {
    selectorOptionId: id,
    ...(rows ? { publishedChecklist: { rows } } : {}),
  });
}

/** The staged candidate rows, as stored (every wire field, not the live view). */
async function stored(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("checklistCandidates").collect());
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

const bsc = (n: string, player: string, ref = `bsc-${n}`): Card => ({
  cardNumber: n,
  cardName: player,
  players: [player],
  platformRef: ref,
  sourceBscSetSlug: "base",
});

const sl = (n: string, name: string, extra: Partial<Card> = {}): Card => ({
  cardNumber: n,
  cardName: name,
  platformRef: `2021 Topps #${n} ${name}`,
  sourceSlSetId: "189991",
  ...extra,
});

beforeEach(() => {
  mockState.bscCards = [];
  mockState.slCards = [];
  // The commit's finalize step can schedule a per-card BSC team lookup this
  // file's adapter mock does not cover; a throwing stub keeps it off the
  // network (the convention of the stickyPairing file).
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      throw new Error(`NEO-591: this test file must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BSC against SportLots: names first, numbers confirm", () => {
  test("the same player on different numbers pairs at 0.9, the card keeps the lettered number and both are kept", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("OV-ANFI", "Mike Trout")];
    mockState.slCards = [sl("7", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched, bscOnly, slOnly } = await buckets(t, leafId);

    expect(bscOnly).toHaveLength(0);
    expect(slOnly).toHaveLength(0);
    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.bsc?.ref).toBe("bsc-OV-ANFI");
    expect(matched[0].platformData.sportlots?.ref).toBe("2021 Topps #7 Mike Trout");
    expect(matched[0].confidence).toBeCloseTo(0.9, 10);
    expect(matched[0].cardNumber).toBe("OV-ANFI");
    expect(matched[0].sourceNumbers).toEqual({ bsc: "OV-ANFI", sportlots: "7" });
  });

  test("letters beat digits whichever side prints them: SportLots' '38a' over BSC's '38'", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout")];
    mockState.slCards = [sl("38a", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].cardNumber).toBe("38a");
    // "38" and "38a" agree (same card), so no discount; both prints still
    // ride along so Match Cards can offer either (Jason 2026-11-18).
    expect(matched[0].confidence).toBe(1);
    expect(matched[0].sourceNumbers).toEqual({ bsc: "38", sportlots: "38a" });
  });

  test("a pair made on the number because BSC names no player scores below 1 (NEO-640)", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      { cardNumber: "12", cardName: "", platformRef: "bsc-12", sourceBscSetSlug: "base" },
    ];
    mockState.slCards = [sl("12", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].pairedBy).toBe("number");
    expect(matched[0].confidence).toBe(NAMES_UNCONFIRMED_FACTOR);
    expect(matched[0].confidence).toBeLessThan(1);
  });

  test("numbers printed alike carry no sourceNumbers and a confidence of 1", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("12", "Mike Trout")];
    mockState.slCards = [sl("12", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].confidence).toBe(1);
    expect(matched[0].cardNumber).toBe("12");
    expect(matched[0].sourceNumbers).toBeUndefined();
  });

  test("a printed number over 64 characters is clipped to 64 on the wire", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    const long = `OV-${"X".repeat(80)}`;
    mockState.bscCards = [bsc(long, "Mike Trout")];
    mockState.slCards = [sl("7", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].sourceNumbers?.bsc).toHaveLength(64);
    expect(matched[0].sourceNumbers?.bsc).toBe(long.slice(0, 64));
    expect(matched[0].sourceNumbers?.sportlots).toBe("7");
  });

  test("sourceNumbers is set whenever the printed text differs, also on an identity-linked pair (BSC 1b against SportLots 1)", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [{ ...bsc("1b", "Mike Trout"), sportlotsRef: "sl-1" }];
    mockState.slCards = [sl("1", "Mike Trout", { platformRef: "sl-1" })];

    await fetchSet(t, leafId);
    const { matched } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].sourceNumbers).toEqual({ bsc: "1b", sportlots: "1" });
  });

  test("numbers that differ only in case or padding print alike: no sourceNumbers", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("ov-anfi", "Mike Trout")];
    mockState.slCards = [sl(" OV-ANFI ", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].sourceNumbers).toBeUndefined();
  });

  test("two BSC '#1's no longer both claim one SportLots '#1' (was: the first in list order)", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    // Unrelated names: only the number could pair them, and it is not unique.
    mockState.bscCards = [
      bsc("1", "Aaron Alpha", "bsc-1-a"),
      bsc("1", "Bobby Beta", "bsc-1-b"),
    ];
    mockState.slCards = [sl("1", "Carlos Gamma")];

    await fetchSet(t, leafId);
    const { matched, bscOnly, slOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(2);
    expect(slOnly).toHaveLength(1);
  });

  test("a repeated number only blocks number-keyed pairing: an exactly-one name still pairs", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      bsc("1", "Aaron Alpha", "bsc-1-a"),
      bsc("1", "Bobby Beta", "bsc-1-b"),
    ];
    mockState.slCards = [sl("1", "Aaron Alpha")];

    await fetchSet(t, leafId);
    const { matched, bscOnly, slOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.bsc?.ref).toBe("bsc-1-a");
    expect(matched[0].confidence).toBe(1);
    expect(bscOnly.map((c) => c.platformData.bsc?.ref)).toEqual(["bsc-1-b"]);
    expect(slOnly).toHaveLength(0);
  });

  test("BSC's own SportLots cross-reference wins over a name that points elsewhere", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      { ...bsc("5", "Mike Trout"), sportlotsRef: "ref-A" },
    ];
    mockState.slCards = [
      // BSC's cross-reference names this one, whatever it is called...
      sl("90", "Somebody Else", { sportlotsRef: "ref-A" }),
      // ...and this one has the player's name and the number.
      sl("5", "Mike Trout"),
    ];

    await fetchSet(t, leafId);
    const { matched, slOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].platformData.sportlots?.ref).toBe("2021 Topps #90 Somebody Else");
    // An identity link is certain, and keeps BSC's number as before.
    expect(matched[0].confidence).toBe(1);
    expect(matched[0].cardNumber).toBe("5");
    // The pair's two prints differ ("5" against "90"), so both ride along
    // even though no number decided the pair.
    expect(matched[0].sourceNumbers).toEqual({ bsc: "5", sportlots: "90" });
    expect(slOnly.map((c) => c.platformData.sportlots?.ref)).toEqual([
      "2021 Topps #5 Mike Trout",
    ]);
  });

  test("a letter prefix is not read off a number to pair by number: 'T-10' and '10' with different players stay apart", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("10", "Mike Trout")];
    mockState.slCards = [sl("T-10", "Mike Stanton")];

    await fetchSet(t, leafId);
    const { matched, bscOnly, slOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(1);
    expect(slOnly).toHaveLength(1);
  });

  test("the set's own prefix is stripped for a number pair: 'BCP-12' and '12' pair, and the names that disagree are surfaced", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t, "BCP-");
    mockState.bscCards = [bsc("BCP-12", "Mike Trout")];
    mockState.slCards = [sl("12", "Mike Stanton")];

    await fetchSet(t, leafId);
    const { matched, bscOnly, slOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(bscOnly).toHaveLength(0);
    expect(slOnly).toHaveLength(0);
    // Paired by number alone, the names disagreeing: the core discounts it.
    // The numbers agree, but they print differently, so both are offered.
    expect(matched[0].confidence).toBeCloseTo(0.9, 10);
    expect(matched[0].cardNumber).toBe("BCP-12");
    expect(matched[0].sourceNumbers).toEqual({ bsc: "BCP-12", sportlots: "12" });
    // The two sides name different players: the existing name conflict
    // carries it (`namesDisagree` needs no wire field of its own).
    expect(matched[0].nameConflict).toEqual({ bsc: "Mike Trout", sportlots: "Mike Stanton" });
  });

  test("a variation pairs only with a variation, even by name", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [{ ...bsc("9b", "Mike Trout"), isVariation: true, cardVariation: "Action" }];
    mockState.slCards = [sl("9", "Mike Trout")];

    await fetchSet(t, leafId);
    const { matched, bscOnly, slOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(0);
    expect(bscOnly).toHaveLength(1);
    expect(slOnly).toHaveLength(1);
  });
});

describe("BSC against SportLots: variations one side lacks (stem)", () => {
  const slVar = (name: string, label: string, ref: string): Card =>
    sl("38", name, { isVariation: true, cardVariation: label, platformRef: ref });

  test("SportLots-only bare-38 variations arrive pre-kept and minted 38b, 38c; the base keeps 38 and no ref is copied", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout")];
    mockState.slCards = [
      sl("38", "Mike Trout"),
      slVar("Aaa Legend", "Action", "sl-var-action"),
      slVar("Bbb Legend", "Sliding", "sl-var-sliding"),
    ];

    await fetchSet(t, leafId);
    const { matched, slOnly, bscOnly } = await buckets(t, leafId);

    expect(matched).toHaveLength(1);
    expect(matched[0].cardNumber).toBe("38");
    expect(bscOnly).toHaveLength(0);
    expect(slOnly.map((c) => c.cardNumber).sort()).toEqual(["38b", "38c"]);
    for (const c of slOnly) {
      expect(c.isVariation).toBe(true);
      expect(c.preKept).toBe(true);
      // The minted number is ours, so the commit never matches a stored row on it.
      expect(c.numberMinted).toBe(true);
      // The number SportLots printed rides along, so Match Cards can offer it
      // against the minted letter.
      expect(c.sourceNumbers).toEqual({ sportlots: "38" });
      // Single-source: its own SportLots ref only, never the parent's, and no BSC ref.
      expect(c.platformData.bsc).toBeUndefined();
      expect(c.platformData.sportlots?.ref).toMatch(/^sl-var-/);
      expect(c.platformData.sportlots?.ref).not.toBe(matched[0].platformData.sportlots?.ref);
    }
    // In SportLots' order.
    expect(slOnly.find((c) => c.cardNumber === "38b")?.platformData.sportlots?.ref).toBe("sl-var-action");
    expect(slOnly.find((c) => c.cardNumber === "38c")?.platformData.sportlots?.ref).toBe("sl-var-sliding");
  });

  test("a letter a card of the stem already uses is skipped: BSC's 38b leaves the next SportLots variation 38c", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      bsc("38", "Mike Trout"),
      { ...bsc("38b", "Casey Legend"), isVariation: true, cardVariation: "Throwback" },
    ];
    mockState.slCards = [sl("38", "Mike Trout"), slVar("Other Legend", "Action", "sl-var-action")];

    await fetchSet(t, leafId);
    const { matched, slOnly, bscOnly } = await buckets(t, leafId);

    expect(matched.map((c) => c.cardNumber)).toEqual(["38"]);
    expect(slOnly.map((c) => c.cardNumber)).toEqual(["38c"]);
    expect(slOnly[0].preKept).toBe(true);
    // BSC's own leftover variation is presumed wanted too, and keeps its number.
    expect(bscOnly.map((c) => c.cardNumber)).toEqual(["38b"]);
    expect(bscOnly[0].preKept).toBe(true);
    // Pre-kept without renumbering: BSC's own number is no minted one.
    expect(bscOnly[0].numberMinted).toBeUndefined();
    expect(slOnly[0].numberMinted).toBe(true);
  });

  test("two SportLots variations against two BSC variations that pair with none: no pre-keep, no minting, all four left for the operator", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      bsc("38", "Alec Bohm"),
      { ...bsc("38b", "Alec Bohm"), isVariation: true, cardVariation: "Gold Wave" },
      { ...bsc("38c", "Alec Bohm"), isVariation: true, cardVariation: "Silver Wave" },
    ];
    mockState.slCards = [
      sl("38", "Alec Bohm"),
      slVar("Alec Bohm", "Action Image", "sl-var-action"),
      slVar("Alec Bohm", "Throwback", "sl-var-throwback"),
    ];

    await fetchSet(t, leafId);
    const { matched, slOnly, bscOnly } = await buckets(t, leafId);

    expect(matched.map((c) => c.cardNumber)).toEqual(["38"]);
    expect(bscOnly.map((c) => c.cardNumber).sort()).toEqual(["38b", "38c"]);
    // SportLots' two keep the bare number it printed: nothing was renumbered.
    expect(slOnly.map((c) => c.cardNumber)).toEqual(["38", "38"]);
    for (const c of [...bscOnly, ...slOnly]) {
      expect(c.preKept).toBeUndefined();
      expect(c.numberMinted).toBeUndefined();
    }
  });

  test("b through z all taken: nothing is minted, the card keeps its number, is not pre-kept and is left for the operator", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    const letters = "bcdefghijklmnopqrstuvwxyz".split("");
    mockState.bscCards = [
      bsc("38", "Mike Trout"),
      ...letters.map((l, i) => ({
        ...bsc(`38${l}`, `Bsc Legend ${String.fromCharCode(97 + i)}${String.fromCharCode(97 + i)}`),
        isVariation: true,
        cardVariation: `Wave ${l}`,
      })),
    ];
    mockState.slCards = [sl("38", "Mike Trout"), slVar("Zed Legend", "Action", "sl-var-action")];

    await fetchSet(t, leafId);
    const { slOnly, bscOnly } = await buckets(t, leafId);

    expect(slOnly).toHaveLength(1);
    // Not a duplicate of any letter, and not silently renumbered or kept.
    expect(slOnly[0].cardNumber).toBe("38");
    expect(slOnly[0].preKept).toBeUndefined();
    expect(slOnly[0].numberMinted).toBeUndefined();
    expect(new Set(bscOnly.map((c) => c.cardNumber)).size).toBe(25);
  });

  test("a letter a STORED row of the leaf already holds is skipped when minting", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        { cardNumber: "38b", cardName: "Hand Added", teams: [], players: [], attributes: [], platformData: {} },
      ],
    });
    await drainScheduled(t);
    mockState.bscCards = [bsc("38", "Mike Trout")];
    mockState.slCards = [sl("38", "Mike Trout"), slVar("Aaa Legend", "Action", "sl-var-action")];

    await fetchSet(t, leafId);
    const { slOnly } = await buckets(t, leafId);

    expect(slOnly.map((c) => c.cardNumber)).toEqual(["38c"]);
  });

  test("with no paired parent nothing is pre-kept or renumbered", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.slCards = [slVar("Aaa Legend", "Action", "sl-var-action")];

    await fetchSet(t, leafId);
    const { slOnly } = await buckets(t, leafId);

    expect(slOnly).toHaveLength(1);
    expect(slOnly[0].cardNumber).toBe("38");
    expect(slOnly[0].preKept).toBeUndefined();
  });
});

/** 56 distinct players, as an Onyx-shaped set lists them. */
function onyxPlayers(): string[] {
  const first = ["Alder", "Briar", "Cedar", "Dunlop", "Elmer", "Fenwick", "Garrick", "Hollis"];
  const last = ["Ames", "Bell", "Cross", "Dean", "Eaton", "Frost", "Grove"];
  return first.flatMap((f) => last.map((l) => `${f} ${l}`));
}

/** Letters only, so the number reads as a printed code like "OV-ANFI". */
function onyxCode(i: number): string {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `${a[i % 26]}${a[Math.floor(i / 26)]}${a[(i * 7) % 26]}${a[(i * 11 + 3) % 26]}`;
}

describe("a publisher checklist: names first (Onyx)", () => {
  test("BSC letter numbers against an all-NNO checklist pair 56 of 56 at 0.9, the card keeps OV-..., the row says NNO", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    const players = onyxPlayers();
    expect(players).toHaveLength(56);
    mockState.bscCards = players.map((p, i) => bsc(`OV-${onyxCode(i)}`, p));

    const result = await fetchSet(
      t,
      leafId,
      players.map((p) => ({ number: "NNO", noNumber: true, players: [p], teams: [] })),
    );

    expect(result.success).toBe(true);
    expect(result.checklistMatch).toMatchObject({
      needsOperator: false,
      unusedRowIndices: [],
      leftoverCardKeys: [],
      checklistOnlyCount: 0,
    });
    const rows = (await stored(t)).filter((r) => r.bucket !== "checklistOnly");
    expect(rows).toHaveLength(56);
    for (const r of rows) {
      // The NB number is the lettered one; the NNO row never replaces it.
      expect(r.cardNumber).toMatch(/^OV-[A-Z]{4}$/);
      expect(r.checklistLink).toBeDefined();
      expect(r.checklistLink?.checklistNumber).toBe("NNO");
      expect(r.checklistLink?.confidence).toBeCloseTo(0.9, 10);
      // The number did not change, so there is nothing for Unlink to restore.
      expect(r.checklistLink?.revert?.cardNumber).toBeUndefined();
      expect(r.sourceNumbers).toEqual({ bsc: r.cardNumber, checklist: "NNO" });
    }
  });

  test("a row whose number has letters replaces a marketplace's bare digits, and Unlink can put them back", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("12", "Mike Trout")];

    await fetchSet(t, leafId, [
      { number: "BCP-12", players: ["Mike Trout"], teams: [] },
    ]);

    const [row] = await stored(t);
    // "BCP-12" and "12" agree (the letter prefix is read off), so this is no
    // disagreement; NB takes the more specific print.
    expect(row.cardNumber).toBe("BCP-12");
    expect(row.checklistLink?.revert?.cardNumber).toBe("12");
    expect(row.checklistLink?.checklistNumber).toBe("BCP-12");
    // Agreeing, but printed differently: both prints are on the wire so the
    // operator can change the pick.
    expect(row.sourceNumbers).toEqual({ bsc: "12", checklist: "BCP-12" });
  });

  test("a marketplace's lettered number is kept against the row's digits", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("OV-ANFI", "Mike Trout")];

    await fetchSet(t, leafId, [{ number: "44", players: ["Mike Trout"], teams: [] }]);

    const [row] = await stored(t);
    expect(row.cardNumber).toBe("OV-ANFI");
    expect(row.checklistLink?.checklistNumber).toBe("44");
    expect(row.checklistLink?.revert?.cardNumber).toBeUndefined();
    expect(row.sourceNumbers).toEqual({ bsc: "OV-ANFI", checklist: "44" });
  });

  test("an existing NB card keeps its number when a checklist carries a more specific one (rule 3)", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    const asAdmin = t.withIdentity(ADMIN);
    // The card is already in NB as "12", linked to BSC.
    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        {
          cardNumber: "12",
          cardName: "Mike Trout",
          teams: [],
          players: [],
          attributes: [],
          platformData: { bsc: { ref: "bsc-12", setId: "base" } },
        },
      ],
    });
    await drainScheduled(t);
    const before = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(before).toHaveLength(1);

    mockState.bscCards = [bsc("12", "Mike Trout")];
    await fetchSet(t, leafId, [{ number: "BCP-12", players: ["Mike Trout"], teams: [] }]);
    const [candidate] = await stored(t);
    expect(candidate.cardNumber).toBe("BCP-12");

    // The operator confirms the candidate as the fetch staged it, asking for
    // every content field to be applied. The number is not one of them.
    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        {
          cardNumber: candidate.cardNumber,
          cardName: "Mike Trout",
          teams: [],
          players: [],
          attributes: [],
          platformData: { bsc: { ref: "bsc-12", setId: "base" } },
          applyFields: ["cardName", "playerIds", "teamOnCardIds", "attributes", "isRookie", "isRelic", "printRun", "cardVariation"],
          baseVersion: before[0].lastUpdated,
        },
      ],
    });
    await drainScheduled(t);

    const after = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(after).toHaveLength(1);
    expect(after[0]._id).toBe(before[0]._id);
    expect(after[0].cardNumber).toBe("12");
  });
});

describe("a publisher checklist: a BSC number shared by two different players (2026 Immaculate Memorabilia)", () => {
  // Five BSC numbers each printed on two different players; the checklist
  // numbers every one of the ten with its own plain digits. Each name is
  // exactly one card and one row, so each pairs by name (letters against
  // digits, 0.9). A number two cards share must never block that, and two
  // cards sharing a number are not stem siblings: a stem needs the same player.
  const SHARED: Array<[string, string, string]> = [
    ["MEM-AA", "Aiva Arquette", "2"],
    ["MEM-AA", "Aaron Judge", "34"],
    ["MEM-BC", "Bubba Chandler", "6"],
    ["MEM-BC", "Billy Carlson", "16"],
    ["MEM-MM", "Mark Mulder", "30"],
    ["MEM-MM", "Marcelo Mayer", "37"],
    ["MEM-TB", "Travis Bazzana", "11"],
    ["MEM-TB", "Tyler Bremner", "40"],
    ["MEM-TH", "Todd Helton", "10"],
    ["MEM-TH", "Travis Hafner", "17"],
  ];

  test("all ten pair by name at 0.9, none left over, none created as a sibling", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = SHARED.map(([n, p], i) => bsc(n, p, `bsc-imm-${i}`));

    const result = await fetchSet(
      t,
      leafId,
      SHARED.map(([, p, rowNumber]) => ({ number: rowNumber, players: [p], teams: [] })),
    );

    expect(result.success).toBe(true);
    expect(result.checklistMatch).toMatchObject({
      needsOperator: false,
      unusedRowIndices: [],
      leftoverCardKeys: [],
      checklistOnlyCount: 0,
    });
    const rows = (await stored(t)).filter((r) => r.bucket !== "checklistOnly");
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      // The lettered BSC number stays the card's; the row's digits are the note.
      expect(r.cardNumber).toMatch(/^MEM-/);
      expect(r.checklistLink).toBeDefined();
      expect(r.checklistLink?.confidence).toBeCloseTo(0.9, 10);
    }
    expect(rows.map((r) => r.checklistLink?.checklistNumber).sort()).toEqual(
      SHARED.map(([, , n]) => n).sort(),
    );
  });
});

describe("a publisher checklist: team names that are aliases of one NB team (NEO-591)", () => {
  async function seedAthletics(t: ReturnType<typeof convexTest>, sportId: Id<"selectorOptions">) {
    return t.run(async (ctx) => {
      const aliases = ["Oakland Athletics", "Oakland A's"];
      const id = await ctx.db.insert("teams", {
        name: "Athletics",
        location: "Oakland",
        nameNormalized: normalizeTeamName("Oakland Athletics"),
        sportId,
        aliases,
        lastUpdated: 1,
      });
      for (const alias of aliases) {
        await ctx.db.insert("teamAliases", { teamId: id, sportId, aliasNormalized: normalizeTeamName(alias) });
      }
      return id;
    });
  }
  const mulder = ["Mark Mulder"];

  test("BSC's 'Oakland Athletics' against the checklist's 'Oakland A's' is no disagreement: no conflict, the card takes the team", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    await seedAthletics(t, sportId);
    mockState.bscCards = [{ ...bsc("MEM-MM", "Mark Mulder"), teams: ["Oakland Athletics"] }];

    await fetchSet(t, leafId, [{ number: "30", players: mulder, teams: ["Oakland A's"] }]);

    const [card] = (await stored(t)).filter((r) => r.bucket !== "checklistOnly");
    expect(card.checklistConflict?.teams).toBeUndefined();
    expect(card.teams).toEqual(["Oakland A's"]);
    expect(card.teamLookup).toBe("checklist");
  });

  test("a real different team is still asked", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    await seedAthletics(t, sportId);
    await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Red Sox",
        location: "Boston",
        nameNormalized: normalizeTeamName("Boston Red Sox"),
        sportId,
        lastUpdated: 1,
      }),
    );
    mockState.bscCards = [{ ...bsc("MEM-MM", "Mark Mulder"), teams: ["Oakland Athletics"] }];

    await fetchSet(t, leafId, [{ number: "30", players: mulder, teams: ["Boston Red Sox"] }]);

    const [card] = (await stored(t)).filter((r) => r.bucket !== "checklistOnly");
    expect(card.checklistConflict?.teams).toMatchObject({
      marketplace: ["Oakland Athletics"],
      checklist: ["Boston Red Sox"],
    });
    expect(card.teams).toEqual(["Oakland Athletics"]);
  });

  test("a name NB does not know is still asked", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    await seedAthletics(t, sportId);
    mockState.bscCards = [{ ...bsc("MEM-MM", "Mark Mulder"), teams: ["Oakland Athletics"] }];

    await fetchSet(t, leafId, [{ number: "30", players: mulder, teams: ["Oakland Elephants"] }]);

    const [card] = (await stored(t)).filter((r) => r.bucket !== "checklistOnly");
    expect(card.checklistConflict?.teams).toMatchObject({
      marketplace: ["Oakland Athletics"],
      checklist: ["Oakland Elephants"],
    });
  });
});

describe("a publisher checklist: variations (stem)", () => {
  const trout = ["Mike Trout"];

  test("one row's team lands on 38, 38b and 38c, each with its own revert and a shared rowKey", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      bsc("38", "Mike Trout", "bsc-38"),
      { ...bsc("38b", "Mike Trout", "bsc-38b"), isVariation: true },
      { ...bsc("38c", "Mike Trout", "bsc-38c"), isVariation: true },
    ];

    const result = await fetchSet(t, leafId, [
      { number: "38", players: trout, teams: ["Cincinnati Reds"] },
    ]);

    expect(result.checklistMatch).toMatchObject({ unusedRowIndices: [], checklistOnlyCount: 0 });
    const rows = await stored(t);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.teams).toEqual(["Cincinnati Reds"]);
      expect(r.teamLookup).toBe("checklist");
      expect(r.checklistLink?.rowKey).toBe(0);
      // Each card has its own revert (the card as it was before the row).
      expect(r.checklistLink?.revert).toMatchObject({ teamsFromRow: true });
      // Nobody is renumbered: each keeps the number it was fetched with.
      expect(r.checklistLink?.revert?.cardNumber).toBeUndefined();
    }
    const byNumber = new Map(rows.map((r) => [r.cardNumber, r]));
    expect([...byNumber.keys()].sort()).toEqual(["38", "38b", "38c"]);
    expect(byNumber.get("38b")?.checklistLink?.via).toBe("stem");
    expect(byNumber.get("38c")?.checklistLink?.via).toBe("stem");
    // A stem is no number disagreement.
    expect(byNumber.get("38b")?.sourceNumbers).toBeUndefined();
    expect(byNumber.get("38b")?.checklistLink?.checklistNumber).toBe("38");
  });

  test("a card with a differing team gets a conflict, never an overwrite (rule 8)", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [
      bsc("38", "Mike Trout", "bsc-38"),
      { ...bsc("38b", "Mike Trout", "bsc-38b"), isVariation: true, teams: ["Boston Red Sox"] },
    ];

    await fetchSet(t, leafId, [{ number: "38", players: trout, teams: ["Cincinnati Reds"] }]);

    const rows = new Map((await stored(t)).map((r) => [r.cardNumber, r]));
    expect(rows.get("38")?.teams).toEqual(["Cincinnati Reds"]);
    expect(rows.get("38")?.teamLookup).toBe("checklist");
    const b = rows.get("38b");
    expect(b?.teams).toEqual(["Boston Red Sox"]);
    expect(b?.teamLookup).not.toBe("checklist");
    expect(b?.checklistConflict?.teams).toMatchObject({
      marketplace: ["Boston Red Sox"],
      checklist: ["Cincinnati Reds"],
    });
    expect(b?.checklistLink?.rowKey).toBe(0);
  });

  test("card 38 against rows 38a and 38b: the card pairs with 38a, 38b becomes a pre-kept variation candidate", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout", "bsc-38")];

    const result = await fetchSet(t, leafId, [
      { number: "38a", players: trout, teams: ["Cincinnati Reds"] },
      { number: "38b", players: trout, teams: ["Cincinnati Reds"] },
    ]);

    const rows = new Map((await stored(t)).map((r) => [r.cardNumber, r]));
    expect([...rows.keys()].sort()).toEqual(["38a", "38b"]);
    const paired = rows.get("38a");
    expect(paired?.platformData.bsc?.ref).toBe("bsc-38");
    // Letters beat digits: the card carries 38a and Unlink can restore 38.
    expect(paired?.checklistLink?.revert?.cardNumber).toBe("38");
    const sibling = rows.get("38b");
    expect(sibling).toMatchObject({
      bucket: "checklistOnly",
      isVariation: true,
      preKept: true,
      teams: ["Cincinnati Reds"],
      players: ["Mike Trout"],
    });
    expect(sibling?.platformData).toEqual({});
    // The pair and its sibling share an NB-side token (never a marketplace
    // value), and the row's number that replaced the card's is flagged ours.
    expect(sibling?.variationGroup).toBeDefined();
    expect(paired?.variationGroup).toBe(sibling?.variationGroup);
    expect(paired?.numberMinted).toBe(true);
    // The sibling is used: it is not an unused row.
    expect(result.checklistMatch?.unusedRowIndices).toEqual([]);
  });

  test("a sibling row's variationName, when the parser kept one, is the created card's variation name", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout", "bsc-38")];

    await t.withIdentity(ADMIN).action(api.selectorOptions.fetchCardChecklist, {
      selectorOptionId: leafId,
      publishedChecklist: {
        rows: [
          { number: "38a", players: trout, teams: [] },
          // `variationName` is the parser's new optional field.
          { number: "38b", players: trout, teams: [], variationName: "Photo variation" },
        ],
      },
    });

    const rows = new Map((await stored(t)).map((r) => [r.cardNumber, r]));
    expect(rows.get("38b")?.cardVariation).toBe("Photo variation");
  });

  test("the server's re-check strips control characters from a variation name and refuses one over 80", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout", "bsc-38")];
    const asAdmin = t.withIdentity(ADMIN);

    await asAdmin.action(api.selectorOptions.fetchCardChecklist, {
      selectorOptionId: leafId,
      publishedChecklist: {
        rows: [
          { number: "38a", players: trout, teams: [] },
          { number: "38b", players: trout, teams: [], variationName: "  Photo\u0007\n variation " },
        ],
      },
    });
    const rows = new Map((await stored(t)).map((r) => [r.cardNumber, r]));
    expect(rows.get("38b")?.cardVariation).toBe("Photo variation");

    // Bidirectional and line-separator format characters go too (the parser's
    // own set): each becomes a space, then the whitespace folds.
    await asAdmin.action(api.selectorOptions.fetchCardChecklist, {
      selectorOptionId: leafId,
      publishedChecklist: {
        rows: [
          { number: "38a", players: trout, teams: [] },
          {
            number: "38b",
            players: trout,
            teams: [],
            variationName: "Photo\u202e\u2066variation\u200f\u2028\u2029 two\u200e",
          },
        ],
      },
    });
    const bidi = new Map((await stored(t)).map((r) => [r.cardNumber, r]));
    expect(bidi.get("38b")?.cardVariation).toBe("Photo variation two");

    // Zero-width and BOM characters too (U+061C, U+200B-200D, U+FEFF).
    await asAdmin.action(api.selectorOptions.fetchCardChecklist, {
      selectorOptionId: leafId,
      publishedChecklist: {
        rows: [
          { number: "38a", players: trout, teams: [] },
          {
            number: "38b",
            players: trout,
            teams: [],
            variationName: "\ufeffPhoto\u200b\u200c\u200d\u061cvariation three",
          },
        ],
      },
    });
    const zeroWidth = new Map((await stored(t)).map((r) => [r.cardNumber, r]));
    expect(zeroWidth.get("38b")?.cardVariation).toBe("Photo variation three");

    await expect(
      asAdmin.action(api.selectorOptions.fetchCardChecklist, {
        selectorOptionId: leafId,
        publishedChecklist: {
          rows: [{ number: "38b", players: trout, teams: [], variationName: "x".repeat(81) }],
        },
      }),
    ).rejects.toThrow(/variation name over 80/);
  });

  test("a paired row keeps its variationName, so Unlink or a relink puts back the same variation card", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout", "bsc-38")];

    await fetchSet(t, leafId, [
      { number: "38", players: trout, teams: [], variationName: "Photo variation" } as ChecklistRow,
    ]);

    const [row] = await stored(t);
    expect(row.checklistLink?.row?.variationName).toBe("Photo variation");
  });

  test("every sibling row becomes a candidate: none is silently dropped", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout", "bsc-38")];

    await fetchSet(t, leafId, [
      { number: "38a", players: trout, teams: [] },
      { number: "38b", players: trout, teams: [] },
      { number: "38c", players: trout, teams: [] },
      { number: "38d", players: trout, teams: [] },
    ]);

    const rows = await stored(t);
    const siblings = rows.filter((r) => r.bucket === "checklistOnly");
    expect(siblings.map((r) => r.cardNumber).sort()).toEqual(["38b", "38c", "38d"]);
    expect(siblings.every((r) => r.isVariation === true && r.preKept === true)).toBe(true);
    expect(rows).toHaveLength(4);
  });

  test("the commit links a created 38b to its parent card by stem", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    mockState.bscCards = [bsc("38", "Mike Trout", "bsc-38")];
    await fetchSet(t, leafId, [
      { number: "38a", players: trout, teams: [] },
      { number: "38b", players: trout, teams: [] },
    ]);
    const staged = await stored(t);

    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: staged.map((r) => ({
        cardNumber: r.cardNumber,
        cardName: r.cardName,
        teams: [],
        players: r.players ?? [],
        attributes: [],
        ...(r.isVariation ? { isVariation: true } : {}),
        platformData: r.platformData,
      })),
    });
    await drainScheduled(t);

    const rows = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    const parent = rows.find((r) => r.cardNumber === "38a");
    const child = rows.find((r) => r.cardNumber === "38b");
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    expect(child?.variationOfCardId).toBe(parent?._id);
    expect(parent?.variationOfCardId).toBeUndefined();
  });

  test("a created variation is not linked when two series each have a parent of its stem (rule 7)", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);

    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        { cardNumber: "38", cardName: "Series One", teams: [], players: [], attributes: [], platformData: { bsc: { ref: "s1-38", setId: "series-1" } } },
        { cardNumber: "38", cardName: "Series Two", teams: [], players: [], attributes: [], platformData: { bsc: { ref: "s2-38", setId: "series-2" } } },
        { cardNumber: "38b", cardName: "Made From A Row", teams: [], players: [], attributes: [], isVariation: true, platformData: {} },
      ],
    });
    await drainScheduled(t);

    const rows = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.cardNumber === "38b")?.variationOfCardId).toBeUndefined();
  });

  test("a shared variationGroup links the created variation to ITS parent even where two series share the stem", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);

    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        { cardNumber: "38", cardName: "Series One", teams: [], players: [], attributes: [], platformData: { bsc: { ref: "s1-38", setId: "series-1" } } },
        { cardNumber: "38a", cardName: "Series Two", teams: [], players: [], attributes: [], variationGroup: "g4", platformData: { bsc: { ref: "s2-38", setId: "series-2" } } },
        { cardNumber: "38b", cardName: "Made From A Row", teams: [], players: [], attributes: [], isVariation: true, variationGroup: "g4", platformData: {} },
      ],
    });
    await drainScheduled(t);

    const rows = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    const child = rows.find((r) => r.cardNumber === "38b");
    expect(child?.variationOfCardId).toBe(rows.find((r) => r.cardNumber === "38a")?._id);
  });

  test("a token with two parents, or one the variation does not share, links nothing by itself", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);

    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        { cardNumber: "38", cardName: "Series One", teams: [], players: [], attributes: [], variationGroup: "g1", platformData: { bsc: { ref: "s1-38", setId: "series-1" } } },
        { cardNumber: "38", cardName: "Series Two", teams: [], players: [], attributes: [], variationGroup: "g1", platformData: { bsc: { ref: "s2-38", setId: "series-2" } } },
        { cardNumber: "38b", cardName: "Made From A Row", teams: [], players: [], attributes: [], isVariation: true, variationGroup: "g1", platformData: {} },
        { cardNumber: "38c", cardName: "Elsewhere", teams: [], players: [], attributes: [], isVariation: true, variationGroup: "g9", platformData: {} },
      ],
    });
    await drainScheduled(t);

    const rows = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(rows.find((r) => r.cardNumber === "38b")?.variationOfCardId).toBeUndefined();
    expect(rows.find((r) => r.cardNumber === "38c")?.variationOfCardId).toBeUndefined();
  });

  test("a minted number never matches a stored ref-less row: the stored row is untouched and the variation inserts", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    const asAdmin = t.withIdentity(ADMIN);
    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        { cardNumber: "38b", cardName: "Hand Added", teams: [], players: [], attributes: [], platformData: {} },
      ],
    });
    await drainScheduled(t);
    const before = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(before).toHaveLength(1);
    const slVarCard = {
      cardNumber: "38b",
      cardName: "Aaa Legend",
      teams: [],
      players: [],
      attributes: [],
      isVariation: true,
      platformData: { sportlots: { ref: "sl-var-action", setId: "189991" } },
    };

    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [{ ...slVarCard, numberMinted: true as const }],
    });
    await drainScheduled(t);

    const after = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(after).toHaveLength(2);
    const handAdded = after.find((r) => r._id === before[0]._id);
    expect(handAdded?.platformData).toEqual(before[0].platformData);
    expect(after.find((r) => r._id !== before[0]._id)?.platformData?.sportlots).toBeDefined();
  });

  test("the same card WITHOUT the flag still matches the stored row by number (the tiers are untouched)", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    const asAdmin = t.withIdentity(ADMIN);
    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        { cardNumber: "38b", cardName: "Hand Added", teams: [], players: [], attributes: [], platformData: {} },
      ],
    });
    await drainScheduled(t);

    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        {
          cardNumber: "38b",
          cardName: "Hand Added",
          teams: [],
          players: [],
          attributes: [],
          platformData: { sportlots: { ref: "sl-38b", setId: "189991" } },
        },
      ],
    });
    await drainScheduled(t);

    const after = await t.run((ctx) => ctx.db.query("cardChecklist").collect());
    expect(after).toHaveLength(1);
    expect(after[0].platformData?.sportlots).toBeDefined();
  });

  test("a commit card whose sourceNumbers value is over 64 characters is refused; 64 passes", async () => {
    const t = convexTest(schema, modules);
    const { leafId, sportId } = await seedTree(t);
    const asAdmin = t.withIdentity(ADMIN);
    const card = (n: string) => ({
      cardNumber: "7",
      cardName: "Mike Trout",
      teams: [],
      players: [],
      attributes: [],
      platformData: {},
      sourceNumbers: { bsc: n },
    });

    await expect(
      asAdmin.action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: leafId,
        sportId,
        cards: [card("x".repeat(65))],
      }),
    ).rejects.toThrow(/source number over 64 characters/);
    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: leafId,
      sportId,
      cards: [card("x".repeat(64))],
    });
    await drainScheduled(t);
    expect(await t.run((ctx) => ctx.db.query("cardChecklist").collect())).toHaveLength(1);
  });
});
