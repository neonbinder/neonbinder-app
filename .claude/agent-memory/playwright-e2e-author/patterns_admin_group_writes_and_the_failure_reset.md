---
name: admin-group-writes-and-the-failure-reset
description: NEO-592 - why a spec whose admin write settles a whole group needs a group key of its own; how the harness failure reset and console capture fixtures are ordered and proved
metadata:
  type: feedback
---

- **Per-account isolation is not enough when an admin write is group-wide.** Every test account is an admin, and some admin writes settle every row in a group whoever owns it (`syncReports.close` closes every open report on the same variant + platform). Two specs reporting on the same shared variant raced across workers. Fix: give one spec a group nobody else can reach (a per-attempt hand-made set under real Baseball > 2024 > Topps, `Insert` > `Base`, prefix row in SET-REGISTRY's Custom sets), never change the product write. **Why:** owner chose spec isolation over product change. **How to apply:** before sharing a variant between specs, grep the mutation the spec triggers for a query that is not owner-scoped.
- A hand-made card has no player, so the collector's short name is `#<number>` and the card drawer's name is `^<year> <set>.*#<number>`.
- **Auto fixtures tear down in reverse registration order.** The failure reset (`resetAfterFailure`) is registered before the console capture and takes no `page`/`context`, so it runs after `afterEach`, the other fixtures and the red context's close. Playwright screenshots every open page of a red test, including a fresh context's: send the reset page to `about:blank` before closing it, or the credentials page lands in the artifacts.
- **Proving the harness:** plant a wrong expectation after the spec has written (copy added), run with `--reporter=json`, read `failure-reset` in the result's annotations (seconds) and that the spec's own error is the reported one; prove the failure path with `APP_URL` on a closed port (the annotation says FAILED, the spec error still stands). Restore with `cp` from a scratch backup and `cmp`.
- Check redaction by decoding the `console` attachment body from the JSON report and grepping for testing tokens, JWTs, Convex hosts and emails; never paste the body anywhere.

Related: [[per-worker-data-isolation]], [[planted-red-for-server-side-behaviour]], [[collection-optimistic-writes-wait-for-the-notice]].
