/**
 * NEO-645 (Q1 = A) — the teams the commit writes itself onto a card that would
 * otherwise save teamless, from strict pre-fill evidence. Ported from the
 * client's Teams step (`components/SetSelector/teams-on-cards.ts`), which the
 * client keeps until the old wizard is retired.
 *
 *  - "otherCards": the same player set on other cards of this commit whose team
 *    resolves, and every such card agrees on ONE team set;
 *  - "career": the player's own career gives exactly one team for the set's
 *    year (`careerTeamVerdict`; chosen by the chunk, which can read the player).
 *
 * Rule 8 (a data claim holds back a guess): a card whose source NAMES a team —
 * a pending team name, a team string that resolved to nothing, the checklist's
 * "No Team", an unsettled teams disagreement — is never filled. The fill is
 * note-only: the card shows a `teamFill` check, never blue, never a stop.
 *
 * Pure: ids and flags in, ids out.
 */

export type FillCard<TTeam extends string = string> = {
  /** Position in the commit, for the caller to map the answer back. */
  index: number;
  /** The card's player ids as born. */
  players: ReadonlyArray<string>;
  /** The card's team ids as it arrives (before any set-level default). */
  teamIds: ReadonlyArray<TTeam>;
  /** True when no source names a team on this card (rule 8). */
  mayFill: boolean;
};

export type BatchFill<TTeam extends string = string> = {
  index: number;
  teamIds: TTeam[];
  reason: "otherCards";
};

const idSetKey = (ids: ReadonlyArray<string>) => [...new Set(ids)].sort().join("|");

/**
 * One fill per eligible teamless card whose player set is shared by other cards
 * agreeing on exactly one team set. Two distinct team sets (the checklist
 * disagrees with itself, a traded player) fill nothing.
 */
export function planBatchTeamFill<TTeam extends string>(
  cards: ReadonlyArray<FillCard<TTeam>>,
  maxTeams: number,
): Array<BatchFill<TTeam>> {
  const evidence = new Map<string, Map<string, TTeam[]>>();
  for (const card of cards) {
    if (card.players.length === 0 || card.teamIds.length === 0) continue;
    const playerKey = idSetKey(card.players);
    const sets = evidence.get(playerKey) ?? new Map<string, TTeam[]>();
    sets.set(idSetKey(card.teamIds), [...new Set(card.teamIds)]);
    evidence.set(playerKey, sets);
  }
  const out: Array<BatchFill<TTeam>> = [];
  for (const card of cards) {
    if (!card.mayFill || card.teamIds.length > 0 || card.players.length === 0) continue;
    const sets = evidence.get(idSetKey(card.players));
    if (!sets || sets.size !== 1) continue;
    const teamIds = [...sets.values()][0].slice(0, maxTeams);
    if (teamIds.length > 0) out.push({ index: card.index, teamIds, reason: "otherCards" });
  }
  return out;
}
