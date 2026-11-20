/**
 * NEO-591 (Jason, 2026-11-20) — a printed PLACE that pairing left as printed
 * ("Seattle": the 1969 Pilots and the Mariners are both in the set's league)
 * AGREES with a marketplace team that is one of the place's teams. There is no
 * team conflict, and the card keeps the marketplace's team: the place adds no
 * claim beyond it and is never written over it.
 *
 * Driven through the two pairing paths that must agree: `fetchCardChecklist`
 * (the matcher's pairs, step 3c) and `applyPublishedChecklistPairs` (the
 * operator's own links). The pure rule is in
 * `lib/checklists/apply-published-row.test.ts`; the place query and its
 * wrapper are in `checklistCandidates.placeTeams.test.ts`.
 *
 * Both BSC adapter actions are mocked at the module boundary (the convention
 * of `fetchCardChecklist.publishedChecklist.test.ts`); nothing reaches a
 * network.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { normalizeEntityName } from "./lib/entityNearMatch";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

type BscCard = {
  cardNumber: string;
  cardName: string;
  teams?: string[];
  players?: string[];
  platformRef?: string;
};

const mockState = vi.hoisted(() => ({
  bscCards: [] as BscCard[],
  teamLookupCalls: [] as string[][],
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
        sourceFacet: v.optional(v.union(v.literal("setName"), v.literal("variantName"))),
        waitKey: v.optional(v.string()),
      },
      returns: v.object({
        success: v.boolean(),
        cards: v.array(v.any()),
        message: v.optional(v.string()),
        collisions: v.optional(v.array(v.any())),
      }),
      handler: async (): Promise<{ success: boolean; cards: BscCard[] }> => ({
        success: true,
        cards: mockState.bscCards,
      }),
    }),
    fetchBscCardTeamNames: internalAction({
      args: { bscCardIds: v.array(v.string()), waitKey: v.optional(v.string()) },
      returns: v.array(
        v.object({
          bscCardId: v.string(),
          rawTeamName: v.string(),
          teamNames: v.array(v.string()),
          success: v.boolean(),
          skipped: v.optional(v.literal(true)),
        }),
      ),
      handler: async (_ctx, args) => {
        mockState.teamLookupCalls.push(args.bscCardIds);
        return args.bscCardIds.map((bscCardId) => ({
          bscCardId,
          rawTeamName: "",
          teamNames: [],
          success: true,
        }));
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
      returns: v.object({
        success: v.boolean(),
        cards: v.array(v.any()),
        message: v.optional(v.string()),
      }),
      handler: async () => ({ success: true, cards: [] }),
    }),
  };
});

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_place_agreement_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_place_agreement_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
const live: T[] = [];
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});
beforeEach(() => {
  mockState.bscCards = [];
  mockState.teamLookupCalls = [];
});

/**
 * Baseball > 2024 > Topps (in MLB) > Base. In MLB: the Pilots (1969) and the
 * Mariners (1977-, alias "M's") share Seattle; the Cubs and the White Sox share
 * Chicago; the Red Sox are Boston's only team. The Kraken are in another league.
 */
async function seed(t: T): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      platformData: { bsc: { b0: "baseball" } },
      platformSlotSeq: { bsc: 1 },
      children: [],
      lastUpdated: now,
    });
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "2024",
      platformData: { bsc: { b0: "2024" } },
      platformSlotSeq: { bsc: 1 },
      parentId: sportId,
      children: [],
      lastUpdated: now,
    });
    await ctx.db.patch(sportId, { children: [yearId] });
    const mlb = await ctx.db.insert("leagues", {
      name: "Major League Baseball",
      nameNormalized: "major league baseball",
      sportId,
      level: "major",
      lastUpdated: now,
    });
    const other = await ctx.db.insert("leagues", {
      name: "Exhibition",
      nameNormalized: "exhibition",
      sportId,
      level: "other",
      lastUpdated: now,
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "2024 Topps",
      platformData: { bsc: { b0: "2024-topps" } },
      platformSlotSeq: { bsc: 1 },
      leagueIds: [mlb],
      parentId: yearId,
      children: [],
      lastUpdated: now,
    });
    await ctx.db.patch(yearId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: { bsc: { b0: "base" } },
      platformFacets: { bsc: { b0: "variant" } },
      primaryPlatformId: { bsc: "b0" },
      platformSlotSeq: { bsc: 1 },
      parentId: setNameId,
      children: [],
      lastUpdated: now,
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    const team = async (
      name: string,
      location: string,
      leagueId: Id<"leagues">,
      opts: { aliases?: string[]; yearsActive?: { from: number; to?: number } } = {},
    ) => {
      const id = await ctx.db.insert("teams", {
        ...teamRowFields({ name, location }),
        sportId,
        leagueId,
        ...(opts.aliases ? { aliases: opts.aliases } : {}),
        ...(opts.yearsActive ? { yearsActive: opts.yearsActive } : {}),
        lastUpdated: now,
      });
      for (const alias of opts.aliases ?? []) {
        await ctx.db.insert("teamAliases", { teamId: id, sportId, aliasNormalized: normalizeEntityName(alias) });
      }
    };
    await team("Pilots", "Seattle", mlb, { yearsActive: { from: 1969, to: 1969 } });
    await team("Mariners", "Seattle", mlb, { aliases: ["M's"], yearsActive: { from: 1977 } });
    await team("Kraken", "Seattle", other, { yearsActive: { from: 2021 } });
    await team("Cubs", "Chicago", mlb);
    await team("White Sox", "Chicago", mlb);
    await team("Red Sox", "Boston", mlb);
    return variantTypeId;
  });
}

const bsc = (n: string, extra: Partial<BscCard> = {}): BscCard => ({
  cardNumber: n,
  cardName: `Card ${n}`,
  platformRef: `bsc-${n}`,
  players: ["Ken Griffey Jr."],
  ...extra,
});

async function fetchWith(teams: string[] | undefined, rowTeams: string[]) {
  const t = convexTest(schema, modules);
  live.push(t);
  const id = await seed(t);
  mockState.bscCards = [bsc("1", teams ? { teams } : {})];
  const result = await t.withIdentity(ADMIN).action(api.selectorOptions.fetchCardChecklist, {
    selectorOptionId: id,
    publishedChecklist: {
      rows: [{ number: "1", players: ["Ken Griffey Jr."], teams: rowTeams }],
    },
  });
  const rows = await t.run((ctx) => ctx.db.query("checklistCandidates").collect());
  return { t, id, result, row: rows.find((r) => r.cardNumber === "1") };
}

describe("fetchCardChecklist: a place left as printed against the marketplace's team", () => {
  test("Seattle against BSC's Seattle Mariners agrees: the card keeps the marketplace's team, no conflict, no lookup", async () => {
    const { row, result } = await fetchWith(["Seattle Mariners"], ["Seattle"]);
    expect(result.success).toBe(true);
    expect(row?.checklistConflict).toBeUndefined();
    expect(row?.teams).toEqual(["Seattle Mariners"]);
    expect(row?.teamLookup).toBeUndefined();
    expect(mockState.teamLookupCalls).toEqual([]);
    // The place did not answer the team: it is not "from your checklist".
    expect(result.checklistTeams).toEqual({ matched: 0, total: 1 });
  });

  test("the marketplace may name the team by an alias of it", async () => {
    const { row } = await fetchWith(["M's"], ["Seattle"]);
    expect(row?.checklistConflict).toBeUndefined();
    expect(row?.teams).toEqual(["M's"]);
  });

  test("the place's other team agrees as well (the Pilots)", async () => {
    const { row } = await fetchWith(["Seattle Pilots"], ["Seattle"]);
    expect(row?.checklistConflict).toBeUndefined();
    expect(row?.teams).toEqual(["Seattle Pilots"]);
  });

  test("a marketplace team that is not one of the place's teams is still a disagreement, the place as printed", async () => {
    const { row, result } = await fetchWith(["Seattle Mariners"], ["Chicago"]);
    expect(row?.teams).toEqual(["Seattle Mariners"]);
    expect(row?.checklistConflict).toEqual({
      teams: { marketplace: ["Seattle Mariners"], checklist: ["Chicago"] },
    });
    expect(result.checklistTeams).toEqual({ matched: 0, total: 1 });
  });

  test("a lone in-league place is unchanged: the settled team answers, or conflicts", async () => {
    const agree = await fetchWith(["Boston Red Sox"], ["Boston"]);
    expect(agree.row?.checklistConflict).toBeUndefined();
    expect(agree.row?.teams).toEqual(["Boston Red Sox"]);
    expect(agree.row?.teamLookup).toBe("checklist");
    const differ = await fetchWith(["Seattle Mariners"], ["Boston"]);
    expect(differ.row?.checklistConflict).toEqual({
      teams: { marketplace: ["Seattle Mariners"], checklist: ["Boston Red Sox"] },
    });
  });

  test("no marketplace team: nothing to agree with, the place stands as printed for the card rule (as before)", async () => {
    const { row } = await fetchWith(undefined, ["Seattle"]);
    expect(row?.checklistConflict).toBeUndefined();
    expect(row?.teams).toEqual(["Seattle"]);
    expect(row?.teamLookup).toBe("checklist");
  });
});

describe("applyPublishedChecklistPairs: the operator's own link agrees the same way", () => {
  async function pairs(card: string[], rowTeams: string[]) {
    const t = convexTest(schema, modules);
    live.push(t);
    const id = await seed(t);
    return t.withIdentity(ADMIN).action(api.publishedChecklistPairs.applyPublishedChecklistPairs, {
      selectorOptionId: id,
      pairs: [
        {
          card: { players: ["Ken Griffey Jr."], teams: card },
          row: { number: "1", players: ["Ken Griffey Jr."], teams: rowTeams },
        },
      ],
    });
  }

  test("Seattle against Seattle Mariners (or an alias of it): nothing to write, no conflict", async () => {
    expect(await pairs(["Seattle Mariners"], ["Seattle"])).toEqual([{}]);
    expect(await pairs(["M's"], ["Seattle"])).toEqual([{}]);
  });

  test("a team that is not the place's is a conflict with the place as printed", async () => {
    expect(await pairs(["Seattle Mariners"], ["Chicago"])).toEqual([
      { checklistConflict: { teams: { marketplace: ["Seattle Mariners"], checklist: ["Chicago"] } } },
    ]);
  });

  test("no team on the card: the row answers with the place as printed", async () => {
    expect(await pairs([], ["Seattle"])).toEqual([{ teams: ["Seattle"], teamLookup: "checklist" }]);
  });
});
