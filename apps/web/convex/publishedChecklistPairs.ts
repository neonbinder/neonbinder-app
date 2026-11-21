/**
 * NEO-490 — the operator's own checklist links, answered the way the fetch
 * answers its own.
 *
 * When a publisher checklist leaves a card or a row unpaired (a tie that
 * names and numbers could not settle, rule 8: `checklistMatch.needsOperator`),
 * `fetchCardChecklist` applies nothing it cannot prove and hands the leftovers
 * to the Match Cards dialog. The operator links a checklist row to a card
 * there; on Confirm the dialog sends those links here and merges the answers
 * into the cards it confirms.
 *
 * Each answer is exactly what step 3c would have given the same card and row:
 * the same pure `applyChecklistRow`, the same comma-text resolution
 * (`resolveChecklistCommaTexts`, through
 * `checklistCandidates.resolveChecklistTeamTexts`). So a row the operator
 * linked fills players, answers the team (`teamLookup: "checklist"`), or
 * surfaces a disagreement (`checklistConflict`) by the same rules.
 *
 * NEO-591 — the card's NUMBER. This action returns no number: it never reads
 * one off the card and never writes one. Names pair a card and a number only
 * confirms (product rule 7), so a linked card and row whose numbers differ
 * are still a pair; the dialog, which holds both numbers, sets the card's
 * with `preferCardNumber(card, row.number)` (letters over digits over none,
 * the card's own on a tie) and remembers the one it replaced for Unlink, the
 * same choice step 3c makes for the pairs the fetch made. The link is a
 * new card's number only: an NB card that already exists is never renumbered.
 *
 * Writes nothing: the rows are never stored, and the cards live in the
 * client until the commit. Admin-only, like every entry point onto the set
 * builder, bounded by the same row cap the fetch takes, and refused for a
 * set with no sport above it (no scope to resolve a team text in).
 */
import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import { findSportForSelectorOption } from "./cardChecklist";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import { MAX_PLAYER_NAME_LENGTH } from "../lib/players/name-limits";
import { applyChecklistRow } from "../lib/checklists/apply-published-row";
import { checklistConflictValidator } from "./schema";
import {
  MAX_PUBLISHED_CHECKLIST_ROWS,
  checkPublishedChecklist,
  publishedChecklistRowValidator,
  resolveChecklistCommaTexts,
  resolveChecklistPlaceSets,
  resolveChecklistPlaceTexts,
  resolveChecklistTeamIdentities,
} from "./selectorOptions";

/**
 * One answer per pair, in pair order, ready to spread onto the card:
 *  - `players` — the row's players, only when the card has none;
 *  - `teams` + `teamLookup: "checklist"` — only when the row answers the
 *    team (it names one, it resolves, and the card names no different one;
 *    a printed place that is one of the card's team's places adds no claim,
 *    so the card keeps its team);
 *  - `checklistConflict` — only when the card and the row disagree, the
 *    checklist side resolved as the card would carry it;
 *  - NEO-591: `isProspect` — the row says Prospect (its X, if any, is a
 *    team like any other and rides in `teams`).
 * An empty object means the row changes nothing on that card (a row naming
 * no team, a refused team text, players and teams that agree).
 */
const pairAnswerValidator = v.object({
  players: v.optional(v.array(v.string())),
  teams: v.optional(v.array(v.string())),
  teamLookup: v.optional(v.literal("checklist")),
  checklistConflict: v.optional(checklistConflictValidator),
  isProspect: v.optional(v.literal(true)),
});

/** A card's names as the operator sees them, checked to a card's caps. */
function checkCardNames(
  names: string[],
  max: number,
  unit: "player" | "team",
  where: string,
): string[] {
  const kept = names.map((n) => n.trim()).filter(Boolean);
  if (kept.length > max) {
    throw new ConvexError(`${where} names ${kept.length} ${unit}s; the limit is ${max}.`);
  }
  for (const n of kept) {
    if (n.length > MAX_PLAYER_NAME_LENGTH) {
      throw new ConvexError(`${where} has a ${unit} name over ${MAX_PLAYER_NAME_LENGTH} characters.`);
    }
  }
  return kept;
}

/**
 * The set's sport row, through the same bounded ancestor walk the team-text
 * resolver scopes by (`checklistCandidates.resolveChecklistTeamTexts`), or
 * null when the id names no row or no sport sits above it. Internal: only
 * `applyPublishedChecklistPairs` asks, from behind its `requireAdmin`.
 */
export const sportOfPairsSet = internalQuery({
  args: { selectorOptionId: v.id("selectorOptions") },
  returns: v.union(v.id("selectorOptions"), v.null()),
  handler: async (ctx, args) =>
    (await findSportForSelectorOption(ctx, args.selectorOptionId)) ?? null,
});

export const applyPublishedChecklistPairs = action({
  args: {
    /** The set being built: scopes the team texts to its sport and year. */
    selectorOptionId: v.id("selectorOptions"),
    /**
     * Each link the operator made: the card's CURRENT players and teams (as
     * the dialog holds them) and the publisher-checklist row linked to it.
     * At most `MAX_PUBLISHED_CHECKLIST_ROWS`.
     */
    pairs: v.array(
      v.object({
        card: v.object({ players: v.array(v.string()), teams: v.array(v.string()) }),
        row: publishedChecklistRowValidator,
      }),
    ),
  },
  returns: v.array(pairAnswerValidator),
  handler: async (ctx, args) => {
    // Outside any try, like `fetchCardChecklist`: a refusal is not an outage.
    await requireAdmin(ctx);
    if (args.pairs.length > MAX_PUBLISHED_CHECKLIST_ROWS) {
      throw new ConvexError(
        `${args.pairs.length} checklist links; the limit is ${MAX_PUBLISHED_CHECKLIST_ROWS}.`,
      );
    }
    // A set with no sport above it has no scope to resolve a team text in:
    // the resolver would answer every comma text against no sport at all.
    // Refused like the fetch refuses a bad input, before any work and
    // outside any try. (Annotated: the query lives in this module, so an
    // inferred type would be circular.)
    const sportId: Id<"selectorOptions"> | null = await ctx.runQuery(
      internal.publishedChecklistPairs.sportOfPairsSet,
      { selectorOptionId: args.selectorOptionId },
    );
    if (sportId === null) {
      throw new ConvexError(
        "applyPublishedChecklistPairs: the set has no sport above it.",
      );
    }
    if (args.pairs.length === 0) return [];
    const startedAt = Date.now();
    // The fetch's own re-check, row for row: caps, trimming, NNO flag.
    const rows = checkPublishedChecklist({ rows: args.pairs.map((p) => p.row) })!.rows;
    const cards = args.pairs.map((p, index) => {
      const where = `Linked card ${index + 1}`;
      return {
        players: checkCardNames(p.card.players, MAX_CARD_PLAYERS, "player", where),
        teams: checkCardNames(p.card.teams, MAX_CARD_TEAMS, "team", where),
      };
    });

    const resolveText = await resolveChecklistCommaTexts(
      ctx,
      args.selectorOptionId,
      rows.flatMap((r) => r.teams),
    );
    const resolvePlace = await resolveChecklistPlaceTexts(
      ctx,
      args.selectorOptionId,
      rows.flatMap((r) => r.teams),
    );
    const resolveTeamId = await resolveChecklistTeamIdentities(
      ctx,
      args.selectorOptionId,
      cards.map((card, i) => ({ card, row: rows[i] })),
      resolveText,
      resolvePlace,
    );
    // NEO-591 (Jason 2026-11-20) — a place left as printed agrees with a
    // marketplace team that is one of the place's teams, as in the fetch.
    const resolvePlaceTeamIds = await resolveChecklistPlaceSets(
      ctx,
      args.selectorOptionId,
      cards.map((card, i) => ({ card, row: rows[i] })),
      resolvePlace,
    );
    let answered = 0;
    let conflicts = 0;
    const answers = cards.map((card, i) => {
      const applied = applyChecklistRow(
        card,
        rows[i],
        resolveText,
        resolvePlace,
        resolveTeamId,
        resolvePlaceTeamIds,
      );
      if (applied.answered) answered++;
      if (applied.conflict) conflicts++;
      return {
        ...(applied.fillPlayers ? { players: applied.fillPlayers } : {}),
        ...(applied.answered && applied.teams
          ? { teams: applied.teams, teamLookup: "checklist" as const }
          : {}),
        ...(applied.conflict ? { checklistConflict: applied.conflict } : {}),
        ...(applied.isProspect ? { isProspect: true as const } : {}),
      };
    });
    // Counts and timing only — never a name.
    console.log(
      JSON.stringify({
        msg: "checklist_operator_pairs",
        operation: "applyPublishedChecklistPairs",
        pairs: args.pairs.length,
        teamsFromChecklist: answered,
        conflicts,
        elapsedMs: Date.now() - startedAt,
      }),
    );
    return answers;
  },
});
