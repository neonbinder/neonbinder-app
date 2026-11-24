---
name: reference_pickers_take_a_source_value_list
description: Match Cards name and number pickers are built from a {source, value} list via pick-options.ts; a new source is one adapter entry, never UI; typed values need exact:true
metadata:
  type: reference
---

Both pick-one pickers in `CardPairingModal` (name, number) render a list of
`PickChoice` built by `pickChoices(PickOption[])` in `pick-options.ts`. The
wire-shaped adapters (`numberSourceOptions`, `nameSourceOptions`) are the ONLY
code that knows "bsc / sportlots / checklist"; a new marketplace or a second
checklist is one more entry there. A fully generic wire would send the list
itself.

- De-dupe is case-folded, first spelling kept; a value only `own` sources said
  gets " · your checklist" (a marketplace saying it too keeps it bare).
- A name the operator TYPED must be `exact: true` (case counts); folding it
  would swallow "mike" typed over "Mike" (an old NEO-344 test pins three pills).
- `findChoice` matches exact spelling first, then folded: use it everywhere a
  name is turned back into a pill, or two case-variants collapse onto the first.
- A name pick on a checklist-involved row waits in `State.namePicks` (like
  `numberPicks`) until Confirm; Confirm saves it and, via
  `settlePlayersByName`, drops the matching `checklistConflict.players` so the
  wizard's "Checklist disagreements" step does not ask again. An untouched
  preselect is NOT an answer (same rule as `touched`). Teams stay asked.
- Drop the pick on every Unlink path (`UNLINK_CHECKLIST`, server unlink, pair
  `UNLINK`); a stale pick self-invalidates only while the row's name is gone.
