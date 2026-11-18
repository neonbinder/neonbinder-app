/**
 * NEO-490 — what one official-checklist row does to the card it is paired
 * with. Pure: no Convex, no DOM.
 *
 * Two callers, and they must never disagree: `fetchCardChecklist` step 3c
 * (pairs the matcher made, by number or by player name) and
 * `applyPublishedChecklistPairs` (pairs the operator made in the Match Cards
 * dialog). Either way the card keeps its fetched number; the row only speaks
 * to players and teams.
 *
 * ## The rules (wrapper rules 3 and 8)
 *
 *  - The row's players fill a card that has none (`fillPlayers`). A card with
 *    players keeps them; a disagreement is `conflict.players`.
 *  - The row's teams, resolved as the card would carry them (`resolveText`
 *    for a text with a comma, the whole-name-first rule BSC's raw value
 *    takes), become the card's teams with `teamLookup: "checklist"`
 *    (`answered`), unless:
 *     - the card already names different teams: `conflict.teams` carries both
 *       sides (the checklist side RESOLVED, so "Use the checklist's" writes
 *       what a checklist-answered card would get) and the card keeps the
 *       marketplace's teams until the operator picks;
 *     - the row names no team: no claim, the card keeps its lookup;
 *       EXCEPT a row that says "No Team" (NEO-489, `noTeam`), which IS a
 *       claim: the card is answered with `teams: []` (`teamLookup:
 *       "checklist"` and no team, read back by `checklistClaimsNoTeam`) when
 *       it has no team of its own, and is a team conflict with an empty
 *       checklist side when it has one. That holds however the pair was made
 *       (number, name fallback, the operator's own link);
 *     - a text cannot be resolved, or the resolved list passes
 *       `MAX_CARD_TEAMS` (`teams: null`): the checklist says nothing usable
 *       about the team, the card keeps its lookup, and nothing is offered.
 *
 * ## A team printed as a place (NEO-591 collector review)
 *
 *  - A plain team text no team answers to by name ("Seattle") may be a team's
 *    location. `resolvePlace` (the server's `resolveChecklistPlaceTeams`)
 *    answers the full name when exactly one team in the set's league(s) has
 *    that location. The card then carries that team as a checklist team, and
 *    against a marketplace team it is the ordinary conflict or agreement: a
 *    card whose data names another team is never written over (rule 8).
 *
 * ## Prospect (NEO-591, `prospect.ts`)
 *
 *  - A row that says Prospect (`prospect`, or any `prospectTeams`) marks the
 *    card `isProspect`. That is a claim about the card and rides with every
 *    outcome below, including a team conflict. A bare "Prospect" is also a
 *    "No Team" row (`noTeam`) and follows the No Team rules above.
 *  - Each X of `prospectTeams` is asked of `resolveProspect` (the server's
 *    `resolveProspectTeams`): a settled X is the full name of the one
 *    minor-league or college team and joins `teams` like any resolved text;
 *    anything else, a missing resolver included, is HELD (rule 8: the fetch
 *    neither fails nor guesses).
 *  - A held X is never written as a team string. The card is answered by the
 *    checklist with `teams: []` and `prospectTeam` set to the held X (several
 *    are joined with " / "): it is not a No Team claim, and the operator
 *    picks. Against a card that already has a team it is a team conflict with
 *    an empty checklist side. A settled X against a different team is the
 *    ordinary conflict. Either conflict carries `prospectClaim`.
 */
import { MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
import type { ProspectResolution } from "./prospect";
import { joinProspectTeams } from "./prospect-team-text";
import {
  checklistNameKey,
  compareChecklistRow,
  type ChecklistCardInput,
  type ChecklistConflict,
  type ChecklistRowInput,
} from "./match-published-checklist";

/** Only a team text with a comma can resolve to something other than itself. */
export function checklistTeamTextNeedsResolving(text: string): boolean {
  return text.includes(",");
}

export type AppliedChecklistRow = {
  /** The row's players, when the card has none. */
  fillPlayers?: string[];
  /**
   * The row's teams as the card would carry them: deduped, resolved. `[]`
   * when the row names no team; `null` when the row's teams are refused.
   */
  teams: string[] | null;
  /** Present only when the card and the row disagree, after resolution. */
  conflict?: ChecklistConflict;
  /** The card takes `teams` with `teamLookup: "checklist"` and needs no lookup. */
  answered: boolean;
  /** NEO-591 — the row says Prospect: the card is born with the Prospect Card attribute. */
  isProspect?: true;
  /**
   * NEO-591 — the X of "Prospect (X)" that could not be settled to exactly one
   * minor-league or college team. Never a team string: `teams` is empty. The
   * card's "Listed as:" hint; the operator picks the team. Several are joined
   * with " / ", held to one name's length (`joinProspectTeams`).
   */
  prospectTeam?: string;
  /**
   * NEO-591 — the same held Xs as a list, exactly as the row named them. The
   * client rebuilds a row from it (`prospectTeams`), never by splitting the
   * joined `prospectTeam`.
   */
  prospectTeams?: string[];
};

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const key = (names: readonly string[]) =>
    [...new Set(names.map(checklistNameKey).filter(Boolean))].sort().join("|");
  return key(a) === key(b);
}

/**
 * Apply one row to one card. `resolveText` is asked only about a team text
 * with a comma (`checklistTeamTextNeedsResolving`) and answers the names the
 * card would carry for it, or `null` when it is refused (over the team cap, an
 * over-length part, or past the resolver's bound).
 */
export function applyChecklistRow(
  card: Pick<ChecklistCardInput, "players" | "teams" | "team">,
  row: Pick<ChecklistRowInput, "players" | "teams" | "noTeam" | "prospect" | "prospectTeams">,
  resolveText: (text: string) => readonly string[] | null,
  /** Asked once per X of `row.prospectTeams`; absent or null answers held. */
  resolveProspect?: (text: string) => ProspectResolution | null,
  /**
   * Collector review — asked once per plain team text (no comma): the full
   * name of the ONE team in the set's league(s) whose location the text is
   * ("Seattle" in an MLB set), else null and the text stays as printed. Absent
   * answers null, so a caller that does not ask changes nothing.
   */
  resolvePlace?: (text: string) => string | null,
): AppliedChecklistRow {
  // NEO-591 — settle each X first: a settled one is a team name like any
  // other, a held one is never a team string.
  const settledX: string[] = [];
  const heldX: string[] = [];
  for (const raw of row.prospectTeams ?? []) {
    const x = raw.trim();
    if (!x) continue;
    const answer = resolveProspect?.(x) ?? null;
    if (answer?.kind === "team") settledX.push(answer.name);
    else if (!heldX.includes(x)) heldX.push(x);
  }
  const isProspect = row.prospect === true || (row.prospectTeams ?? []).some((x) => x.trim());
  const held = heldX.length > 0;
  const prospectClaim = settledX.length > 0 || held;

  const compared = compareChecklistRow(card, {
    players: row.players,
    // A held X is not a team: nothing of it is compared as one.
    teams: held ? [] : [...row.teams, ...settledX],
    noTeam: row.noTeam,
  });

  let teams: string[] | null = [];
  for (const raw of row.teams) {
    const t = raw.trim();
    if (!t) continue;
    const names = checklistTeamTextNeedsResolving(t) ? resolveText(t) : [resolvePlace?.(t) ?? t];
    if (!names) {
      teams = null;
      break;
    }
    teams.push(...names);
  }
  if (teams && !held) teams.push(...settledX);
  if (teams) {
    teams = [...new Set(teams)];
    if (teams.length > MAX_CARD_TEAMS) teams = null;
  }
  // A held X: the checklist names a team nothing may write. Nothing else it
  // names is written either, so the operator sees one honest question.
  if (held) teams = [];

  // The disagreement as the operator will settle it: the checklist side is the
  // RESOLVED names. Resolved, they may turn out to be the card's own teams (no
  // disagreement at all); refused, there is nothing to offer.
  let conflict: ChecklistConflict | undefined = compared.conflict
    ? {
        ...(compared.conflict.players ? { players: compared.conflict.players } : {}),
        ...(compared.conflict.teams ? { teams: compared.conflict.teams } : {}),
      }
    : undefined;
  if (conflict?.teams) {
    const marketplace = conflict.teams.marketplace;
    if (!teams || (!held && sameNames(teams, marketplace))) {
      delete conflict.teams;
    } else {
      conflict.teams = {
        marketplace,
        checklist: teams,
        ...(prospectClaim ? { prospectClaim: true as const } : {}),
      };
    }
  }
  if (held && !conflict?.teams) {
    // The held claim disagrees with any team the card already has.
    const listed = (card.teams ?? []).map((t) => t.trim()).filter(Boolean);
    const cardTeams = listed.length > 0 ? listed : card.team?.trim() ? [card.team.trim()] : [];
    if (cardTeams.length > 0) {
      conflict = {
        ...(conflict ?? {}),
        teams: { marketplace: cardTeams, checklist: [], prospectClaim: true },
      };
    }
  }
  if (conflict && !conflict.players && !conflict.teams) conflict = undefined;

  // A team disagreement keeps the marketplace's teams; a row naming no team
  // makes no claim unless it says "No Team" (NEO-489: answered with `[]`); a
  // refused list says nothing usable.
  const answered =
    teams !== null && (teams.length > 0 || row.noTeam === true || held) && !conflict?.teams;

  return {
    ...(compared.fillPlayers ? { fillPlayers: compared.fillPlayers } : {}),
    teams,
    ...(conflict ? { conflict } : {}),
    answered,
    ...(isProspect ? { isProspect: true as const } : {}),
    ...(held ? { prospectTeam: joinProspectTeams(heldX), prospectTeams: heldX } : {}),
  };
}
