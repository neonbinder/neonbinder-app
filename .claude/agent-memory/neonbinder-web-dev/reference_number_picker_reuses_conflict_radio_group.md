---
name: number-picker-reuses-conflict-radio-group
description: Match Cards number picker is ConflictRadioGroup made generic over its option key; group name must hold still across a pick, so scope uses the rule's number, not card.cardNumber
metadata:
  type: reference
---

The "pick the card's number" control is the same `ConflictRadioGroup` the name/players pickers use
(generic `<S extends string>`), not a new component. Rules that bit:

- The group's accessible name (`conflictScopeLabels`) must not change when the operator picks, so it is
  keyed on `stableNumberOf` (rule pick from `sourceNumbers`, or the remembered minted number), never on
  the live `card.cardNumber`. The Matched sort uses the same stable number so the row does not jump.
- The card's `cardNumber` IS the picker's state for server pairs; a hand-linked checklist row changes
  nothing until Confirm, so its pick waits in `numberPicks` and `applyChecklistAnswers` applies it.
- A minted single card (number "38b" over printed "38") has no pair to sit in: the picker also renders
  on the Keeping shelf, and the minted number is remembered in `mintedNumbers` so it stays on offer.
- `numberMinted` / `variationGroup` are commit inputs: `committable` must keep them (it strips only the
  dialog's wire-only fields: checklistLink, checklistRowId, sourceNumbers, preKept).
