---
name: reseed-right-after-a-queued-lookup-spec
description: A --fresh/plant re-seed straight after a spec that saved cards into the background team-lookup queue can fail its own verify (selectorOptions grows between import and verify); seed standalone a few minutes later
metadata:
  type: feedback
---

A re-seed (`--fresh`, `--project both`'s mobile re-seed, or a plant's re-seed) started about a
minute after a spec saved cards into the background team-lookup queue can fail the reference
import's verify: `FAIL selectorOptions N rows (expected 17)`, the import itself having sent 17.
Something still running from the spec (likely the queue's lane once its Retry-After ends) writes
selectorOptions between import and verify. The seed tool then stops before the spec runs.

**Why:** seen twice in a row on 2026-11-21 (NEO-639, the BSC 429 cooldown spec, 90 s
Retry-After); a standalone `e2e-run.mjs seed` a few minutes later passed both times.

**How to apply:** this is not a spec red. Run `e2e-run.mjs seed`, then the next project or the
plant with `--expect` (no further re-seed). Do not edit the spec or the seed to appease it;
report it under findings. Related: [[patterns_e2e_run_tool_in_practice]].
