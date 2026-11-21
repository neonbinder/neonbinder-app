/**
 * NEO-591 (collector review) — the team part of a checklist row, AS PRINTED.
 *
 * A "Prospect (X)" cell makes X the card's team and sets `prospect`, so a row
 * that is a prospect with teams reads "Prospect (X)" (several teams read
 * "Prospect (X / Y)"), and a bare "Prospect" reads "Prospect" (not "No
 * Team"). A cell that mixes both ("Cincinnati Reds / Prospect (Frisco)") keeps
 * which teams were inside the parens in `prospectClaimedTeams`, so it reads as
 * printed. The operator sees the claim the checklist made before linking it.
 * Display only: nothing reads this text back as data; `teams` and `prospect`
 * mean what they always did.
 *
 * An empty list means the row prints no team claim; the caller then says "No
 * Team" for a row that made that claim, or nothing.
 */

import { normalizeEntityName } from "../entities/normalize-name";

export const CLAIM_JOINER = " / ";

/** The key two team texts are the same team by, here and in the server's re-check. */
function teamKey(text: string): string {
  return normalizeEntityName(text);
}

/**
 * Which of a row's `teams` sat INSIDE the Prospect parens, when only some did
 * ("Cincinnati Reds / Prospect (Frisco)": Frisco). `undefined` when all of
 * them did (a bare "Prospect (X / Y)", the common case, which the claim text
 * already reads as printed) and when the row has no team, so a row only
 * stores the list when it differs from the default. The result holds the
 * texts as they are in `teams`, in `teams` order; a claimed text that is not
 * one of `teams` is ignored, so the list can never name a team the row does
 * not. Pure: the parser and the server's re-check both build it here.
 */
export function mixedProspectClaim(
  teams: readonly string[],
  claimed: readonly string[],
): string[] | undefined {
  const named = teams.map((t) => t.trim()).filter(Boolean);
  const wanted = new Set(claimed.map(teamKey).filter(Boolean));
  const inside = named.filter((t) => wanted.has(teamKey(t)));
  return inside.length === named.length ? undefined : inside;
}

/**
 * The claim as printed, one part per team and one for the Prospect claim.
 *
 * `prospectClaimedTeams` (set when a row's teams were only partly inside the
 * Prospect parens) names the teams that were: they read "Prospect (X)" after
 * the plain teams, so "Cincinnati Reds / Prospect (Frisco)" stays that, and a
 * "Prospect" beside a plain team reads "Reds / Prospect". Without it every
 * team was inside (a row stored before the field, or an all-prospect cell).
 */
export function checklistClaimParts(row: {
  teams: readonly string[];
  prospect?: boolean;
  prospectClaimedTeams?: readonly string[];
}): string[] {
  const teams = row.teams.map((t) => t.trim()).filter(Boolean);
  if (!row.prospect) return teams;
  const claimed = row.prospectClaimedTeams;
  if (claimed === undefined) {
    return [teams.length > 0 ? `Prospect (${teams.join(CLAIM_JOINER)})` : "Prospect"];
  }
  const inside = new Set(claimed.map(teamKey));
  const plain = teams.filter((t) => !inside.has(teamKey(t)));
  const x = teams.filter((t) => inside.has(teamKey(t)));
  return [...plain, x.length > 0 ? `Prospect (${x.join(CLAIM_JOINER)})` : "Prospect"];
}

/** The longest claim text the server hands the client; display only. */
export const MAX_CHECKLIST_CLAIM_LENGTH = 500;

/** `checklistClaimParts` joined, held to `MAX_CHECKLIST_CLAIM_LENGTH` (cut, with an ellipsis, never an error). */
export function checklistClaimText(row: Parameters<typeof checklistClaimParts>[0]): string {
  const text = checklistClaimParts(row).join(CLAIM_JOINER);
  return text.length <= MAX_CHECKLIST_CLAIM_LENGTH
    ? text
    : `${text.slice(0, MAX_CHECKLIST_CLAIM_LENGTH - 1).trimEnd()}…`;
}
