---
name: teardown-count-assert-and-lane-clear
description: NEO-644 pattern for a spec teardown that must prove it acted - return the hop's count, assert it only when the test passed, annotate it; how to read it back and plant it
metadata:
  type: feedback
---

A teardown hop that "succeeds" with a count of 0 is a silent green (the coverage auditor's
NEO-644 finding). Shape that passed review:

- The `BscFake.hop()` returns the settled status line's text; a helper parses its count
  (`clearTeamLane()` returns N from "Cleared: lane, N queued team lookups.").
- In the spec's `test.afterEach(async ({ bscFake }, testInfo) => ...)`: always clear, then
  `testInfo.annotations.push({ type: "bsc-team-lane-cleared", description: String(n) })`, and
  assert `n >= 1` only when `testInfo.status === testInfo.expectedStatus`, so a red test keeps
  its own error instead of a teardown error.
- Read N back from the run's `e2e.json` / `e2e-mobile.json` (`results[].annotations`); the
  e2e-run digest does not print annotations. Measured: 429 spec 28, stall spec 3, both projects.
- Prove it can fail: plant the server-side bookkeeping write off (`convex/` plant, re-pushed and
  restored by the tool) with `--expect` on the assertion's message.

**Why:** a teardown that stopped finding its items (a lost `queuedBy`) would otherwise leave
the deployment-wide BSC team lane blocked with no red anywhere.

**How to apply:** any spec teardown that cancels or deletes something it created. Both NEO-644
specs are fresh-only: after a `--project both` run, `e2e-run.mjs seed` before a `plant`, or
the plant goes red at "No cards in this checklist yet." instead of the planted line. A `--edit`
JSON path is relative to `apps/web`, so the worktree scratchpad is `../../scratchpad/...`.
Related: [[patterns_planted_red_for_server_side_behaviour]], [[patterns_fake_bsc_faults_and_the_call_gate]].
