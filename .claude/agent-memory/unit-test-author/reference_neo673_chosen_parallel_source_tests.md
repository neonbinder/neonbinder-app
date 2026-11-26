---
name: reference-neo673-chosen-parallel-source-tests
description: NEO-673 chosen-source tests - fixture shape, why the title tests need a long box, wire-level R1 chain check, mutation checks
metadata:
  type: reference
---

- Fixture: Parallel type (variant-tagged) with insert children Silver/Gold/Blue, pick patched on as `parallelSourceId`. `t.run` turns an undefined read into null, so assert stored picks with `toBeNull()`.
- A carried hand edit only reaches a title when the builder's own title fails. To exercise `dropName` through the build, give the target a long name (60 chars) and a short source rest; through saveTitleFixes use a 69-char box plus a two-word player so the first name is cut, and set `listingTitleTruncated: true` on the copy (the save skips cards `storedTitleFails` does not list). Compute the "shown" title with `assessParallelCopyTitle({...inputs, setShortName: box}, carriedRest)` like the client.
- A source title whose description form already contains the dropped name hides the drop; put a second, separate "SILVER" after the description.
- R1 (Silver Sync vs side plan): stub fetch at the wire (`/search/bulk-upload/results`) and compare the recorded filters with `planParallelSides(getAncestorChain(id))`.
- Break-check by cp backup of the product file, sed the one line, rerun, cp back; confirm `git status` shows no product diff.
