---
name: reference-card-description-follows-facts
description: NEO-535 — every card fact writer must fold refreshedListingDescription into its patch; the list of writers, the equality rule, and what is deliberately not covered
metadata:
  type: reference
---

A card's `listingDescription` (what collector search reads) is rebuilt on a fact
write through `convex/cardDescriptionRefresh.ts`, ONLY when the stored text equals
`generateListingDescription` of the card BEFORE the write (the comparison is the
"not hand-edited" flag; there is no schema flag). Missing description: not filled
there (the backfill fills). A description in the same call wins.

Writers wired (a NEW card-fact writer must join this list or descriptions go stale):
`updateCard` (lazy: reads the row only when `patchNamesDescriptionFacts`),
`setCardFeature`, `applyBscAttributeFill` (folded into its one patch, so the
backfill's recording ctx sees one patch), `applyBscTeamResolution` (re-reads the
row: the fill may have patched it earlier in the same mutation),
`cascadeSelectorOptionTeams` (shared lookup cache per page), and `moveCards`
(scheduled `refreshMovedCardDescriptions` tail, only for cards that have a
description, so move tests without descriptions schedule nothing).

Regenerate uses a looser rule (`readsAsGeneratedDescription`: every line is a
generator line shape) because a stale builder text from older facts is exactly
what the operator wants rebuilt. Keep the line shapes in generateListing.ts beside
the generator; a test runs generator output back through the check.

Not covered on purpose (fan-out): player/team renames, set/insert/parallel
renames, brand rehome. Raise before wiring any of them — they touch every card
beneath and need a paged job.
