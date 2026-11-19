---
name: patterns_neo592_bounded_r2_get
description: NEO-592 bounded R2 GET (getObjectBytes) — what to re-check when an R2 read is hand-signed instead of going through aws4fetch's client.fetch
metadata:
  type: project
---

`convex/lib/r2.ts` `boundedRequest` signs with `client.sign()` and calls global
`fetch` itself, so aws4fetch's 10-try retry is gone and an AbortController timer
bounds each try. `getObjectBytes` runs the body read INSIDE that timer.

Checks that held (2026-11-18):
- aws4fetch `sign(input, init)` merges `init` into the signed Request, so the
  `signal` survives signing; the unit "hang" stubs only end via that signal, so
  a green r2.test.ts proves it.
- The `r2_get` log line has five pinned keys (msg, attempts, status,
  durationMs, outcome); errors are swallowed to `{kind:"error"}`, never logged
  with a message, so no signed URL / Authorization header can reach logs.
- `getObjectBytes` is a plain lib export, not a registered Convex function: no
  public path.

Residual (note-level): the size cap is a declared-length precheck plus a
post-read `byteLength` check. An absent or non-numeric content-length
(`Number(...)` → NaN/-1) reads the whole body before refusing; bounded only by
the 2.5 s timer and by bucket objects being signed-length PUTs. A streamed
reader that cancels past maxBytes closes it if the bucket ever takes
unsigned-length writes.

Closed by the follow-up: the no/NaN-length path now streams via a reader and
cancels once the running total passes maxBytes. Re-check on any change:
- `boundedRequest` must test `timedOut` BEFORE `instanceof BodyReadError`; an
  abort mid-body surfaces as a wrapped read error. The "two stalled bodies end as
  timeout" test is what pins that order.
- Chunks are per-invocation locals, so a broken first try cannot leak bytes into
  the second; the retry test asserts the exact second-try bytes.
- Residual notes: `status` is not reset between tries (log may show 200 with
  outcome timeout); peak memory is ~2x maxBytes (chunks + concat).

Caller semantics: `defaultFetchPhoto` maps every non-ok kind to null; BSC
re-queues only refresh cards (`later()`), non-refresh sides are re-wanted by the
state-derived `rowNeedsSellerPhoto` next run; eBay sets `complete = false`.
Related: [[patterns_neo592_concurrent_reads]], [[patterns_neo411_retry_generation_and_dispatcher]].
