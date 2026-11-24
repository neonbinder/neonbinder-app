---
name: new-table-naming-a-variant-has-six-pins
description: A new owner-scoped table holding a selectorOptions/cardChecklist id must be pinned in six hand-kept lists; which tests go red for each, and the exact count pins that move
metadata:
  type: reference
---

A new apps/web table whose rows name a `selectorOptions` (or `cardChecklist`) id and an `ownerId`
is not finished until these all name it (NEO-536 `syncReports`, verified green):

1. `convex/wipeVariantTypeSubtree.ts` `SUBTREE_REFERENCE_GRAPH` — `wipeVariantTypeSubtree.test.ts`
   scans each `defineTable` block's TEXT for id fields, so keep `v.id(...)` inline in the block.
2. A reset batch in `convex/selectorOptions.ts` (listing tables: `resetMarketplaceListingBatch`'s
   loop) + `resetSetBuilderData.test.ts` DEPENDANTS + a fixture row in `seedAll`. The fixture row
   moves an EXACT count pin in the same file (`marketplaceListingDeleted: N` in "reports 0 for
   each skipped table") — bump it.
3. `scripts/reference-seed/cli.mjs` `SELECTOR_DEPENDANT_TABLES` — `cli.test.mjs` walks
   `schema.export()` and fails if a selectorOptions-holding table is in neither list; the
   resetSetBuilderData test asserts DEPENDANTS equals it.
4. `convex/testing.ts` `resetMyTestState` (fold into an existing count key rather than adding one)
   + `testing.test.ts` `seedUser` row and `countRows` table list; the folded count appears as
   `marketplaceListing: N` once and `listing: N` THREE times.
5. `convex/_generated/api.d.ts` — two alphabetical lines per new module (see
   [[convex-codegen-only-blocks-types]]).
6. `publicFunctionAuth.test.ts` — a describe block per module (nothing enumerates the API).

**How to apply:** grep an existing sibling table's name across `convex/` and `scripts/` first;
every hit is a list the new table probably belongs in. Related: [[reset-loop-has-a-fifth-consumer]].

**Declaring a table before its drain exists (NEO-645 W1a).** `resetSetBuilderData.test.ts`
asserts the cli `SELECTOR_DEPENDANT_TABLES` list equals the drains the reset REALLY does, so a
table declared ahead of its reset step goes in `SELECTOR_DEPENDANT_UNDRAINED_TABLES` (which
`cli.test.mjs` also accepts) and moves across when the drain lands. The wipe graph entry can
say "declared, wired later"; the wipe test only checks the key exists.
