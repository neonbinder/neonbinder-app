---
name: ci-step-timings-live-in-the-html-report
description: To size an E2E wait from CI, read per-step durations keyed by source file and line from the merged Playwright HTML report's embedded zip; one run is one sample per site per project, and unexecuted lines mark the other operator-flag branch
metadata:
  type: reference
---

The merged Playwright artifact's `html/index.html` embeds a base64 zip (one
JSON per spec file). Each result's nested `steps` carry `title`, `duration`
and `location {file, line}` (helpers appear as `../support/<file>.ts`). Joining
those to every source line that passes a `timeout:` gives a measured value per
wait site without rerunning anything. `results.json` beside it holds the
annotations (`marketplace-wait`, `seller-wait`) but only `test.step` steps.

**How to apply:**
- A wait site with no step in the run sits on a branch the run did not take
  (an operator flag such as a paused marketplace): keep its value, never size
  it from the other branch.
- One green run is two samples per site (desktop, mobile). Tail events that
  can land on any step (a first token mint, a cold service) are not in a
  site's own number: read the per-run call-health summary for the tail and
  leave headroom, or use the measured-wait helper instead of a flat value.
- Lowering a timeout never makes a green run faster; it only shortens the
  time to red. Say so in the plan.
- Seed and bootstrap steps absorb cold starts; their numbers do not transfer
  to shard steps.
