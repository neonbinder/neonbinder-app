---
name: patterns-checklist-facts-run-the-product-matcher
description: NEO-591 - checklistFacts imports parsePublishedChecklist + matchPublishedChecklist (never restate a pairing rule); ChecklistEdits for in-memory uploads; Match Cards number-picker, one-%, stem and sibling handles
metadata:
  type: feedback
---

Spec arithmetic about a checklist upload comes from the product's own code, imported into
`support/published-checklist.ts`: `checklistFacts(name, { edits?, cardsOf?, cardNumber? })`
runs `parsePublishedChecklist` + `matchPublishedChecklist` (lib/ is pure and importable from
Playwright support; eslint allows it). `nearNamePair(card, row)` calls `pairNamesFirst` with the
matcher's own options for a near-name %.

**Why:** the old helper restated the matcher (equal counts, repeated numbers) and went silently
stale when pairing became names first; specs asserted counts the product no longer produced.

**How to apply:**
- Before switching a facts helper, run old vs new over every `CHECKLISTS` file in a tsx scratch
  script (import the HEAD copy with absolute paths) and explain every DIFF; a diff can be a product
  finding (e.g. the parser strips "SP" from a row's player while BSC keeps it in the card name).
- Edited uploads go through `usePublishersChecklist(page, name, ChecklistEdits)` (teamCells,
  renumber, split with a "(Note)" variation, drop); each key must be on exactly one row (throws).
- A publisher file numbered differently from BSC: `cardsOf` the capture plus a `cardNumber` mapper.
- Match Cards handles (names-first pairs): row `listitem` filtered by page-rooted
  `group "Number conflict on #<rule's pick>"`; radiogroup `Number for #<pick>`; radios
  `<#N|NNO> — use this number for #<pick>`; the scope keeps the rule's pick after an operator pick,
  but the title becomes `Edit name for #<picked> <name>`. The % shows once: exact `"90%"` count 1
  plus sr-only `"Name match 90%"` count 1 (only when the card has sourceNumbers; without them the
  chip's own span reads "Name match NN%" and no bare "NN%" element exists).
- Stem link chip: `Checklist: #9 · all versions`, no %, no picker. Shared-row Unlink announces in a
  `status` without id; one-marketplace card focus lands on `Remove #9b <name> from save list`.
- A sibling row (`95b (Photo Variation)`) is pre-kept on Keeping as `Checklist: #95b <player> · <team>`
  (no variation name shown); read the name back after save from the list sub-line
  `Variation of #95a · … · Photo Variation`. A drawer with a linked parent shows `#95a <name>` +
  `Clear variation parent`, not the number textbox.

Related: [[reference_neo591_prospect_and_onyx_specs]], [[patterns_checklist_is_a_match_cards_source]]
