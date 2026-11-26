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
 *   1. exactly ONE NB match links (the one player who answers to the name, by
 *      its own name or an alias, or one team the set's year allows; a tied
 *      match is a question, never an adoption);
 *   2. otherwise the name stays pending and the card carries the printed name.
 *
 * NEO-656 (Jason: "Once you pick a source, the card keeps only the result"): a
 * pick REMOVES the disagreement's entry from the card instead of stamping
 * `chosen` on it, and nothing is read from or written to a name row.
 *
 * Every write goes through `writeNameChange` (links, title, description, the
 * teamless default; a pick that moves no name still rebuilds the title and
 * description, `regenerateListingNow`). Removing the entry alone does not bump
 * `lastUpdated` (the NEO-203 baseVersion); the link writes it causes do, and so
 * does a card name that follows the pick (`pickedCardName`).
 */

import { ConvexError, getConvexSize } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import {
  nameFieldsOf,
  planNameChange,
  printedRefOf,
  writeNameChange,
  type NameFields,
  type NameWriteCache,
} from "./tidyCardWrites";
import { regenerateListingNow } from "./tidyListingText";
import { MAX_TIDY_NAME_LENGTH } from "./tidyNames";
import { sameNamePlayers } from "./players";
import { resolveTeamForSetYear } from "./lib/teamRow";
import { stampNoTeam } from "./lib/selectorTeams";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { normalizeEntityName } from "../lib/entities/normalize-name";

/** Names one picked value may hold (a card carries at most 20 players). */
export const MAX_PICK_NAMES = 20;
/** `sourceDisagreements` bytes per card (schema.ts: 4096); also the bound on an `offered` entry. */
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

/**
 * The card's open disagreement on `field`, or undefined.
 */
export function entryFor(
  card: Pick<Doc<"cardChecklist">, "sourceDisagreements">,
  field: PickField,
): { entry: Entry; index: number } | undefined {
  const list = card.sourceDisagreements ?? [];
  const index = list.findIndex((e) => e.field === field);
  return index < 0 ? undefined : { entry: list[index], index };
}

/**
 * NEO-656 (D13) — the entry a pick works from when the card no longer carries it:
 * the values the walk kept for the open card, bounded the way the stored field
 * is (at most 3 values, `MAX_PICK_NAMES` names of at most `MAX_TIDY_NAME_LENGTH`
 * characters, `SOURCE_DISAGREEMENTS_MAX_BYTES`). Refused without them. Typed
 * values are already unchecked, so this gives an admin no new power.
 */
export function entryFromOffered(
  field: PickField,
  offered: ReadonlyArray<ReadonlyArray<string>> | undefined,
): Entry {
  if (!offered || offered.length === 0) throw new ConvexError("That card has nothing to pick.");
  if (offered.length > 3) throw new ConvexError("A disagreement holds at most 3 values.");
  const values = offered.map((value) => {
    if (value.length > MAX_PICK_NAMES) {
      throw new ConvexError(`A value holds at most ${MAX_PICK_NAMES} names.`);
    }
    if (value.some((name) => name.length > MAX_TIDY_NAME_LENGTH)) {
      throw new ConvexError(`A name is at most ${MAX_TIDY_NAME_LENGTH} characters.`);
    }
    return { value: [...value], sources: [] };
  });
  const entry: Entry = { field, values };
  if (getConvexSize([entry]) > SOURCE_DISAGREEMENTS_MAX_BYTES) {
    throw new ConvexError("Those values are too long to pick from.");
  }
  return entry;
}

/** Two names alike when only case and edge space differ (main's `sameName`). */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The card name a pick leaves, or undefined to leave it alone (decision 23).
 *
 * Main's rule (`applyChecklistChoice`, checklist-conflict.ts): a pick renames
 * a one-player card whose name WAS the losing player ("Rhett Lowder" ->
 * "Rhett Loder"), so the card's name and its player never disagree. The pick
 * and the losing side each hold exactly one name, and the card's name equals
 * the losing side's. Any other card name is left alone, and so is a pick or a
 * side holding several names. A teams pick never renames (main's teams branch
 * leaves `cardName` alone).
 *
 * With more than two values the "losing side" is any other offered value: a
 * Change re-follows because the value the card is named for is still offered.
 */
export function pickedCardName(
  card: Pick<Doc<"cardChecklist">, "cardName">,
  entry: Entry,
  names: ReadonlyArray<string>,
): string | undefined {
  if (entry.field !== "players" || names.length !== 1) return undefined;
  const others = entry.values.filter((o) => !sameValue(o.value, names));
  return others.some((o) => o.value.length === 1 && sameName(card.cardName, o.value[0]))
    ? names[0]
    : undefined;
}

type Resolved =
  | { state: "playerLink"; playerId: Id<"players"> }
  | { state: "teamLink"; teamId: Id<"teams"> }
  | { state: "pending" };

/**
 * What one name of a picked value becomes: exactly ONE NB match links, anything
 * else stays pending for the operator. NEO-656 (B10): nothing stored is read,
 * so a name a card once had answered is matched like any other.
 */
export async function resolveName(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  kind: "player" | "team",
  name: string,
  setYear: number | undefined,
): Promise<Resolved> {
  const key = normalizeEntityName(name);
  if (kind === "player") {
    const same = await sameNamePlayers(ctx, key, card.sportId);
    // NEO-680: one player who answers to the name links, by its own name or an
    // alias alike; two holders are a question.
    if (same.length === 1) {
      return { state: "playerLink", playerId: same[0]._id };
    }
  } else {
    const found = await resolveTeamForSetYear(ctx, card.sportId, name, setYear, {
      allowPastEra: true,
    });
    if (found.teamId) return { state: "teamLink", teamId: found.teamId };
  }
  return { state: "pending" };
}

/**
 * NEO-680 (Jason: a lone alias match "should be automatic"): when the walk opens
 * a card, each name still WAITING on it that exactly one player answers to
 * links by itself. Same resolver as the pick (`resolveName`), same writer as an
 * answer (`planNameChange` + `writeNameChange`), so the title, description and
 * team fill follow as for any link. `skip` holds name keys the operator has
 * taken back this sitting (Edit); it only narrows what is linked. A name no one
 * answers to, or two players do, stays waiting, and a card with nothing to link
 * is not written. Returns whether the card was written.
 */
export async function linkWaitingPlayerNames(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  args: { userId: string; cache: NameWriteCache; skip: ReadonlySet<string> },
): Promise<boolean> {
  let fields = nameFieldsOf(card);
  let linked = false;
  for (const printed of card.pendingPlayerNames ?? []) {
    const key = normalizeEntityName(printed);
    if (args.skip.has(key)) continue;
    const resolved = await resolveName(ctx, card, "player", printed, undefined);
    if (resolved.state !== "playerLink") continue;
    const { ref, unlinkedBefore } = printedRefOf(fields, "player", key, printed);
    const plan = planNameChange(
      fields,
      ref,
      { kind: "linkPlayer", playerId: resolved.playerId },
      "any",
      { unlinkedBefore },
    );
    if (plan.status === "changed") {
      fields = plan.fields;
      linked = true;
    }
  }
  if (linked) await writeNameChange(ctx, card, fields, args.cache, args.userId);
  return linked;
}

/**
 * Write `names` as the chosen value of `field` on `card`, and remove the
 * disagreement's entry. The caller has already checked the value is one the
 * entry offers (or typed).
 *
 * The entry is the card's own open one. A card that no longer carries it (the
 * walk is Changing a pick it made a moment ago) passes `entry`, the values the
 * walk kept (`entryFromOffered`); nothing is then removed from the card.
 * Returns whether names were left pending.
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
    entry?: Entry;
  },
): Promise<{ pending: boolean; written: boolean }> {
  const kind = args.field === "players" ? "player" : "team";
  const found = entryFor(card, args.field);
  const entry = found?.entry ?? args.entry;
  if (!entry) throw new ConvexError("That card has nothing to pick.");
  const cap = kind === "player" ? MAX_CARD_PLAYERS : MAX_CARD_TEAMS;
  if (args.names.length > cap) {
    throw new ConvexError(`A card holds at most ${cap} ${args.field}.`);
  }

  const setYear = await findSetYearForSelectorOption(ctx, card.selectorOptionId);
  const fields: NameFields = nameFieldsOf(card);

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
  for (const name of args.names) {
    const resolved = await resolveName(ctx, card, kind, name, setYear);
    if (resolved.state === "playerLink") {
      if (!fields.playerIds.includes(resolved.playerId)) {
        fields.playerIds.push(resolved.playerId);
        fields.playerLinks.push({ playerId: resolved.playerId, nameOnCard: name });
      }
    } else if (resolved.state === "teamLink") {
      if (!fields.teamOnCardIds.includes(resolved.teamId)) {
        fields.teamOnCardIds.push(resolved.teamId);
      }
    } else {
      anyPending = true;
      if (kind === "player") fields.pendingPlayerNames.push(name);
      else fields.pendingTeamNames.push(name);
    }
  }

  // The pick keeps only its result: the entry leaves the card (the other
  // field's entry, and every entry nobody picked, stay). Removing an entry only
  // shrinks the field, so there is no size check.
  const remaining = (card.sourceDisagreements ?? []).filter((_, i) => i !== found?.index);
  const sourceDisagreements = remaining.length > 0 ? remaining : undefined;

  const before = nameFieldsOf(card);
  const changed =
    JSON.stringify(before.playerIds) !== JSON.stringify(fields.playerIds) ||
    JSON.stringify(before.playerLinks) !== JSON.stringify(fields.playerLinks) ||
    JSON.stringify(before.pendingPlayerNames) !== JSON.stringify(fields.pendingPlayerNames) ||
    JSON.stringify(before.teamOnCardIds) !== JSON.stringify(fields.teamOnCardIds) ||
    JSON.stringify(before.pendingTeamNames) !== JSON.stringify(fields.pendingTeamNames);

  // The removal first, alone: on its own it must not bump `lastUpdated`. A card
  // name that follows the pick is content, so it does (the NEO-203 baseVersion).
  const cardName = pickedCardName(card, entry, args.names);
  // A teams value that names nobody ("No Team") IS the No-team answer: the
  // operator took the source's own claim that this card has no team, so the card
  // is stamped the way "No team on this card" stamps it and is not asked again.
  // Taking a value that names a team retires a stamp an earlier pick left.
  // The operator is the server-resolved caller of the pick, never a client value.
  const operatorId = args.userId;
  const noTeamStamp: Partial<Doc<"cardChecklist">> =
    kind !== "team"
      ? {}
      : args.names.length === 0
        ? stampNoTeam(operatorId, Date.now())
        : card.teamNoneConfirmedAt !== undefined
          ? {
              teamNoneConfirmedAt: undefined,
              teamNoneConfirmedByUserId: undefined,
            }
          : {};
  await ctx.db.patch(card._id, {
    sourceDisagreements,
    ...noTeamStamp,
    ...(cardName !== undefined ? { cardName, lastUpdated: Date.now() } : {}),
  });
  if (changed) {
    const stamped = {
      ...card,
      sourceDisagreements,
      ...noTeamStamp,
      ...(cardName !== undefined ? { cardName } : {}),
    } as Doc<"cardChecklist">;
    await writeNameChange(ctx, stamped, fields, args.cache, args.userId);
  } else {
    // No name moved (a stamp, or a card name that followed the pick), but the
    // write still rebuilds the title and description (NEO-645 T4).
    await regenerateListingNow(ctx, card._id, args.cache.titles);
  }
  return { pending: anyPending, written: changed || cardName !== undefined };
}
