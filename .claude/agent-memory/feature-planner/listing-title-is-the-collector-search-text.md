---
name: listing-title-is-the-collector-search-text
description: collectionCatalog.search matches ONLY cardChecklist.listingTitle (search_listing_title) on main as of 2026-11; NEO-535 ruling moves collector search onto the listing DESCRIPTION, which must carry every card fact; ebayListingText silently slices titles to 80
metadata:
  type: project
---

The collector's free-text card search (`collectionCatalog.search`) runs on the
`search_listing_title` index and filters with `titleMatches(c.listingTitle, …)`.
Nothing else about the card is searched. eBay gets the number and team as
aspects beside the title.

Jason, 2026-11-13 (NEO-535): titles drop things (card number, first names,
teams) to fit 80 characters, so search should read the listing DESCRIPTION,
which has hundreds of characters and must carry every fact (year, maker, set,
insert, parallel, full player names, number, print run, AUTO/RELIC/RC/SP/SSP,
variation, teams, sport). Stored titles and descriptions are never rewritten
(no backfill: Jason hand-built them), so old rows only stay findable if search
reads title AND description.

Also: `convex/lib/ebayListing.ts` `ebayListingText` slices the stored title to
80 silently. Any change that lets a generated title exceed 80 must turn that
slice into a per-card refusal, or eBay gets a title chopped mid-word.

**Why:** a title-content change is a search change and a listing change.
**How to apply:** when planning title rules, check search
(`collectionCatalog.search`, `lib/titleQuery.ts`) and the eBay text builder in
the same pass. See [[listing-title-inputs-are-server-assembled]].
