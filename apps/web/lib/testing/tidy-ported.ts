/**
 * NEO-645 — fixtures shared by the `tidy*.ported.test.ts` files.
 *
 * Those files carry the behaviours the retired `entityReviewQueue` batch tests
 * pinned, on the per-card walk. The shape of every one is the same:
 * a set with one leaf, a commit that leaves a printed name pending on the card,
 * then the tile's own mutation (`tidyNames.createPlayer`, `answerName`, `teams.findOrCreate`,
 * `players.addStint`) acting on the card the operator has open.
 *
 * Lives under lib/ rather than convex/ so it is never deployed as a module.
 */

import type { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { normalizeEntityName } from "../entities/normalize-name";

export type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

export const ADMIN = {
  subject: "admin_tidy_ported_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_tidy_ported_001",
  name: "Admin User",
  role: "admin",
};

/** A baseball sport, a 2024 Topps Chrome set and one leaf under it. */
export async function seedLeaf(t: T, opts: { sport?: string; extraLeaf?: string } = {}) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: opts.sport ?? "Baseball",
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const leaf = async (value: string) => {
      const id = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value,
        platformData: {},
        features: { manufacturer: "Topps", season: "2024" },
        parentId: setNameId,
        children: [],
        lastUpdated: Date.now(),
      });
      const set = await ctx.db.get(setNameId);
      await ctx.db.patch(setNameId, { children: [...(set!.children ?? []), id] });
      return id;
    };
    const variantTypeId = await leaf("Base");
    const otherLeafId = opts.extraLeaf ? await leaf(opts.extraLeaf) : undefined;
    return { sportId, setNameId, variantTypeId, otherLeafId };
  });
}

export function makeCard(
  overrides: Partial<{
    cardNumber: string;
    cardName: string;
    players: string[];
    teams: string[];
  }> = {},
) {
  return {
    cardNumber: overrides.cardNumber ?? "1",
    cardName: overrides.cardName ?? "Card",
    team: undefined,
    teams: overrides.teams ?? [],
    players: overrides.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
  };
}

export async function commit(
  t: T,
  s: { variantTypeId: Sel; sportId: Sel },
  cards: ReturnType<typeof makeCard>[],
) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: s.variantTypeId,
    sportId: s.sportId,
    cards,
  });
}

export async function readCards(t: T, selectorOptionId: Sel): Promise<Doc<"cardChecklist">[]> {
  return t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", selectorOptionId))
      .collect(),
  );
}

export async function allOf<N extends "players" | "teams" | "leagues">(
  t: T,
  table: N,
): Promise<Doc<N>[]> {
  return t.run(async (ctx) => ctx.db.query(table).collect()) as Promise<Doc<N>[]>;
}

/** Insert a team row the way `teamRowFields` would, split or whole. */
export async function seedTeam(
  t: T,
  sportId: Sel,
  parts: {
    name: string;
    location?: string;
    yearsActive?: { from: number; to?: number };
    aliases?: string[];
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", {
      name: parts.name,
      ...(parts.location ? { location: parts.location } : {}),
      nameNormalized: normalizeEntityName([parts.location, parts.name].filter(Boolean).join(" ")),
      sportId,
      ...(parts.yearsActive ? { yearsActive: parts.yearsActive } : {}),
      ...(parts.aliases ? { aliases: parts.aliases } : {}),
      lastUpdated: Date.now(),
    } as never),
  );
}
