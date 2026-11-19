---
name: NEO-587 rAF status race sweep
description: How to find rAF-delayed live-region races by slowing requestAnimationFrame in a throwaway setup file; useLiveWords joins words; vacuous negatives
metadata:
  type: reference
---

Finding races of the "one-frame-late status text" class: add a throwaway setup file that replaces
`globalThis/window.requestAnimationFrame` with a real-`setTimeout` (captured before fake timers) of
`SLOWRAF_MS`, wire it into the `components` project `setupFiles`, run the whole project at 1, 30, 200 ms.
Fails at 1 ms are real races (immediate vs timer reorder); failures only at >=100 ms are artifacts
(5s test timeouts, `frames()` 40ms sleeps, waitFor 1s budget). Revert both files afterwards.

- `useLiveWords` (collection notice.tsx) JOINS words of notices that land before the frame runs, so an exact `===` or `^`-anchored
  status match on the later notice is flaky: use `endsWith` / a tail-anchored regex.
- A "says nothing" negative on that status line passes vacuously unless a frame ran first: `await act(async () => { await new Promise(r => requestAnimationFrame(() => r())) })` (FIFO behind the product's rAF).
- Product rAF focus moves also race tests that call `.focus()` right after opening a form: wait for the form to hold focus first.
- Stress with ~half the cores in busy loops + `--sequence.shuffle`; 2x cores starves everything into 5s timeouts (not a signal). Machine may already be loaded by other apps.
- zsh: put file lists in an array (`F=(a b)`, `$F`), a plain string var is passed as one filter. `grep -a` plus strip ANSI when reading vitest logs.

Follow-up (load-sensitive tests): drive a bounded product rAF retry by hand (spy rAF into a Map, flush in act) instead of a wall-clock waitFor;
hoist cold `await import("axe-core")` into `beforeAll(..., 60_000)` and serialize axe runs via a `lastAxeRun` promise awaited before the next run;
heavy-by-nature sync renders get a scoped `it(name, fn, 30_000)` with a why-comment. Prove "red before" with `--testTimeout=400 -t <name>` on a `git show HEAD:` copy
(explicit per-test timeouts win over the CLI flag, but unscoped siblings failing cascade into later tests in the file). Run `--sequence.shuffle --sequence.seed=N` over N=1..15: a leaked `vi.spyOn(Storage.prototype)` surfaced only at seed 6.
