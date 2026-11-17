---
name: retiring-a-features-key
description: Every choke point that writes or copies a `features` record key (selectorOptions and cardChecklist) — a key moved to a typed field must leave all of them or it comes back
metadata:
  type: reference
---

`features` is a string→string record copied at creation and by armed
backfills. Moving a key to a typed field (NEO-569: `league` → `leagueIds` /
`leagueId`) needs it removed from every place that MINTS or COPIES it, not just
the readers, or a later run silently re-adds what the strip phase removed:

- own-level derivation: `features/deriveCardFeatures.ts` (`deriveOwnLevelFeatures`,
  the per-level key table, e.g. `sport: ["league"]`, and constants like
  `SPORT_TO_LEAGUE`);
- node copy-down: `inheritableFeatures` (same file; `NODE_ONLY_FEATURE_KEYS`
  is the existing drop list) at every node insert;
- card birth merge: `mergeCardFeatures` (used by `cardRowCreate` and
  `features/listingInputs.ts`);
- the edit doors: `refuseKeyWithItsOwnDoor` in selectorOptions.ts guards
  `setSelectorOptionFeature` / `setCardFeature`;
- `features/expectedFeatures.ts` (panel field list);
- **the armed `backfillCardFeatures.ts` seed list** (it seeds keys at the
  setName node; re-running it after a strip re-adds the key). Easy to miss.

Readers: grep `features?.<key>` and `features.<key>`; add a pin test that only
the migration module reads the legacy key. Sport rows are reference-seed
(only `level == "sport"` rows ship in the bundle), so a strip phase leaves
them alone; the key there is inert once derivation and copy-down drop it.
Related: [[derived-card-field-from-entity-fact]].
