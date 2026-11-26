/**
 * NEO-645 — the stint "Add to career" writes for a career gap.
 *
 * Main's career check (`career-check.ts`, `preAddedStints`) staged the card's
 * team as a stint that starts at the SET'S year: open ("2026–present") when the
 * set is from this year or later, because that is the player's current team; the
 * one season ("1990–1990") for any earlier set, which the operator widens if the
 * player stayed. The default answer to a career gap, and the "Add to career"
 * button, are this stint. Pure, so the browser and the server say the same thing.
 */
export function defaultGapStint(
  setYear: number,
  currentYear: number = new Date().getFullYear(),
): { fromYear: number; toYear?: number } {
  return setYear < currentYear ? { fromYear: setYear, toYear: setYear } : { fromYear: setYear };
}
