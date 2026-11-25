---
name: patterns-neo644-fake-only-skip-and-lane-bookkeeping
description: A real-mode safeguard (pacing sleep) skipped "on the fake" must key on the domain resolved from env at run time, not a stored item field; fake-only bookkeeping rows written on re-enqueue spread the stored field
metadata:
  type: project
---

When a diff skips a real-marketplace safeguard (a pacing sleep, a backoff) for
fake/test traffic, check WHAT the skip keys on:

- Safe shape (NEO-644): keyed on `bscCallDomainFor(...).gateKey`, which reads
  `resolveBscTarget(process.env)` at run time. Real and misconfigured both
  return the `"deployment"` key, and fake mode requires TESTING_RESET_SECRET
  plus a fake-host URL, so no prod path reaches the skip.
- Unsafe shape: keyed on a field stored on the queued item (`queuedBy`). The
  item outlives the env that minted it, and re-enqueue paths spread the stored
  context without re-applying the env filter.

Fake-only bookkeeping (a table of work ids per test user so a spec can cancel
its own items): the insert guard must re-apply the env filter
(`queuedByForLane`) rather than trust `item.queuedBy`, or the "never written
on real" claim fails across an env flip. Low severity (test deployments only),
but the doc comment then lies.

Scoping check that held: the public testing mutation reads rows by the
verified Clerk subject, has no user arg, gates on TESTING_RESET_SECRET before
identity (no oracle), returns and logs a count only. A throwing mutation rolls
back, so write-nothing pins are implied for it.

Related: [[patterns-testing-endpoint-gate]], [[patterns-merge-resolution-guard-survival-and-bsc-lane-enqueue]].
