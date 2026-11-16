---
name: reference_hand_made_rows_cannot_reach_the_commit_path
description: A fetch on a hand-made row (no marketplace ids) returns "No marketplace ids on this path" BEFORE it reads a publisher's checklist, so no spec can drive commitCardChecklistChunk on a hand-made set; card-birth proofs there go through quick-add or the parallel build
metadata:
  type: reference
---

`fetchCardChecklist` (convex/selectorOptions.ts, the `resolvableSides` check) returns
`NO_MARKETPLACE_IDS_MESSAGE` with `candidateCount: 0` when neither side is resolvable,
and that return comes before anything reads `args.publishedChecklist`. So "upload the
publisher's checklist onto a hand-made row and commit it" is not a path: nothing is
created. The three card-creation paths are `commitCardChecklistChunk` (a real fetch on a
set with marketplace ids), `addCustomCard` (quick-add) and `parallelChecklistBuild`
(a parallel built from its source's cards; no marketplace needed).

**Why:** NEO-528 asked for "store a value, then let a fetch's commit create the cards" on a
hand-made row; it cannot be done, and a real set needs owner approval (SET-REGISTRY
"Adding a set").
**How to apply:** for any "new cards are born with X" feature, prove it on a hand-made set
through quick-add (and the parallel build if the feature touches it); a commit-path proof
is a real-set proposal to the coordinator, never an improvised fixture.
Related: [[patterns_cameo_specs_and_sorted_binder_pages]]
