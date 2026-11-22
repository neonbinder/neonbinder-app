/**
 * NEO-645 — "this name is not a player / not a team", read from both homes.
 *
 * A ruling used to live in `entityReviewSkips` (one row per leaf, kind and
 * name). It is now a `tidyNames` row whose `answer` is `notEntity`. Until the
 * old table is retired (the cleanup step after the deploy window, and
 * `tidyMigrations.migrateSkipsToAnswers` copying the rows over), every reader
 * that honours a ruling asks BOTH, so a ruling the operator made before the
 * deploy still holds the moment after it. The readers:
 *
 *  - `reviewGatePrelude` and `findSkippedEntityNames` (selectorOptions.ts), the
 *    gate's "never ask again";
 *  - the commit prelude's `isStoredSkip`;
 *  - `findSkippedTeamNameKeys` (cardChecklist.ts), the BSC lane that must not
 *    hand a name the operator threw out back to them as the card's team hint
 *    (NEO-330/333).
 *
 * Keys are `${kind}:${nameNormalized}`, the shape every one of them already
 * uses.
 */

import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type Reader = Pick<QueryCtx, "db">;

/**
 * Is `name` ruled out in this leaf's scope, in either home? One point read on
 * each index.
 */
export async function isRuledOutName(
  ctx: Reader,
  scopeId: Id<"selectorOptions">,
  kind: "player" | "team",
  nameNormalized: string,
): Promise<boolean> {
  const tidy = await ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) =>
      q.eq("scopeId", scopeId).eq("kind", kind).eq("nameNormalized", nameNormalized),
    )
    .first();
  if (tidy?.answer?.kind === "notEntity") return true;
  const legacy = await ctx.db
    .query("entityReviewSkips")
    .withIndex("by_selector_option_and_kind_and_name", (q) =>
      q.eq("selectorOptionId", scopeId).eq("kind", kind).eq("nameNormalized", nameNormalized),
    )
    .first();
  return legacy !== null;
}

/**
 * Every ruled-out name of a scope as `kind:key`, from the `tidyNames` home
 * only, or null when the scope holds more than `limit` name rows (a prefix read
 * that overflows cannot prove a name is NOT ruled out, so the caller falls back
 * to point lookups; see `findSkippedEntityNames`).
 */
export async function tidyRuledOutKeys(
  ctx: Reader,
  scopeId: Id<"selectorOptions">,
  limit: number,
): Promise<string[] | null> {
  const rows = await ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", scopeId))
    .take(limit + 1);
  if (rows.length > limit) return null;
  return rows
    .filter((row) => row.answer?.kind === "notEntity")
    .map((row) => `${row.kind}:${row.nameNormalized}`);
}
