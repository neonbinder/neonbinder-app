/**
 * NEO-645 (S3) — the printed subject of a checklist card ("Checklist",
 * "Checklist 1-100", "Team Checklist"), kept as the card's own name.
 *
 * One pure predicate, read by the parser (which produces the subject) and by the
 * server's re-check of a stored or pasted checklist row (which must not trust a
 * client's `subject`): the card's name becomes whatever this returns, so a value
 * that is not a checklist's own subject is dropped, never kept. Other subjects
 * that are not a person ("Team Card", "Mets TC", "Team Leaders") name a team or
 * a group and keep dropping out as before.
 */
export const MAX_SUBJECT_LENGTH = 120;

/** The subject folded to single spaces when it is a checklist's, else undefined. */
export function checklistSubject(subject: string): string | undefined {
  const folded = subject.replace(/\s+/g, " ").trim();
  if (folded === "" || folded.length > MAX_SUBJECT_LENGTH) return undefined;
  return /^(team )?checklist\b/i.test(folded) ? folded : undefined;
}
