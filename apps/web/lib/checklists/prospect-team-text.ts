/**
 * NEO-591 (collector review) — the team part of a checklist row, AS PRINTED.
 *
 * A "Prospect (X)" cell makes X the card's team and sets `prospect`, so a row
 * that is a prospect with teams reads "Prospect (X)" (several teams read
 * "Prospect (X / Y)"), and a bare "Prospect" reads "Prospect" (not "No
 * Team"). The operator sees the claim the checklist made before linking it.
 * Display only: nothing reads this text back as data.
 *
 * An empty list means the row prints no team claim; the caller then says "No
 * Team" for a row that made that claim, or nothing.
 */

export const CLAIM_JOINER = " / ";

export function checklistClaimParts(row: {
  teams: readonly string[];
  prospect?: boolean;
}): string[] {
  const teams = row.teams.map((t) => t.trim()).filter(Boolean);
  if (!row.prospect) return teams;
  return [teams.length > 0 ? `Prospect (${teams.join(CLAIM_JOINER)})` : "Prospect"];
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
