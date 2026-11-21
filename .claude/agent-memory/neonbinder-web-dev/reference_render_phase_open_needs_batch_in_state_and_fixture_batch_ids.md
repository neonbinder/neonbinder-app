---
name: reference_render_phase_open_needs_batch_in_state_and_fixture_batch_ids
description: A render-phase "open when a row of THIS run's batch needs X" check needs previousBatchId in state, and CardChecklist test fixtures that pre-stream liveCandidates never trip it
metadata:
  type: reference
---

CardChecklist's early open of Match Cards (NEO-640) is a render-phase `setPairingPhase("review")` guarded by
`liveCandidates.batchId !== soloFetch.previousBatchId`. The previous batch id is captured at Sync press, so it has
to live in `soloFetch` state (a handleSync closure local is invisible to render).

Test fixtures in `CardChecklist.test.tsx` pre-set `state.liveCandidates` before the press, often with `batchId`
undefined or the same id the fetch later reports. Under "this run's batch" semantics those rows are never "new",
so a test that expects the dialog the instant Sync is pressed must stream a row with a NEW batchId after the press
(`streamCandidates(rerender, {...})`). Real data always has a batchId once total > 0.

Also: a `matched` fixture row with no `pairedBy` is "unknown" to `matchCardsNeeded` and opens the dialog; set
`pairedBy: "number"` (and full confidence) on a fixture that must be skipped.
