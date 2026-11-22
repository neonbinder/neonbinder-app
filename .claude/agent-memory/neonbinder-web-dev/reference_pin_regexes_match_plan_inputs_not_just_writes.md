---
name: reference_pin_regexes_match_plan_inputs_not_just_writes
description: Source-slice pin tests that grep for `playerIds:` flag any object key of that name, including a pure planner's input; name planner input keys differently
metadata:
  type: reference
---

`cardChecklist.playerLinksPin.test.ts` flags every line starting `playerIds:`
in selectorOptions.ts that has no `playerLinks` within 60 lines, so a planner
input literal (`{ index, playerIds: card.playerIds }`) or a parameter
(`playerIds: ReadonlyArray<...>`) trips it. Name such keys differently
(`players`, `careerPlayers`) rather than loosening the pin.

Likewise the printed-names pin lists every file that writes a card's pending
names and requires each to reach `syncCardPrintedNames`; a new writer joins
that list in the same PR.
