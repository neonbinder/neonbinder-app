---
name: restore-spy-before-real-timers
description: A setTimeout spy taken under fake timers must be restored BEFORE vi.useRealTimers(), or the network-guard afterAll hangs 10 s ("Hook timed out") with every test green
metadata:
  type: reference
---

`vi.spyOn(globalThis, "setTimeout")` under `vi.useFakeTimers()` wraps the FAKE function. In an `afterEach`, `vi.useRealTimers()` then `vi.restoreAllMocks()` puts the fake `setTimeout` back, so the suite's `afterAll` (`settleBeforeFileCheck`, a real 30 ms wait) never resolves: the file fails with "Hook timed out in 10000ms" while every test reports passed. Order it `restoreAllMocks()` first, `useRealTimers()` second (or `spy.mockRestore()` inside the test's `finally`).

Related stale-timer tests: a notice/toast id must come from a monotonic `useRef` counter (never `(prev?.id ?? 0) + 1`, which restarts after a dismiss), and the guard compares ids, not text.
