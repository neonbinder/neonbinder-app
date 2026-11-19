---
name: title-chain-facts-travel-by-key
description: A new listing-title chain fact is added in titleChainFactsFields and moves between prelude, chunk and set context through pickTitleChainFacts (by key) — no hand-passed lines; the TS prelude type is `& TitleChainFacts`
metadata:
  type: reference
---

`convex/listingShortName.ts` exports `titleChainFactsFields` (validators) and
`pickTitleChainFacts(source)` (copies those keys, skipping undefined). The
commit prelude -> chunk call and the insert's set-context pass in
`selectorOptions.ts` spread `...pickTitleChainFacts(prelude|args)`, and the
`CommitPrelude` TS type is `{...} & TitleChainFacts`. A fact added to
`titleChainFactsFields` + `TitleChainFacts` therefore travels with no other
edit. Still hand-mirrored: `ListingCardInputs` in the `previewListingTitle`
returns and `parallelCopyTitles.ts` inputs validators, and the SPA's
`PreviewResult` type in `useTitlePreview.ts`.

**Why:** NEO-609 added `titleLevels`; the old four hand-passed lines per site
were how preview and stored titles drifted.

**How to apply:** a title test that calls `commitCardChecklistChunk` directly
passes only the facts it lists, so it will not see a new fact (e.g. a Base
level) unless the test adds it. See [[title-chain-facts-are-hand-passed-at-the-commit-chunk]].

Also: a cut-list change that makes a cut "Tidy Up" must read `assessment.tidyUp`
(the chosen title's own flag), not `coreFits`, wherever "the builder worked"
is tested — `coreFits` is also false for a box-built title that fits cleanly.
