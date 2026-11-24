---
name: patterns-iterate-fresh-only-on-a-no-reset-deployment
description: Running a fresh-only new-player spec several times on a deployment you may not reset (e2e-run's setup trap, swapping names, catalogue probes, stint-form list quirk)
metadata:
  type: feedback
---

When the coordinator says the worktree deployment holds data and must not be reset:

- **Do not use `e2e-run.mjs run` on a deployment it did not seed.** It runs `setup` first
  ("not seeded by e2e-run"), and setup signs in through `/testing/reset`, which wipes test
  user 0's own rows and fake-BSC account, then reds on a non-empty catalogue anyway. Use the
  plain `npx playwright test --project=e2e|e2e-mobile --no-deps --retries=0` with the
  coordinator's env, and plant by hand (exact-string edit, run, exact-string restore; never
  a whole-file copy while another builder edits the same product file).
- **Each run spends the spec's fixed real names** (players created on the walk). Iterate with a
  throwaway wrapper that swaps the names in the spec for unused recorded Baseball no-matches
  (`recorded-names.ts` pool entries at indexes 9-11, unused by CI workers 0-7 and local 8), runs,
  then restores the file. Keep the committed names fresh for CI.
- **A recorded no-match can still be a catalogue player** (one was, and the card linked silently)
  or share a name with another sport's player ("Add as new player anyway"). Handle the
  "anyway" branch in the spec; probe catalogue absence by a run (the card stays a pending
  name), not by grepping `npx convex data players` (it caps at 8000 rows per order, and
  `nameNormalized` sorts the tokens: "carlos gamboa juan").
- **CareerTeamEntry shows no suggestion list when the box holds a team's whole name**
  (exact match). To assert an option's name, type part of it ("Seattle Mar").

**Why:** `e2e-run.mjs run` runs `setup`, which resets test user 0's rows on the target
deployment; and every red run of a fresh-only spec uses up its names. **How to apply:** any fresh-only walk spec on a shared or no-reset deployment.
Related: [[patterns_e2e_run_tool_in_practice]], [[patterns_rerun_a_fresh_only_spec_without_a_reseed]].
