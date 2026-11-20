/**
 * NEO-426 — "this sport has no teams", read in exactly one place.
 *
 * A `level: "sport"` row may carry `teamlessSport` (`{ setAt, setByUserId }`,
 * the same shape as the set-level `noTeamDefault`): a sport whose people never
 * play for a team (Non Sport, Golf, Tennis, Boxing). Every reader goes through
 * this module, never through the sport's display name: the stamp is NB's own
 * fact about the row, so renaming the sport never changes what it means
 * (product invariant 4). ABSENT means "this sport has teams".
 *
 * The flag is a DEFAULT, never a block. It is one more reason for a card to be
 * stamped "No team" (`noTeamCardVerdict` decides, in the commit chunk, on the
 * card as it will be born), and it only ever applies when nothing names a team
 * and nothing is still waiting on one (product invariant 8). It never refuses,
 * strips or hides a team that does arrive.
 *
 * Env-free and import-free so a client could share it; today only Convex
 * reads it.
 */

/** Who flagged the sport, and when. Server-stamped, never a client argument. */
export type TeamlessSport = { setAt: number; setByUserId: string };

/** The fields these readers look at; a full `selectorOptions` doc fits. */
export type TeamlessSportRow = {
  level: string;
  teamlessSport?: TeamlessSport;
};

/**
 * The row's stamp, but only on a sport row: the flag means nothing below the
 * sport, so any other level answers `undefined` even if it somehow carries the
 * field. Returns a COPY, never the row's own object.
 */
export function teamlessSportOf(
  row: TeamlessSportRow | null | undefined,
): TeamlessSport | undefined {
  if (row?.level !== "sport" || !row.teamlessSport) return undefined;
  return {
    setAt: row.teamlessSport.setAt,
    setByUserId: row.teamlessSport.setByUserId,
  };
}

/** True only for a sport row an operator flagged. */
export function isTeamlessSport(
  row: TeamlessSportRow | null | undefined,
): boolean {
  return teamlessSportOf(row) !== undefined;
}

/**
 * The sport-default half of the "No team" rule: does this card, as it will be
 * born, default to No team because of its people alone? Asked at birth only
 * (a new row, `addCustomCard`, BSC's "no team" answer): a re-synced row is
 * never asked, since existing cards are the operator's to mark (NEO-556).
 * Returns the flagged stamp that vouches for it (the first person's sport,
 * for credit), or `undefined`.
 *
 * True only when ALL of these hold:
 *  - the card has at least one player (the NEO-528 default player counts: the
 *    caller passes the ids the card is born with);
 *  - no printed player name is still waiting on review (an unreviewed name is
 *    someone unknown, and could play anywhere);
 *  - every player's HOME sport (`players.sportId`; extra `playerSports` never
 *    count) is flagged. `homeSport` answers per player: a missing player, or
 *    one whose home sport is not flagged, is `undefined`, and one such player
 *    ends the default.
 *
 * Whether anything names a team, or is still waiting on one, is NOT decided
 * here: `noTeamCardVerdict` (lib/selectorTeams.ts) owns that, for the set's
 * No Team and this default alike, so the two cannot disagree. A caller asks
 * both and stamps only when both say yes.
 */
export function sportDefaultNoTeam(card: {
  playerIds: ReadonlyArray<string>;
  pendingPlayerNameCount: number;
  homeSport: (playerId: string) => TeamlessSport | undefined;
}): TeamlessSport | undefined {
  if (card.playerIds.length === 0) return undefined;
  if (card.pendingPlayerNameCount > 0) return undefined;
  let first: TeamlessSport | undefined;
  for (const id of card.playerIds) {
    const sport = card.homeSport(id);
    if (!sport) return undefined;
    first ??= sport;
  }
  return first;
}
