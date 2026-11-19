---
name: neo604-retried-secret-add
description: Auditing a retry on a non-idempotent Secret Manager add (UNAVAILABLE) and its widened keep-one prune; the invariant to check is "destroy only ordinals below the created one".
metadata:
  type: project
---

NEO-604 (2026-11-18): `withQuotaRetry` retries gRPC UNAVAILABLE once; a retried
`addSecretVersion` flags `RetryOutcome` and the keep-one prune goes N-1 and N-2.

The check that settles "could the wider prune destroy the wrong version": every
writer destroys only ordinals strictly below its own created ordinal, and the
latest is >= every writer's created ordinal, so no interleaving destroys the
latest. A concurrent writer's version at N-1 can be destroyed, but it is
already shadowed by the newer created one (same as last-writer-wins).

Residuals (hygiene, not exposure): with 2+ interleaved writers the first-attempt
duplicate can sit below N-2 and stay live; a retry that also fails leaves a
committed first attempt unpruned. Both leave a stale credential copy live until
a `clear` deletes the secret.

Other `withQuotaRetry` callers are reads, `updateSecret(expire_time)` and
`destroySecretVersion` (replay -> FAILED_PRECONDITION, swallowed): all replay-safe.
`createSecret`/`deleteSecret` are not wrapped. Re-grep callers on any change.

Related: [[patterns_credential_atomicity_neo89]], [[patterns_neo141_credential_rework]].
