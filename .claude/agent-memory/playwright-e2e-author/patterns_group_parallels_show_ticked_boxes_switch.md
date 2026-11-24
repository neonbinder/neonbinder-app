---
name: patterns_group_parallels_show_ticked_boxes_switch
description: NEO-660 Group Parallels hides a ticked row's own box unless "Show boxes for selected inserts" is on; filter asserts, empty-pane line, suggested-box fixture, scratch screenshot config
metadata:
  type: feedback
---

In the Group Parallels dialog (NEO-660) a ticked row's own `Parallels of "X"` box
(role group in region "Parallels by insert") is not in the DOM while the switch
`Show boxes for selected inserts` is off (the default on every open; a tick never moves
it). The switch is the `primitives/Switch` input: role **checkbox**, not `switch`,
named by its wrapping label. It sits in the filter row above both panes (not in
the "Parallels by insert" region), so scope it to the dialog. `.check()` on it times out: the sr-only input sits
under the painted track (`<div class="relative"> intercepts pointer events`).
Click the label's visible words (`getByText("Show boxes for selected inserts", { exact: true })`)
and assert `toBeChecked()` on the checkbox, as a user would.

**Why:** a spec that ticks rows and then asserts `boxOf(ticked)` toHaveCount(0)
"because the filter hides it" goes vacuous: the tick alone already hides it.

**How to apply:**
- To prove the filter (or anything else) hides a ticked row's box, turn the
  switch on first, so only the thing under test can remove it; turn it off
  after and assert the boxes go again.
- Own box with the switch on: accessible description is exactly
  "Selected", border-style solid. A box that takes the selection: description starts
  "Click here to make the N selected rows parallels", and
  `toHaveCSS("border-style", "dashed")` (a perceivable look, no class check).
- Empty right pane: with the switch off, a filter matching only ticked rows
  shows `No parallels to show for "<filter>"`; with no filter the line is
`Every box here belongs to a selected insert. Turn on "Show boxes for selected inserts" to see them.` (scope to the "Parallels by
  insert" region; it also appears for a filter matching nothing). Pair it
  with the ticked row still visible on the left.
- A suggested box needs a prefix fixture (`<T> Aces` + `<T> Aces Gold`); Cancel
  with a pending suggestion opens "Discard N pending move(s)?" first.
- Screenshots for review without touching `playwright/tests/`: a scratch
  config in the worktree scratchpad that spreads the suite config, overrides
  testDir/testMatch/outputDir, keeps only e2e/e2e-mobile with no deps; run
  `npx playwright test --config <absolute path>` from apps/web with .env.local
  sourced, APP_URL and WORKER_INDEX set; `page.emulateMedia` + `paintsLook`
  per theme, then `locator.screenshot`.
- Other specs that tick a row and click ANOTHER row's box are unaffected; the
  long-set spec's `/^\d+ selected/` does not collide with the switch label.

Related: [[patterns_prove_a_theme_by_painted_colour]].
