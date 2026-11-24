---
name: NEO-645 tidy ported tests
description: How batch-wizard tests were ported to per-card Tidy Up storage; shared fixture, walk-driven creates, bulk removal of retired tests
metadata:
  type: reference
---

- Shared fixtures live in `lib/testing/tidy-ported.ts` (not convex/, so never deployed): seedLeaf, makeCard, seedUnansweredName, commit, readCards, allOf, seedTeam.
- Porting recipe: insert a `ready` unanswered `tidyNames` row, run `commitCardChecklist` (it only links and stamps pending names), then drive the walk: `tidyNames.createPlayer`, `teams.findOrCreate` + `answerName linkTeam`, `players.addStint`. Fan-out to other cards needs `drainScheduled`.
- Auto-links: write them with `internal.tidyNames.upsertFromGatePage` (answer `by:"auto"` + `autoReason`); Change = `answerName {clear}`, which keeps the old pick as `enrichment.preselect`.
- A fixture with two same-name players in the set's sport stops the commit from silently linking, which a cross-sport/offered-candidate test needs.
- Removing many failing tests from old files: get names from `vitest --reporter=json`, delete each `test(` block by paren balancing (skip strings/template literals), then drop describes left with no test. Vitest errors "No test found in suite" on empty describes.
- Budget-boundary fixture: gate upsert costs about 2 ops per plain name, so `ceil(GATE_UPSERT_OPS/2)+25` names exceed one page.
- A `test.fails` BUG test flips to an unexpected pass once the builder fixes it; flip and delete the comment.
