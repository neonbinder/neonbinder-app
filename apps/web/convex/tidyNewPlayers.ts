/**
 * NEO-645 (decision 32) — "Add all N new players" in the Tidy Up walk.
 *
 * The old wizard had "Add remaining players as new". Without it a set with a
 * hundred new rookies is a hundred per-card answers. This module is the two
 * server halves of the button:
 *
 *   - `newPlayerNames({leafId})`   which player names on a checklist the walk may
 *                                  offer to add in one go, each with its card
 *                                  numbers. Read on demand, never subscribed.
 *   - `addNewPlayers({leafId, names})`  create the chosen ones, each exactly as
 *                                  the Player tile's "Add as new player" does.
 *
 * ## A name is eligible only when nothing else could answer it
 *
 * Every one of these holds, and the mutation re-checks every one for every name
 * before it writes (the list is a proposal, never a permission):
 *
 *   - a PLAYER name row in this scope, unanswered (so not "not a player", whether
 *     the operator or the gate ruled it out, and not already linked);
 *   - its lookup has FINISHED: `ready`, and asked at least once (`neverLooked`
 *     is a migrated row nobody asked Wikidata about);
 *   - no same-name choice and no preselect on the row (an existing player is
 *     already on offer);
 *   - no player in the row's sport answers to the name (`sameNamePlayers`:
 *     primary name, alias, or another sport the player also plays);
 *   - no near spelling on file (`nearSpelledPlayers`, "Did you mean"): a
 *     misspelling is a link the operator should see, not a duplicate to create;
 *   - not a fragment of a fuller-named player (`nameFragmentScan`): that is the
 *     "one-name player?" question, an operator's;
 *   - at least one card in the scope still prints it.
 *
 * Wikidata ambiguity: the lookup writes a match only when it is exactly one
 * person, and nothing at all when the name is ambiguous or unknown, so a row
 * that is `ready` with a match, or with none, is what "Add as new player" works
 * from today. A lookup that FINISHED and found nothing (no match, or a sport
 * with no Wikidata mapping) is stored `ready` with no enrichment
 * (`runTidyNameLookupImpl`), which is exactly the new rookie this button is
 * for. There is no further state to exclude; a row whose lookup is still
 * `pending`, or `error` (a lookup that could not complete: network,
 * unavailable, timeout), is not eligible.
 *
 * ## Cost
 *
 * Each name costs a few index reads and search reads, and a creation costs a
 * player insert, the career-team matches and the answer (the card, its titles,
 * the fan-out schedule). A mutation has a second, so the work is paged exactly
 * as the other apply mutations are (`tidyCards.applyTeamToPlayerCards`): the
 * first `NEW_PLAYERS_PAGE_SIZE` names are created in the call, the rest by
 * scheduled pages that each re-check their names. `created` is therefore the
 * number ACCEPTED for creation (passed the cheap checks on the name row and
 * its printers); a scheduled page can still skip a name whose player appeared
 * in between. The list query is bounded the same way: `NEW_PLAYERS_EVAL_MAX`
 * names are checked at most, and `more` says there are others.
 */

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { listPrintersOfName } from "./cardPrintedNames";
import { clampSearchQuery } from "./lib/searchQueryClamp";
import {
  MAX_PLAYER_NAME_LENGTH,
  nameFragmentScan,
  nearSpelledPlayers,
  normalizePlayerName,
  sameNamePlayers,
} from "./players";
import {
  MAX_TIDY_NAME_LENGTH,
  createPlayerOnTarget,
  neverLooked,
  readRow,
  resolveName,
} from "./tidyNames";
import { normalizeEntityName } from "../lib/entities/normalize-name";

/** Names one `addNewPlayers` call takes (after de-duplication). */
export const MAX_NEW_PLAYERS_PER_CALL = 100;
/** Names created in one transaction: the first page inline, then one scheduled page each. */
export const NEW_PLAYERS_PAGE_SIZE = 10;
/** Player name rows read from the scope for one list. */
export const NEW_PLAYERS_SCAN_MAX = 1500;
/** Names the list checks against the player table at most (each is a few reads). */
export const NEW_PLAYERS_EVAL_MAX = 150;
/** Card numbers shown beside a name. */
export const NEW_PLAYERS_NUMBERS_SHOWN = 6;
/** Printer rows read per name for those numbers, and to find an anchor card. */
const PRINTERS_READ = NEW_PLAYERS_NUMBERS_SHOWN + 1;

/**
 * What the name ROW says, before the player table is asked: a player name,
 * unanswered, its lookup finished, nothing already on offer. Pure.
 */
export function rowIsOfferable(row: Doc<"tidyNames">): boolean {
  return (
    row.kind === "player" &&
    row.answer === undefined &&
    row.status === "ready" &&
    !neverLooked(row) &&
    (row.enrichment?.existingCandidates?.length ?? 0) === 0 &&
    row.enrichment?.preselect === undefined &&
    (row.candidateTeamIds?.length ?? 0) === 0 &&
    row.candidatePlace === undefined
  );
}

/** Nothing on file answers to this name, near-spells it, or contains it as a fragment. */
export async function playerNameIsNew(
  ctx: QueryCtx | MutationCtx,
  row: Pick<Doc<"tidyNames">, "name" | "sportId">,
): Promise<boolean> {
  const name = row.name.trim();
  if (!name || name.length > MAX_PLAYER_NAME_LENGTH) return false;
  const normalized = normalizePlayerName(name);
  if (!normalized) return false;
  if ((await sameNamePlayers(ctx, normalized, row.sportId)).length > 0) return false;
  const fragment = await nameFragmentScan(ctx, name, row.sportId);
  // A truncated read cannot prove there is no clash: the one-name question stands.
  if (fragment.matches.length > 0 || fragment.truncated) return false;
  const searchable = clampSearchQuery(name).trim();
  if (!searchable) return false;
  return (await nearSpelledPlayers(ctx, searchable, row.sportId)).length === 0;
}

/** The printers of a name that can carry its answer: not changed on their own. */
async function printersOf(
  ctx: QueryCtx | MutationCtx,
  scopeId: Id<"selectorOptions">,
  nameNormalized: string,
) {
  return listPrintersOfName(ctx, { scopeId, kind: "player", nameNormalized }, PRINTERS_READ);
}

// ─── the list ──────────────────────────────────────────────────────────────

const offeredNameValidator = v.object({
  /** The first-seen spelling: what `addNewPlayers` is sent back. */
  name: v.string(),
  /** The first few cards that print it, in the order the index holds them. */
  cardNumbers: v.array(v.string()),
  /** More cards print it than are listed. */
  moreCards: v.boolean(),
});

/**
 * The player names on a checklist the walk may add as new players in one go,
 * at most `MAX_NEW_PLAYERS_PER_CALL` (so one confirm is one call). `more` is true
 * when other names were not looked at or did not fit, so the button says "the
 * first N" and the next press offers the rest.
 *
 * Read on demand (`useConvex().query`), never subscribed: it reads the player
 * table for every name (NEO-392).
 */
export const newPlayerNames = query({
  args: { leafId: v.id("selectorOptions") },
  returns: v.object({ names: v.array(offeredNameValidator), more: v.boolean() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", args.leafId).eq("kind", "player"))
      .take(NEW_PLAYERS_SCAN_MAX + 1);
    let more = rows.length > NEW_PLAYERS_SCAN_MAX;
    const names: Array<{ name: string; cardNumbers: string[]; moreCards: boolean }> = [];
    let evaluated = 0;
    for (const row of rows.slice(0, NEW_PLAYERS_SCAN_MAX)) {
      if (!rowIsOfferable(row)) continue;
      if (names.length >= MAX_NEW_PLAYERS_PER_CALL || evaluated >= NEW_PLAYERS_EVAL_MAX) {
        more = true;
        break;
      }
      evaluated += 1;
      const printers = await printersOf(ctx, args.leafId, row.nameNormalized);
      if (printers.length === 0) continue;
      if (!(await playerNameIsNew(ctx, row))) continue;
      const cardNumbers: string[] = [];
      for (const printer of printers.slice(0, NEW_PLAYERS_NUMBERS_SHOWN)) {
        const card = await ctx.db.get(printer.cardChecklistId);
        if (card) cardNumbers.push(card.cardNumber);
      }
      names.push({
        name: row.name,
        cardNumbers,
        moreCards: printers.length > NEW_PLAYERS_NUMBERS_SHOWN,
      });
    }
    names.sort((a, b) => a.name.localeCompare(b.name));
    return { names, more };
  },
});

// ─── the write ─────────────────────────────────────────────────────────────

/**
 * Re-check one name and, if it still qualifies, create its player and answer it.
 * Every check runs before the first write; nothing here catches an error after
 * a write, because a caught error does not roll a transaction back.
 */
async function addOne(
  ctx: MutationCtx,
  userId: string,
  scopeId: Id<"selectorOptions">,
  nameNormalized: string,
): Promise<boolean> {
  const row = await readRow(ctx, scopeId, "player", nameNormalized);
  if (!row || !rowIsOfferable(row)) return false;
  if (!(await playerNameIsNew(ctx, row))) return false;
  const printers = await printersOf(ctx, scopeId, nameNormalized);
  // An anchor card that carries the answer itself: one the operator has not
  // changed on its own (`cardOverride` keeps its own link and is skipped by fan-out).
  const anchor = printers.find((p) => !p.cardOverride);
  if (!anchor) return false;
  const target = await resolveName(ctx, anchor.cardChecklistId, "player", anchor.printed);
  // Re-read through the target: the same row, now proven to be on that card.
  if (target.scopeId !== scopeId || !rowIsOfferable(target.row)) return false;
  await createPlayerOnTarget(ctx, userId, target, { name: anchor.printed });
  return true;
}

async function addPage(
  ctx: MutationCtx,
  userId: string,
  scopeId: Id<"selectorOptions">,
  keys: readonly string[],
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  for (const key of keys) {
    if (await addOne(ctx, userId, scopeId, key)) created += 1;
  }
  return { created, skipped: keys.length - created };
}

/**
 * Add the chosen names as new players (at most `MAX_NEW_PLAYERS_PER_CALL` after
 * de-duplication; over that is refused, never trimmed). Each name is re-checked
 * here: one that no longer qualifies is skipped and counted. See the module note
 * for what `created` means once pages are scheduled.
 */
export const addNewPlayers = mutation({
  args: { leafId: v.id("selectorOptions"), names: v.array(v.string()) },
  returns: v.object({ created: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireAdmin(ctx);
    if (args.names.length > MAX_NEW_PLAYERS_PER_CALL * 4) {
      throw new ConvexError(`At most ${MAX_NEW_PLAYERS_PER_CALL} players can be added at once.`);
    }
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const raw of args.names) {
      const name = raw.trim();
      if (!name) continue;
      if (name.length > MAX_TIDY_NAME_LENGTH) {
        throw new ConvexError(
          `A name is ${name.length} characters; the limit is ${MAX_TIDY_NAME_LENGTH}.`,
        );
      }
      const key = normalizeEntityName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    if (keys.length > MAX_NEW_PLAYERS_PER_CALL) {
      throw new ConvexError(`At most ${MAX_NEW_PLAYERS_PER_CALL} players can be added at once.`);
    }

    // The cheap pass over every name: a row that is no longer offerable, or that
    // no card prints, is skipped now. The player table is asked per page.
    const accepted: string[] = [];
    for (const key of keys) {
      const row = await readRow(ctx, args.leafId, "player", key);
      if (!row || !rowIsOfferable(row)) continue;
      if ((await printersOf(ctx, args.leafId, key)).length === 0) continue;
      accepted.push(key);
    }

    const now = accepted.slice(0, NEW_PLAYERS_PAGE_SIZE);
    const inline = await addPage(ctx, userId, args.leafId, now);
    for (let at = NEW_PLAYERS_PAGE_SIZE; at < accepted.length; at += NEW_PLAYERS_PAGE_SIZE) {
      await ctx.scheduler.runAfter(0, internal.tidyNewPlayers.addNewPlayersPage, {
        scopeId: args.leafId,
        keys: accepted.slice(at, at + NEW_PLAYERS_PAGE_SIZE),
        userId,
      });
    }
    return {
      created: inline.created + Math.max(0, accepted.length - now.length),
      skipped: keys.length - accepted.length + inline.skipped,
    };
  },
});

/** One scheduled page of `addNewPlayers`; every name is re-checked. */
export const addNewPlayersPage = internalMutation({
  args: {
    scopeId: v.id("selectorOptions"),
    keys: v.array(v.string()),
    userId: v.string(),
  },
  returns: v.object({ created: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => addPage(ctx, args.userId, args.scopeId, args.keys),
});
