---
name: patterns-checklist-total-and-lib-plants-reaching-convex
description: Read a set's card total (0 or N) through the search line's "N of M cards" instead of counting virtualized rows; a lib/ plant reaches the server only when a convex/ file is also touched
metadata:
  type: feedback
---

- **Card total of a checklist, order-independent.** The card list is a Virtuoso (only the
  rows in view plus overscan exist), so counting `Edit card` buttons is unreliable. Wait on
  `empty.or(searchbox "Search cards")`; empty line = 0, else fill the searchbox with any
  query and read M from the status inside `role=search` (`/^[0-9]+ of [0-9]+ cards?$/`),
  then clear it and wait for the line to go. Use it when a reader shares a set with a writer
  that may have committed it first (shard order): read before, prove unchanged after Cancel.
- **A `plant` in `lib/` that the server also runs is not pushed.** `e2e-run plant` pushes
  Convex only when a planted path is under `convex/`; a lib/ break otherwise reaches only
  Vite, and a server-side re-cleanse hides it (STAYED GREEN). Add a comment-only edit to a
  convex/ file in the same `--edit` list to force the push; the tool re-pushes on restore.
- Read a measured value from a green path by planting the spec's own assert
  (`toBe(x)` -> `toBe(x + 1000)`) with `--expect` on its message: Received shows x.

**Why:** NEO-645 junk-name reader on the Stars of MLB Network set (2026-11-22).
**How to apply:** any reader on a set a sibling commits; any plant in shared lib/ code.
Related: [[patterns_e2e_run_tool_in_practice]], [[reference_planted_break_on_convex_code]].
