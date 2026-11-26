---
name: names-first-core-makes-a-name-pair-at-1-clean
description: After NEO-591 a BSC-SL pair the core makes by "name" at confidence 1 is clean (same roster, numbers agree); the skip predicate reads confidence + sourceNumbers, not pairedBy === "name"
metadata:
  type: reference
---

`pairNamesFirst` scores a pair by what the sources agree on: same roster with agreeing numbers is 1, numbers differing or one missing 0.9, a near name its score (times 0.9 when numbers differ). Most real BSC-SL pairs are therefore `by: "name"` at 1. A predicate that treats `pairedBy === "name"` as a guess opens Match Cards on nearly every run.

**How to apply:** `matchCardsNeeded` (components/SetSelector/match-cards-needed.ts) opens on `!isFullConfidence(confidence)`, on `sourceNumbers`/`numberMinted` (the number picker is on the row, rule 7: an automatic number choice is never final), or on a matched row with no `pairedBy` (written before the field). Do not add a second "numbers didn't match" field: `sourceNumbers` plus the 0.9 are rule 7's note, and main's modal already draws "Numbers differ" and the picker.

Stamp `pairedBy` from the core's `by` ("number" stays "number", "name" and "nearName" read "name") plus the identity lookups ("stored", "crossRef", "variation"); keep the identity lookups as a table of [fn, via].

Main's `fetchCardChecklist.namesFirst.test.ts` pins "a repeated number only blocks number-keyed pairing: an exactly-one name still pairs", which contradicts the wrapper CLAUDE.md D2 bullet (a duplicated number sits out the name match). Ask the coordinator which wins before re-adding a duplicate-number pre-filter; it would also need no-number (NNO/blank) cards excluded or every unnumbered set becomes one tie.

Related: [[reference_new_candidate_field_needs_three_client_hand_copies]].
