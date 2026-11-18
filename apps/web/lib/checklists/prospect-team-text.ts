/**
 * NEO-591 — the one text a card shows for its held "Prospect (X)" teams.
 *
 * `prospectTeams` (the exact list of held Xs) is the source of truth. A card
 * also carries those Xs as ONE string, `prospectTeam`, which is the "Listed
 * as:" hint and rides in `rawTeamName`. That string crosses the same wire as
 * any other team value, so it is held to the same bound,
 * `MAX_PLAYER_NAME_LENGTH`: three 50-character Xs joined with " / " would be
 * 154 characters and the whole fetch would be refused for it.
 *
 * Rule: every X, joined with " / ", when that fits. When it does not, as many
 * WHOLE leading Xs as fit followed by " +N more" (N is the count left out), so
 * the text still names what was listed first and says plainly that it is not
 * the whole list. Never a cut mid-name unless the first X alone is too long.
 * The list itself is untouched; nothing reads the joined text back as a list.
 *
 * Pure and dependency-free: the server (`applyChecklistRow`, both fetch call
 * sites) and the Match Cards client (`pairedRowCard`) call this one function,
 * so a card unlinked and relinked shows the same text the fetch gave it.
 */
import { MAX_PLAYER_NAME_LENGTH } from "../players/name-limits";

export const PROSPECT_TEAM_JOINER = " / ";

export function joinProspectTeams(xs: readonly string[]): string {
  const names = xs.map((x) => x.trim()).filter(Boolean);
  const whole = names.join(PROSPECT_TEAM_JOINER);
  if (whole.length <= MAX_PLAYER_NAME_LENGTH) return whole;
  for (let keep = names.length - 1; keep >= 1; keep--) {
    const text = `${names.slice(0, keep).join(PROSPECT_TEAM_JOINER)} +${names.length - keep} more`;
    if (text.length <= MAX_PLAYER_NAME_LENGTH) return text;
  }
  // Even the first X and its suffix do not fit: cut the X, keep the suffix.
  const suffix = names.length > 1 ? ` +${names.length - 1} more` : "";
  return `${names[0].slice(0, MAX_PLAYER_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

/**
 * NEO-591 (collector review) — the team part of a checklist row, AS PRINTED:
 * the row's own teams, then its Prospect claim. A "Prospect (X)" cell reads
 * "Prospect (X)" whether X settled to a team or was held, and a bare
 * "Prospect" reads "Prospect" (not "No Team"), so the operator sees the claim
 * the checklist made before linking it. Several Xs are separate forms; the
 * caller joins the parts with " / ".
 *
 * An empty list means the row prints no team claim; the caller then says "No
 * Team" for a row that made that claim, or nothing.
 */
export function checklistClaimParts(row: {
  teams: readonly string[];
  prospect?: boolean;
  prospectTeams?: readonly string[];
}): string[] {
  const xs = (row.prospectTeams ?? []).map((x) => x.trim()).filter(Boolean);
  const forms = xs.length > 0 ? xs.map((x) => `Prospect (${x})`) : row.prospect ? ["Prospect"] : [];
  return [...row.teams.map((t) => t.trim()).filter(Boolean), ...forms];
}

/** The longest claim text the server hands the client; display only. */
export const MAX_CHECKLIST_CLAIM_LENGTH = 500;

/** `checklistClaimParts` joined, held to `MAX_CHECKLIST_CLAIM_LENGTH` (cut, with an ellipsis, never an error). */
export function checklistClaimText(row: Parameters<typeof checklistClaimParts>[0]): string {
  const text = checklistClaimParts(row).join(PROSPECT_TEAM_JOINER);
  return text.length <= MAX_CHECKLIST_CLAIM_LENGTH
    ? text
    : `${text.slice(0, MAX_CHECKLIST_CLAIM_LENGTH - 1).trimEnd()}…`;
}
