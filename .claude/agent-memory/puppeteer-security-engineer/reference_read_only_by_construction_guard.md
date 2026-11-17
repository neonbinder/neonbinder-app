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
- **Allowlist header names too, per request kind**, or an allowlisted GET
  carries `X-HTTP-Method-Override: DELETE`. Accept only a plain object (refuse
  a `Headers` instance, pairs, a foreign prototype), lower-case each name,
  refuse duplicates across case (fetch joins them), and forward a fresh copy
  read once via `Object.entries`, so a getter cannot pass the check and send
  something else. Fake-only caller headers belong only to the fake target's set.
- **Value-free shapes still leak by key presence.** A public shape artifact
  must not report a key whose mere presence answers a private question (eBay
  may omit `orders` on an empty page, `next` exists only past one result):
  report paging keys only, and test with/empty/key-absent answers all equal.
- **Break-check by mutating `dist/`, then rebuild** (tests require `../dist`):
  sed/perl one line of the compiled JS, run the file, restore the `.bak`. No
  `git checkout` needed, and the source-scan tests are untouched by it.
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
