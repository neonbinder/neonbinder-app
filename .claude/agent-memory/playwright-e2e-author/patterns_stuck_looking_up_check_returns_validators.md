---
name: stuck-looking-up-check-returns-validators
description: A review row that never leaves "N still looking up" (even a 180 s wait) is usually the lookup action throwing; read the Convex logs for ReturnsValidationError before any timing theory
metadata:
  type: feedback
---

When a Player/Team row on the walk sits on "Checking for players by that name…" (or the end screen on
"Still looking up teams for N cards…") past every budget, read the deployment's Convex logs
(`npx convex logs --history 400`, read-only) for the lookup action
(`adapters/wikidata:runEntityReviewLookup`, `worker:runBatch`). NEO-602 case: the
schema gained optional row fields (`teamContext.cards`, `playerContext`) but
`entityReviewQueue.getInternal`'s `returns` reused the public `rowValidator`, so every
row carrying them failed `ReturnsValidationError`, the lookup threw, and the row stayed
pending. Specs whose step needed the lookup went red; specs that act without it
(Create new, a silent link) stayed green, which is why only some specs showed it.

**Why:** Jason's rule: never diagnose timing first; a stuck spinner is almost always a
throw underneath.

**How to apply:** grep the log for `ReturnsValidationError|Uncaught|failed` around the
run's time; a schema field added on the branch without its validators updated is a
product bug to report (not a spec fix, not a longer wait). `npx convex logs` keeps
streaming, so run it in the background with a bounded kill (macOS has no `timeout`).
