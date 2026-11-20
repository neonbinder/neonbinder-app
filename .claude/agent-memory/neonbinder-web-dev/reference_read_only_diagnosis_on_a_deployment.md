---
name: reference_read_only_diagnosis_on_a_deployment
description: How to inspect a deployment's rows read-only without pushing code - convex data caps at 8192 per call, internal queries run without identity, uncommitted cards live in checklistCandidates
metadata:
  type: reference
---

Diagnosing "why did the gate not pick X" on a worktree's deployment without a push:

- `npx convex data <table> --limit N --format jsonLines` caps at 8192 per call; a bigger table needs `--order asc` and `--order desc` merged (`sort -u`) and still may miss the middle. Run it with `unset CONVEX_DEPLOYMENT` in the subshell so `.env.local` picks the target.
- It cannot filter. Dump to the scratchpad and filter with `python3 -I`/grep; never print ids or names into a public file.
- `npx convex run <internal fn> '{json}'` runs internal functions with no identity: `players:resolveNameForReview` replays the review gate's player answer for a name, year and printed teams. Public admin queries (`selectorOptions:getCardChecklist`) refuse with "Not authenticated".
- While the entity-review wizard is open the set's cards are NOT in `cardChecklist`; the fetched cards are in `checklistCandidates` (by `selectorOptionId`, `players`, `teams`, `cardNumber`), and the batch is `entityReviewQueue` (one row per name, `enrichment.existingCandidates`).

**How to apply:** start from these three tables and the replay query before reading gate code.
