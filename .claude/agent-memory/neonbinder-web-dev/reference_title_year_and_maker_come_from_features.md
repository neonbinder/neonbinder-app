---
name: reference-title-year-and-maker-come-from-features
description: A generated listing title reads its year and maker from merged features (season, manufacturer), never from the year/manufacturer selector rows, so a convex-test tree without them builds silently shorter titles
metadata:
  type: reference
---

`listingInputsForCard` takes `year` from `mergedFeatures.season` and
`manufacturer` from `mergedFeatures.manufacturer`. The year and manufacturer
selector rows in a convex-test tree contribute nothing to the title. A fixture
that seeds sport → year → setName rows but no `features: { season, manufacturer }`
gets titles like "Topps Chrome Anime …" with no year. Those titles are about 5
characters shorter, so every test pinned at a length boundary (80 vs 81, a
first name kept or lost) quietly tests a different case.

**How to apply:** in any convex-test fixture whose assertions depend on title
length, put `season` and `manufacturer` in the features of the source row, the
target row (insert or parallel) and each source card. Before you trust a
boundary, print or assert one full title. The NEO-535 build-title tests seed
them through a shared `SET_FACTS`. Pure tests that build `ListingCardInputs`
by hand pass `year`/`manufacturer` directly and are unaffected.

Related: [[reference-bulkload-budget-tests-pin-exact-ops]] (another fixture
detail that silently changes what a test proves).
