---
name: neo611-roster-players-tests
description: NEO-611 upsertPlayers/previewPlayers test recipe - epoch helper, budget fixture, source pin
metadata:
  type: reference
---

- Load epoch (`loadStartedAt`): take it AFTER seeding and BEFORE the first call, with a 5ms sleep each side; `_creationTime` ordering then decides "created this run". Same epoch across calls simulates a resume; a new epoch simulates a rerun.
- Op-budget fixture: adopts cost ~5 ops/row and never reach 900 in 100 rows; use 100 CREATES with 12 aliases each (unique names, so no twin or fragment clash).
- Held adopt writes nothing: assert `lastUpdated` unchanged, no `playerAliases`, no `teamYears`, plus empty `_scheduled_functions` and `playerSports`.
- Source pin (bulkLoad.test.ts): regex `export const X = internalMutation(` slices to the next export and requires `assertBulkLoadArmed(`; previews must not call it.
- Seeding `playerAliases` directly in a test is fine (the alias pin scans non-test sources only).
