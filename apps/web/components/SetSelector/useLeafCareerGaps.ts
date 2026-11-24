import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useStaleWhileLoading } from "../../src/hooks/useStaleWhileLoading";
import type { LiveCareerGap } from "./card-attention";

/**
 * `careerCoverage.CAREER_GAPS_MAX_PAIRS`, hand-copied (the server graph cannot
 * be imported here). Keep in step: the query refuses more.
 */
export const CAREER_GAPS_MAX_PAIRS = 1024;

/** The card fields the career rule reads (a `getCardChecklist` row has them all). */
export type CareerGapCard = {
  _id: Id<"cardChecklist">;
  /** The card's own set: a guest row keeps its HOME set, so its home year is the one read. */
  selectorOptionId: Id<"selectorOptions">;
  playerIds?: ReadonlyArray<Id<"players">>;
  teamOnCardIds?: ReadonlyArray<Id<"teams">>;
};

export type LeafCareerGaps = {
  /** Cards with a gap, by card id. A card with none is absent. */
  gapsByCard: ReadonlyMap<string, readonly LiveCareerGap[]>;
  /** The first answer has arrived (or there is nothing to ask). Never flips back. */
  ready: boolean;
};

const NO_GAPS: ReadonlyMap<string, readonly LiveCareerGap[]> = new Map();
const NO_ANSWER: ReadonlyArray<{
  selectorOptionId: Id<"selectorOptions">;
  playerId: Id<"players">;
  teamId: Id<"teams">;
}> = [];

const pairKey = (selectorOptionId: string, playerId: string, teamId: string) =>
  `${selectorOptionId}|${playerId}|${teamId}`;

/**
 * NEO-656 (Jason: "it should read real data and display pink/blue as
 * appropriate depending on the current state of the data") — the career gaps
 * of a checklist's cards, read live.
 *
 * ONE subscribed query (`careerCoverage.careerGaps`) for the leaf. It is asked
 * about the pairs the cards in hand already name: a card with exactly ONE
 * player (nobody can say which of several a team belongs to, the same rule as
 * the commit's), and each team it carries. It reads players and teams only,
 * never a card, so a card write does not re-run it; adding a stint, or
 * changing a team, does. The answer is the pairs no stint covers, and each one
 * is handed back on its card. Nothing is stored.
 *
 * The last answer is held while the next loads (a team change re-keys the
 * query), so a badge never blinks off for the round trip.
 */
export function useLeafCareerGaps(cards: readonly CareerGapCard[] | undefined): LeafCareerGaps {
  const pairs = useMemo(() => {
    const seen = new Map<string, (typeof NO_ANSWER)[number]>();
    for (const card of cards ?? []) {
      const playerIds = card.playerIds ?? [];
      if (playerIds.length !== 1) continue;
      for (const teamId of card.teamOnCardIds ?? []) {
        const key = pairKey(card.selectorOptionId, playerIds[0], teamId);
        if (!seen.has(key)) {
          seen.set(key, { selectorOptionId: card.selectorOptionId, playerId: playerIds[0], teamId });
        }
      }
    }
    // Sorted, so a reordered list is the same question. A checklist with more
    // pairs than the query takes shows no gap on the rest.
    return [...seen.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, CAREER_GAPS_MAX_PAIRS)
      .map(([, pair]) => pair);
  }, [cards]);

  const answer = useQuery(api.careerCoverage.careerGaps, pairs.length > 0 ? { pairs } : "skip");
  const held = useStaleWhileLoading(pairs.length > 0 ? answer : NO_ANSWER, "career-gaps");

  const gapsByCard = useMemo(() => {
    if (!held || held.length === 0) return NO_GAPS;
    const uncovered = new Set(held.map((g) => pairKey(g.selectorOptionId, g.playerId, g.teamId)));
    const out = new Map<string, LiveCareerGap[]>();
    for (const card of cards ?? []) {
      const playerIds = card.playerIds ?? [];
      if (playerIds.length !== 1) continue;
      const gaps = [...new Set(card.teamOnCardIds ?? [])]
        .filter((teamId) => uncovered.has(pairKey(card.selectorOptionId, playerIds[0], teamId)))
        .map((teamId) => ({ playerId: playerIds[0] as string, teamId: teamId as string }));
      if (gaps.length > 0) out.set(card._id as string, gaps);
    }
    return out;
  }, [cards, held]);

  return { gapsByCard, ready: cards !== undefined && (pairs.length === 0 || held !== undefined) };
}
