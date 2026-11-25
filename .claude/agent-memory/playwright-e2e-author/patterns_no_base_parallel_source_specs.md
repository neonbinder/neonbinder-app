---
name: patterns-no-base-parallel-source-specs
description: NEO-673 chosen-parallel source specs - section names by state, (current)/(source) markers, the loading heading, Rebuild vs Build on the old source, sleeve titles, Pulse Premier facts
metadata:
  type: patterns
---

- Section region names by state: first pick (no Base, no source) "Parallels of this set"; WHILE THE
  PLAN LOADS it reads "Parallels of the base set" (the fallback), so never settle on the heading:
  wait on `firstPicker.or(copyingLine)` before branching fetch-or-adopt. Chosen: "Parallels from
  <source>" (changes on Change, so locate it with `/^Parallels from .+$/` when the source moves).
  Base sets: "Parallels of Base".
- Radiogroup "Which parallel do the others copy from?"; Change reopens it with the standing pick
  named "<name> (current)" and NOTHING checked; the first-pick list has no marker. Picking an empty
  parallel while the source has cards shows "<name> has no cards yet." (role=status; two statuses
  sit in the section while the picker is open, so match by text, never bare getByRole("status")).
- Parallels column: the source option's accessible name is "<name> (source)" (+ " BSC" on a real
  set); `columnOption(page, col, name)` still finds it (inner span is the bare name).
- Row buttons: a non-source parallel WITH cards says "Rebuild from <src>", empty says "Build from
  <src>"; the source row says Sync (no build). After Change the old source holds cards: Rebuild.
- "Build N parallels from <src>" can be pressed with a row of the type open; its ledger shows there.
  Whether it survives a SIBLING pick conflicts with NEO-496 (Base parity spec asserts it goes), so
  don't assert persistence across a sibling pick.
- "Silver is not among the N": the section's strip sleeves are aria-hidden with titles
  "<name> — empty|has cards"; `getByTitle(/^.+ — (empty|has cards)$/)` counts them (the build
  button also has a title, hence the anchored regex). Summary reads "N parallels, all empty. ...".
- Planting "source not excluded" (convex filter) duplicates the source radio in Change's list: the
  spec goes red on a strict-mode "(current)" match, earlier than the build label.
- Real set: 2026 Baseball › Pulse (known brand, minted by the seed's year-wide Sets sync) › Pulse
  Premier: Insert + Parallel, 13 parallels, no Base; `drillToSet` waits for Base, so drill by hand.
Related: [[patterns_parallel_build_specs_must_tidy_the_base_j3]], [[patterns_bsc_team_lane_is_shared_across_shards]]
