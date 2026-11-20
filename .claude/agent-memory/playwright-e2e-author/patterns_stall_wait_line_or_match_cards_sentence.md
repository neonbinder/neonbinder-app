---
name: stall-wait-line-or-match-cards-sentence
description: NEO-624 - on a fetch that can open Match Cards mid-stream, the page "Waiting on BuySportsCards" line stands down while the dialog is open; a stall proof accepts the page line OR the dialog's "(N of M done)" sentence
metadata:
  type: feedback
---

`CardChecklist`'s wait line is `active={syncing && pairingPhase !== "review"}` and mounts only after 1.5 s of waiting. With a publisher's checklist uploaded, Match Cards can open before that (seen on the phone project, merge-group red): the ARIA snapshot showed the dialog with "Pair away — teams are still resolving in the background (21 of 26 done). Confirm unlocks when the fetch finishes." and no page line. The hang HAD held.

Pattern used in `checklist-fetch-bounds-a-bsc-stall-and-queues-the-cards`:
- `waitLine.or(matchCards.getByText(STILL_RESOLVING).first()).first()` visible (the sentence is shown AND said by a status, so `.first()`), then branch on `waitLine.isVisible()`.
- Dialog branch hard-asserts the sentence and `done <= CARDS - STALLED`, axe `within` the dialog; page branch axe whole page. A `bsc-wait` annotation names the branch (R2).
- Name the locator `waitLine`, not `pageWait`: eslint's `playwright/prefer-locator` misfires on a variable starting with `page`.

**Why:** the ticket first read the missing line as "the fault did not apply"; error-context.md said otherwise.
**How to apply:** any spec proving a BSC wait on a two-source fetch. Which comes first is a race (locally both projects took the dialog branch, "21 of 26 done"); the page line can still show later while the dialog is open (the Confirm wait was credited 9.2 s of 9.4 s), so `confirmChecklistMatchCards` needed no change. Related: [[fake-bsc-faults-and-the-call-gate]].
