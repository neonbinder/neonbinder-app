---
name: stdio-epipe-error-is-a-late-event
description: A write to a closed stdout/stderr pipe or hung-up tty kills Node via an 'error' event queued on nextTick; a scoped listener removed in finally can miss it, and stdio resets `errored` after each error
metadata:
  type: reference
---

A write to a closed stdio pipe (EPIPE, `2>&1 | tee` after tee died) or a
hung-up terminal (EIO after SIGHUP) never throws: the sync write failure goes
onwrite → nextTick → destroy → nextTick → 'error'. No listener = uncaught, the
process dies and any `finally` cleanup is skipped. try/catch around `write`
does nothing.

- **A scoped no-op listener removed in `finally` can miss it.** A run whose
  awaits never touch I/O (stubbed fetch, `sleep` that only bumps a clock)
  completes in one microtask drain, so the queued nextTicks fire after the
  `finally`. Remove the listener with `setImmediate(release)`; an entry-point
  listener for the whole process is the real guard for a CLI.
- **stdio streams re-arm after each error.** `dummyDestroy` calls
  `_undestroy()`, so `stream.errored` is null afterwards and every later write
  errors again. To prove a test hit the path, wrap `process.stderr.emit` and
  record `'error'` events (forward to the original so the no-listener throw
  still happens); adding a listener to observe would itself be the guard.
- **Testing it:** spawn a child with `stdio: "pipe"`, `child.stderr.destroy()`
  right after spawn, and have the child wait for a line on stdin before
  writing (deterministic close-before-write). Node ignores SIGPIPE, so the
  child sees EPIPE, not a signal. Shared stubs for parent and child go in a
  non-`*.test.mjs` module so `node --test 'tests/*.test.mjs'` skips it.

Related: [[test-signal-guards-with-process-emit]].
