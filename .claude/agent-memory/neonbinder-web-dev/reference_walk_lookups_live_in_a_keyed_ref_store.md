---
name: walk-lookups-live-in-a-keyed-ref-store
description: Per-sitting lookup results belong in a class store (ref Maps + useSyncExternalStore) keyed by the full request, never in a table, storage or useState; stale responses drop by key
metadata:
  type: reference
---

When a walk or wizard needs an action's result only for the sitting (a lookup, a set's facts), hold it in one
class store provided by context (`tidy/walk-memory.tsx`): ref-backed Maps, `subscribe`/`getVersion` for
`useSyncExternalStore`, never sessionStorage/localStorage.

- Key each request by everything that changes its answer (`cardId|kind|name|sportId`). A response lands under its
  own key, so a stale one is simply never read; no cancel token needed.
- A local chip (sport) changing the key re-runs the lookup; nothing is saved.
- Missing is not a claim: a pending or failed lookup blocks no rule, it only shows "Try again" on error.
- Hold a destructive default (create, lead action) while its lookup is pending; show a status line, not a spinner.
- A live-query hook that must not blink on re-key wraps `useStaleWhileLoading`; expose `ready` so the first card waits.
- Root `tsc -p .` is red at baseline and `npm run typecheck` (convex tsconfig) does NOT cover components/: filter the
  root tsc output to your files, and annotate arrow params inside `useState<Fn>(() => (x) => ...)`.
