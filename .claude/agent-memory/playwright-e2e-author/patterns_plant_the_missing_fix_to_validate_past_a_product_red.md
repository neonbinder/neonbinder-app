---
name: patterns-plant-the-missing-fix-to-validate-past-a-product-red
description: When a spec goes red on a real product bug mid-flow, plant the one-line fix with an unmatchable --expect; PLANT STAYED GREEN proves every later step of the spec passes on the fixed product, nothing committed
metadata:
  type: feedback
---

A spec that correctly reds on a product bug part-way through leaves every later
assertion unrun, so a rewritten tail (new titles, new header text) is unproven.
Do not weaken the red assertion to get past it. Instead:

1. Write the product fix as a plant edit (`[{ file, find, replace }]`, in the
   gitignored `.e2e-local/plants/`), e.g. one line passing the missing input.
2. `e2e-run plant --edit <fix.json> --expect 'SOME_UNMATCHABLE_MARKER' <spec>`.
   `--expect` keeps the tool from re-seeding a spec that already ran on the seed.
3. `PLANT STAYED GREEN` (exit 1) here is the good result: the whole spec passed
   with the fix in. A red shows what else is wrong. The tool restores the file and
   re-pushes Convex.
4. Still plant a real break for the assertion you changed (the normal proof), and
   report the bug with the fix you validated.

**Why:** NEO-645, a quick-add mutation built the born title without the card's
name while the drawer's Regenerate had it; the spec's sibling read-back went red
there and the walk half was otherwise unvalidated.
**How to apply:** any red that is a product bug with an obvious small fix, before
hand-back, on desktop and mobile. Related: [[pre-fix-snapshot-is-the-planted-break]],
[[patterns-e2e-run-tool-in-practice]].
