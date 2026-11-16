---
name: read-only-by-construction-guard
description: How to make a route that reads a real seller account provably read-only - wrap the transport once, scan source for bypasses with per-function scopes, prove the scan with plants, check every stub call in a root afterEach
metadata:
  type: reference
---

A source-scan guard alone ("egress only inside probeGet/tokenGrant") is easy to
slip past: `ctx.fetchImpl.call(...)`, `Reflect.apply`, a lowercase
`method: "delete"` (fetch upper-cases it), an alias (`const f = deps.fetchImpl`),
or egress in an imported module. The pattern that holds (NEO-555 `/probe/ebay`):

- **Wrap the raw transport once** and put only the wrapper in the context. The
  wrapper allows an exact-string URL set for GET (built by the same helper the
  caller uses, with the clock fixed per run so date-window queries agree) and a
  form-body check for the one POST. Exact `"GET"`/`"POST"` only; string input
  only (a Request/URL object carries its own method/body); force
  `redirect: "error"`; freeze the wrapper.
- **Scan with per-pattern function scopes**: a write-method literal (regex `gi`)
  allowed only where a POST belongs, not in the GET helper. Forbid
  `.call/.apply/.bind` on fetch-ish names, `Reflect.apply`, `globalThis[`,
  `require(`, `import(`; pin the static import list; assert the raw transport
  is read exactly once and passed only to the wrapper.
- **Prove the scan**: run it over the real source plus planted snippets
  (string-inserted after a known anchor); each plant must yield a violation.
- **Cover every route test, not the happy path**: stubs register themselves;
  a top-level `afterEach` from `node:test` drains and checks every recorded
  call. Verified: a root `afterEach` does run for tests nested in `describe`.
  Add an `after` that asserts the hook checked a minimum count, so the
  coverage cannot silently vanish.
- **Bound every `while (!flag)` wait in a test.** A planted break that stops
  the route before the awaited point turns an unbounded loop into a suite
  hang, not a red. macOS has no `timeout` binary for a wrapper.

Related: [[adapter-error-string-is-body-and-classifier]].
