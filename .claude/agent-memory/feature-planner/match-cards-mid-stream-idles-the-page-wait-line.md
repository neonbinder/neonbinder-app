---
name: match-cards-mid-stream-idles-the-page-wait-line
description: Match Cards can open while BSC team lookups still stream; the page's "Waiting on BuySportsCards" line goes idle while the dialog is open, so a spec asserting it after Sync races the dialog
metadata:
  type: project
---

`CardChecklist`'s sync wait line is `active={syncing && pairingPhase !== "review"}`, and the line mounts only after 1.5 s of waiting. On a two-source fetch the Match Cards dialog can open mid-stream and show its own sentence instead ("teams are still resolving in the background (21 of 26 done)"). A spec that asserts the page wait line after Sync passes only when the dialog opens after 1.5 s. Seen as NEO-624 (stall spec, mobile): the dialog's "21 of 26 done" with 5 cards outstanding proved the hang DID hold.

**Why:** the ticket read the missing line as "the fault did not apply"; the dialog's progress count said otherwise.
**How to apply:** for a stall or slow-call proof on a fetch that can open Match Cards, accept the page line OR the dialog's streaming sentence with the outstanding count. Read error-context.md before blaming the fake. Related: [[wizard-step-after-a-decision-can-be-a-pool-wait]].
