---
name: bsc-call-gate-in-unit-tests
description: Every BSC call passes the deployment-wide call gate (bscFetch + bscCallGate); how stub-ctx and convex-test tests keep it out of the way or drive it
metadata:
  type: reference
---

Since NEO-552 every BuySportsCards call goes through `bscFetch` (convex/lib/bscHttp.ts),
which asks `bscCallGate` (one `marketplaceCallGates` row: token bucket + breaker) first.

- **Stub ctx without `runMutation`/`runQuery` fails closed**: the call is never sent and
  answers a synthetic 503 (`x-nb-bsc-breaker: gate_unavailable`). Spread
  `openBscGate().ctx` (lib/testing/bsc-gate-stub.ts) into the stub ctx.
- **convex-test with more than 10 calls** waits on the real bucket (60/min, burst 10).
  `onTestFinished(skipBscGateWaits())` moves `Date.now` instead of sleeping.
- **Many failures in one test now open the breaker** (5 in a run), so later calls are
  refused unsent. A test about something else: `vi.mock("./bscCallGate", ...)` returning
  `openBscCallGate()` from lib/testing/bsc-open-gate.ts. A test about the breaker: assert
  call counts with the breaker in mind (ten 503s in a wave = 10 calls, no retries).
- Seeding an open window: `bscGateWindowRow(until, now)`; patch the existing row if a
  running action already made one (one row per deployment, `.unique()` read).
- Count gate reads by spying `bscCallGate.state._handler` (see [[convex-test-spy-handler-to-count-calls]]).
- In convex-test, `t.withIdentity(...)` reaches an internal action called directly, so
  `getCurrentUserId(ctx)` works there; a nested `runAction` from a signed-in action also
  carries it in Convex.
- A seam test (convex/bscHttpSeam.test.ts) fails on any BSC host literal outside
  lib/bscHttp.ts or a raw `fetch(` in a BSC module; strip comments before scanning.

Related: [[workpool-retry-semantics]], [[new-pool-enqueue-breaks-convex-test]].
