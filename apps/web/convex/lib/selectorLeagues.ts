/**
 * NEO-569 — a set row's EFFECTIVE leagues: the `leagueIds` the row carries,
 * else the nearest ancestor's.
 *
 * `selectorOptions.leagueIds` is stored only where an operator (or the set's
 * creation default) put it, and is looked up rather than copied down, so a
 * variant type, insert or parallel with no list of its own answers with its
 * set's. The walk goes self → parent while the row is a `parallel`, `insert`,
 * `variantType` or `setName`, and stops after the `setName`: a brand, year or
 * sport never carries leagues, and the first list found wins whole (lists are
 * never merged).
 *
 * A parallel of the Base set sits under the Parallel variant type (its parent
 * is that type, whose parent is the set), so it inherits from the Parallel
 * type or the set, never from the Base variant type. A parallel of an insert
 * sits under the insert and inherits through it.
 *
 * Pure reads over `ctx.db.get`, memoised in a caller-owned cache keyed by row
 * id, so a commit chunk or a cascade page that asks for many cards under a
 * handful of rows reads each row once. Typed against a minimal ctx so a query
 * and a mutation can both call it, and so this module pulls in no generated
 * server code.
 */

import type { Doc, Id } from "../_generated/dataModel";

/** The levels that may carry `leagueIds`, and the walk's whole range. */
export const LEAGUE_BEARING_LEVELS: ReadonlySet<string> = new Set([
  "setName",
  "variantType",
  "insert",
  "parallel",
]);

/** Depth guard against a `parentId` cycle, as the other ancestor walks use. */
const MAX_WALK = 8;

export type EffectiveSetLeagues = {
  leagueIds: Array<Id<"leagues">>;
  /** The row the list was read from; null when no row on the walk had one. */
  fromId: Id<"selectorOptions"> | null;
};

/** Memo of the walk, by the id it was asked for (and every row it passed). */
export type SelectorLeagueCache = Map<string, EffectiveSetLeagues>;

export function newSelectorLeagueCache(): SelectorLeagueCache {
  return new Map();
}

type LeagueWalkCtx = {
  db: {
    get: (id: Id<"selectorOptions">) => Promise<
      Pick<Doc<"selectorOptions">, "_id" | "level" | "parentId" | "leagueIds"> | null
    >;
  };
};

const NONE: EffectiveSetLeagues = { leagueIds: [], fromId: null };

/**
 * The effective leagues of `selectorOptionId`, with the row they came from.
 * A row outside `LEAGUE_BEARING_LEVELS` (or a dangling id) answers none.
 */
export async function effectiveSetLeagues(
  ctx: LeagueWalkCtx,
  selectorOptionId: Id<"selectorOptions">,
  cache?: SelectorLeagueCache,
): Promise<EffectiveSetLeagues> {
  const hit = cache?.get(selectorOptionId);
  if (hit) return hit;
  const passed: Array<Id<"selectorOptions">> = [];
  let answer: EffectiveSetLeagues = NONE;
  let cursor: Id<"selectorOptions"> | undefined = selectorOptionId;
  for (let depth = 0; cursor && depth < MAX_WALK; depth++) {
    const cached = cache?.get(cursor);
    if (cached) {
      answer = cached;
      break;
    }
    const row = await ctx.db.get(cursor);
    if (!row || !LEAGUE_BEARING_LEVELS.has(row.level)) break;
    passed.push(row._id);
    if (row.leagueIds && row.leagueIds.length > 0) {
      answer = { leagueIds: [...row.leagueIds], fromId: row._id };
      break;
    }
    if (row.level === "setName") break;
    cursor = row.parentId;
  }
  for (const id of passed) cache?.set(id, answer);
  return answer;
}

/** `effectiveSetLeagues(...).leagueIds` — the shape most readers want. */
export async function effectiveSetLeagueIds(
  ctx: LeagueWalkCtx,
  selectorOptionId: Id<"selectorOptions">,
  cache?: SelectorLeagueCache,
): Promise<Array<Id<"leagues">>> {
  return (await effectiveSetLeagues(ctx, selectorOptionId, cache)).leagueIds;
}

/**
 * The sport row above a selectorOption (itself, when it is one), by the same
 * bounded parent walk as `cardChecklist.findSportForSelectorOption` — restated
 * here so the set-league writers need not import that module (it reaches the
 * card-team seam, which reaches `cardLeague.ts`).
 */
export async function sportOfSelectorOption(
  ctx: {
    db: {
      get: (id: Id<"selectorOptions">) => Promise<
        Pick<Doc<"selectorOptions">, "_id" | "level" | "parentId"> | null
      >;
    };
  },
  selectorOptionId: Id<"selectorOptions">,
): Promise<Id<"selectorOptions"> | undefined> {
  let cursor: Id<"selectorOptions"> | undefined = selectorOptionId;
  for (let depth = 0; cursor && depth < 16; depth++) {
    const node = await ctx.db.get(cursor);
    if (!node) return undefined;
    if (node.level === "sport") return node._id;
    cursor = node.parentId;
  }
  return undefined;
}
