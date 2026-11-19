---
name: neo487-bsc-lane-wait-test-patterns
description: PR 451 (NEO-487) test recipes: stop-rule/wait-edge test layout and a safe mutation runner for a shared worktree
metadata:
  type: reference
---

- Stop rules of `fetchBscCardTeamNames` are tested through the real action with a `fetch` stub; a wave is 10 cards (adapter-private constant). The `marketplaceCooldowns` table and `resetMarketplaceCooldownsBatch` were removed (NEO-552 follow-up), so the cooldown half of this recipe (a cooldown opened "mid lookup" by a `t.run` insert from inside the fetch stub) no longer applies; check the current stop rules in the adapter before reusing it.
- Chunk-loop stop in `fetchCardChecklist`: copy teamsSettled's module mock, add the `skipped` field; chunk is 50.
- Recorder wait edges: fake timers, `now: Date.now`, `waitIdleGraceMs`; pure, no convex-test. `ProgressLedger` writes are chained and send the ledger as it stands when they RUN, so assert after a macrotask, not after `finishWaits` (which closes the wait first).
- `parseRetryAfterMs("-5" | "1.5")` falls through to Date.parse and returns 0, not undefined (harmless: nextCooldown ignores 0).
- Mutation runner for a worktree other agents edit: replace one unique string, run vitest, restore by reverse-replacing the mutant text on the CURRENT file (never write back a stale snapshot); use a non-empty marker for deletions; compare shasums before/after.
