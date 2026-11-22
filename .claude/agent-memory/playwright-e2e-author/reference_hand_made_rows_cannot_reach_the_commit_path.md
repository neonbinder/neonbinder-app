---
name: reference_hand_made_rows_cannot_reach_the_commit_path
description: A hand-made row (no marketplace ids) DOES reach the review gate and the commit when a checklist is in play (leaf "Add the official checklist" or a stored set-checklist section linked via Reconcile; NEO-496 D10, checklist-only solo fetch). Without a checklist the fetch stops at "No marketplace ids on this path" and creates nothing
metadata:
  type: reference
---

`fetchCardChecklist` (convex/selectorOptions.ts) returns `NO_MARKETPLACE_IDS_MESSAGE` with
`candidateCount: 0` only when neither side is resolvable AND no published checklist is in
play (`!published`, NEO-496 D10). With a checklist (pasted/uploaded on the leaf through
"Add the official checklist", or the set's stored checklist section the row is linked to)
the run goes on with the checklist as its ONE source: no Match Cards dialog (one source is the
solo path), every row a checklist-only candidate that reaches `resolveUnknownsAndStartBatch`
(the review gate) and the commit exactly as a marketplace fetch's do, then the wizard (unknown
names, a teams question) or a direct commit ("Saved N cards. Teams from your checklist: N of N
cards.").

So a per-attempt hand-made set CAN prove "a fetch's commit creates cards with X": upload a
small hand-written CSV on the leaf, Sync, read the cards back, delete them. Used by NEO-591
`checklist-prospect-and-place-team-cells-ask-only-the-unsettled-on-the-team-tile` (Baseball > 2024 > Topps, sport must be real
when the feature resolves teams/players against the set's sport).

Recipe (NEO-602 `checklist-team-name-on-two-eras-follows-the-player`): `drillToCustom` to a
private sport/year/brand/set + Insert > Base (empty checklist shows Sync + "Add the official
checklist"), `usePastedChecklist(page, "number,player,team\n1,<player>,<team>", 1)`, press
`syncChecklistButton`; the wizard opens only when a name needs a look or was auto-linked
("1 name was linked for you..."), then Confirm & Save -> "Saved 1 card". Players/teams made
in a custom sport (no `sportConfig.wikidata`) resolve at the gate with no lookup.

A hand-made SET with a stored checklist: the Inserts column's first visit opens Reconcile
Inserts with the sections (BSC/SportLots "wasn't asked"); "Make its own set from checklist
section: <name>" then "Save 1 sets" makes a linked insert whose sync is checklist-only.

Without a checklist the three card-creation paths are still quick-add (`addCustomCard`),
the parallel build and a real fetch.

**Why:** the earlier note (NEO-528) predates NEO-496 D10 and led specs to think a real set
was needed. **How to apply:** before proposing a real set for a commit-path proof, try a
hand-made set plus a leaf checklist.
Related: [[patterns_cameo_specs_and_sorted_binder_pages]], [[patterns_checklist_is_a_match_cards_source]], [[patterns_checklist_is_a_match_cards_source]]
