---
name: reference_hand_made_rows_cannot_reach_the_commit_path
description: Since NEO-496 (D10) a hand-made set (no marketplace ids) DOES reach commitCardChecklistChunk when an official checklist is pasted before Sync; without one the fetch still returns "No marketplace ids on this path"
metadata:
  type: reference
---

`fetchCardChecklist` (convex/selectorOptions.ts) returns `NO_MARKETPLACE_IDS_MESSAGE` with
`candidateCount: 0` only when neither side is resolvable AND no publisher checklist is in
play (`... && !published`). With a checklist pasted (or stored on the leaf), the run goes on
with it as the only source: every row becomes a `checklistOnly` candidate
(`checklistOnlyCard`: `platformData: {}`, no BSC ref; `teamLookup: "checklist"` only when the
row's team cell answers, so a BLANK team cell leaves no lookup state at all). The UI says
"Kept all N cards from your checklist. Nothing to match, no marketplace attached."; with every
name known it commits at once (no wizard), otherwise the wizard opens for the names.

The empty checklist panel shows both "Sync card checklist" and "Add the official checklist"
ungated; `usePastedChecklist` (support/published-checklist.ts) drives the paste.

**Why:** an earlier version of this note (NEO-528) said hand-made rows could never reach the
commit path; NEO-496 changed that. Proved in `set-checklist-pdf-topps-chrome-2026.spec.ts`
(the token set's checklist-only fetch).
**How to apply:** for a "cards born at commit with X" feature, a hand-made per-attempt set plus
a pasted one-section checklist is a commit-path fixture with no marketplace and no recording.
Quick-add (`addCustomCard`) and the parallel build remain the other two birth paths; quick-add
never passes through the review wizard. A row reading exactly `No Team` is a checklist claim
(`checklistClaimsNoTeam`) and stamps on its own, so leave the cell blank when the feature under
test is the one that should stamp.
Related: [[patterns_cameo_specs_and_sorted_binder_pages]]
