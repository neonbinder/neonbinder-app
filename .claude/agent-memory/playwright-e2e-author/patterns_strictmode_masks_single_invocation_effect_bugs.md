---
name: strictmode-masks-single-invocation-effect-bugs
description: Local Vite dev runs React StrictMode (effects run twice on mount); CI runs a production build (once). A red that only CI shows, where an effect's write gets undone, is often this
metadata:
  type: feedback
---

A spec that is green on local Vite and red in CI, with the page stuck in an
"in between" state (NEO-645: the Tidy Up walk read "Finding the next card." for
good), can be a URL or state write that one effect makes and a LATER effect in
the same flush undoes. In dev, StrictMode runs a newly mounted component's
effects a second time, after the whole flush, so the first write is made again
and wins. The CI preview is a production build: one run, and the undone write
stays undone.

**Why:** NEO-645 seed red. The walk's `first` → card `replace` (child effect)
was undone by `useDrillUrlState`'s canonicalising effect (an ancestor, so its
effect runs after the child's). That effect rebuilt the query string from the
params it had rendered, and `serializeDrillPath` moves non-drill params to the
front, so every walk open caused a reorder write. The walk's resolve effect only
re-runs when its deps change, so it never ran again unless the head card moved.

**How to apply:**
- Read `client-wire.log` (it is in the blob report zip's resources, and as a
  body in results.json): a NAVIGATED pair 1 ms apart, with no subscription to the
  query the next state would need (here `tidyCards:cardContext`), points to a
  write that was overwritten.
- Prove it with a vitest that renders the real hooks WITHOUT `<StrictMode>`
  (mock `convex/react` `useQuery`). Add a StrictMode copy to show that it hides
  the bug. A test that wraps in StrictMode passes vacuously.
- A local browser repro needs a production build (`vite build` + `vite
  preview`). A dev-server run is green by construction.
- Related: [[patterns-local-run-backend-and-vite]], [[patterns-sibling-edits-reload-a-local-vite-run]].
