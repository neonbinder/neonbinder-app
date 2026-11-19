---
name: test-signal-guards-with-process-emit
description: How to unit-test a run that holds off SIGINT/SIGTERM/SIGHUP under node --test — process.emit from a stub handler, an injected exit, listenerCount per request
metadata:
  type: reference
---

A run that installs `process.on("SIGINT"|...)` guards (the eBay prod capture) is
testable in-process without sending a real signal:

- `process.emit("SIGTERM", "SIGTERM")` from inside a stubbed fetch handler calls
  the listeners at that exact point of the run. Pass the name as the argument:
  a bare `process.emit("SIGINT")` hands the listener `undefined`, so a handler
  that reports or maps the signal name must tolerate a non-string.
- Emitting does not kill the test process (only listeners run), but a real
  second-signal path calls `process.exit`: make the exit injectable
  (`deps.exit`) and record the codes. The stubbed exit returns, so the run
  carries on; assert it was called once even after a third signal.
- To prove the guard window, wrap the stub fetch and record
  `process.listenerCount(sig)` on every request: every request from the grant
  through the last verification read should see baseline + 1, and the count is
  back to baseline after the run (also after a throw).
- Signal handlers report through the same report callback the run uses; wrap it
  in try/catch (a SIGHUP usually means the terminal is gone).

Related: [[adapter-retry-pause-is-injected]] (same seam idea for timers).
