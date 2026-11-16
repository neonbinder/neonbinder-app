---
name: reference-card-description-follows-facts
description: NEO-535 — every card fact writer must fold refreshedListingDescription into its patch; the list of writers, the equality rule, the rename fan-out (overlay before-reads) and what is deliberately not covered
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

Renames that fan out (player, team name/location, set/insert/parallel value,
reconciliation tier-0 title edit, brand rehome onto/off Unknown) go through
`convex/cardDescriptionFanOut.ts`: `refreshDescriptionsAfterRename(ctx, target,
{inline})`. "Before" is rebuilt by laying the OLD field values over `db.get`
(`renamedListingDescription` + an overlay map) — the chain runs after the rename
committed, so the old facts are not in the DB any more. Operator doors run the
first page inline and hand the chain an index cursor (link pages via the link
modules' own readers `cardPlayerLinkPage` / `cardTeamLinkPage` — the pin tests
refuse any other module querying those tables — never `.paginate()`), so the
common test case schedules nothing; budget-sized doors (reconciliation, rehome)
schedule only, gated by `subtreeMayHoldCards` (count, else a bounded probe) so
fixtures with empty rows schedule nothing. A re-run is idempotent: a rebuilt card
no longer matches the old names.

Deliberately NOT rebuilt: finalize's pending-name clear (it links no ids, so a
rebuild could only DROP a name search still finds); sport/year/manufacturer
renames (year/maker are card `features` snapshots; sport is one line over every
card in the sport); variant type renames (kind-changing renames are refused).
New description facts read through `listingInputsForStoredCard` must be reachable
by `db.get` only (`StoredCardReader`), or the overlay cannot show them as before.

**Import cycle trap.** players.ts / teams.ts now import the fan-out, so nothing on
that path may import selectorOptions.ts at load: listingTitleContext → players →
… → selectorOptions → listingTitleContext left `titleContextValidator` undefined
("reading 'asOptional'" in 25 commit tests). `findAncestorLabels` moved into
storedCardTitle.ts for that reason; see [[placeholder-module-cycle-tdz]].
