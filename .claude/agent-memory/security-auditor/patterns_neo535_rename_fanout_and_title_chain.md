---
name: patterns-neo535-rename-fanout-and-title-chain
description: NEO-535 rename→description fan-out and parallel Card titles chain — per-row "may hold cards" probes inside budget-sized doors multiply by the row cap; value-keyed chain stop allows A→B→A twin chains; what held
metadata:
  type: project
---

What held (re-check if touched): `parallelCopyTitles.failingTitles` / `saveTitleFixes`
are `requireAdmin` first, registered in publicFunctionAuth.test.ts with an ordering
pin; the save validates every answer before any write, caps cards, only writes cards
on THIS parallel that still `storedTitleFails`, and writes a "kept" box-built title
only when the server re-derives exactly that text. The fan-out chains are internal,
cursor on `_creationTime` / `(sportId, creationTime)`, `pagesLeft` runaway cap, stack
cap under Convex's 8,192-element array arg limit. Fan-out does NOT requeue eBay
(description is eBay item content; stale until Sync) — if someone wires it, it must
use the paged `queueRetitledCard` shape, never inline per card across a 2000-page chain.

Traps worth re-checking:
- A cheap pre-check called PER ROW inside a door already sized to its row cap
  (`subtreeMayHoldCards` in brand rehome: up to 500 rows × up to 50 probes × 2 calls)
  multiplies by the cap. Fix shape: one probe budget per transaction; once spent,
  answer "maybe" and let the scheduled chain pay. Same family as
  [[patterns-neo312-parallel-rebuild]] report-cap multiplication.
- A chain that stops when "the stored value is no longer mine" (box text) is not a
  generation: save A, B, A leaves two live A chains. Harmless while idempotent;
  becomes a real bug the day a page has a non-idempotent side effect. See
  [[patterns-neo411-retry-generation-and-dispatcher]].
- Title doors disagree on character classes: the box normaliser refuses \p{Cf},
  the parallel own-title check refuses only Cc/Zl/Zp, updateCard refuses none.
