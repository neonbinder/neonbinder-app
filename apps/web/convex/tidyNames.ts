/**
 * NEO-645 — the name rows of One-card Tidy Up: answers, sport, lookups.
 *
 * `tidyNames` (schema.ts) replaces `entityReviewQueue` and absorbs
 * `entityReviewSkips`. One row per (scopeId, kind, nameNormalized), shared
 * across operators. This module is the PUBLIC surface the tiles call:
 *
 *   - `answerName`      Link / which player / preselect / Change / Not a player
 *                       / Not a team / clear. The one door for a name's answer.
 *   - `createPlayer`    Add as new player.
 *   - `setNameSport`    the Sport chip on a player or team tile.
 *   - `requestLookup`   "Add as new player anyway": ask Wikidata now.
 *   - `lookupsPending`  a small subscribed read: which names are still looking.
 *
 * ## STATUS: signatures first
 *
 * This is the first slice (W1a): the validators, the auth gate and the
 * contracts below are final, so the tile builders can code against them. The
 * mutations throw "not implemented yet" after the admin gate; `lookupsPending`
 * is real. W1b implements the mutations to the contracts in their doc
 * comments. A mutation that throws leaves nothing written.
 *
 * ## Conventions every mutation here follows
 *
 *  - `requireAdmin` first.
 *  - The scope is NEVER an argument. Each mutation takes the open `cardId` and
 *    the printed `name`; the server finds the card's `cardPrintedNames` row for
 *    (kind, normalised name) and reads the scope off it (falling back to the
 *    card's own leaf when the scope leaf is gone: decision Q3). A client that
 *    named a scope could answer a name in a leaf it never opened.
 *  - Strings are capped (`MAX_TIDY_NAME_LENGTH`) and arrays are capped; an
 *    over-cap argument is a `ConvexError` naming the LIMIT, never the value.
 *  - A marketplace name never appears in an error message. Errors name the
 *    kind ("player", "team"), counts and limits only.
 *  - Refusals the operator can act on are `ConvexError`s with a plain-language
 *    string; client bugs are plain `Error`s for the log.
 *  - Answers are NB data: `by` is set by the server ("operator" here; "auto"
 *    is written only by the gate from NB's own rows). A client cannot say
 *    "auto".
 */

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";
import { tidyNameKindValidator } from "./schema";

/** Longest printed name accepted, in characters. Same bound as the schema. */
export const MAX_TIDY_NAME_LENGTH = 120;

/**
 * The most pending names `lookupsPending` reads in one run. One more than it
 * returns, so `more` is exact. Pending rows are small (no enrichment yet), and
 * the query re-runs each time a lookup lands, so the bound is what keeps it
 * cheap (NEO-392).
 */
export const LOOKUPS_PENDING_RETURN_MAX = 256;

/**
 * What the operator answered, as the tiles send it. `by` is absent on purpose:
 * the server records "operator". The stored shape is `tidyNameAnswerValidator`.
 *
 *  - `linkPlayer`: link the name to this existing player. `addSetSport: true`
 *    also adds the SET's sport to the player's sports (NEO-313), meaningful
 *    only on a row switched to another sport.
 *  - `linkTeam`: link the name to this existing team. `saveAsAlias: true`
 *    remembers the printed spelling as an alias of the team (NEO-284).
 *  - `notEntity`: "Not a player" / "Not a team".
 *  - `clear`: undo the answer (Change). Not a stored arm.
 */
export const tidyAnswerInputValidator = v.union(
  v.object({
    kind: v.literal("linkPlayer"),
    playerId: v.id("players"),
    addSetSport: v.optional(v.literal(true)),
  }),
  v.object({
    kind: v.literal("linkTeam"),
    teamId: v.id("teams"),
    saveAsAlias: v.optional(v.literal(true)),
  }),
  v.object({ kind: v.literal("notEntity") }),
  v.object({ kind: v.literal("clear") }),
);

function notImplemented(fn: string): never {
  throw new ConvexError(`${fn} is not implemented yet`);
}

/**
 * Answer a printed name for every card in its scope.
 *
 * ## Contract
 *
 * 1. Resolve the scope from the open card's printed row for
 *    (`kind`, `normalizeEntityName(name)`). No printed row on this card is a
 *    client bug (an exact single match has no row, D6; its Change goes through
 *    `updateCard`, which sets `cardOverride`).
 * 2. Validate the answer against the row: a `linkPlayer` player must exist and
 *    belong to the row's `sportId` (`playerBelongsToSport`), except a link to
 *    the row's `preselect` or an `existingCandidates` id, which may be in
 *    another sport and RE-POINTS the row's `sportId` to the player's home sport
 *    (D7). A typed link stays sport-checked. A `linkTeam` team must exist and
 *    be in the row's sport. A kind/answer mismatch (a player id on a team row)
 *    is refused. `saveAsAlias` is refused on a player row; `addSetSport` on a
 *    team row (they name an intent the write would drop).
 * 3. Write the row: `answer` (by "operator"), `answerGen` + 1,
 *    `answeredByUserId`, `answeredAt`. `clear` removes the answer and bumps
 *    `answerGen`; an operator answer is replaced by a new operator answer; an
 *    `auto` answer is kept until the operator answers again (item 15), and
 *    `clear` of an auto answer leaves the row unanswered with its
 *    `preselect.reason` so Change shows the old pick as the primary.
 * 4. Side effects in the SAME transaction: `saveAsAlias` writes the alias
 *    through `normalizeTeamAliasList` + `syncTeamAliases` (never removed by a
 *    later Change; Team Management removes it); `addSetSport` runs
 *    `syncPlayerSports`. Recorded on the answer for audit.
 * 5. Patch the OPEN card in the same transaction: `playerIds` +
 *    `playerLinks` at the printed position (`cardPrintedNames.order`) or
 *    `teamOnCardIds`; the name leaves `pendingPlayerNames` / `pendingTeamNames`
 *    on a link and goes back on a clear; `notEntity` removes the name from
 *    pending AND from the generated title (`storedCardTitle`), and `clear`
 *    restores it. The title follows `updateCard`'s link rule. The card's index
 *    rows go through their one writers (`syncCardPlayerLinks`,
 *    `syncCardTeamLinks`, `syncCardPrintedNames`). The teamless-sport default
 *    is re-run on a card that just lost its last pending player name (item 14).
 *    These writes bump `lastUpdated` (content changed under an open review).
 * 6. Schedule the fan-out when other cards printed the name: a paged internal
 *    action (shape of `cascadeAutographFormat`) over
 *    `cardPrintedNames.by_scope_kind_name`, 50 cards a page, which SKIPS
 *    `cardOverride` rows and any card whose current state for the name is not
 *    what the previous answer produced (compare-and-set), and STOPS when the
 *    row's `answerGen` no longer matches the job's.
 *
 * Idempotent: the same answer twice writes nothing the second time.
 *
 * Returns the new `answerGen` and whether a fan-out was scheduled.
 */
export const answerName = mutation({
  args: {
    /** The open card. The scope is read from its printed row, never sent. */
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    /** The spelling the card printed (any case; matched normalised). */
    name: v.string(),
    answer: tidyAnswerInputValidator,
  },
  returns: v.object({
    answerGen: v.number(),
    fanOutScheduled: v.boolean(),
  }),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyNames.answerName");
  },
});

/**
 * Add as new player.
 *
 * ## Contract
 *
 * 1. Scope and row as in `answerName`. The row must be unanswered.
 * 2. `players.findOrCreate`'s insert path (internal helper, not the public
 *    mutation) with the row's sport, its Wikidata fields (`wikidataId`,
 *    `birthYear`, `isHallOfFame`) and the row's `enrichment` career. A
 *    one-word name that clashes with a fuller-named player is refused with
 *    `PLAYER_NAME_FRAGMENT` unless `oneNamePlayer: true` (NEO-463,
 *    `assertNotNameFragment`).
 * 3. Then exactly `answerName({ linkPlayer })` with `by: "operator"`: the
 *    answer, the open-card patch and the scheduled fan-out. There is no stored
 *    "create" answer.
 * 4. Append `{ kind: "newPlayerCareer", playerId }` to the OPEN card's
 *    `tidyChecks` (the player was created on THIS card, so only this card shows
 *    the career as blue).
 *
 * Returns the player and the answer's `answerGen`.
 */
export const createPlayer = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    /** The spelling to create the player under; matched to the card's printed names. */
    name: v.string(),
    /** NEO-463: confirm a one-word name is a one-name player. */
    oneNamePlayer: v.optional(v.literal(true)),
  },
  returns: v.object({
    playerId: v.id("players"),
    answerGen: v.number(),
  }),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyNames.createPlayer");
  },
});

/**
 * The Sport chip: ask the question in another sport.
 *
 * Ported from `entityReviewQueue.switchRowSport` (NEO-313).
 *
 * ## Contract
 *
 * - Refused on an answered row (clear the answer first: it was made about the
 *   old sport) and when `sportId` is not a sport-level row.
 * - Re-points the row's `sportId`, clears the lookup's `enrichment`, bumps
 *   `lookupGen` and sets `lookupRequestedAt`, then re-enqueues the Wikidata
 *   lookup under the new sport, UNLESS the name is a same-name choice there
 *   (NEO-332: the row settles `ready` with its candidates and waits for
 *   Add as new player, exactly as at the gate).
 * - Switching to the sport the row already has is a no-op. Switching back to
 *   the set's sport is the same operation.
 * - Player and team rows both switch. A team row re-reads `candidateTeamIds`
 *   in the new sport (NEO-602); a player row re-looks-up.
 * - An in-flight lookup for the old sport is dropped by its `lookupGen`.
 *
 * Nothing is stored beyond the row: the next set that prints the name asks
 * again in its own sport.
 */
export const setNameSport = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
    sportId: v.id("selectorOptions"),
  },
  returns: v.null(),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyNames.setNameSport");
  },
});

/**
 * "Add as new player anyway": ask Wikidata about a name now.
 *
 * Ported from `entityReviewQueue.requestPlayerLookup`.
 *
 * ## Contract
 *
 * - Player rows only; refused on a team row and on an answered row.
 * - A name born `ready` (a same-name choice, or a preselect: no lookup yet)
 *   becomes `pending`: bump `lookupGen`, set `lookupRequestedAt`, enqueue the
 *   pooled lookup (`wikidataPool`), whose result must carry the same
 *   `lookupGen` to be applied.
 * - A row already looked up (or already looking) is a no-op: the tile shows the
 *   lookup it has.
 * - The lookup lands on the open card's tile through `cardContext`; no
 *   acknowledgement is waited on.
 */
export const requestLookup = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    kind: tidyNameKindValidator,
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyNames.requestLookup");
  },
});

/**
 * The names in a scope whose Wikidata lookup has not finished. REAL.
 *
 * The walk subscribes to this only while it is open, with the open card's
 * scope. A card's tiles stay skeletons (and the card stays out of the walk)
 * while one of ITS pending names is in this list. Parallel copies: a pending
 * name on a copy is scoped to its source leaf, so this query, called with the
 * copy's own leaf, misses it and the copy sorts as ready. The tiles are still
 * right (`tidyCards.cardContext` reads by the printed row's scope). Accepted.
 *
 * One `by_scope_status` range, at most `LOOKUPS_PENDING_RETURN_MAX + 1` small
 * documents; `more` says there were more than were returned.
 */
export const lookupsPending = query({
  args: { scopeId: v.id("selectorOptions") },
  returns: v.object({
    names: v.array(
      v.object({
        kind: tidyNameKindValidator,
        nameNormalized: v.string(),
      }),
    ),
    more: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("tidyNames")
      .withIndex("by_scope_status", (q) =>
        q.eq("scopeId", args.scopeId).eq("status", "pending"),
      )
      .take(LOOKUPS_PENDING_RETURN_MAX + 1);
    return {
      names: rows
        .slice(0, LOOKUPS_PENDING_RETURN_MAX)
        .map((r) => ({ kind: r.kind, nameNormalized: r.nameNormalized })),
      more: rows.length > LOOKUPS_PENDING_RETURN_MAX,
    };
  },
});
