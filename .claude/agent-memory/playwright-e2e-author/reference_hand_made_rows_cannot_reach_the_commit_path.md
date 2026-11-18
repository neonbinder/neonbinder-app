---
name: reference_hand_made_rows_cannot_reach_the_commit_path
description: CORRECTED (NEO-591) — a hand-made row (no marketplace ids) DOES reach the commit path when a checklist is in play (leaf "Add the official checklist" or a stored set-checklist section linked via Reconcile): the fetch is checklist-only. Without a checklist it still stops at "No marketplace ids on this path".
metadata:
  type: reference
---

`fetchCardChecklist` (convex/selectorOptions.ts) returns `NO_MARKETPLACE_IDS_MESSAGE` with
`candidateCount: 0` only when neither side is resolvable AND no published checklist is in
play (`!published`, NEO-496 D10). With a checklist (pasted/uploaded on the leaf through
"Add the official checklist", or the set's stored checklist section the row is linked to)
the run goes on with the checklist as its ONE source: no Match Cards, every row a
checklist-only candidate, then the wizard (unknown names, a teams question) or a direct
commit ("Saved N cards. Teams from your checklist: N of N cards.").

So a per-attempt hand-made set CAN prove "a fetch's commit creates cards with X": upload a
small hand-written CSV on the leaf, Sync, read the cards back, delete them. Used by NEO-591
`checklist-prospect-team-cells-set-prospect-card` (Baseball › 2024 › Topps, sport must be real
when the feature resolves teams/players against the set's sport).

A hand-made SET with a stored checklist: the Inserts column's first visit opens Reconcile
Inserts with the sections (BSC/SportLots "wasn't asked"); "Make its own set from checklist
section: <name>" then "Save 1 sets" makes a linked insert whose sync is checklist-only.

**Why:** the earlier note (NEO-528) predates NEO-496 D10 and led specs to think a real set
was needed. **How to apply:** before proposing a real set for a commit-path proof, try a
hand-made set plus a leaf checklist.
Related: [[patterns_cameo_specs_and_sorted_binder_pages]], [[checklist-is-a-match-cards-source]]
