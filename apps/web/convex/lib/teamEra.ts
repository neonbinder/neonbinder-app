/**
 * NEO-602 (S2) — the one era check every team writer applies.
 *
 * A team's `yearsActive` is half of its identity (NEO-254) and decides alias
 * clashes (NEO-602), so a NaN, Infinity, fractional or inverted span must not
 * be stored: every comparison against NaN is false, and the alias rule would
 * read such a team as overlapping nothing. The rule itself is the pure
 * `teamEraProblem` (`lib/teams/team-era.ts`, shared with the review wizard);
 * this only turns its answer into the `ConvexError` a client can read.
 *
 * Applied by `entityReviewQueue.recordDecision` (via `toTeamCreate`),
 * `teams.findOrCreate`, `teams.saveTeamFields` and `teams.nameHeldAsAliasBy`.
 */
import { ConvexError } from "convex/values";
import { teamEraProblem } from "../../lib/teams/team-era";

/**
 * Whole years, in range, ending no earlier than they start; returns the era
 * with only the keys it needs (a stray field on the wire is dropped).
 */
export function requireTeamEra(era: { from: number; to?: number }): {
  from: number;
  to?: number;
} {
  const problem = teamEraProblem(era);
  if (problem) throw new ConvexError(problem);
  return { from: era.from, ...(era.to !== undefined ? { to: era.to } : {}) };
}
