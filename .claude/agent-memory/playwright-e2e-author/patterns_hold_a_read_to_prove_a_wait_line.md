---
name: hold-a-read-to-prove-a-wait-line
description: Prove a "Waiting on BuySportsCards" line deterministically by holding a BSC read (bscFault.slow, under the caller's timeout) in a window where nothing else can be on screen; never `.or()` the page line with the Match Cards sentence
metadata:
  type: feedback
---

A wait-line proof that accepts "the page line OR the dialog's sentence" passed an audit as PASS WITH FIXES: either branch may never run, so neither is proved. Make the window deterministic instead.

- Hold the fetch's one catalogue read: `bscFault.slow(BSC_PATH.results, HOLD_MS, { times: 1 })`. The read's own timeout is 30 s (BSC_CHECKLIST_FETCH_TIMEOUT_MS), so a hold below it is an answer, never a failure to the call gate. Match Cards opens on the first streamed candidates, and there are none while the catalogue read is held, so the dialog cannot be open: assert `waitingOn(page, ...)` visible, then `matchCardsDialog(page)` `toHaveCount(0)` (that is what makes it the PAGE line; `waitingOn(page)` also matches the dialog's own line).
- The dialog carries its own wait line (`waitingSlot`, role status), shown 1.5 s after the dialog mounts (the 1.5 s gate is per component instance). Prove it with `waitingOn(matchCards, ...)` after the dialog is up.
- `expectAfterMarketplace` already credits the dialog's line, so a Confirm wait with the dialog open the whole time gets BSC's seconds. Never credit the "(N of M done)" sentence: it stays up after the fetch until the run's teams land (NEO-341), which is our own time.
- A whole-page axe check taken while a held line shows: hold long enough for both passes, then assert the line is STILL visible, so the check read the state it is named for.
- A failed run leaves a candidate batch: the next Sync on that set opens Match Cards at once with the old batch. Reseed before re-running (and before a planted-break run).
- Read "the screen said nothing" off the trace's screencast frames: frames are written only when the screen changes, so a gap between the click's frame and the dialog's frame is time with nothing new on screen.

**Why:** NEO-628 audit of the NEO-624 fix; the held read also exposed that the page line stands down for a two-source run before the dialog exists (6.5 s with only "Fetching...").
**How to apply:** any spec proving a marketplace wait line. Related: [[patterns_fake_bsc_faults_and_the_call_gate]], [[patterns_dialog_seed_from_stale_batch_masks_a_lookup_loss]].
