---
name: patterns-neo661-attention-level-hold
description: NEO-661 - a server hold keyed on deriveCardAttention(row).level === "fix"; what to check when a workflow gate is widened to "any pink"
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

**How to apply:** any diff that widens or narrows a hold derived from attention level.
