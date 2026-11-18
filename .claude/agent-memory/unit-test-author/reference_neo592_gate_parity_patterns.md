---
name: neo592-gate-parity-patterns
description: How to prove a perf refactor of an action/query changed no output - origin/main differential, db probe, outside-in call counting, mutant runner
metadata:
  type: reference
---

- Strongest parity proof: `git archive origin/main convex`, drop it as a sibling `apps/web/convex_base/` (`../lib` still resolves), run the same seeded fixture through two `convexTest` instances (current schema/modules vs base `schema` + `import.meta.glob("../convex_base/**/*.*s")`; convex-test finds the root by `_generated`). Ids are deterministic across instances; only the random `batchId` needs normalising. Then record the base output as an inline golden and DELETE the copy. The golden tests also run green against the base copy (via a temp vitest config); only the structural pins (call count, log line, concurrency) go red there.
- `lib/testing/db-probe.ts` wraps `ctx.db` to read peak reads in flight / gets / index reads per table. Call a handler as `fn._handler({...ctx, db: probe.db}, args)` inside `t.run`; return only `probe.stats` (a Proxy in a `t.run` result throws "commit timestamp unresolved").
- Count child calls from OUTSIDE: wrap every registered query/mutation's `_handler` in the module registry (`Object.assign(() => undefined, fn, {_handler})`), arm only around the action.
- Shared-cache pins need real budget math: the card-year team cache ceiling is 240 reads; 25 names x 16 distinct team reads (rule 6b via past stints) exhausts it only if shared.
- Mutant runner: backup file, string-replace exactly once, run vitest, restore in `finally`; a mutant that does not compile is not evidence.
