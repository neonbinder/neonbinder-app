---
name: listing-text-trust-path
description: Listing title/description generator (generateListing.ts) — what text sources feed eBay's title/description, that ebayListingText passes it unescaped, and how to audit a change that adds a new source (e.g. NEO-609 variant-type names)
metadata:
  type: project
---
`features/generateListing.ts` builds the card title (80 cap) and a plain-text
description from `ListingCardInputs`; `convex/lib/ebayListing.ts`
`ebayListingText` sends both to eBay **unescaped** (slice to 4000 only). eBay's
item description accepts HTML, so every string reaching the generator is
effectively markup. Today every source is NB catalog text written behind
`requireAdmin` (set/insert/parallel/variant-type `selectorOptions.value`,
player and team names, operator box text), so it is one trust class.
In-app rendering is React text (auto-escaped); no `dangerouslySetInnerHTML`
in components/SetSelector.

**Why:** NEO-609 added variant-type names and every chain level to titles and
description lines; audited as no new trust class.

**How to apply:** when a diff adds a generator input, ask whether it can come
from a signed-in non-admin (collector) write or straight from a marketplace
payload without an admin step. If yes, that is new HTML reaching eBay: require
escaping or stripping at `ebayListingText`. Also confirm the preview
`returns` validators (`previewListingTitle`, `parallelCopyTitles`
`listingInputsValidator`) carry only names, never platform slots/ids, and stay
`requireAdmin`. `pickTitleChainFacts` copies only `titleChainFactsFields` keys,
so spreading it into an insert cannot smuggle extra fields.
See [[patterns_neo364_client_carried_undo]] for other text-to-write doors.
