---
name: fake-target-environment-label
description: a fake marketplace target labelled with a real environment name ("production") silently passes environment-echo mismatch guards and every check keyed on that label
metadata:
  type: project
---

When a test double (fake eBay, fake BSC) is wired in by giving its config a real
environment label ("production", so it behaves like the production API), every
check keyed on `environment === "production"` now matches the fake too, and any
response that echoes the label back to Convex (the eBay connect answer's
`environment`, which Convex compares to its own config to catch cross-wired
sessions) reports the fake session as production.

**Why:** NEO-555 B1 did exactly this; the browser side patched the one known
check (`seed_in_production`, `&& !config.fake`), but the echo to Convex still
said "production", leaving the cross-wiring guard blind to fake-vs-real.

**How to apply:** on any fake-target diff, grep every consumer of the label
(both sides of the boundary) and ask: does the value that crosses the boundary
say "fake"? Prefer reporting the truth outward (`"fake"` or an added
`target: "fake"`) so an older or mis-configured peer fails closed on mismatch.
Related: [[neo552-fake-upstream-and-recorder]].
