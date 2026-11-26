---
name: neo609-title-levels-test-patterns
description: NEO-609 titleLevels test recipes - atFullLength padding, refill hides city cuts, Proof chain parity fixture, probe-with-tsx loop
metadata:
  type: reference
---

- Test file for the level machinery: `convex/features/generateListing.titleLevels.test.ts`; the 20 cut rows and Tidy Up line live in `generateListing.cutLoop.test.ts`.
- `atFullLength(inputs, n)` pads `setName` so the UNCUT title is exactly n; pad around a boundary (80 vs 81) and assert the one thing that goes. Row sizes: cutting "Base " = 5, "RC " = 3, "AUTO " = 5, so full length = 80 + saved chars lands exactly on 80.
- The cut loop REFILLS: a cut city comes back if it fits. City-cut tests at "just over" often show the cut undone, and the restore is greedy (a short later city can return before a longer earlier one). Probe with `npx tsx <scratch>.ts` over a range of set lengths before pinning strings.
- A type name that is the cuttable word (Autographs/Rookies/Relics type) must not trigger rows 2/3/4; the same word in a level NAME does.
- Parity fixture for a non-Insert type: seed sport > year > manufacturer > set > variantType "Proof" > leaf; give the stored card AND the chunk `features`/`inheritedFeatures` season+manufacturer or the year and maker vanish from the title. Chunk calls need `pickTitleChainFacts` output (`chunkFacts` helper) or the stored title silently lacks the levels.
- Mutating a product file for a break-check can be denied by the permission classifier in auto mode; do break-checks only where the harness allows, otherwise disclose.
