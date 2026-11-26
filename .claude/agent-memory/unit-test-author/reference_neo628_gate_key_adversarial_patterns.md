---
name: neo-628-gate-key-adversarial-patterns
description: Per-domain BSC call gate adversarial recipes: fake acquire writes no row, vacuous source-scan trap, test.fails for known latent gaps, break-check by sed + cp restore
metadata:
  type: reference
---

- On the fake a plain `acquire` writes NO row (no bucket); to create a gate row in a fixture use
  `recordOutcome` with outcome "failure" (or open429). Row-count asserts on acquire alone pass vacuously.
- "No public function declares X" scan: `import.meta.glob([...globs, "!./**/*.test.ts"], {query:"?raw", import:"default", eager:true})`.
  A negated single-pattern glob matched nothing; list positive globs then negations. Always add a
  control assertion that the scan finds the known internal declarations, and match the validator
  (`queuedBy\s*:\s*v\.`) not the bare word, since public actions legitimately pass it on.
- A real but unreachable gap goes in as `test.fails("KNOWN GAP: ...")` so the gate stays green and
  goes red the day it is fixed; say so in the report.
- Break-check product code: `cp` to the scratchpad, `sed -i ''` the mutation, run, `cp` back, `git diff --stat` to prove restore.
- Lane ladder: drive `runBscTeamLane(t, lane, 1)` in a loop reading `lane[0].item` each pass to assert a field survives every re-enqueue.
