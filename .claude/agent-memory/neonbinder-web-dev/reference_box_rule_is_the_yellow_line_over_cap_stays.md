---
name: reference_box_rule_is_the_yellow_line_over_cap_stays
description: NEO-637 — the "Set name in titles" box is used when the builder title leaves something out (leftOutOfTitle non-empty) OR is over the cap; hand edits swap the set-name text in CardTitlesStep.changeShort
metadata:
  type: reference
---

`assessListingTitle` uses the box when `!builder.fits || leftOutOfTitle(inputs, builder.title).length > 0`; no "boxed version must fit" guard. The over-cap clause is NOT redundant: a one-word player with no team/number and a long set name is over 80 with nothing left out (cutLoop test "builder over 80 and the box over 80"), and that is the exact case the box exists for. Dropping it to be "literal" breaks card-title-uses-short-name's card C.

Hand-edited titles live in CardTitlesStep `drafts`, never in the generator, so the generator rule cannot reach them. `changeShort` (the box's onChange AND its Escape undo) calls `retitleDraftsForSetName(prev, titleGroups, oldName, newName)` in the same event: rows whose group/row line was showing get the old set-name text swapped (old = checked box text else prefill), or the draft dropped when the old text is absent. Read the marker from the lists as rendered BEFORE the change. `fireEvent.change` with an unchanged value fires nothing in React, so a test draft equal to the generated title is never a draft.

How to apply: any new "regenerate everything when X changes" control on this step must also decide what happens to `drafts`.
