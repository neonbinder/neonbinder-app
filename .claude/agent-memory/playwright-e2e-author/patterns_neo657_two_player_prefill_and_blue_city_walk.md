---
name: neo657-two-player-prefill-and-blue-city-walk
description: NEO-657 prefill on a two-player card (fixture names, "/" cells, plant) and the Pro Set City Designation walk after NEO-656 (every card blue, Apply to all, end screen 4 still to check)
metadata:
  type: project
---

Learned 2026-11-24 (NEO-656 merge of NEO-657):

- **Two players / two teams in a pasted checklist:** split the cell on "/" (`1,A / B,Seattle Mariners`).
  On a several-name card the Player row's buttons may carry " <printed>": match
  `^Add as new player( <name>)?$` scoped to the row group `Player <name>`.
- **Prefill on a two-player card** renders a `Career <name>` group per player made on the card, each
  with `New stint for <name>, prefilled from the card`; no gap text (the live gap is one-player only).
  Save & next writes every open form. Two NB teams on the card: no Career tile at all. Plant
  `CareerStintEntry.tsx` `cardTeams.length === 1` -> `>= 1`; `--expect 'name no one team'`.
- **Spare recorded Baseball no-match people are nearly gone.** Only the "CO" coaches (`Bob Humphryes CO`,
  `Carlos Moreno CO`, `Gilberto Marcano CO`) were unused after `tcp`; scan
  `convex/adapters/__fixtures__/enrichment-lookups.json` (kind player, result null, Q5369) against
  `playwright/` before picking. A catalogue player (`Mike Trout`) links by name at commit as a filler.
- **Pro Set Metal walk:** the four 2026 prospects have no career, so every linked City Designation is a
  live blue gap. An answer links the open card only; `applyNameToAll(…"Los Angeles N")` = "Linked 1 more
  card." and the count holds (pink -> blue). Skip all four; end `{ fixed: 0, stillToCheck: 4 }`, pill
  "4 need you". Never branch on `tidyTile("Career").count()` right after a team answer: the gap query
  lands a beat later; assert `toHaveAccessibleDescription("To check")` instead.

Related: [[neo656-tidy-walk-helpers-skip-apply-end-screen]], [[neo656-live-career-mark-and-apply-counts]].
