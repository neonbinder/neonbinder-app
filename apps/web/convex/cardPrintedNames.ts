/**
 * NEO-645 — the ONE writer of `cardPrintedNames`, and its readers.
 *
 * `cardPrintedNames` records, for each card, the player and team names the card
 * PRINTED that have a `tidyNames` row (pending, auto-answered, or not an
 * entity). It exists because a pending name is an array member on the card and
 * Convex indexes fields, not array members: "every card in this scope that
 * printed this name" had no index, so an answer would have scanned the leaf
 * plus every parallel leaf. It also keeps the printed record after a name is
 * answered, so an answer can be changed back, and it is what makes NEO-602's
 * "Printed on #1, #17" note live instead of a stored copy.
 *
 * The table is DERIVED. It holds nothing that is not already on a card plus its
 * name row, and if the two ever disagree the card wins and the rows are
 * rebuilt. So exactly one module touches the table: this one.
 * `cardPrintedNames.pin.test.ts` greps every other module for anything
 * inserting, patching or deleting, and for any other reader. The named
 * exception is the E2E head-of-run reset drain.
 *
 * ## The helpers
 *
 *  - `syncCardPrintedNames`: diff a card's rows against the desired list. The
 *    single writer. Callers (the commit chunk, `addCustomCard`, `updateCard`,
 *    `tidyCards.pickSourceValue`, the fan-out page, the parallel build, the
 *    move, the legacy backfill) hand it the card's FULL desired list; a name
 *    absent from the list is deleted.
 *  - `deleteCardPrintedNames`: every row of a card, for `removeCardRow`.
 *  - `listCardPrintedNames`, `listPrintersOfName`, `pagePrintersOfName`: reads.
 *
 * ## Scope
 *
 * `scopeId` is the scope the NAME is answered in: the leaf that printed it. A
 * parallel copy keeps its SOURCE leaf's scope (and a copy of a copy keeps the
 * root), so one answer reaches the copies. When the scope leaf is gone, readers
 * fall back to the card's own leaf (`resolveScopeLeaf`); nothing re-scopes at
 * write time (decision Q3).
 *
 * ## Costs
 *
 * `syncCardPrintedNames` costs one `by_card` read plus one write per changed
 * row; a card written with its names unchanged costs only the read. Pass
 * `fresh: true` for a card inserted in the same transaction to skip the read.
 */

import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/** The most printed rows one card can hold: 20 players and 8 teams. */
export const MAX_PRINTED_NAMES_PER_CARD = 28;
/** Display bound of a printed spelling; the schema comment says the same. */
export const MAX_PRINTED_NAME_LENGTH = 120;

export type PrintedNameKind = "player" | "team";

/** One row a card should have. `order` is the position among the card's names of this kind. */
export type DesiredPrintedName = {
  kind: PrintedNameKind;
  scopeId: Id<"selectorOptions">;
  /** `normalizeEntityName` of the printed spelling: the `tidyNames` key. */
  nameNormalized: string;
  /** This card's own spelling. Trimmed and cut to `MAX_PRINTED_NAME_LENGTH` here. */
  printed: string;
  order: number;
  /** The operator changed THIS card's link on its own; a fan-out never overwrites it. */
  cardOverride?: true;
};

type StoredPrintedName = Pick<
  Doc<"cardPrintedNames">,
  "_id" | "kind" | "scopeId" | "nameNormalized" | "printed" | "order" | "cardOverride"
>;

const keyOf = (r: { kind: string; nameNormalized: string }) =>
  `${r.kind}|${r.nameNormalized}`;

/**
 * The desired list as it will be stored: blank keys dropped, spellings trimmed
 * and cut, and a name listed twice kept once (the lowest `order` wins, because
 * the question is "does this card print this name", not how many times).
 */
export function normalizeDesiredPrintedNames(
  desired: ReadonlyArray<DesiredPrintedName>,
): DesiredPrintedName[] {
  const byKey = new Map<string, DesiredPrintedName>();
  for (const d of desired) {
    if (d.nameNormalized.length === 0) continue;
    const printed = d.printed.trim().slice(0, MAX_PRINTED_NAME_LENGTH);
    if (printed.length === 0) continue;
    const next: DesiredPrintedName = {
      kind: d.kind,
      scopeId: d.scopeId,
      nameNormalized: d.nameNormalized,
      printed,
      order: d.order,
      ...(d.cardOverride ? { cardOverride: true as const } : {}),
    };
    const key = keyOf(next);
    const held = byKey.get(key);
    if (!held || next.order < held.order) byKey.set(key, next);
  }
  return Array.from(byKey.values());
}

/**
 * What one card's rows must change by to match its desired list. Pure, and the
 * single place the diff is decided, so a dry run and the writer agree.
 *
 * A stored duplicate (two rows for one key) is removed. A row whose scope,
 * spelling, order or override differs is patched, never replaced, so a row's id
 * is stable across an answer.
 */
export function planCardPrintedNames(
  existing: ReadonlyArray<StoredPrintedName>,
  desired: ReadonlyArray<DesiredPrintedName>,
): {
  toDelete: Array<Id<"cardPrintedNames">>;
  toInsert: DesiredPrintedName[];
  toPatch: Array<{ id: Id<"cardPrintedNames">; patch: Partial<DesiredPrintedName> }>;
} {
  const wanted = new Map<string, DesiredPrintedName>();
  for (const d of normalizeDesiredPrintedNames(desired)) wanted.set(keyOf(d), d);
  const held = new Set<string>();
  const toDelete: Array<Id<"cardPrintedNames">> = [];
  const toPatch: Array<{
    id: Id<"cardPrintedNames">;
    patch: Partial<DesiredPrintedName>;
  }> = [];
  for (const row of existing) {
    const key = keyOf(row);
    const want = wanted.get(key);
    if (!want || held.has(key)) {
      toDelete.push(row._id);
      continue;
    }
    held.add(key);
    const patch: Partial<DesiredPrintedName> = {};
    if (row.scopeId !== want.scopeId) patch.scopeId = want.scopeId;
    if (row.printed !== want.printed) patch.printed = want.printed;
    if (row.order !== want.order) patch.order = want.order;
    if (!!row.cardOverride !== !!want.cardOverride) {
      // `undefined` in a Convex patch removes the field.
      patch.cardOverride = want.cardOverride;
    }
    if (Object.keys(patch).length > 0) toPatch.push({ id: row._id, patch });
  }
  const toInsert = Array.from(wanted.entries())
    .filter(([key]) => !held.has(key))
    .map(([, d]) => d);
  return { toDelete, toInsert, toPatch };
}

/**
 * ── The ONE writer of `cardPrintedNames` for a card ────────────────────────
 *
 * Diffs `desired` (the card's FULL list) against `by_card`. A card saved with
 * its printed names unchanged costs one read and no writes. Refuses a list over
 * `MAX_PRINTED_NAMES_PER_CARD` after normalising, which is a caller bug (a card
 * carries at most 20 players and 8 teams).
 *
 * Writes no `lastUpdated`: this table is derived and a printed-name change that
 * matters to the card goes through the caller's own patch.
 *
 * Returns the counts, for the callers that budget operations.
 */
export async function syncCardPrintedNames(
  ctx: Pick<MutationCtx, "db">,
  card: { _id: Id<"cardChecklist"> },
  desired: ReadonlyArray<DesiredPrintedName>,
  opts?: { fresh?: boolean },
): Promise<{ inserted: number; patched: number; deleted: number }> {
  const wantedCount = normalizeDesiredPrintedNames(desired).length;
  if (wantedCount > MAX_PRINTED_NAMES_PER_CARD) {
    throw new Error(
      `syncCardPrintedNames: ${wantedCount} printed names exceeds the ${MAX_PRINTED_NAMES_PER_CARD}-name limit`,
    );
  }
  if (opts?.fresh && wantedCount === 0) {
    return { inserted: 0, patched: 0, deleted: 0 };
  }
  const existing = opts?.fresh
    ? []
    : await ctx.db
        .query("cardPrintedNames")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", card._id))
        .collect();
  const { toDelete, toInsert, toPatch } = planCardPrintedNames(existing, desired);
  for (const id of toDelete) await ctx.db.delete(id);
  for (const { id, patch } of toPatch) await ctx.db.patch(id, patch);
  for (const d of toInsert) {
    await ctx.db.insert("cardPrintedNames", {
      cardChecklistId: card._id,
      scopeId: d.scopeId,
      kind: d.kind,
      nameNormalized: d.nameNormalized,
      printed: d.printed,
      order: d.order,
      ...(d.cardOverride ? { cardOverride: true as const } : {}),
    });
  }
  return { inserted: toInsert.length, patched: toPatch.length, deleted: toDelete.length };
}

/**
 * Every row of a card, deleted. Called by `removeCardRow` so a deleted card
 * takes its rows with it. Returns the number deleted.
 */
export async function deleteCardPrintedNames(
  ctx: Pick<MutationCtx, "db">,
  cardId: Id<"cardChecklist">,
): Promise<number> {
  const rows = await ctx.db
    .query("cardPrintedNames")
    .withIndex("by_card", (q) => q.eq("cardChecklistId", cardId))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

/** A card's printed rows, players first then teams, each in printed order. */
export async function listCardPrintedNames(
  ctx: Pick<QueryCtx, "db">,
  cardId: Id<"cardChecklist">,
): Promise<Array<Doc<"cardPrintedNames">>> {
  const rows = await ctx.db
    .query("cardPrintedNames")
    .withIndex("by_card", (q) => q.eq("cardChecklistId", cardId))
    .take(MAX_PRINTED_NAMES_PER_CARD + 1);
  return rows.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === "player" ? -1 : 1) || a.order - b.order,
  );
}

/**
 * The cards that printed a name in a scope: up to `limit` rows, ascending by
 * creation. `limit` is a take, not a page; the caller asks for one more than it
 * shows to know there are more ("50+").
 */
export async function listPrintersOfName(
  ctx: Pick<QueryCtx, "db">,
  key: { scopeId: Id<"selectorOptions">; kind: PrintedNameKind; nameNormalized: string },
  limit: number,
): Promise<Array<Doc<"cardPrintedNames">>> {
  return ctx.db
    .query("cardPrintedNames")
    .withIndex("by_scope_kind_name", (q) =>
      q
        .eq("scopeId", key.scopeId)
        .eq("kind", key.kind)
        .eq("nameNormalized", key.nameNormalized),
    )
    .take(limit);
}

/**
 * One page of the cards that printed a name in a scope, for the answer fan-out.
 * Run inside an internal QUERY (a snapshot, no optimistic-concurrency footprint
 * on the writers); the mutation that follows re-reads each card.
 */
export async function pagePrintersOfName(
  ctx: Pick<QueryCtx, "db">,
  key: { scopeId: Id<"selectorOptions">; kind: PrintedNameKind; nameNormalized: string },
  page: { numItems: number; cursor: string | null },
) {
  return ctx.db
    .query("cardPrintedNames")
    .withIndex("by_scope_kind_name", (q) =>
      q
        .eq("scopeId", key.scopeId)
        .eq("kind", key.kind)
        .eq("nameNormalized", key.nameNormalized),
    )
    .paginate(page);
}

/**
 * The scope a printed row is answered in. Normally its own `scopeId`; when that
 * leaf is gone (a wipe took a source leaf whose parallel copies survive) the
 * card's own leaf, so the name is read and answered where the card still is.
 * The server resolves this from the stored row, never from a client argument.
 */
export async function resolveScopeLeaf(
  ctx: Pick<QueryCtx, "db">,
  row: Pick<Doc<"cardPrintedNames">, "scopeId">,
  cardLeafId: Id<"selectorOptions">,
): Promise<Id<"selectorOptions">> {
  const leaf = await ctx.db.get(row.scopeId);
  return leaf ? row.scopeId : cardLeafId;
}
