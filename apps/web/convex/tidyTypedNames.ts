/**
 * NEO-645 — names an operator TYPES onto a card by hand (quick add, the card
 * editor) go through the same index every other pending name does.
 *
 * A pending name is only findable by an answer when it has a `tidyNames` row in
 * the card's leaf and a `cardPrintedNames` row saying the card printed it. The
 * commit gets both from the gate; these two writers (`addCustomCard`,
 * `updateCard`) do not pass the gate, so they make the rows here:
 *
 *  - `indexTypedNames`: a NEW card's pending names, one name row each (born
 *    pending, its lookup enqueued by `tidyNames.enqueuePendingLookups`, which
 *    the caller schedules) and one printed row each;
 *  - `reconcilePrintedAfterEdit`: after an edit, the printed rows follow the
 *    names the card now holds pending, and every row of a kind whose names the
 *    operator changed on this card by hand is marked `cardOverride`, so a later
 *    fan-out never overwrites the card's own choice.
 *
 * Both write `cardPrintedNames` through `syncCardPrintedNames` only.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  listCardPrintedNames,
  syncCardPrintedNames,
  type DesiredPrintedName,
} from "./cardPrintedNames";
import { ensureTidyNameRow, MAX_TIDY_NAME_LENGTH } from "./tidyNames";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";

type NameFields = Pick<
  Doc<"cardChecklist">,
  "playerLinks" | "pendingPlayerNames" | "teamOnCardIds" | "pendingTeamNames"
>;

/** Born-card form: every pending name gets a name row and a printed row. */
export async function indexTypedNames(
  ctx: MutationCtx,
  card: { _id: Id<"cardChecklist">; selectorOptionId: Id<"selectorOptions">; sportId: Id<"selectorOptions"> },
  names: {
    players: ReadonlyArray<string>;
    teams: ReadonlyArray<string>;
    setYear: number | undefined;
  },
): Promise<boolean> {
  const desired: DesiredPrintedName[] = [];
  for (const kind of ["player", "team"] as const) {
    const list = kind === "player" ? names.players : names.teams;
    for (const [order, printed] of list.entries()) {
      const name = printed.trim().slice(0, MAX_TIDY_NAME_LENGTH);
      const key = normalizeEntityName(name);
      if (!key) continue;
      await ensureTidyNameRow(ctx, {
        scopeId: card.selectorOptionId,
        kind,
        name,
        sportId: card.sportId,
        setYear: names.setYear,
      });
      desired.push({ kind, scopeId: card.selectorOptionId, nameNormalized: key, printed: name, order });
    }
  }
  if (desired.length === 0) return false;
  await syncCardPrintedNames(ctx, card, desired, { fresh: true });
  return true;
}

const keysOf = (names: ReadonlyArray<string> | undefined) =>
  (names ?? []).map((n) => normalizeEntityName(n)).filter(Boolean);
const sameList = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((k, i) => k === b[i]);
const linkState = (card: NameFields) =>
  (card.playerLinks ?? []).map((l) => `${normalizeEntityName(l.nameOnCard)}>${l.playerId}`);

/**
 * After `updateCard` wrote `after` over `before`. Returns whether the card now
 * holds names whose lookup the caller should enqueue (a new typed name).
 */
export async function reconcilePrintedAfterEdit(
  ctx: MutationCtx,
  before: NameFields,
  after: Doc<"cardChecklist">,
): Promise<boolean> {
  const playersChanged =
    !sameList(keysOf(before.pendingPlayerNames), keysOf(after.pendingPlayerNames)) ||
    !sameList(linkState(before), linkState(after));
  const teamsChanged =
    !sameList(keysOf(before.pendingTeamNames), keysOf(after.pendingTeamNames)) ||
    !sameList(
      [...(before.teamOnCardIds ?? [])].map(String).sort(),
      [...(after.teamOnCardIds ?? [])].map(String).sort(),
    );
  if (!playersChanged && !teamsChanged) return false;

  const have = await listCardPrintedNames(ctx, after._id);
  const desired: DesiredPrintedName[] = have.map((row) => ({
    kind: row.kind,
    scopeId: row.scopeId,
    nameNormalized: row.nameNormalized,
    printed: row.printed,
    order: row.order,
    ...(row.cardOverride || (row.kind === "player" ? playersChanged : teamsChanged)
      ? { cardOverride: true as const }
      : {}),
  }));
  let created = false;
  // The set's year, read once and only when a typed name needs a row: the name
  // row's same-name candidates are ranked by it, as for a born card.
  let setYear: number | undefined;
  let yearRead = false;
  for (const [kind, pending, changed] of [
    ["player", after.pendingPlayerNames, playersChanged],
    ["team", after.pendingTeamNames, teamsChanged],
  ] as const) {
    if (!changed) continue;
    for (const [order, printed] of (pending ?? []).entries()) {
      const name = printed.trim().slice(0, MAX_TIDY_NAME_LENGTH);
      const key = normalizeEntityName(name);
      if (!key || desired.some((d) => d.kind === kind && d.nameNormalized === key)) continue;
      if (!yearRead) {
        setYear = await findSetYearForSelectorOption(ctx, after.selectorOptionId);
        yearRead = true;
      }
      await ensureTidyNameRow(ctx, {
        scopeId: after.selectorOptionId,
        kind,
        name,
        sportId: after.sportId,
        setYear,
      });
      desired.push({
        kind,
        scopeId: after.selectorOptionId,
        nameNormalized: key,
        printed: name,
        order,
        cardOverride: true,
      });
      created = true;
    }
  }
  await syncCardPrintedNames(ctx, after, desired);
  return created;
}
