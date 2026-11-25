---
name: teardown-hop-count-ignored
description: A spec teardown hop that returns "N items cleared" but the spec never checks N, so a flake fix can go green while clearing nothing
metadata:
  type: project
---

Pattern (NEO-644, BSC team lane clear): a testing mutation cancels the caller's queued work and the
`/testing/<fake>?clear=...` hop prints "Cleared: lane, N ...". The helper only checks the "Cleared"
prefix, so if the live path never records the rows (plumbing of the owner id broken), teardown passes
with N = 0 and the flake the PR fixes silently returns.

**Why:** a test-infra fix has no user-facing spec of its own; its only live proof is the teardown.
**How to apply:** when a cleanup helper reports a count, ask for the helper to return it and the spec
to assert it is at least 1 where the spec guarantees queued work (e.g. a long Retry-After cooldown).
Also ask for a unit test at the bulk cap (`take(MAX)`) boundary: MAX+1 rows leaves one behind.
Related: [[seeded-terminal-state-spec]], [[a-green-suite-can-mean-the-test-stopped-testing]].
