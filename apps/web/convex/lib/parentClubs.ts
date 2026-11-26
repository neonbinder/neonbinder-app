/**
 * NEO-676 — `teams.parentClubs`: which MLB club a minor-league team was
 * affiliated with, and when. The parent is an NB team row (an era row, never an
 * MLB id), `toYear` absent = still affiliated.
 *
 * Readers must tolerate a parent row that no longer exists. Pure; imported by
 * `schema.ts` and `teams.ts`.
 */
import { v, type Infer } from "convex/values";

/** The most affiliations one team row may carry. */
export const MAX_PARENT_CLUBS = 64;

export const parentClubEntryValidator = v.object({
  parentTeamId: v.id("teams"),
  fromYear: v.number(),
  toYear: v.optional(v.number()),
});

export type ParentClubEntry = Infer<typeof parentClubEntryValidator>;

export const parentClubsValidator = v.array(parentClubEntryValidator);
