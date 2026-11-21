---
name: patterns_find_a_duplicate_key_owner_with_captureownerstack
description: A green run's Vite log shows React "Encountered two children with the same key" with no component stack; patch a HEAD snapshot's main.tsx to log React's captureOwnerStack() and read which element collides
metadata:
  type: patterns
---

Vite 8 forwards the client console to its log, so a green run can still log
React's "Encountered two children with the same key, `<id>`". Neither the Vite
log nor a trace's console event carries a component stack (React 19 puts it in
`console.createTask`, not the arguments). The key alone (a Convex id) does not
tell you the table either: id prefixes do not map cleanly to tables.

Find the owner in the HEAD snapshot only ([[probe-vite-from-a-head-snapshot]]),
never in the worktree:

1. Bucket the log lines by minute and match them to specs by working backwards
   from the run's end with the list reporter's durations; pick the shortest
   re-runnable spec (minted tokens) inside a burst.
2. To find the action, run that spec with `--trace=on` (output in the scratchpad),
   unzip, and line up `console` events containing "same key" against the nearest
   `before` actions in `*.trace`. Delete the trace afterwards: it holds Clerk tokens.
3. To find the component: in the snapshot's `src/main.tsx`, after the first import,
   wrap `console.error` so a "same key" message is followed by
   `"OWNERSTACK " + captureOwnerStack()` (import `captureOwnerStack` from `react`;
   flatten newlines). Restart Vite (hmr is off), rerun the spec, grep the log.
4. Read the top frame `at <Owner> (<served file>:<line>:<col>)` against the SERVED
   file (`curl http://localhost:<port>/<path>.tsx | awk 'NR==<line>'`), not the
   source: the line is the `_jsxDEV(<Component>` call that created the COLLIDING
   element. So the duplicate is that element and a sibling in the same children
   array, not a list inside it.

Seen on NEO-591 after the NEO-602 merge: the team step rendered `TeamStepContext`
and `TeamMatchSearch` as siblings in one fragment, both `key={current._id}`
([[sibling-keyed-on-the-same-row-id-is-a-key-collision]]). Report it as a product
finding. Specs stay green, so do not touch a spec for it.
