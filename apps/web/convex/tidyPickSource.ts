/**
 * NEO-645 — "the sources disagree: use this one" on ONE card.
 *
 * `tidyCards.pickSourceValue` writes the open card in its own transaction and
 * hands the "apply to the cards with the same disagreement" ones to scheduled
 * pages; both end here, so a card reached by the pages is exactly the card the
 * operator picked on.
 *
 * Until a value is chosen the disagreeing field holds NOTHING (no links, no
 * pending names), which is what keeps the losing side out of the walk. Choosing
 * resolves each name of the value the same way the commit does:
 *
 *   1. an answer already on the name's `tidyNames` row applies (a link, or "not
 *      an entity", which leaves the name off the card);
 *   2. otherwise exactly ONE NB match links (a player whose own name is the
 *      name, one team the set's year allows; an alias-only or tied match is a
 *      question, never an adoption);
 *   3. otherwise the name stays pending: a name row is born (lookup enqueued
 *      after the write by `tidyNames.enqueuePendingLookups`) and the card
 *      carries the printed name.
 *
 * Every write goes through `writeNameChange` (links, title, description, the
 * teamless default) and `syncCardPrintedNames` (the printed-name index).
 * `chosen` alone does not bump `lastUpdated` (the NEO-203 baseVersion); the
 * link writes it causes do, and so does a card name that follows the pick
 * (`pickedCardName`).
 */

import { ConvexError } from "convex/values";
import { getConvexSize } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import {
  listCardPrintedNames,
  syncCardPrintedNames,
  type DesiredPrintedName,
} from "./cardPrintedNames";
import {
  nameFieldsOf,
  writeNameChange,
  type NameFields,
  type NameWriteCache,
} from "./tidyCardWrites";
import { ensureTidyNameRow, MAX_TIDY_NAME_LENGTH } from "./tidyNames";
import { sameNamePlayers } from "./players";
import { resolveTeamForSetYear } from "./lib/teamRow";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { nameKey } from "../lib/cards/card-name";

/** Names one picked value may hold (a card carries at most 20 players). */
export const MAX_PICK_NAMES = 20;
/** Stored `sourceDisagreements` bytes per card (schema.ts: 4096). */
export const SOURCE_DISAGREEMENTS_MAX_BYTES = 4096;

export type PickField = "players" | "teams";

type Entry = NonNullable<Doc<"cardChecklist">["sourceDisagreements"]>[number];

/** The value's names: trimmed, one line, blanks and repeats (by key) dropped. */
export function cleanPickNames(raw: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const name = entry.replace(/\s+/g, " ").trim();
    if (!name) continue;
    if (name.length > MAX_TIDY_NAME_LENGTH) {
      throw new ConvexError(
        `A name is ${name.length} characters; the limit is ${MAX_TIDY_NAME_LENGTH}.`,
      );
    }
    const key = normalizeEntityName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const keysOf = (names: ReadonlyArray<string>) => names.map((n) => normalizeEntityName(n));

/** Two values are the same when their names agree one for one, in order. */
export function sameValue(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const ka = keysOf(a);
  const kb = keysOf(b);
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

/** Two lists of values are the same set (order aside, each value by `sameValue`). */
export function sameValueSets(
  a: ReadonlyArray<ReadonlyArray<string>>,
  b: ReadonlyArray<ReadonlyArray<string>>,
): boolean {
  if (a.length !== b.length) return false;
  return a.every((va) => b.some((vb) => sameValue(va, vb)));
}

/** Two entries carry the same disagreement: the same set of values (order aside). */
export function sameDisagreement(a: Entry, b: Entry): boolean {
  if (a.field !== b.field) return false;
  return sameValueSets(
    a.values.map((x) => x.value),
    b.values.map((x) => x.value),
  );
}

export function entryFor(
  card: Pick<Doc<"cardChecklist">, "sourceDisagreements">,
  field: PickField,
): { entry: Entry; index: number } | undefined {
  const list = card.sourceDisagreements ?? [];
  const index = list.findIndex((e) => e.field === field);
  return index < 0 ? undefined : { entry: list[index], index };
}

/**
 * The card name a pick leaves, or undefined to leave it alone (decision 23).
 *
 * Match Cards preselects ONE source's spelling as `cardName`, so a card whose
 * players were picked from the other source read "Carl Boudreau" as its name
 * and "Carl Bodureau" as its player. The name follows the pick when it IS one
 * of the spellings the sources gave (any offered value, or the value an earlier
 * pick chose: a Change re-follows). A name that matches none of them was typed
 * by hand and stays. Compared the way the marketplaces' own names are
 * (`nameKey`: accents folded, "|" and " / " the same), so only the words count.
 * A card name holds players or teams joined with " / "; a team card carries the
 * team there, a player card the players, so one rule serves both fields.
 */
export function pickedCardName(
  card: Pick<Doc<"cardChecklist">, "cardName">,
  entry: Entry,
  names: ReadonlyArray<string>,
): string | undefined {
  if (names.length === 0) return undefined;
  const picked = names.join(" / ");
  if (card.cardName === picked) return undefined;
  const have = nameKey(card.cardName);
  if (have === "") return undefined;
  const offered = [...entry.values.map((o) => o.value), ...(entry.chosen ? [entry.chosen.value] : [])];
  return offered.some((value) => value.length > 0 && nameKey(value.join(" / ")) === have)
    ? picked
    : undefined;
}

type Resolved =
  | { state: "playerLink"; playerId: Id<"players">; hasRow: boolean }
  | { state: "teamLink"; teamId: Id<"teams">; hasRow: boolean }
  | { state: "ruledOut"; hasRow: true }
  | { state: "pending"; hasRow: true };

async function resolveName(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  kind: "player" | "team",
  name: string,
  setYear: number | undefined,
): Promise<Resolved> {
  const key = normalizeEntityName(name);
  const row = await ctx.db
    .query("tidyNames")
    .withIndex("by_scope_kind_name", (q) =>
      q.eq("scopeId", card.selectorOptionId).eq("kind", kind).eq("nameNormalized", key),
    )
    .first();
  const answer = row?.answer;
  if (answer?.kind === "notEntity") return { state: "ruledOut", hasRow: true };
  if (answer?.kind === "linkPlayer" && kind === "player") {
    return { state: "playerLink", playerId: answer.playerId, hasRow: true };
  }
  if (answer?.kind === "linkTeam" && kind === "team") {
    return { state: "teamLink", teamId: answer.teamId, hasRow: true };
  }
  if (!row) {
    if (kind === "player") {
      const same = await sameNamePlayers(ctx, key, card.sportId);
      // The PRIMARY name must be the name: a shared alias is a question.
      if (same.length === 1 && same[0].nameNormalized === key) {
        return { state: "playerLink", playerId: same[0]._id, hasRow: false };
      }
    } else {
      const found = await resolveTeamForSetYear(ctx, card.sportId, name, setYear, {
        allowPastEra: true,
      });
      if (found.teamId) return { state: "teamLink", teamId: found.teamId, hasRow: false };
    }
  }
  return { state: "pending", hasRow: true };
}

/**
 * Write `names` as the chosen value of `field` on `card`. The caller has
 * already checked the value is one the entry offers (or typed) and that the
 * card carries the entry. Returns whether names were left pending, so the
 * caller enqueues their lookups once.
 */
export async function applyPickToCard(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  args: {
    field: PickField;
    names: string[];
    typed: boolean;
    userId: string;
    cache: NameWriteCache;
  },
): Promise<{ pending: boolean; written: boolean }> {
  const kind = args.field === "players" ? "player" : "team";
  const found = entryFor(card, args.field);
  if (!found) throw new ConvexError("That card has nothing to pick.");
  const cap = kind === "player" ? MAX_CARD_PLAYERS : MAX_CARD_TEAMS;
  if (args.names.length > cap) {
    throw new ConvexError(`A card holds at most ${cap} ${args.field}.`);
  }

  const setYear = await findSetYearForSelectorOption(ctx, card.selectorOptionId);
  const fields: NameFields = nameFieldsOf(card);
  const desired: DesiredPrintedName[] = (await listCardPrintedNames(ctx, card._id))
    .filter((row) => row.kind !== kind)
    .map((row) => ({
      kind: row.kind,
      scopeId: row.scopeId,
      nameNormalized: row.nameNormalized,
      printed: row.printed,
      order: row.order,
      ...(row.cardOverride ? { cardOverride: true as const } : {}),
    }));

  // The disagreeing field held nothing, or held the value Change is replacing.
  if (kind === "player") {
    fields.playerIds = [];
    fields.playerLinks = [];
    fields.pendingPlayerNames = [];
  } else {
    fields.teamOnCardIds = [];
    fields.pendingTeamNames = [];
  }

  let anyPending = false;
  for (let order = 0; order < args.names.length; order++) {
    const name = args.names[order];
    const key = normalizeEntityName(name);
    const resolved = await resolveName(ctx, card, kind, name, setYear);
    if (resolved.hasRow) {
      // The row exists (an answer) or is born now (pending): either way the
      // card prints it, so it is indexed.
      await ensureTidyNameRow(ctx, {
        scopeId: card.selectorOptionId,
        kind,
        name,
        sportId: card.sportId,
        setYear,
      });
      desired.push({
        kind,
        scopeId: card.selectorOptionId,
        nameNormalized: key,
        printed: name,
        order,
      });
    }
    if (resolved.state === "playerLink") {
      if (!fields.playerIds.includes(resolved.playerId)) {
        fields.playerIds.push(resolved.playerId);
        fields.playerLinks.push({ playerId: resolved.playerId, nameOnCard: name });
      }
    } else if (resolved.state === "teamLink") {
      if (!fields.teamOnCardIds.includes(resolved.teamId)) {
        fields.teamOnCardIds.push(resolved.teamId);
      }
    } else if (resolved.state === "pending") {
      anyPending = true;
      if (kind === "player") fields.pendingPlayerNames.push(name);
      else fields.pendingTeamNames.push(name);
    }
  }

  const entries = [...(card.sourceDisagreements ?? [])];
  entries[found.index] = {
    ...found.entry,
    chosen: {
      value: args.names,
      by: "operator",
      ...(args.typed ? { typed: true as const } : {}),
    },
  };
  if (getConvexSize(entries) > SOURCE_DISAGREEMENTS_MAX_BYTES) {
    throw new ConvexError("That value is too long to keep on the card.");
  }

  const before = nameFieldsOf(card);
  const changed =
    JSON.stringify(before.playerIds) !== JSON.stringify(fields.playerIds) ||
    JSON.stringify(before.playerLinks) !== JSON.stringify(fields.playerLinks) ||
    JSON.stringify(before.pendingPlayerNames) !== JSON.stringify(fields.pendingPlayerNames) ||
    JSON.stringify(before.teamOnCardIds) !== JSON.stringify(fields.teamOnCardIds) ||
    JSON.stringify(before.pendingTeamNames) !== JSON.stringify(fields.pendingTeamNames);

  // The stamp first, alone: on its own it must not bump `lastUpdated`. A card
  // name that follows the pick is content, so it does (the NEO-203 baseVersion).
  const cardName = pickedCardName(card, found.entry, args.names);
  await ctx.db.patch(card._id, {
    sourceDisagreements: entries,
    ...(cardName !== undefined ? { cardName, lastUpdated: Date.now() } : {}),
  });
  if (changed) {
    const stamped = {
      ...card,
      sourceDisagreements: entries,
      ...(cardName !== undefined ? { cardName } : {}),
    } as Doc<"cardChecklist">;
    await writeNameChange(ctx, stamped, fields, args.cache, args.userId);
  }
  await syncCardPrintedNames(ctx, card, desired);
  return { pending: anyPending, written: changed || cardName !== undefined };
}
