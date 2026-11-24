---
name: patterns-probe-the-rest-of-a-spent-fresh-only-run
description: A fresh-only walk spec that went red after its commit (one shot per seed, no reseed allowed) can still have its later steps proven by a throwaway probe that reopens the saved set's walk from the "N need you" pill
metadata:
  type: feedback
---

When a fresh-only spec (it commits a real set) goes red AFTER the commit and you may not reseed
(shared deployment, coordinator owns resets), the remaining steps are not lost:

- copy the spec to a throwaway `tests/<area>/zz-<worker>-probe-*.spec.ts`; replace the fixture
  and the first fetch with `openOneMarketplaceSetBase(page, env, { set })` (or the drill the
  set needs) plus `openTidyWalk(page, { title })` — the pill opens a NEW sitting on the saved
  cards, which are still unanswered past the red step;
- drop one-time fixture creates (a player the first attempt already added) and the axe call
  that went red (it is a product finding, reported separately);
- run it once, then `rm` it. Never leave it in the tree; it is a diagnostic, not coverage.

**Why:** NEO-645 merged link spec: the first run died on a product axe failure at step 1; the
probe proved steps 2-5 (sport switch, cross-sport link, Back, card lists) in 15 s, so CI would
not be the first to see them.

**How to apply:** only for steps after the red; a probe green says the locators and flow work
on the saved data, not that the fresh run is green. Report the spec as "CI decides" for the
untried fresh path and any axe states the probe skipped.
