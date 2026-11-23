/**
 * NEO-645 — the career-gap check, kept current after Add to career.
 *
 * A `{ kind: "careerGap", playerId, teamId }` entry in a card's `tidyChecks` says
 * "this card prints a team the player's career does not cover". The commit writes
 * it (today's rule, `careerCoversCardTeam`, J2: not a [Y-1, Y] window); this
 * module removes it once an added stint covers the team by the card's year, with
 * the same `computeCoverage` the commit and the career screen use.
 *
 * `tidyChecks` writes never bump `lastUpdated` (the NEO-203 baseVersion): the
 * card's data did not change, only what has been verified about it.
 */

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { computeCoverage } from "./lib/careerCoverageFacts";
import { findSetYearForSelectorOption } from "./lib/selectorAncestry";

/**
 * Drop `card`'s careerGap checks for `playerId` that the player's career now
 * covers. Returns how many were removed.
 */
export async function recheckCareerGaps(
  ctx: MutationCtx,
  card: Doc<"cardChecklist">,
  playerId: Id<"players">,
): Promise<number> {
  const checks = card.tidyChecks ?? [];
  const gaps = checks.filter((c) => c.kind === "careerGap" && c.playerId === playerId);
  if (gaps.length === 0) return 0;
  const setYear = await findSetYearForSelectorOption(ctx, card.selectorOptionId);
  const covered = await computeCoverage(ctx, {
    sportId: card.sportId,
    setYear: setYear ?? null,
    pairs: gaps.map((g) => ({
      playerId,
      teamId: (g as { teamId: Id<"teams"> }).teamId,
    })),
  });
  const gone = new Set<string>();
  covered.forEach((result, i) => {
    if (result.covered) gone.add((gaps[i] as { teamId: Id<"teams"> }).teamId as string);
  });
  if (gone.size === 0) return 0;
  const kept = checks.filter(
    (c) => !(c.kind === "careerGap" && c.playerId === playerId && gone.has(c.teamId as string)),
  );
  await ctx.db.patch(card._id, { tidyChecks: kept.length > 0 ? kept : undefined });
  return checks.length - kept.length;
}
