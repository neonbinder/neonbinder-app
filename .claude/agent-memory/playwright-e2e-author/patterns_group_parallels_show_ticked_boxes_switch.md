---
name: patterns_group_parallels_show_ticked_boxes_switch
description: NEO-660 Group Parallels hides a ticked row's own "Parallels of" box unless the "Show ticked rows' boxes" switch is on; keeps filter asserts honest; dashed target border via toHaveCSS
metadata:
  type: feedback
---

In the Group Parallels dialog (NEO-660) a ticked row's own `Parallels of "X"` box
(role group in region "Parallels by insert") is not in the DOM while the switch
`Show ticked rows' boxes` is off (the default on every open; a tick never moves
it). The switch is the `primitives/Switch` input: role **checkbox**, not `switch`,
named by its wrapping label. `.check()` on it times out: the sr-only input sits
under the painted track (`<div class="relative"> intercepts pointer events`).
Click the label's visible words (`getByText("Show ticked rows' boxes", { exact: true })`)
and assert `toBeChecked()` on the checkbox, as a user would.

**Why:** a spec that ticks rows and then asserts `boxOf(ticked)` toHaveCount(0)
"because the filter hides it" goes vacuous: the tick alone already hides it.

**How to apply:**
- To prove the filter (or anything else) hides a ticked row's box, turn the
  switch on first, so only the thing under test can remove it; turn it off
  after and assert the boxes go again.
- Own box with the switch on: accessible description is exactly
  "This row is selected. Untick it to drop the other row here." (2 ticked),
  border-style solid. A box that takes the selection: description starts
  "Click here to make the N selected rows parallels", and
  `toHaveCSS("border-style", "dashed")` (a perceivable look, no class check).
- Other specs that tick a row and click ANOTHER row's box are unaffected; the
  long-set spec's `/^\d+ selected/` does not collide with the switch label.

Related: [[patterns_prove_a_theme_by_painted_colour]].
