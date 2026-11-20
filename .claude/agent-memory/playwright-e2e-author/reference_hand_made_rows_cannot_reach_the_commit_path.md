---
name: reference_hand_made_rows_cannot_reach_the_commit_path
description: A hand-made leaf (no marketplace ids) reaches the review gate and the commit ONLY with a publisher's checklist in play (NEO-496 D10, checklist-only solo fetch); with no checklist the fetch returns "No marketplace ids on this path" and creates nothing
metadata:
  type: reference
---

`fetchCardChecklist` (convex/selectorOptions.ts) returns `NO_MARKETPLACE_IDS_MESSAGE` with
`candidateCount: 0` when neither side is resolvable AND no checklist is in play. Since NEO-496
(D10) a pasted (or stored) publisher's checklist is a source of its own: the run goes on with the
checklist as its ONLY source, every row a checklist-only candidate, and one source is the solo
path (no Match Cards dialog), so the rows reach `resolveUnknownsAndStartBatch` (the review gate)
and the commit exactly as a marketplace fetch's do.

Recipe (NEO-602 `checklist-team-name-on-two-eras-follows-the-player`): `drillToCustom` to a
private sport/year/brand/set + Insert > Base (empty checklist shows Sync + "Add the official
checklist"), `usePastedChecklist(page, "number,player,team\n1,<player>,<team>", 1)`, press
`syncChecklistButton`; the wizard opens only when a name needs a look or was auto-linked
("1 name was linked for you..."), then Confirm & Save -> "Saved 1 card". Players/teams made
in a custom sport (no `sportConfig.wikidata`) resolve at the gate with no lookup.

Without a checklist the three card-creation paths are still quick-add (`addCustomCard`),
the parallel build and a real fetch.

**Why:** the pre-NEO-496 version of this note said no hand-made commit path existed, which
would have pushed a gate/commit proof onto a real set needing owner approval.
**How to apply:** any "the review gate / commit does X" proof that needs per-worker data: use
a pasted checklist on a hand-made leaf before proposing a real set.
Related: [[patterns_cameo_specs_and_sorted_binder_pages]], [[patterns_checklist_is_a_match_cards_source]]
