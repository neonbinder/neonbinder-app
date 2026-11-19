---
name: title-chain-facts-are-hand-passed-at-the-commit-chunk
description: A new listing-title chain fact (titleChainFacts) is spread into validators but hand-passed field by field at the commit prelude->chunk call and the chunk->insertCardRow call in selectorOptions.ts, and ListingCardInputs is hand-copied in two returns validators; miss one and preview and stored titles disagree
metadata:
  type: project
---
Every title path reads its set chain through `listingShortName.titleChainFacts`
(commit prelude, `findAncestorLabels` for hand-added/Regenerate/stored titles,
`listingTitleContext` for the pre-save step, `parallelSetContext` for parallel
copies, the attributes panel's box prefill). Validators spread
`titleChainFactsFields`, so a new fact looks like a one-place change. It is not:

- `selectorOptions.ts` passes the facts EXPLICITLY at the chunk call
  (`insertNameValue: prelude.insertNameValue`, ...) and again into the insert's
  set context (`insertNameValue: args.insertNameValue`, ...), plus a hand TS type
  for the prelude result.
- `ListingCardInputs` is mirrored as a strict `v.object` in the
  `previewListingTitle` returns (selectorOptions.ts) and in `parallelCopyTitles.ts`;
  `useTitlePreview.ts` keeps a hand TS copy for the chips.
- The Tidy Up flag (`listingTitleTruncated`) is written from
  `assessListingTitle(...).coreFits` by every writer (insert, Regenerate, player
  bulk link, no-team regen, parallel copies), but `carriedTitle.assessParallelCopyTitle`
  short-circuits on `fits && !firstNameLost`, not on `coreFits`.

**Why:** found planning NEO-609 (title levels from variant types). A missed
explicit pass leaves the commit writing a title the preview never showed;
`storedCardTitle.parity.test.ts` only catches it if a fixture carries the field.

**How to apply:** when a plan adds a chain fact or changes what sends a card to
Tidy Up, list these sites in the builder's file set, and suggest a pick helper
(or a test that iterates `titleChainFactsFields` keys) over more hand copies.
See [[listing-title-inputs-are-server-assembled]].
