---
name: card-derived-table-checklist
description: Every place a new table keyed on cardChecklist (or a new cardChecklist field) must be wired, or a pin/strict-returns test or a runtime "extra field" error catches it
metadata:
  type: reference
---

A new table holding `cardChecklistId`, or a new `cardChecklist` field, touches more than schema.ts:

- **Strict whole-row returns:** `selectorOptions.getCardChecklist` lists every cardChecklist field by hand; a field missing there throws `Object contains extra field` for every row carrying it. It was the only such validator as of NEO-528 (re-checked NEO-569, 2026-11-16) (grep `platformData: cardPlatformDataValidator` outside schema.ts to re-check).
- **Card delete:** every catalog card delete goes through `cardRowDelete.removeCardRow`; add the table's delete there and return its ids (the subtree wipe logs them).
- **Subtree wipe:** `wipeVariantTypeSubtree.SUBTREE_REFERENCE_GRAPH` + `WIPED_TABLES`; its test holds the graph against schema.ts.
- **E2E reset:** a `reset<Table>Batch` drain in selectorOptions.ts looped by `runSetBuilderReset` before the cards, plus a `<table>Deleted` counter in the reset return validators; `resetSetBuilderData.test.ts` pins counts.
- **Single writer + pin test:** model on `cardTeamLinks.ts` / `cardTeamLinks.pin.test.ts` (greps for any other insert/delete).
- **Copied cards:** `parallelChecklistBuild` copies base cards through `insertCardRow` with a `carried` bag; decide whether the new data travels.
- Prefer the derived table's `sportId` (the card's sport, stable across `moveCards`) over `selectorOptionId`, as `cardPlayerLinks` does.

Related: [[smart-binder-fits-pattern]]
