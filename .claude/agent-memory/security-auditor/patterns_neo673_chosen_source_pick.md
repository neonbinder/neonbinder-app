---
name: patterns-neo673-chosen-source-pick
description: NEO-673 stored pointer (parallelSourceId) re-verified on read; a one-click source repoint opens a delete-phase race in the parallel build
metadata:
  type: project
---

NEO-673 added `setParallelTypeSource` (requireAdmin first; type kind via
`variantTypeKind`; source must be `level === "insert"` with `parentId === type`)
and the pointer `selectorOptions.parallelSourceId`, re-verified on every read in
`sourceOfParallelType` (exists, insert, parent is this type). That shape held:
no cross-set write is possible, a dangling or moved pick reads as absent, and
no adapter/sync reads it.

The gap: the build action (`buildParallelChecklist`) deletes the target's old
cards via `deleteParallelCardsPage`, which never re-resolves the source; only
`insertParallelCardsPage` checks `sourceMoved`. Before NEO-673 a target could
not cheaply become non-buildable mid-run (kind-changing renames are refused
while rows sit beneath). A repoint door makes "the target becomes the source"
one click away in another tab, so the new source's cards are wiped.

**How to apply:** any new door that changes what `resolveBuildSource` answers
(a pick, a role flag, a re-parent) needs the delete page to re-resolve and
compare to the action's `sourceId` before deleting, not only the insert page.
Grep `deleteParallelCardsPage` args for `sourceId`.
