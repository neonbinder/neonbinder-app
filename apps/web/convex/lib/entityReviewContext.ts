/**
 * NEO-602 — the stored shape of an `entityReviewQueue` row's display context,
 * defined once for `schema.ts` (what the table stores) and
 * `entityReviewQueue.ts` (what `getInternal` returns and what `startBatch`
 * takes). They used to be written out three times; `getInternal`'s `returns`
 * validator missed them, and every team row (which always carries
 * `teamContext`) failed with a ReturnsValidationError when the pool's lookup
 * work item read it.
 *
 * Display only: nothing decides from either field. See the field comments in
 * `schema.ts` for what the review gate writes and when.
 */

import { v } from "convex/values";

/** `entityReviewQueue.teamContext` — a team step's candidates and triggering cards. */
export const teamContextValidator = v.object({
  candidateTeamIds: v.array(v.id("teams")),
  /**
   * True when the candidates are the in-league teams LOCATED at the printed
   * text (a place, NEO-591), not teams that answer to it by name or alias. The
   * step's lead-in says "from New York" instead of "by that name". Absent for
   * a name or alias match and on rows written before this field.
   */
  place: v.optional(v.literal(true)),
  cards: v.array(
    v.object({
      number: v.optional(v.string()),
      players: v.array(
        v.object({ name: v.string(), playerId: v.optional(v.id("players")) }),
      ),
    }),
  ),
  moreCards: v.number(),
});

/** `entityReviewQueue.playerContext` — a same-name player step's triggering cards. */
export const playerContextValidator = v.object({
  cards: v.array(
    v.object({ number: v.optional(v.string()), teams: v.array(v.string()) }),
  ),
  moreCards: v.number(),
});
