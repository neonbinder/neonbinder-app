---
name: fake-bsc-faults-and-the-breaker-job
description: NEO-552 - BuySportsCards is a fake; a spec makes BSC misbehave only through the bscFake fixture, and any 429/503/hang/reset fault belongs in the serial @bsc-breaker job
metadata:
  type: reference
---

BSC is the fake on previews, worktree deployments and dev: deterministic, one account per test user, no shared seller. Patterns:

- **Faults and orders go through the `bscFake` fixture** (`support/bscFake.ts`): `setFaults([bscFault.slow|tooManyRequests|unavailable|hangs|answersUnavailable(BSC_PATH.x, opts)])`, `addOrder`. It drives the `/testing/bsc-fake` hop on a SECOND page of the context (a spec cannot call a Convex action), so the spec's own page never moves. Teardown is automatic (fixture), red or green; orders are the one thing not cleared.
- **Convex has ONE deployment-wide BSC call gate.** A 429, or five consecutive 5xx / timeouts (so a `hang` on three cards = six timeouts; no fault drops a socket since NEO-582: `reset` = 503 at once, `hang` = 503 at its 2-min cap), opens it for every shard. Those specs carry `@bsc-breaker` and sit in `BREAKER_SPECS` (project-scope.mjs); `setFaults` throws without the tag; shard-plan refuses a tag/list mismatch; e2e.yml runs them alone in `breaker-<pass>` after every shard. A `delay` shorter than the caller's timeout (card-listing 5 s, seller profile 20 s, sheet 90 s) is safe anywhere.
- **A hang, not a delay, to stall a card that has no recording**: a delay answers from the recording afterwards (a miss if there is none); a hang never reaches the lookup.
- **Never loosen an assertion because the fake is fast.** The seller-account wait is made likelier with a held profile read, not asserted; both orders stay legal (R2).
- **A 501 `x-nb-fake: unrecorded` red is a recorder run, never a spec change.** Read the miss list first.
- A spec that makes a request nobody recorded needs the recorder run in the same PR; prefer a fixture that leaves out few cards.
