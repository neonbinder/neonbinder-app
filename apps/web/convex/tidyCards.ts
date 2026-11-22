/**
 * NEO-645 — the card-level writes and the one subscribed read of One-card Tidy
 * Up. The name answers live in `tidyNames.ts`; the career write is
 * `players.addStint`.
 *
 *   - `cardContext`            REAL. One card's names, players, teams: the walk's
 *                              only per-card subscription besides `getCardChecklist`.
 *   - `markReviewed`           REAL. "Seen" for blue; refuses while pink remains.
 *   - `pickSourceValue`        Sources disagree: use one value (this card, or the
 *                              cards with the same disagreement).
 *   - `applyTeamToPlayerCards` the guarded "Apply to all" on the Team tile.
 *   - `applyVariation`         Apply a corrected variation to the cards that share it.
 *   - `applySetNameToTitles`   "Shorten the set name for every card".
 *
 * ## STATUS: signatures first
 *
 * This is the first slice (W1a): validators, the auth gate and the contracts
 * below are final so the tile builders can code against them. The four write
 * mutations throw "not implemented yet" after the admin gate and write nothing;
 * W1b implements them to the contracts in their doc comments.
 *
 * ## Conventions every mutation here follows
 *
 *  - `requireAdmin` first.
 *  - Every string and array argument is capped; an over-cap argument is a
 *    `ConvexError` naming the LIMIT, never the value.
 *  - A marketplace name never appears in an error message.
 *  - A bulk call (`cardIds`, at most `MAX_APPLY_CARDS`) is checked per card on
 *    the server: the client's belief that cards "have the same disagreement" is
 *    never trusted. The open card is written in the call; the rest are written
 *    by scheduled 50-card pages (a call that wrote 100 cards inline would be
 *    about 1,500 operations).
 *  - Writes that change `playerIds`, `teamOnCardIds`, a title or a variation
 *    bump `lastUpdated` (the NEO-203 baseVersion): content really changed under
 *    an open review. `tidyReviewed`, `tidyChecks`, `sourceNumbers` and
 *    `cardPrintedNames` writes never do.
 */

import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import {
  tidyNameAnswerValidator,
  tidyNameEnrichmentValidator,
  tidyNameKindValidator,
  tidyLookupStatusValidator,
} from "./schema";
import {
  listCardPrintedNames,
  listPrintersOfName,
  resolveScopeLeaf,
} from "./cardPrintedNames";
import {
  TIDY_REVIEWED_KEY_MAX_LENGTH,
  TIDY_REVIEWED_MAX_KEYS,
  currentReviewKeys,
  deriveCardAttention,
} from "./features/cardAttention";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { teamFullName } from "../lib/teams/team-name";

/** The most cards one bulk apply can name. */
export const MAX_APPLY_CARDS = 100;
/** Cards of one page of a scheduled bulk apply. */
export const APPLY_PAGE_SIZE = 50;
/** A source value's longest name, and the most names in one value. */
export const MAX_PICK_NAME_LENGTH = 120;
export const MAX_PICK_NAMES = 20;
/** `cardContext` bounds (NEO-392: a subscribed query stays small). */
export const CONTEXT_MAX_PLAYERS = 4;
export const CONTEXT_MAX_STINTS_PER_PLAYER = 32;
export const CONTEXT_MAX_TEAMS = 16;
/** "Printed on #1, #17": how many card numbers are shown, and how many are counted. */
export const CONTEXT_PRINTED_ON_SHOWN = 8;
export const CONTEXT_PRINTED_ON_COUNTED = 50;

function notImplemented(fn: string): never {
  throw new ConvexError(`${fn} is not implemented yet`);
}

// ─── cardContext ────────────────────────────────────────────────────────────

const printedOnValidator = v.object({
  /** The first few card numbers that printed the name, for "Printed on #1, #17". */
  cardNumbers: v.array(v.string()),
  /** How many cards printed it, counted up to `CONTEXT_PRINTED_ON_COUNTED`. */
  count: v.number(),
  /** More than `count` (render "50+"). */
  more: v.boolean(),
});

/** One name the open card printed that has a name row. */
export const contextNameValidator = v.object({
  kind: tidyNameKindValidator,
  nameNormalized: v.string(),
  /** This card's own spelling. */
  printed: v.string(),
  order: v.number(),
  /** The operator changed THIS card on its own; an answer elsewhere never overwrites it. */
  cardOverride: v.boolean(),
  /** The scope the name is answered in (the card's own leaf when its scope leaf is gone). */
  scopeId: v.id("selectorOptions"),
  /** The name row; null when none exists (nothing to answer). */
  row: v.union(
    v.null(),
    v.object({
      name: v.string(),
      sportId: v.id("selectorOptions"),
      status: tidyLookupStatusValidator,
      enrichment: v.optional(tidyNameEnrichmentValidator),
      candidateTeamIds: v.optional(v.array(v.id("teams"))),
      candidatePlace: v.optional(v.literal(true)),
      answer: v.optional(tidyNameAnswerValidator),
      answerGen: v.optional(v.number()),
    }),
  ),
  /** Which cards print the same name; null once the name is answered. */
  printedOn: v.union(v.null(), printedOnValidator),
});

export const contextPlayerValidator = v.object({
  playerId: v.id("players"),
  name: v.string(),
  /** The name this card printed for the player, when it differs from `name`. */
  nameOnCard: v.optional(v.string()),
  birthYear: v.optional(v.number()),
  isHallOfFame: v.optional(v.boolean()),
  sportId: v.id("selectorOptions"),
  stints: v.array(
    v.object({
      teamId: v.id("teams"),
      teamName: v.string(),
      fromYear: v.optional(v.number()),
      toYear: v.optional(v.number()),
    }),
  ),
  /** The player has more stints than `stints` holds. */
  stintsMore: v.boolean(),
});

export const contextTeamValidator = v.object({
  teamId: v.id("teams"),
  /** Full name, "San Diego Padres". */
  name: v.string(),
  /** The card carries this team. */
  onCard: v.boolean(),
  /** A name row offered this team as a candidate (NEO-602). */
  candidate: v.boolean(),
});

/** Why a name was linked without the operator ("Linked for you"). */
export const linkedForReasonValidator = v.union(
  v.literal("exact"),
  v.literal("setHistory"),
  v.literal("hallOfFame"),
  v.literal("careerTeam"),
);

export const cardContextValidator = v.object({
  cardId: v.id("cardChecklist"),
  names: v.array(contextNameValidator),
  players: v.array(contextPlayerValidator),
  /** The card links more players than `players` holds. */
  playersMore: v.boolean(),
  teams: v.array(contextTeamValidator),
  linkedFor: v.array(
    v.union(
      v.object({
        kind: v.literal("player"),
        playerId: v.id("players"),
        reason: linkedForReasonValidator,
      }),
      v.object({
        kind: v.literal("team"),
        teamId: v.id("teams"),
        reason: linkedForReasonValidator,
      }),
    ),
  ),
});

/**
 * Everything the open card's tiles need beyond the card row itself. REAL.
 *
 * Subscribed only while the walk is open (NEO-392). The reads are bounded and
 * the result is small by construction:
 *
 *  - the card, its `cardPrintedNames` rows (at most 28), a point read of the
 *    `tidyNames` row for each (at most 28);
 *  - "Printed on" only for names still UNANSWERED: a `by_scope_kind_name` take
 *    of `CONTEXT_PRINTED_ON_COUNTED + 1`, with the first
 *    `CONTEXT_PRINTED_ON_SHOWN` cards read for their numbers;
 *  - at most `CONTEXT_MAX_PLAYERS` linked players and, for each, at most
 *    `CONTEXT_MAX_STINTS_PER_PLAYER` stints (team names cached per call);
 *  - the card's teams plus any `candidateTeamIds`, at most `CONTEXT_MAX_TEAMS`.
 *
 * Target: under 150 documents. It re-runs on the open card's own writes and on
 * a lookup landing for one of its names, both of which are wanted.
 *
 * When a printed row's scope leaf is gone (a wipe took a parallel copy's source
 * leaf), the name is read in the card's own leaf (decision Q3); `scopeId` says
 * which scope was used.
 *
 * `linkedFor`: the "Linked for you" note. A player whose name row carries an
 * `auto` answer reports its `autoReason`; a linked player with NO name row
 * whose normalised name equals what the card printed reports `exact` (D6: an
 * exact single match gets no row, so the note is read live). An operator's own
 * answer is not "for you" and reports nothing.
 *
 * Returns null when the card is gone.
 */
export const cardContext = query({
  args: { cardId: v.id("cardChecklist") },
  returns: v.union(v.null(), cardContextValidator),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get(args.cardId);
    if (!card) return null;

    // One cache for every team name this call needs.
    const teamNames = new Map<string, string>();
    const teamName = async (teamId: Id<"teams">): Promise<string | null> => {
      const held = teamNames.get(teamId);
      if (held !== undefined) return held;
      const team = await ctx.db.get(teamId);
      if (!team) return null;
      const name = teamFullName(team);
      teamNames.set(teamId, name);
      return name;
    };

    // ── names ──
    const printed = await listCardPrintedNames(ctx, card._id);
    const scopeCache = new Map<string, Id<"selectorOptions">>();
    const names: Array<Infer<typeof contextNameValidator>> = [];
    const rowOf = new Map<string, Doc<"tidyNames">>();
    for (const p of printed) {
      let scopeId = scopeCache.get(p.scopeId);
      if (!scopeId) {
        scopeId = await resolveScopeLeaf(ctx, p, card.selectorOptionId);
        scopeCache.set(p.scopeId, scopeId);
      }
      const row = await ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) =>
          q
            .eq("scopeId", scopeId!)
            .eq("kind", p.kind)
            .eq("nameNormalized", p.nameNormalized),
        )
        .first();
      if (row) rowOf.set(`${p.kind}|${p.nameNormalized}`, row);

      let printedOn: Infer<typeof printedOnValidator> | null = null;
      if (row && !row.answer) {
        const printers = await listPrintersOfName(
          ctx,
          { scopeId, kind: p.kind, nameNormalized: p.nameNormalized },
          CONTEXT_PRINTED_ON_COUNTED + 1,
        );
        const cardNumbers: string[] = [];
        for (const printer of printers.slice(0, CONTEXT_PRINTED_ON_SHOWN)) {
          const printerCard = await ctx.db.get(printer.cardChecklistId);
          if (printerCard) cardNumbers.push(printerCard.cardNumber);
        }
        printedOn = {
          cardNumbers,
          count: Math.min(printers.length, CONTEXT_PRINTED_ON_COUNTED),
          more: printers.length > CONTEXT_PRINTED_ON_COUNTED,
        };
      }
      names.push({
        kind: p.kind,
        nameNormalized: p.nameNormalized,
        printed: p.printed,
        order: p.order,
        cardOverride: p.cardOverride === true,
        scopeId,
        row: row
          ? {
              name: row.name,
              sportId: row.sportId,
              status: row.status,
              ...(row.enrichment ? { enrichment: row.enrichment } : {}),
              ...(row.candidateTeamIds ? { candidateTeamIds: row.candidateTeamIds } : {}),
              ...(row.candidatePlace ? { candidatePlace: row.candidatePlace } : {}),
              ...(row.answer ? { answer: row.answer } : {}),
              ...(row.answerGen !== undefined ? { answerGen: row.answerGen } : {}),
            }
          : null,
        printedOn,
      });
    }

    // ── players ──
    const playerIds = card.playerIds ?? [];
    const players: Array<Infer<typeof contextPlayerValidator>> = [];
    const linkedFor: Array<Infer<typeof cardContextValidator>["linkedFor"][number]> = [];
    for (const playerId of playerIds.slice(0, CONTEXT_MAX_PLAYERS)) {
      const player = await ctx.db.get(playerId);
      if (!player) continue;
      const nameOnCard = card.playerLinks?.find((l) => l.playerId === playerId)?.nameOnCard;
      const stints = [];
      for (const s of (player.teamYears ?? []).slice(0, CONTEXT_MAX_STINTS_PER_PLAYER)) {
        const name = await teamName(s.teamId);
        if (name === null) continue;
        stints.push({
          teamId: s.teamId,
          teamName: name,
          ...(s.fromYear !== undefined ? { fromYear: s.fromYear } : {}),
          ...(s.toYear !== undefined ? { toYear: s.toYear } : {}),
        });
      }
      players.push({
        playerId,
        name: player.name,
        ...(nameOnCard && nameOnCard !== player.name ? { nameOnCard } : {}),
        ...(player.birthYear !== undefined ? { birthYear: player.birthYear } : {}),
        ...(player.isHallOfFame !== undefined ? { isHallOfFame: player.isHallOfFame } : {}),
        sportId: player.sportId,
        stints,
        stintsMore: (player.teamYears?.length ?? 0) > CONTEXT_MAX_STINTS_PER_PLAYER,
      });

      // "Linked for you".
      const printedKey = normalizeEntityName(nameOnCard ?? player.name);
      const row = rowOf.get(`player|${printedKey}`);
      const answer = row?.answer;
      if (answer?.kind === "linkPlayer" && answer.playerId === playerId) {
        if (answer.by === "auto" && answer.autoReason) {
          linkedFor.push({ kind: "player", playerId, reason: answer.autoReason });
        }
      } else if (!row && player.nameNormalized === printedKey) {
        linkedFor.push({ kind: "player", playerId, reason: "exact" });
      }
    }

    // ── teams ──
    const onCard = new Set<string>(card.teamOnCardIds ?? []);
    const candidates = new Set<string>();
    for (const row of rowOf.values()) {
      if (row.kind !== "team") continue;
      for (const id of row.candidateTeamIds ?? []) candidates.add(id);
      if (row.answer?.kind === "linkTeam" && row.answer.by === "auto" && row.answer.autoReason) {
        linkedFor.push({
          kind: "team",
          teamId: row.answer.teamId,
          reason: row.answer.autoReason,
        });
      }
    }
    const teams: Array<Infer<typeof contextTeamValidator>> = [];
    for (const id of [...new Set([...onCard, ...candidates])].slice(0, CONTEXT_MAX_TEAMS)) {
      const name = await teamName(id as Id<"teams">);
      if (name === null) continue;
      teams.push({
        teamId: id as Id<"teams">,
        name,
        onCard: onCard.has(id),
        candidate: candidates.has(id),
      });
    }

    return {
      cardId: card._id,
      names,
      players,
      playersMore: playerIds.length > CONTEXT_MAX_PLAYERS,
      teams,
      linkedFor,
    };
  },
});

// ─── markReviewed ───────────────────────────────────────────────────────────

/**
 * Save & next on a card that has blue items: mark the ones the operator saw as
 * seen. REAL.
 *
 * ## Contract
 *
 * - Refused (`ConvexError`, "Fix the pink items first.") while the card still
 *   has any pink item: Save & next is only ever enabled with none left, so this
 *   is the server's guard against a stale client.
 * - The server RECOMPUTES the blue keys from the stored row
 *   (`currentReviewKeys`) and stores exactly those of `keys` that are still
 *   current, so a key the client never saw (an item that appeared between the
 *   render and the click) is NOT marked seen, and a key for a value that has
 *   since changed is dropped.
 * - `keys` is at most `TIDY_REVIEWED_MAX_KEYS` entries of at most
 *   `TIDY_REVIEWED_KEY_MAX_LENGTH` characters; over either is a `ConvexError`.
 * - Writes `tidyReviewed: { at, keys }` and NOTHING else: no `lastUpdated`, no
 *   title, no link rows (the NEO-203 baseVersion must not move for a review).
 * - Idempotent; replaces the previous list (a key whose value changed drops out
 *   and its item re-raises).
 *
 * Returns the keys that were stored.
 */
export const markReviewed = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    keys: v.array(v.string()),
  },
  returns: v.object({ keys: v.array(v.string()) }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.keys.length > TIDY_REVIEWED_MAX_KEYS) {
      throw new ConvexError(
        `At most ${TIDY_REVIEWED_MAX_KEYS} items can be marked seen at once.`,
      );
    }
    if (args.keys.some((k) => k.length > TIDY_REVIEWED_KEY_MAX_LENGTH)) {
      throw new ConvexError(
        `A seen-key is at most ${TIDY_REVIEWED_KEY_MAX_LENGTH} characters.`,
      );
    }
    const card = await ctx.db.get(args.cardId);
    if (!card) throw new Error("Card not found");
    if (deriveCardAttention(card).level === "fix") {
      throw new ConvexError("Fix the pink items first.");
    }
    const current = new Set(currentReviewKeys(card));
    const keys = [...new Set(args.keys)].filter((k) => current.has(k));
    await ctx.db.patch(card._id, { tidyReviewed: { at: Date.now(), keys } });
    return { keys };
  },
});

// ─── write mutations (contracts only) ───────────────────────────────────────

/**
 * Sources disagree: use one value.
 *
 * ## Contract
 *
 * - `field` names a `sourceDisagreements` entry on the card with no `chosen`
 *   (or a `chosen.by: "nb"` one, which Change flips). `value` is one of the
 *   entry's `values`, or a typed value (`typed: true`, the "Type another"
 *   control; then it is cleansed with the shared name matcher and must not be
 *   empty). Names are capped at `MAX_PICK_NAMES` of at most
 *   `MAX_PICK_NAME_LENGTH` characters.
 * - Each parsed name is resolved: an exact single NB match links; an existing
 *   `tidyNames` answer applies; anything else becomes a pending name plus a
 *   name row (born `pending`, lookup enqueued AFTER the write) and a
 *   `cardPrintedNames` row through the one writer. A generated title is
 *   regenerated (a hand-typed one is left alone).
 * - Stamps `chosen: { value, by: "operator", typed? }` on the entry. That stamp
 *   on its own does not bump `lastUpdated`; the link/pending writes it causes
 *   do.
 * - `cardIds` (at most `MAX_APPLY_CARDS`): "Apply to the cards with the same
 *   disagreement". The server checks EACH card carries the same field with the
 *   same set of values and no `chosen`; a card that differs is refused and
 *   counted, never written. The open card is written in the call; the rest by
 *   scheduled `APPLY_PAGE_SIZE`-card pages.
 *
 * Returns the cards written in the call, the cards queued for scheduled pages,
 * and the cards refused.
 */
export const pickSourceValue = mutation({
  args: {
    cardId: v.id("cardChecklist"),
    field: v.union(v.literal("players"), v.literal("teams")),
    value: v.array(v.string()),
    typed: v.optional(v.literal(true)),
    cardIds: v.optional(v.array(v.id("cardChecklist"))),
  },
  returns: v.object({
    applied: v.number(),
    scheduled: v.number(),
    refused: v.number(),
  }),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyCards.pickSourceValue");
  },
});

/**
 * The guarded "Apply to all" on the Team tile.
 *
 * ## Contract (rule 8: a data claim holds back a guess)
 *
 * The server checks EVERY card in `cardIds` (at most `MAX_APPLY_CARDS`) and
 * skips and counts any it refuses. A card is written only when ALL hold:
 *  - it carries exactly one player, the same player as `sourceCardId`;
 *  - it has no teams, no pending team names, no `bscTeamName`, no checklist
 *    claim, no unsettled or chosen teams disagreement, and no No-team stamp;
 *  - `careerTeamVerdict` / `stintCoversWindow` (`lib/teamFill.ts`) over the
 *    player's stints gives EXACTLY `teamId` for that card's year (this is the
 *    fill rule, not the career-gap rule).
 * The source card must already carry `teamId`. A traded player's other-team
 * card, a multi-player card and a card a source named a team for are skipped.
 *
 * Written cards get `teamOnCardIds: [teamId]` through the one writer
 * (`syncCardTeamLinks`, which settles the card's league) and a regenerated
 * generated title; `lastUpdated` bumps. The first `APPLY_PAGE_SIZE` accepted
 * cards are written in the call; the rest by scheduled pages.
 *
 * Returns the cards accepted for writing and the cards skipped.
 */
export const applyTeamToPlayerCards = mutation({
  args: {
    sourceCardId: v.id("cardChecklist"),
    teamId: v.id("teams"),
    cardIds: v.array(v.id("cardChecklist")),
  },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyCards.applyTeamToPlayerCards");
  },
});

/**
 * Apply a corrected card variation to the cards that print the same one.
 *
 * ## Contract
 *
 * For each card in `cardIds` (at most `MAX_APPLY_CARDS`): write
 * `cardVariation: to` only when the card's stored variation, trimmed, equals
 * `from` (compare-and-set: a card edited since is skipped and counted). `to`
 * is trimmed and capped like `updateCard`'s variation. A generated title is
 * regenerated; a hand-typed one is left alone. A `variation:` key in
 * `tidyReviewed` for the old value no longer matches, so a still-long new
 * value re-raises on its own.
 *
 * Returns the cards written and the cards skipped.
 */
export const applyVariation = mutation({
  args: {
    cardIds: v.array(v.id("cardChecklist")),
    from: v.string(),
    to: v.string(),
  },
  returns: v.object({ applied: v.number(), skipped: v.number() }),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyCards.applyVariation");
  },
});

/**
 * "Shorten the set name for every card": save the new set name and retitle.
 *
 * ## Contract
 *
 * - Writes the leaf's `metadata.listingShortName` with the
 *   `setSelectorOptionListingShortName` rules (`selectorOptions.ts`).
 * - Patches the OPEN card's title now (`cardId`).
 * - Schedules a paged retitle (`convex/features/setNameInTitles.ts`, the NEO-637
 *   rules): a generated title is regenerated; a hand edit showing "Left out" gets
 *   `swapSetNameInTitle`; any other hand edit is left alone. Selection is a
 *   query over `by_selector_option_and_sort`; 100 writes a page.
 * - The live preview while typing is client-side (`useTitlePreview`); this is
 *   the Save.
 *
 * Returns whether the open card was retitled and whether pages were scheduled.
 */
export const applySetNameToTitles = mutation({
  args: {
    leafId: v.id("selectorOptions"),
    /** The open card, patched in the call. */
    cardId: v.id("cardChecklist"),
    listingShortName: v.string(),
  },
  returns: v.object({
    openCardRetitled: v.boolean(),
    scheduled: v.boolean(),
  }),
  handler: async (ctx, _args) => {
    await requireAdmin(ctx);
    return notImplemented("tidyCards.applySetNameToTitles");
  },
});
