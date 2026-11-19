---
name: patterns_failure_hook_that_finishes_every_step
description: Self-cleaning specs - afterEach finishing every step, finally cleanup without an isVisible branch, the failure screenshot shows the post-cleanup state
metadata:
  type: pattern
---

A spec that writes through the UI (a box, a copy) or through a `/testing/seed-*` hop must tidy on a
failure too, or the next spec on that worker meets its leftovers ("None yet" no longer true, a sync
problem it never made on the dashboard).

Shape (NEO-464 `real-sync-status-and-sale`, `real-sell-and-take-off-sale`, `real-shelf-box-overflow`):
- module-level `written = { box?, card? }` set by the body right BEFORE each write (so a death mid-write is covered);
- `test.afterEach(async ({ context }, testInfo) => { if (testInfo.status === testInfo.expectedStatus) return; const clean = await context.newPage(); ... finally { await clean.close() } })` (the context is already signed in);
- each step wrapped in `attempt(step)` that pushes to `failures`, the first rethrown at the end, so one red step does not skip the rest;
- steps are idempotent: the card panel settles on `none.or(remove)`, then branch on `remove.isVisible()`; a box already gone is skipped (`support/collection.ts` `deleteBoxNamed`);
- a body that passes does its own final tidy and clears `written`; planting a `throw` after the first write proves the hook (the next run's fresh "None yet" proves it cleaned).

**Why:** GUIDE gotcha "A failure hook finishes its tidy-up".
**How to apply:** reuse `deleteBoxNamed(page, name)`; seven-box specs loop it over the names the body pushed to a `made` array.

## Patterns finally cleanup without an isvisible branch

A cleanup that must close something only when the body did not ("Done adding
photos" on a run) is a state question, not a visibility one. Do not write
`await expect(done.or(closed)).toBeVisible(); if (await done.isVisible()) ...`:
it is an instant branch (the reviewer rejects it) and the pair of states it
tests is knowable from the spec's own flow.

- Set a flag the line AFTER the closing click resolves (`doneClicked = true`),
  or clear the "run is open" record there (`written.runUrl = undefined`) BEFORE
  the closed-note assertion. The cleanup then presses Done only when the flag
  says the run is still open, with one plain `click()` (7 s, auto-waits for the
  button) and one assertion on the closed note.
- Run each tidy step (close run, clear common price, delete box) through a
  `tidy(step)` that catches into a list, so one stalled step never skips the
  rest. After them: throw the first leftover only when the body passed; when the
  body failed, put it on `test.info().annotations` so the body's own error stays
  the one the report shows (a throw in `finally` replaces it).
- A closed run's id stays on the URL, so `/[?&]run=/.test(page.url())` means
  "a run exists", never "a run is open"; pair it with the flag.
- Proving a conditional panel state ("Min price is blank again") can use the
  button that mirrors it (`Defaults: Near Mint` vs `Defaults: Near Mint, $0.25`
  by accessible name) instead of opening the panel with an `aria-expanded`
  branch.

A horizontal overflow inside a lane (a status pill clipped in a ~125 px lane at
the desktop project's 1024 px width) shows up as axe `scrollable-region-focusable`
on `section[aria-label="Cropping & reading, N"] > .overflow-auto`. Seen on the
desktop project only; the same spec passed on the phone project.

Related: [[patterns_marketplace_listing_spec_shape]]

## Patterns failure screenshot shows the finally end state

Playwright's `only-on-failure` screenshot is taken after the test body AND its
`finally` have run. In a spec that cleans up after itself (reopen, Done, remove
the copy), the PNG shows the cleanup's end state, not the failing moment. NEO-481:
a recrop spec's PNG showed a checklist and an empty card drawer, which read like
a wrong `goto`; the real failure was a view-only viewer opened by a load race.

**How to apply:** for any red in a spec with a cleanup `finally`, open the
blob report (`report/blob`) and read the error-context ARIA snapshot under
`resources/` before trusting the PNG. Related: [[patterns_failure_hook_that_finishes_every_step]].
