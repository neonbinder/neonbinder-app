---
name: neo556-no-team-adversarial-patterns
description: NEO-556 No Team default adversarial recipes - oracle cartesian for pure verdicts, ?raw source pins in convex tests, client-vs-server agreement via real commit
metadata:
  type: reference
---

- Pure verdict: write an independent oracle from the doc comment and sweep the full cartesian product (blank variants: "", spaces, tab/newline, nbsp, zero-width space).
- Source pins inside convex/** (edge-runtime, no fs): `import.meta.glob([...], {query:"?raw", import:"default", eager:true})`; brace-match the object literal after `insert("selectorOptions",` and require a helper spread; whitelist the code that can CREATE a stamp value.
- Client-vs-server agreement: import the pure client helper (components/SetSelector/teams-on-cards.ts) into a convex test, run one real commitCardChecklist with a matrix of wire cards, assert client "settled" implies server stamped.
- `rawTeamName` only becomes a hint beside teamLookup "answered" AND a BSC ref (settleCardTeamAnswer returns early with no ref) - fixtures must pair them.
- Planted-break loop over copy-down sites: replace the helper CALL on a pinned line with `{}` (python line-indexed, restore from bytes, `git diff --exit-code` per file), full `convex lib` per site (~100s). The ?raw source pin catches a site only if the call text is removed, so a pin-red is not behaviour proof; storeSelectorOptions, ensureBrandUnknownRow, ensureBrandRow and the insert-conversion source-default branch had NO behavioural test until covered (convex/noTeamDefault.copyDown.test.ts + describe.each blocks in setInsertConversion/setParallelConversion tests).
- convertToInsert returns no row id: find the landed row by value under the Insert type. referenceSeed/parse-published-checklist tests time out intermittently under full-suite load (flake, not related).
