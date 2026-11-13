---
name: listing-title-is-the-collector-search-text
description: Since NEO-535 collector search reads cardChecklist.listingDescription (search_listing_description, sportId filter), not the title; the description must carry every card fact; ebayListingText refuses titles over 80 (titleTooLong hold) instead of slicing
metadata:
  type: project
---

The collector's free-text card search (`collectionCatalog.search`) runs on the
`search_listing_description` index (filter field `sportId` only) and matches
with `titleMatches(c.listingDescription ?? "", …)`. A card with no description
is never found.

Titles drop things (card number, first names, teams) to fit 80 characters, so
the description is the search text and must carry every fact in long and short
forms (year, maker, set, insert, parallel, contiguous full player names,
`#number`, `/N`, AUTO/RELIC/RC/SP/SSP, variation, teams, sport). Existing
descriptions were brought up to that by an armed backfill
(`backfillListingDescriptions`). Stored titles are never backfilled.

`convex/lib/ebayListing.ts` `ebayListingText` never cuts a title: over 80 it
returns a refusal and the eBay drain holds the card with reason
`titleTooLong`.

**Why:** a title-content change is a search change and a listing change.
**How to apply:** when planning title or description rules, check search
(`collectionCatalog.search`, `lib/titleQuery.ts` substring matching) and the
eBay text builder in the same pass; any new card fact must reach the
description. See [[listing-title-inputs-are-server-assembled]].
