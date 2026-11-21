---
name: slow-component-test-profile-recipe
description: How a unit test that only times out under load was traced to a product hot path (demoStore containerCopies) with an in-test inspector profile; split-test and no-real-sleep rules
metadata:
  type: reference
---

A component test that passes alone but hits 5000ms under load is CPU-bound, not waiting: load multiplies its CPU time 5-8x. Find the CPU first.

- Time each step with `performance.now()` laps in a scratch copy of the file (delete it after). In `A11yFocusAndDrawer.test.tsx` role queries were ~2ms; every store write (add/remove a copy) cost ~180ms.
- `NODE_OPTIONS=--cpu-prof` loses the worker profile (worker is killed). Instead open `node:inspector` Session inside the test, `Profiler.start` around ONE action, `Profiler.stop`, write the profile to the scratchpad, and sum self time per function (small script over `samples`/`timeDeltas`). That named `containerCopies` (a `fixtureCards.find` per copy per smart binder) at ~90% of a write.
- Fix the product hot path when it is a one-line index (Map by id); otherwise cut the number of store writes per test.
- Split a test that chains several writes into one test per behaviour: each pays only its own writes, and the one with the fewest steps stops being the timeout victim.
- Drop `await act(() => setTimeout 40)` frame helpers when a `waitFor` follows anyway; they add wall time and nothing else.
- Every demo-owned card has exactly one copy line, so "after the last copy" needs no add step; "next copy" needs one add.
- `tsc -p .` at the app root takes minutes and 2.8GB; never run it as a check (gate is `npm run typecheck`).
- A busy shared Mac (load average 100+) reproduces the red organically: run old and new file back to back for a real before/after.
