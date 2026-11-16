---
name: neo555-probe-capture-adversarial
description: NEO-555 eBay probe/prod-capture adversarial patterns - shallow-freeze trap, signal guard, body-read leak, break-check by reverting fixes
metadata:
  type: reference
---

- `Object.freeze({...e, query: Object.freeze(...)})` leaves object-valued query entries writable; assert `Object.isFrozen` on nested values, and that writes throw TypeError (ESM tests are strict).
- A `finally` does not run on SIGINT/SIGTERM/SIGHUP: a run that must clean up (prod capture) installs no-op handlers around itself; test with `process.listenerCount` inside a stub route and `process.emit("SIGINT")`.
- Reduce errors at the fetch boundary INCLUDING the body read (`await res.arrayBuffer()` inside the same try), else a raw error message reaches `report`.
- Hostile refresh-token strings: assert on parsed `URLSearchParams` keys, not `includes("authorization_code")` (the encoded token contains the literal).
- express.json strict rejects a bare JSON string body with an HTML 400; real-mode body-ignored tests use arrays/objects only.
- Break-check: never `git checkout --` in a shared worktree (other agents' live edits). Copy the file aside, plant the break by editing a copy in place, rebuild (tests run on dist), run, restore from the copy byte-exact (compare sha256), rebuild.
- Fake eBay: user tokens name the namespace; `x-nb-fake-ns` is ignored when a live user token is present (faults, state, misses).
