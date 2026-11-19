---
name: reference_bounded_fetch_test_timer_arms_before_the_stub_is_reached
description: Testing a timer-bounded R2 fetch with fake timers — the try's timer is armed before the async sign() finishes, so a stubbed fetch can see an already-aborted signal; wait on the stub, not the timer count
metadata:
  type: reference
---

`boundedRequest` (convex/lib/r2.ts) arms its timer, THEN awaits `client.sign()` (real async crypto), then calls fetch. A test that waits for `vi.getTimerCount() === 1` and advances fake time can therefore abort before the stubbed fetch even runs. A stub that only listens for a later "abort" event never fires.

**How to apply:** a hang stub must check `request.signal.aborted` first (the existing `hang` helper does). To prove the BODY read is inside the timer, count stalled bodies handed out by the stub and wait for that count before advancing time. To speed a drain-level test, wrap `setTimeout` to turn the 2.5 s R2 delay into 0 and leave every other delay alone; no fake timers needed with convex-test. `vi.waitFor` under fake timers advances fake time (~50 ms per poll), so never assert exact fake-clock durations after it.
