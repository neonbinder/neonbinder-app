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
- Match Cards number picker (names-first pairs). DISAGREE: row `listitem` filtered by page-rooted
  `group "Number conflict on #<rule's pick>"`, warning "Sources disagree on the number. We picked
  one; check the card back.", radiogroup `Number for #<pick>`, radios `<#N|NNO> — use this number for
  #<pick>`, and the checklist-only number reads `<#N|NNO> · your checklist — use …`. AGREE (95 vs
  95a): quiet, `Number #95a` text + button `Change number for #95a` (aria-expanded); opened it is
  `group "Number choice on #95a"`, no warning. Keeping-shelf scope is `#38b (Keeping, BSC|SL)`. The
  scope keeps the rule's pick after an operator pick; the title becomes `Edit name for #<picked> …`.
  The % shows once: exact `"90%"` count 1 plus sr-only `"Name match 90%"` count 1 (the sr-only
  words carry the same shown % as the amber).
- Hand links (NEO-591, 80d9c935): linking a row to an unmatched card moves BOTH into Matched (no %,
  no "Linked to" line, no row-side Unlink); the chip `Unlink card … from checklist row …` is the only
  undo and sends them back ("Moved back to BSC only and Checklist only."). Keeping is an h3 toggle
  `▼ Keeping (n)` under Matched: match it unanchored (`name: "Keeping (n)"`), never `/^Keeping/`.
  Kept rows are Matched-style: `Edit name for #X …` / `Edit name for checklist row #X … · <variation>`,
  a tag (`BSC`, `SL`, `Checklist row`), Remove names unchanged. A split pair's BSC half holding a
  checklist link is KEPT, not sent to BSC only.
- Stem link chip: `Checklist: #9 · all versions`, no %, no picker. Shared-row Unlink announces in a
  `status` without id; one-marketplace card focus lands on its Keeping title `Edit name for #9b <name>`.
- A sibling row (`95b (Photo Variation)`) is pre-kept on Keeping as the row
  `Edit name for checklist row #95b <player> · Photo Variation` (its Remove name keeps the team
  line, no variation); after save the list sub-line reads
  `Variation of #95a · … · Photo Variation`. A drawer with a linked parent shows `#95a <name>` +
  `Clear variation parent`, not the number textbox.

Related: [[reference_neo591_prospect_and_onyx_specs]], [[patterns_checklist_is_a_match_cards_source]]
