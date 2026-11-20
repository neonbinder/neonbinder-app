---
name: listing-inputs-field-threads-through-validators
description: Adding an optional field to ListingCardInputs touches more than the generator - two returns validators, the stored-card cache, and every path that builds inputs; find them by grepping the field's neighbour (cameoNames)
metadata:
  type: reference
---

A new optional field on `ListingCardInputs` (NEO-606 `teamSplits` is the worked example) is not just a generateListing change:

- `previewListingTitle` (selectorOptions.ts) and `parallelCopyTitles.listingInputsValidator` each re-declare the inputs object. A `v.object` returns validator REJECTS an extra field, and convex-test validates returns, so the existing parity tests go red the moment `listingInputsForStoredCard` emits it. Grep `cameoNames: v.optional` to find them.
- Inputs are built in five places that must agree: `listingInputsForStoredCard` (stored/Regenerate), `buildCardRowForInsert` via `CardRowInput` (commit chunk + parallel copies), `addCustomCard`, the client pre-save `titleContext` (`buildTitleContext`) and the dashboard caption. Spread the key only when non-empty (`...(x.length ? { x } : {})`) so toEqual parity between paths holds.
- `StoredCardReadCache.teams` is shared with `parallelChecklistBuild` (`namesOf`), so a second per-team map must be filled by the same reader (`teamNameFor`), not a parallel hand-rolled read.
- Match a per-team datum to `teamNames` by whole-name equality (`teamFullName`), never by index or by taking a name apart: names are filtered, deduped and reordered between the row and the title.

Test fixtures for a cut-loop change: a card whose title minus the thing under test is exactly N characters (`"Q".repeat(N-29)` set name under "2024 Topps ... Shohei Ohtani #17"), then probe N with `npx tsx` against the real generator before writing the expectations. The refill restores more than you expect (a city or a sport comes back into slack), so predict from a probe, not from the cut order alone.
