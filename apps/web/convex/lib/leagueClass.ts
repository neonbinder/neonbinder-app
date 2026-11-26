/**
 * NEO-676 — minor-league classification, stored on the league row as year
 * ranges because a league's class changes over time (the Pacific Coast League
 * was Class AAA from 1946, and several leagues moved between A and AA).
 *
 * Meaningful only when `leagues.level === "minor"`; `saveLeagueFields` clears
 * the list when a league's level moves off "minor".
 *
 * Pure: imported by `schema.ts` and `leagues.ts`, so it may not import
 * `_generated/*`.
 */
import { v, type Infer } from "convex/values";

export const MINOR_LEAGUE_CLASSES = [
  "aaa",
  "aa",
  "high-a",
  "single-a",
  "short-season-a",
  "rookie-advanced",
  "rookie",
] as const;

/**
 * The most class stretches one league row may carry. A league holds a handful
 * of classes over its history; the bulk loader refuses a list past this so a
 * runaway dataset cannot grow one document without bound.
 */
export const MAX_MINOR_LEAGUE_CLASSES = 64;

export type MinorLeagueClass = (typeof MINOR_LEAGUE_CLASSES)[number];

export const minorLeagueClassValidator = v.union(
  v.literal("aaa"),
  v.literal("aa"),
  v.literal("high-a"),
  v.literal("single-a"),
  v.literal("short-season-a"),
  v.literal("rookie-advanced"),
  v.literal("rookie"),
);

export const MINOR_LEAGUE_CLASS_LABELS: Record<MinorLeagueClass, string> = {
  aaa: "AAA",
  aa: "AA",
  "high-a": "High-A",
  "single-a": "Single-A",
  "short-season-a": "Short-Season A",
  "rookie-advanced": "Rookie Advanced",
  rookie: "Rookie",
};

/** One stretch of seasons a league held a class; `toYear` absent = still does. */
export const minorLeagueClassEntryValidator = v.object({
  class: minorLeagueClassValidator,
  fromYear: v.number(),
  toYear: v.optional(v.number()),
});

export type MinorLeagueClassEntry = Infer<typeof minorLeagueClassEntryValidator>;

export const minorLeagueClassesValidator = v.array(
  minorLeagueClassEntryValidator,
);
