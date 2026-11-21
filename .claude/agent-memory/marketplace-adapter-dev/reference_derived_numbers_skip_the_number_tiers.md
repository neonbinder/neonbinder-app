---
name: derived-numbers-skip-the-number-tiers
description: A card number the sync minted or swapped in must carry a wire flag so resolveExistingIds skips its slot+number and no-ref number tiers
metadata:
  type: reference
---

A number the fetch DERIVES (minted letter for a SportLots-only variation, or `preferCardNumber` swapping in the other source's print) is not a number a marketplace printed for that card. If it reaches `resolveExistingIds`' slot+number or no-ref tiers it can land on an unrelated stored row (a ref-less "38b") and patch it.

- Flag it on the wire (`numberMinted`, optional literal true) through every hop: ReconciledCard, `previewCardFields`, candidate validator, schema, `getReadyCandidates` map. A forged flag only narrows matching.
- In `resolveExistingIds`: skip the number tiers AND leave the card out of the incoming number counts, so it neither matches nor makes a real card look ambiguous.
- When minting also skip letters any STORED row of the leaf holds (the action already has `committed`).
- Commit-side stem searches: precompute `Map<stem, indices>` once; a per-stem `args.cards.filter` is stems x cards.
- A NB-side `variationGroup` token (shared by the row-paired card and its sibling-row variations) beats any search by number; needs exactly one non-variation holder.
