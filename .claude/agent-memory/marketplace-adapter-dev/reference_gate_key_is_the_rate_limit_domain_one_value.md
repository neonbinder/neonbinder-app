---
name: gate-key-is-the-rate-limit-domain-one-value
description: BSC call gate keyed per rate-limit domain (real = one key, fake = one per namespace); derive key and x-nb-fake-ns from ONE helper, move shared pure helpers to lib to avoid import cycles
metadata:
  type: reference
---

A per-domain limiter keyed on the same identity the wire request carries must
get BOTH from one helper (`bscCallDomainFor(userId)` returns `{gateKey, fakeNs}`),
never two derivations at each call site: a site that gates on one namespace and
sends another silently brings cross-user refusals back.

- Token-bearing calls: the key is the token OWNER's domain (current user, or
  the seller session's `ownerId`). Background lanes with no identity must carry
  the queuing operator on the item (`queuedBy`, an argument, optional so
  in-flight items fall back), and a per-namespace block must DEFER, never sleep
  in the shared single slot; only the one shared key may be waited out.
- Validate a stored key string in ONE helper called by every read, insert and
  delete of the row (fail closed), and gate the per-namespace form on the
  deployment actually being in fake mode. Widened column = `v.string()`.
- Import cycle trap: `testing.ts` reaches the listing drainer, which reaches
  `bscSeller`, which reaches the gate. Put shared pure derivations
  (`fakeBscNamespaceFor`) in `lib/` and re-export from `testing.ts`.
- Fake mode has no token bucket, so a healthy `acquire` writes no row: tests
  that need a row open a 429 window first. `open429` style helpers that assert
  exactly one row must run before other keys' rows exist.
- A `vi.mock("./credentials", async (importOriginal) => ...)` factory can be
  bypassed when two importers load it at once: add a top-level
  `await import("./credentials");` right after the mock block.
