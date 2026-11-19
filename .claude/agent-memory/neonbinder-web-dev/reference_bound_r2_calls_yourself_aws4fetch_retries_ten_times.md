---
name: bound-r2-calls-yourself-aws4fetch-retries-ten-times
description: aws4fetch's client.fetch retries 5xx/429 up to 10 times with sleeps a signal cannot cut short; bound a timeboxed R2 call by signing and fetching yourself with an AbortController timer
metadata:
  type: reference
---

`new AwsClient({...})` defaults to `retries: 10` and sleeps `random * 50ms * 2^i`
between tries (up to ~25 s) on a plain `setTimeout` an `AbortSignal` cannot
interrupt, so `signal: AbortSignal.timeout(n)` passed to `client.fetch` does not
bound the call when R2 answers 5xx or 429 (a 30 s `finishUpload` HEAD in CI fits
this as well as a true hang).

For a call inside a UX budget (`headObject` / `deleteObject` in
`convex/lib/r2.ts`, NEO-592): `await fetch(await client.sign(url, { method, signal }))`
yourself, one `AbortController` plus `setTimeout` per try (not
`AbortSignal.timeout`: fake timers drive it, and `clearTimeout` in `finally`
leaves no timer to leak into the next test), retry once on a timeout or
5xx/429, return the last response so the caller's `R2 <method> failed: <status>`
is unchanged, and throw `R2 <method> failed: timed out` when no try answered.
Detect the timeout with your own `timedOut` flag, not the error's shape.

Test with fake timers: the timer is armed before signing (real async crypto), so
wait for `vi.getTimerCount() === 1` (`vi.waitFor`) and then
`advanceTimersByTimeAsync(limit)` once per try; a hanging stub must reject at
once when `request.signal.aborted` is already true, as a real fetch does.
`putObject` still goes through `client.fetch` (its own `AbortSignal.timeout`).
