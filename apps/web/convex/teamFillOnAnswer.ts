/**
 * NEO-645 (Q1 = A, S4) — the team fill, when a name is ANSWERED.
 *
 * `features/teamFillOnCommit.ts` fills a teamless card at the commit. A card
 * whose player name was still pending then (a name the operator links in the
 * walk, or a fan-out reaches) is never offered to that fill, so it would stop
 * pink on the Team tile even when the evidence gives exactly one team. This is
 * the same fill, asked at the moment the card loses its last pending player
 * name (`tidyCardWrites.writeNameChange`), with the wizard's own tiers and rule 8:
 *
 *  1. batch   — the other cards under this checklist with the SAME player set
 *               and a team. One distinct team set is the answer; two or more
 *               means the checklist disagrees with itself and the search STOPS
 *               (a later tier never outvotes it);
 *  2. stored  — per player, his single-player cards under this node, the node
 *               it copies, or the set's base checklist (`suggestTeamsForPlayer`,
 *               the same tiers `cardChecklist.storedTeamEvidence` gives the
 *               commit); two disagreeing cards stop the search for him;
 *  3. career  — the set year and the year before, every player answering, at
 *               most `MAX_CARD_TEAMS` teams (`careerVerdictFor`).
 *
 * A card a source named a team for, a pending team name, a "No team" stamp and a
 * disputed teams field are never filled, and neither is any card of a set whose
 * own team default is "No Team" (NEO-639, decision A). A lookup that never
 * answered is missing data, not a claim: it holds nothing back.
 *
 * A team on a card is the card's team, whoever wrote it, and counts as evidence
 * for the next card (NEO-656, J8: nothing records that NB filled it).
 *
 * The batch and stored tiers read a player's newest `TEAM_SUGGESTION_LINKS_PER_PLAYER`
 * cards: a bound that can cost a suggestion, never produce a wrong one. Both
 * come from ONE read per (leaf, player), memoised with the rest per call
 * (`FillReadCache`), so a fan-out page of 50 cards of one player reads them once.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_CARD_TEAMS } from "./features/cardAttention";
import { planCardFill, type StoredTeamEvidence } from "./features/teamFillOnCommit";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { careerVerdictFor, newCareerVerdictCache, type CareerVerdictCache } from "./lib/careerVerdict";
import { teamDefaultOf } from "./lib/selectorTeams";
import { idSetKey, suggestTeamsForPlayer } from "./lib/teamFill";
import { recentCardIdsForPlayer } from "./cardPlayerLinks";
import {
  storedTierNodes,
  TEAM_SUGGESTION_LINKS_PER_PLAYER,
  TEAM_SUGGESTION_MAX_CANDIDATES,
} from "./cardChecklist";

/** What a leaf's stored tiers read: its sport, the node it copies, its base. */
type LeafTiers = {
  sportId: Id<"selectorOptions"> | undefined;
  parallelOfNodeId: Id<"selectorOptions"> | null;
  baseNodeId: Id<"selectorOptions"> | null;
  relevant: Set<string>;
} | null;

export type FillReadCache = {
  years: Map<string, number | undefined>;
  /** By leaf id: the set's own team default is "No Team" (NEO-639 decision A). */
  noTeamLeaf: Map<string, boolean>;
  stints: Map<string, Array<{ key: string; fromYear?: number; toYear?: number }>>;
  teamSport: Map<string, Id<"selectorOptions"> | null>;
  /** The set's leagues and the career teams' ranks (`lib/careerVerdict`). */
  verdict: CareerVerdictCache;
  /** By leaf id: the nodes the stored tiers read. */
  tiers: Map<string, LeafTiers>;
  /** By `leaf|player`: the player's newest cards under the stored tiers' nodes. */
  playerCards: Map<string, Array<Doc<"cardChecklist">>>;
};

export const newFillReadCache = (): FillReadCache => ({
  years: new Map(),
  noTeamLeaf: new Map(),
  stints: new Map(),
  teamSport: new Map(),
  verdict: newCareerVerdictCache(),
  tiers: new Map(),
  playerCards: new Map(),
});

/** What a card must be, besides teamless, for NO source to have named a team (rule 8). */
export function cardMayTakeFill(
  card: Pick<
    Doc<"cardChecklist">,
    | "bscTeamName"
    | "teamNoneConfirmedAt"
    | "teamCheckOutcome"
    | "sourceDisagreements"
  >,
  fields: {
    playerIds: ReadonlyArray<unknown>;
    pendingPlayerNames: ReadonlyArray<unknown>;
    teamOnCardIds: ReadonlyArray<unknown>;
    pendingTeamNames: ReadonlyArray<unknown>;
  },
): boolean {
  return (
    fields.playerIds.length > 0 &&
    fields.pendingPlayerNames.length === 0 &&
    fields.teamOnCardIds.length === 0 &&
    fields.pendingTeamNames.length === 0 &&
    !card.bscTeamName &&
    card.teamNoneConfirmedAt === undefined &&
    card.teamCheckOutcome !== "checklist" &&
    !(card.sourceDisagreements ?? []).some((d) => d.field === "teams")
  );
}

/**
 * The team(s) the evidence gives the card, with the tier that gave them, or
 * undefined. Pure reads; the caller writes through `writeNameChange`.
 */
export async function planFillOnAnswer(
  ctx: Pick<MutationCtx, "db">,
  card: Doc<"cardChecklist">,
  playerIds: ReadonlyArray<Id<"players">>,
  cache: FillReadCache,
): Promise<{ teamIds: Array<Id<"teams">>; reason: "otherCards" | "career" } | undefined> {
  const leafKey = card.selectorOptionId as string;
  // NEO-639 (decision A): the set's own "No Team" has answered for every card; no
  // tier overrules it. Same rule as the commit's fill.
  if (!cache.noTeamLeaf.has(leafKey)) {
    cache.noTeamLeaf.set(
      leafKey,
      teamDefaultOf(await ctx.db.get(card.selectorOptionId)).kind === "noTeam",
    );
  }
  if (cache.noTeamLeaf.get(leafKey)) return undefined;
  const players = [...new Set(playerIds)];
  if (players.length === 0) return undefined;
  const sportId = card.sportId;

  // Tiers 1 and 2 read the player's cards under this leaf; read once per call.
  if (!cache.tiers.has(leafKey)) {
    const leaf = await ctx.db.get(card.selectorOptionId);
    if (!leaf) {
      cache.tiers.set(leafKey, null);
    } else {
      const nodes = await storedTierNodes(ctx, leaf);
      cache.tiers.set(leafKey, {
        ...nodes,
        relevant: new Set<string>(
          [leaf._id, nodes.parallelOfNodeId, nodes.baseNodeId].filter(
            (id): id is Id<"selectorOptions"> => id !== null,
          ),
        ),
      });
    }
  }
  const tiers = cache.tiers.get(leafKey) ?? null;
  const cardsOf = async (playerId: Id<"players">): Promise<Array<Doc<"cardChecklist">>> => {
    const key = `${leafKey}|${playerId}`;
    let cards = cache.playerCards.get(key);
    if (!cards) {
      cards = [];
      if (tiers) {
        for (const cardId of await recentCardIdsForPlayer(
          ctx,
          playerId,
          sportId,
          TEAM_SUGGESTION_LINKS_PER_PLAYER,
        )) {
          const other = await ctx.db.get(cardId);
          if (other && tiers.relevant.has(other.selectorOptionId)) {
            cards.push(other);
          }
        }
      }
      cache.playerCards.set(key, cards);
    }
    return cards;
  };

  // 1 — batch: the other cards of this checklist with the same player set.
  const setKey = idSetKey(players);
  const batchSets: Array<Array<Id<"teams">>> = [];
  for (const other of await cardsOf(players[0])) {
    if (other._id === card._id || other.selectorOptionId !== card.selectorOptionId) continue;
    if (idSetKey(other.playerIds ?? []) !== setKey) continue;
    const teams = other.teamOnCardIds ?? [];
    if (teams.length === 0) continue;
    if (!batchSets.some((seen) => idSetKey(seen) === idSetKey(teams))) {
      batchSets.push([...new Set(teams)]);
    }
  }
  // The checklist disagreeing with itself is a stop, not a pass to the next tier.
  if (batchSets.length > 1) return undefined;
  if (batchSets.length === 1) {
    return { teamIds: batchSets[0].slice(0, MAX_CARD_TEAMS), reason: "otherCards" };
  }

  // 2 — stored, per player: his own single-player cards under the stored tiers' nodes.
  const stored: Array<StoredTeamEvidence<Id<"players">, Id<"teams">>> = [];
  if (tiers) {
    for (const playerId of players) {
      const suggestion = suggestTeamsForPlayer({
        playerId,
        // No player row: the stored tiers only, the career is the next step.
        player: undefined,
        // The card being filled is not evidence about itself.
        cards: (await cardsOf(playerId)).filter((other) => other._id !== card._id),
        nodeId: card.selectorOptionId,
        parallelOfNodeId: tiers.parallelOfNodeId,
        baseNodeId: tiers.baseNodeId,
        year: undefined,
        currentYear: new Date().getFullYear(),
        maxCandidates: TEAM_SUGGESTION_MAX_CANDIDATES,
      });
      if (suggestion.answer) {
        stored.push({ playerId, status: "answer", teamIds: suggestion.answer.teamIds });
      } else if (suggestion.candidates.length > 0) {
        stored.push({ playerId, status: "disagree", teamIds: [] });
      }
    }
  }

  // 3 — career, per player.
  if (!cache.years.has(leafKey)) {
    cache.years.set(leafKey, await findSetYearForSelectorOption(ctx, card.selectorOptionId));
  }
  const year = cache.years.get(leafKey);
  const career = async (playerId: Id<"players">): Promise<Id<"teams"> | undefined> => {
    if (year === undefined) return undefined;
    const key = playerId as string;
    let stints = cache.stints.get(key);
    if (!stints) {
      const player = await ctx.db.get(playerId);
      stints = (player?.teamYears ?? []).map((t) => ({
        key: t.teamId as string,
        ...(t.fromYear !== undefined ? { fromYear: t.fromYear } : {}),
        ...(t.toYear !== undefined ? { toYear: t.toYear } : {}),
      }));
      cache.stints.set(key, stints);
    }
    // NEO-569 — ranked by the set's leagues, over this sport's teams only.
    const { verdict } = await careerVerdictFor(ctx, cache.verdict, {
      stints,
      year,
      currentYear: new Date().getFullYear(),
      selectorOptionId: card.selectorOptionId,
      sportId,
    });
    if (!verdict.answer) return undefined;
    const teamId = verdict.answer.key as Id<"teams">;
    if (!cache.teamSport.has(teamId)) {
      const team = await ctx.db.get(teamId);
      cache.teamSport.set(teamId, team ? team.sportId : null);
    }
    // A team of another sport (or a gone one) cannot be offered.
    return cache.teamSport.get(teamId) === sportId ? teamId : undefined;
  };
  return await planCardFill({ players, stored, career, maxTeams: MAX_CARD_TEAMS });
}
