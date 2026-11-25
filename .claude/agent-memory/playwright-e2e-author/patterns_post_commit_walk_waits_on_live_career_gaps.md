---
name: patterns-post-commit-walk-waits-on-live-career-gaps
description: NEO-656 - after "Saved N cards." the walk opens only once the live career-gap query answers (tens-hundreds of ms later); no perceivable "answered, nothing to check" signal; use settleWalkAfterCommit { opens: true } when the spec knows
metadata:
  type: feedback
---

Since NEO-656 the checklist reads career gaps through its own subscription
(`useLeafCareerGaps`, `careerGaps.ready`). The post-commit effect opens the walk only
when `ready`, so a card whose only item is a career gap shows NO pill and NO walk at
the moment the saved line appears. A one-shot `isVisible()` read with the line
returns false, then the walk opens anyway (CI red "five career gaps, so the walk
opened" = false).

- **Known-open callers:** `settleWalkAfterCommit(page, saved, { opens: true })`
  (web-first `expectTidyWalkOpen`), or `expectTidyWalkOpen` directly. Every caller that
  asserts `.toBe(true)` may pass it.
- **False / unknown callers stay a read, not a settle:** nothing perceivable says
  the career query answered (no aria-busy, no status). A late walk then sits over the
  checklist: the next click fails (loud) or, worse, a branch that skips a walk proof
  passes. Pair a `false` with card positives; a plant probe (`expect(dialog Tidy up)
  .toBeVisible()` after the false) proves no late walk within 7 s.
- Only single-player cards carrying a team enter the career query; dual-player or
  teamless sets cannot open late.

**Why:** merge-group red on the career-tile spec, 2026-11-24. **How to apply:** any
spec settling the walk after a commit where career gaps can be the only stop.
Related: [[patterns_neo656_live_career_mark_and_apply_counts]], [[patterns_negative_asserts_pass_on_a_dead_page]].
