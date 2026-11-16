---
name: listing-inputs-field-needs-every-returns-validator
description: A new ListingCardInputs field compiles clean but fails at runtime unless every `returns` validator that ships the inputs object (previewListingTitle, parallelCopyTitles) lists it
metadata:
  type: reference
---

`ListingCardInputs` (convex/features/generateListing.ts) travels to the client
whole: `selectorOptions.previewListingTitle` returns `inputs` and
`parallelCopyTitles` has its own `listingInputsValidator`, both hand-written
`v.object`s. TypeScript does not flag an extra property on a non-literal
object returned from a handler, so `npm run typecheck` stays green while
Convex rejects the return at runtime ("extra field") the first time a card
carries the new field.

**How to apply:** when adding a field to `ListingCardInputs` (or to what
`listingInputsForStoredCard` returns), grep `playerNames: v.array(v.string())`
across convex/ and add the field as `v.optional(...)` to each validator that
describes the inputs object. Prefer an optional field that is ABSENT when
empty (spread it in `listingInputsForCard`) so rows and goldens without it are
byte-identical. Related: [[reference_convex_call_spread_hides_bad_args]].
