---
name: patterns-no-base-parallel-source-specs
description: NEO-673 chosen-parallel source specs - handles, press the section build from the type with no row open, Pulse Premier facts and why a real-set spec is costly
metadata:
  type: patterns
---

- Handles: region "Parallels of the base set" (no source name in the heading while the source is a
  chosen parallel), radiogroup "Which parallel do the others copy from?", radios by parallel name,
  "Copy from…" (aria-disabled) then "Copy from <name>", status text "Copying from <name>" (exact
  getByText), Change = "Change the parallel the others copy from". Change reopens the list in child
  order with NOTHING checked, so a re-run on an already-picked set can adopt through Change.
- Picking a row folds the column to its card ("Parallels: Silver — change"); click the card to
  reopen the list before picking a sibling.
- **Press "Build N parallels from <source>" with no row of the type open.** The section's run starts
  from the variant type, and SetSelector retires any finished run whose `startedFrom` is not the
  deepest selected row (NEO-496), so a build pressed while the source row is open ends with no
  ledger at all (fast hand-made builds finish before any assert). Re-drill with `drillToCustom`.
- Silver's role-insert row: paste a checklist, Sync, `tidyForTheParallelBuild`; a plant that drops
  the role makes it a parallel row with no checklist button (red in `usePastedChecklist`).
- Real set: BSC's 2024 Baseball list (476 sets) has no "Pulse Premier", only "Pulse (unlicensed)";
  2026 Baseball "Pulse Premier" has Insert + Parallel (13 parallels, no Base), Silver 107 cards,
  29 need you after a bare fetch (new prospect names, teamless). Without a checklist that means a
  card-listing lookup per card on the one-slot lane and new real names that reach the enrichment
  fixture switch; plan a checklist and enrichment entries before writing such a spec.
Related: [[patterns_parallel_build_specs_must_tidy_the_base_j3]], [[patterns_bsc_team_lane_is_shared_across_shards]]
