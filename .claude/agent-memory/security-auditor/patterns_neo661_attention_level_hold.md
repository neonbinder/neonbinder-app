---
name: patterns-neo661-attention-level-hold
description: NEO-661 - server hold on pink (level fix) or awaiting BSC team lookup; what to check when the workflow gate widens; stuck-awaiting states
metadata:
  type: project
---

A gate that reads `deriveCardAttention(row).level === "fix"` (NEO-661 `blocksParallelBuild`) is not
suppressible by `tidyReviewed`: `deriveCardAttention` drops only reviewed *check* items, never fix items.
Confirm that still holds whenever the gate widens; a reviewed-key filter that touched fix items would
let a stored review list unblock a server refusal.

- The gate is computed in an internalQuery over the row alone (no extra reads, no new return field to
  a client); the public action keeps `requireAdmin` first and its pinned guard tests.
- It is a workflow hold, not a security boundary: a card turning pink after the page load is copied
  anyway (TOCTOU is benign; `skippedChangedSource` covers edits).
- Availability angle: whoever can make a source row pink can hold the build. Fine while every
  `cardChecklist` writer is admin or internal; a new non-admin writer to that table changes this.

- Second hold reason `"lookup"` (`parallelBuildHold`, `isAwaitingTeamLookup`): keyed on bsc-ref
  PRESENCE plus no stamp, never its value, so no invariant breach. The hold rides an internalQuery
  field (`awaitingLookup`) and a static refusal string; nothing new reaches a client. Its stuck
  states are availability only: a cancelled lane item (done, no stamp) and the ambiguous-sport
  early return (left unset for retry) leave a card "awaiting" with no lane run coming; the
  escape is an operator team / No Team write on the card. The lane's giveUp path does stamp.

**How to apply:** any diff that widens or narrows a hold derived from attention level.
