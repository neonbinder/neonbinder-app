/**
 * NEO-645 — a card that changes leaf takes its printed names with it.
 *
 * A name is answered per leaf (`tidyNames.scopeId`), and `cardPrintedNames`
 * says which leaf's answer a card follows. When a card is moved to another leaf
 * (`setShapeMove.moveCards`), its printed rows are re-scoped to the destination
 * and each name gets a `ready` row there, copied from the one it had, so the
 * card's links and the answers on its names stay what they were and a later
 * answer at the destination reaches it. The answer is NOT re-applied: the card
 * already carries its links.
 *
 * `cardPrintedNames` is read and written only through `cardPrintedNames.ts`.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { listCardPrintedNames, syncCardPrintedNames } from "./cardPrintedNames";

async function nameRow(
  ctx: MutationCtx,
  scopeId: Id<"selectorOptions">,
  kind: "player" | "team",
  nameNormalized: string,
): Promise<Doc<"tidyNames"> | null> {
  return await ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) =>
      q.eq("scopeId", scopeId).eq("kind", kind).eq("nameNormalized", nameNormalized),
    )
    .first();
}

/** Re-scope `card`'s printed rows to `destId`, upserting the name rows there. */
export async function rescopePrintedNames(
  ctx: MutationCtx,
  card: Pick<Doc<"cardChecklist">, "_id" | "sportId">,
  destId: Id<"selectorOptions">,
): Promise<void> {
  const rows = await listCardPrintedNames(ctx, card._id);
  if (rows.length === 0 || rows.every((row) => row.scopeId === destId)) return;
  for (const row of rows) {
    if (row.scopeId === destId) continue;
    if (await nameRow(ctx, destId, row.kind, row.nameNormalized)) continue;
    const from = await nameRow(ctx, row.scopeId, row.kind, row.nameNormalized);
    await ctx.db.insert("tidyNames", {
      scopeId: destId,
      kind: row.kind,
      nameNormalized: row.nameNormalized,
      name: from?.name ?? row.printed,
      sportId: from?.sportId ?? card.sportId,
      status: "ready",
      ...(from?.enrichment ? { enrichment: from.enrichment } : {}),
      ...(from?.candidateTeamIds ? { candidateTeamIds: from.candidateTeamIds } : {}),
      ...(from?.candidatePlace ? { candidatePlace: from.candidatePlace } : {}),
      ...(from?.answer
        ? {
            answer: from.answer,
            answerGen: from.answerGen ?? 1,
            ...(from.answeredByUserId ? { answeredByUserId: from.answeredByUserId } : {}),
            ...(from.answeredAt !== undefined ? { answeredAt: from.answeredAt } : {}),
          }
        : {}),
    });
  }
  await syncCardPrintedNames(
    ctx,
    card,
    rows.map((row) => ({
      kind: row.kind,
      scopeId: destId,
      nameNormalized: row.nameNormalized,
      printed: row.printed,
      order: row.order,
      ...(row.cardOverride ? { cardOverride: true as const } : {}),
    })),
  );
}
