---
name: patterns-rule-out-walk-and-source-side
description: NEO-645 walk helpers for specs that rule names out (Not a player / Not a team) and take one source's side of a disagreement; reading the Checklist column's value as the button name
metadata:
  type: feedback
---

For a spec whose old wizard loop pressed "Skip <name> — not a person" / "not a team" on every name:

- `ruleOutOpenPlayerRows(page, { keep })` / `ruleOutOpenTeamRows(page)` in `support/tidy-walk.ts`
  answer each open row "Not a player …" / "Not a team" and return the printed names. Always pass
  `keep` with the catalogue player the spec relies on: one wrong press reaches EVERY card that
  prints the name.
- `takeSourceSide(page, "Checklist")`: the button is `Use “<value>”`, and the value is the
  "What each source says: <Field>" listitem's textContent minus its leading source label and a
  trailing "In NeonBinder" (spans join with no space). An empty side is `Use no player` / `Use no team`.
  Read the status off the whole tile, not `pinkTile`: the filter stops matching on the last pick.
- After a pick, wait for "Looks up once the spelling is picked" / "Waiting on the spelling above"
  to go before reading Player rows, or the card reads empty and gets skipped pink.
- A per-card loop keyed on the card number (`tidyCardIdentity` line 0) can put the old wizard's
  per-step asserts on the card they belong to (e.g. #1 asks for a team after its high school is
  ruled out). Record skips with their pink tiles and, before a parallel build, assert no card was
  skipped at all after the end screen (NEO-661: any pink holds the build, not only names).
- A read-only data check after a fresh-only green: `npx convex data tidyNames|cardChecklist
  --limit 8000 --format jsonl` (limit must stay at or under the server cap) proves which branch ran.

**Why:** NEO-645 every-card-player/cameo rewrites, 2026-11-22. **How to apply:** any rewrite of a
"rule names out" wizard spec. Related: [[patterns_tidy_walk_tiles_and_commit_first]].
