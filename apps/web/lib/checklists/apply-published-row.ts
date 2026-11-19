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
 *  - A row that says Prospect (`prospect`) marks the card `isProspect`. That
 *    is a claim about the card and rides with every outcome below, including
 *    a team conflict. A bare "Prospect" is also a "No Team" row (`noTeam`) and
 *    follows the No Team rules above.
 *  - The X of "Prospect (X)" is the card's printed team (Jason, 2026-11-19),
 *    so the parser already put it in the row's `teams`. Nothing here treats it
 *    differently from any other team text: the same compare, the same
 *    resolution, and the same answer when NB has no team by that name (the
 *    Names gate asks, the New Team step creates or links it).
 */
import { MAX_CARD_TEAMS } from "../../convex/features/cardAttention";
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
};

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const key = (names: readonly string[]) =>
    [...new Set(names.map(checklistNameKey).filter(Boolean))].sort().join("|");
  return key(a) === key(b);
}

/**
 * Do two team lists name the same NB teams? Each name goes through
 * `resolveTeamId` (the product's own team resolver: aliases, era and sport
 * scope included), which answers an NB team id or null. Agreement needs EVERY
 * name on both sides to resolve and the two sets of teams to be equal. A name
 * that does not resolve, or resolves to several, is no agreement: the
 * operator picks (rules 7 and 8, no fuzzy guessing).
 */
function sameTeams(
  a: readonly string[],
  b: readonly string[],
  resolveTeamId: ((name: string) => string | null) | undefined,
): boolean {
  if (!resolveTeamId || a.length === 0 || b.length === 0) return false;
  const ids = (names: readonly string[]): Set<string> | null => {
    const out = new Set<string>();
    for (const raw of names) {
      const id = resolveTeamId(raw.trim());
      if (!id) return null;
      out.add(id);
    }
    return out;
  };
  const left = ids(a);
  const right = ids(b);
  if (!left || !right || left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/**
 * Apply one row to one card. `resolveText` is asked only about a team text
 * with a comma (`checklistTeamTextNeedsResolving`) and answers the names the
 * card would carry for it, or `null` when it is refused (over the team cap, an
 * over-length part, or past the resolver's bound).
 */
export function applyChecklistRow(
  card: Pick<ChecklistCardInput, "players" | "teams" | "team">,
  row: Pick<ChecklistRowInput, "players" | "teams" | "noTeam" | "prospect">,
  resolveText: (text: string) => readonly string[] | null,
  /**
   * Collector review — asked once per plain team text (no comma): the full
   * name of the ONE team in the set's league(s) whose location the text is
   * ("Seattle" in an MLB set), else null and the text stays as printed. Absent
   * answers null, so a caller that does not ask changes nothing.
   */
  resolvePlace?: (text: string) => string | null,
  /**
   * NEO-591 — the NB team a team name means (aliases included: "Oakland
   * Athletics" and "Oakland A's" are one team), or null when it names none or
   * several. Two team lists that differ as strings still agree when they
   * resolve to the same teams. Absent, strings are all that are compared.
   */
  resolveTeamId?: (name: string) => string | null,
): AppliedChecklistRow {
  const isProspect = row.prospect === true;

  const compared = compareChecklistRow(card, {
    players: row.players,
    teams: row.teams,
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
  if (teams) {
    teams = [...new Set(teams)];
    if (teams.length > MAX_CARD_TEAMS) teams = null;
  }

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
    if (!teams || sameNames(teams, marketplace) || sameTeams(teams, marketplace, resolveTeamId)) {
      delete conflict.teams;
    } else {
      conflict.teams = { marketplace, checklist: teams };
    }
  }
  if (conflict && !conflict.players && !conflict.teams) conflict = undefined;

  // A team disagreement keeps the marketplace's teams; a row naming no team
  // makes no claim unless it says "No Team" (NEO-489: answered with `[]`); a
  // refused list says nothing usable.
  const answered =
    teams !== null && (teams.length > 0 || row.noTeam === true) && !conflict?.teams;

  return {
    ...(compared.fillPlayers ? { fillPlayers: compared.fillPlayers } : {}),
    teams,
    ...(conflict ? { conflict } : {}),
    answered,
    ...(isProspect ? { isProspect: true as const } : {}),
  };
}
