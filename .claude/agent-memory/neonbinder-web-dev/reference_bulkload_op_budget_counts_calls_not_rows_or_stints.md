---
name: bulkload-op-budget-counts-calls-not-rows-or-stints
description: bulkLoad.ts op budgets count db CALLS, so a long stint list adds nothing; a no-alias row costs ~5, a 3-alias create ~11 — a budget test must use alias-bearing creates
metadata:
  type: reference
---

The armed loaders' `opsSpent` is a self-counted tally of db calls, not rows, documents or stints.
For the roster leg (`upsertPlayers`): sameNamePlayers is 3 reads (+1 per candidate), a create adds a
`search_name` read and an insert, an alias sync adds `3 + aliases`, an adopt patch is 1. So 100 plain
adopts or creates spend about 500 against a 900 budget, and a 13-stint row costs the same as a
1-stint row (teams are cached per id).

**Why:** a budget test that "makes rows heavy" with long careers never reaches the cap and fails
`hasMore`; 100 creates with 3 aliases each spend ~11/row and stop near row 82.

**How to apply:** to force a stop under `BULK_LOAD_*_OP_BUDGET`, send creates carrying aliases. Probe
the real `opsSpent` first. Also: `bulkLoad.test.ts` slices each `export const` body up to the next one
and asserts the armed gate by regex, so keep `assertBulkLoadArmed(` out of comments that follow a
preview function.
