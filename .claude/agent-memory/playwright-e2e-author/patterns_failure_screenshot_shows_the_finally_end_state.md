---
name: failure-screenshot-shows-the-finally-end-state
description: Where Playwright 1.63 takes the on-failure screenshot and ARIA snapshot relative to a spec's own cleanup — after a `finally` inside the body, before any afterEach
metadata:
  type: patterns
---

`screenshot: "only-on-failure"` and the `error-context.md` snapshot are captured in
`didFinishTestFunction`, i.e. right after the test FUNCTION returns or throws, and
before any `test.afterEach` hook runs (checked in the installed playwright 1.63 lib,
NEO-426).

- A cleanup in a `finally` inside the test body runs BEFORE the capture, so the
  failure PNG shows the cleaned-up end state, not the moment of failure. Read the
  error message and the blob report's error-context for what failed (NEO-481).
- A cleanup in `test.afterEach` runs AFTER the capture, so the PNG shows the red
  screen as it was, even if the hook drives the same page. A second page
  (`page.context().newPage()`) is still the house shape: it starts from a known URL
  and never fights the red page's half-finished state.
- An afterEach cleanup error does not print in the line reporter: push it to
  `testInfo.annotations` when the body failed, throw it when the body passed, and
  when proving cleanup-on-red, check the database or log the leftovers from a
  planted run (a cleanup that silently failed once left a set behind, NEO-426).

Related: [[patterns_finally_cleanup_without_an_isvisible_branch]]
