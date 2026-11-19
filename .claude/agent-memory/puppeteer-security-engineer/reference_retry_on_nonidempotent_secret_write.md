---
name: retry-on-nonidempotent-secret-write
description: Retrying a Secret Manager addSecretVersion on UNAVAILABLE can duplicate a version; the keep-one prune must go two back after a retried add. DEADLINE_EXCEEDED is not retried.
metadata:
  type: reference
---

UNAVAILABLE (gRPC 14) does not prove the call did not execute: the connection can drop after the server committed. Reads, updateSecret(expire_time) and destroySecretVersion are safe to replay; addSecretVersion is not.

- The shared wrapper (`withQuotaRetry`) retries UNAVAILABLE once (jittered ~200 ms) and reports it through an optional `RetryOutcome` flag, so `updateCredentials` can prune N-1 AND N-2 when the add was retried. Pruning only N-1 would leave the first duplicate plus the pre-write version live. N-2 already destroyed is a tolerated no-op (FAILED_PRECONDITION / NOT_FOUND).
- DEADLINE_EXCEEDED is not retried anywhere: the deadline is already spent (a retry doubles the wait against a ~7 s UX budget) and a write has very likely landed.
- Retry budgets are per-code and independent (quota x2, unavailable x1).

Related: [[reference-secret-manager-has-no-upsert]], [[project-secret-version-keep-one]].
