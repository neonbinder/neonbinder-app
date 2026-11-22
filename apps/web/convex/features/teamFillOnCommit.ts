/**
 * NEO-645 (Q1 = A) — the teams the commit writes itself onto a card that would
 * otherwise save teamless, from strict pre-fill evidence. Ported from the
 * client's Teams step (`components/SetSelector/teams-on-cards.ts`), which the
 * client keeps until the old wizard is retired.
 *
 *  - "otherCards": the same player set on other cards of this commit whose team
 *    resolves, and every such card agrees on ONE team set;
 *  - "otherCards" also covers the STORED tier: the player's other cards already
 *    saved under this node, the node it copies, or the set's base checklist
 *    (`cardChecklist.storedTeamEvidence`), which agree on one team set;
 *  - "career": the player's own career gives exactly one team for the set's
 *    year (`careerTeamVerdict`; chosen by the chunk, which can read the player).
 *
 * Per player the order is batch (the commit's own cards, `planBatchTeamFill`),
 * then stored, then career; a stored tier whose cards disagree STOPS the
 * search for that player (a career tier never outvotes two printed cards), and
 * every player on the card must answer, the answers' union is the fill.
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

/** What `cardChecklist.storedTeamEvidence` says about one player. */
export type StoredTeamEvidence<TPlayer extends string = string, TTeam extends string = string> = {
  playerId: TPlayer;
  status: "answer" | "disagree";
  teamIds: ReadonlyArray<TTeam>;
};

/**
 * The fill for ONE card the batch tier left teamless: per player, the stored
 * tier, else his career (`career`, the chunk's read), and the union of the
 * answers. Nothing when any player does not answer, when the stored cards
 * disagree, or when the union is past `maxTeams`. Reason "career" only when
 * every player answered from his career; one stored answer makes it
 * "otherCards" (the note says "from his other cards").
 */
export async function planCardFill<TPlayer extends string, TTeam extends string>(input: {
  players: ReadonlyArray<TPlayer>;
  stored: ReadonlyArray<StoredTeamEvidence<TPlayer, TTeam>>;
  career: (playerId: TPlayer) => Promise<TTeam | undefined>;
  maxTeams: number;
}): Promise<{ teamIds: TTeam[]; reason: "otherCards" | "career" } | undefined> {
  const players = [...new Set(input.players)];
  if (players.length === 0) return undefined;
  const teams: TTeam[] = [];
  let fromStored = false;
  for (const playerId of players) {
    const evidence = input.stored.find((entry) => entry.playerId === playerId);
    if (evidence?.status === "disagree") return undefined;
    if (evidence?.status === "answer") {
      if (evidence.teamIds.length === 0) return undefined;
      fromStored = true;
      for (const id of evidence.teamIds) if (!teams.includes(id)) teams.push(id);
      continue;
    }
    const careerTeam = await input.career(playerId);
    if (careerTeam === undefined) return undefined;
    if (!teams.includes(careerTeam)) teams.push(careerTeam);
  }
  if (teams.length === 0 || teams.length > input.maxTeams) return undefined;
  return { teamIds: teams, reason: fromStored ? "otherCards" : "career" };
}
