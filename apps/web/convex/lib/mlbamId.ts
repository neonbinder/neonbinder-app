/**
 * NEO-676 — the guard every writer of `externalIds.mlbamId` goes through.
 *
 * An MLBAM id is the number MLB's Stats API gives a person, a club or a league
 * (665742 for a player, 119 for a club, 103 for a league). It is a positive
 * safe integer and nothing else: a string, a float, 0, a negative or `NaN`
 * would sit in the slot as "already linked" forever, the same reason the
 * Wikidata id has `lib/players/wikidata-id.ts`.
 *
 * Linkage only (invariant 2b): nothing user-facing reads this value, and no NB
 * behaviour keys on it. Pure and dependency-free so a writer, a loader and a
 * test can share it.
 */
export function isMlbamId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}
