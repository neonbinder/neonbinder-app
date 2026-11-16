---
name: convex-logs-replay-a-tester-report
description: Before trusting a tester's step order for a "nothing shows" bug, replay it from `npx convex logs --history N --success --jsonl` — the mutation list and per-query read counts show what actually ran
metadata:
  type: reference
---

A tester's narrative of a "Find cards / binder shows nothing" bug can be wrong
about what they pressed (NEO-528: "pressed Have, Find cards stayed empty" —
the Have was the NEO-374 locked toggle under scope All, so NO mutation ran and
Find cards was right). Replay it from the worktree's own deployment before
reading code for a cause:

- `npx convex logs --history 1000 --success --jsonl > file &`, then kill it
  after ~25 s (agent shells have no `timeout`; `perl -e 'sleep 25'` works).
- Filter `udfType` Mutation/Action for the real write sequence (addHave vs
  addLineItem vs moveCopy tell you which control was used).
- `usageStats.databaseReadDocuments` of a reactive query that re-ran right
  after a write says what changed: e.g. `binderRules:needs` dropping from ~15
  reads to 6 = every fits row is now `here` (the copy landed IN the binder).
  `cachedResult: true` rows are duplicate subscribers, not new work.
- `npx convex data <table> --format jsonl` is read-only and safe on a
  binder the owner asked you not to touch.

Related: [[reference_convex_mutation_resolves_after_queries_reflect_it]].
