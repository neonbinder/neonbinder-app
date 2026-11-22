/**
 * NEO-645 (Q1 = A, S4) — the team fill, when a name is ANSWERED.
 *
 * `features/teamFillOnCommit.ts` fills a teamless card at the commit. A card
 * whose player name was still pending then (a name the operator links in the
 * walk, or a fan-out reaches) is never offered to that fill, so it would stop
 * pink on the Team tile even when the career gives exactly one team. This is
 * the same fill, asked at the moment the card loses its last pending player
 * name (`tidyCardWrites.writeNameChange`), with the same verdict
 * (`careerTeamVerdict`, the set year and the year before, every player on the
 * card answering, at most `MAX_CARD_TEAMS` teams) and the same rule 8: a card
 * a source named a team for, a pending team name, a "No team" stamp and a
 * disputed teams field are never filled.
 *
 * Career tier only. The stored-cards tier (the player's other cards under this
 * node) is a read of up to ~50 documents per player, which a fan-out page of 50
 * cards cannot afford per card; a card the commit would have filled from his
 * other cards keeps its Team tile (the walk's own chips offer them).
 *
 * Reads are memoised per call (`FillReadCache`): the set year per leaf, a
 * player's stints once, a team once.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_CARD_TEAMS } from "./features/cardAttention";
import { planCardFill } from "./features/teamFillOnCommit";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";
import { careerTeamVerdict } from "./lib/teamFill";

export type FillReadCache = {
  years: Map<string, number | undefined>;
  stints: Map<string, Array<{ key: string; fromYear?: number; toYear?: number }>>;
  teamSport: Map<string, Id<"selectorOptions"> | null>;
};

export const newFillReadCache = (): FillReadCache => ({
  years: new Map(),
  stints: new Map(),
  teamSport: new Map(),
});

/** What a card must be, besides teamless, for NO source to have named a team (rule 8). */
export function cardMayTakeFill(
  card: Pick<
    Doc<"cardChecklist">,
    | "bscTeamName"
    | "teamNoneConfirmedAt"
    | "teamCheckOutcome"
    | "sourceDisagreements"
    | "tidyChecks"
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
 * The team(s) the career gives the card, or undefined. Pure reads; the caller
 * writes through `writeNameChange`.
 */
export async function planFillOnAnswer(
  ctx: Pick<MutationCtx, "db">,
  card: Doc<"cardChecklist">,
  playerIds: ReadonlyArray<Id<"players">>,
  cache: FillReadCache,
): Promise<Array<Id<"teams">> | undefined> {
  const leafKey = card.selectorOptionId as string;
  if (!cache.years.has(leafKey)) {
    cache.years.set(leafKey, await findSetYearForSelectorOption(ctx, card.selectorOptionId));
  }
  const year = cache.years.get(leafKey);
  if (year === undefined) return undefined;
  const sportId = card.sportId;

  const career = async (playerId: Id<"players">): Promise<Id<"teams"> | undefined> => {
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
    const verdict = careerTeamVerdict({ stints, year, currentYear: new Date().getFullYear() });
    if (!verdict.answer) return undefined;
    const teamId = verdict.answer.key as Id<"teams">;
    if (!cache.teamSport.has(teamId)) {
      const team = await ctx.db.get(teamId);
      cache.teamSport.set(teamId, team ? team.sportId : null);
    }
    // A team of another sport (or a gone one) cannot be offered.
    return cache.teamSport.get(teamId) === sportId ? teamId : undefined;
  };
  const filled = await planCardFill({
    players: playerIds,
    stored: [],
    career,
    maxTeams: MAX_CARD_TEAMS,
  });
  return filled?.teamIds;
}
