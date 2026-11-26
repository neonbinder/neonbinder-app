---
name: neo426-teamless-sport-test-patterns
description: NEO-426 teamless-sport default tests - call commitCardChecklistChunk directly, t.run return values must be null not undefined, cross-sport default players are dropped, module-registry probe for an internal query
metadata:
  type: reference
---

- Test the commit stamp through `internal.selectorOptions.commitCardChecklistChunk` with resolved `playerIds` (like cardPlayerDefaults.creation.test.ts); `existingId` + `applyFields` + `baseVersion` (= row.lastUpdated) drives the re-sync branch.
- `t.run` results must be Convex values: map `undefined` to `null` before returning (a probe returning `[undefined]` throws).
- A leaf default player from ANOTHER sport is dropped by `effectiveCardPlayerDefaults`, so the card is born playerless; do not assert it carries that player.
- To prove an internal query is never called, copy the module registry and swap one export's `_handler` (Object.assign(() => undefined, fn, { _handler })), record args.
- Planted-break: `if (!sport) return undefined` -> `continue` in sportDefaultNoTeam goes red in 6 tests; `pendingPlayerNameCount: 0` in the chunk insert goes red in exactly one. Hash-guard the restore.
- `verify-test-completeness.mjs` only passes after a FULL vitest run; a partial run lists hundreds as "no result".
