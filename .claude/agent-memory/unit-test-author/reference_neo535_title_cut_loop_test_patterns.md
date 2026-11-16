---
name: neo535-title-cut-loop-test-patterns
description: Testing the NEO-535 listing-title cut loop — golden file is the source of truth, how to get exact strings fast, the fuzz invariants that still hold, and how commit tests keep listingTitleTruncated reachable
metadata:
  type: reference
---

The NEO-535 builder (`convex/features/generateListing.ts`) starts from the full
title and cuts in a fixed row order; description words, surnames and `/N` are
never cut, so a title can STOP over 80 (`fits: false`). The golden tests live in
`generateListing.cutLoop.test.ts`; other files only pin their own angle.

- **Exact strings:** run the real function from a scratchpad `npx tsx` script
  importing the worktree file by absolute path; do not hand-compute cut/refill
  traces (the refill puts back labels and "Rookie" in surprising places).
- **Fuzz invariants that survive:** `fits === length <= 80`; no double space;
  every `titleDescription` word present unless `shortNameUsed` (then the title
  starts with the box); every `withoutFirstName(name) ?? name` present; `/N`
  present; number present (with/without "#") or `#<n>` in `dropped`; on a
  fitting title each dropped token costs more than the room left. The last one
  needs an exemption for tokens whose words collide with other inputs (15-word
  vocab) — see [[feedback-adversarial-pass-patterns]]; prove the check still
  bites by planting a throw on the number branch.
- **`listingTitleTruncated` now means "lost a first name or built from the box"**,
  not "core cut". Commit fixtures with `players: []` never lose a first name, so
  seed `metadata.listingShortName` on the leaf (box used = flagged) to test kept/
  blank/re-sync answers; a no-box over-cap set is flagged only by length.
- A box stored ABOVE the insert row gets the insert name appended by
  `titleChainFacts`; one stored on the leaf is used as typed.
- `leftOutOfTitle(inputs, text)` takes TEXT, not an assessment (old signature
  fails with `text.toLowerCase is not a function`).
- Kept titles are bounded by `LISTING_TITLE_KEPT_MAX` (400), the operator's own
  by 80; box cap is 80 ("Set name in titles tops out at 80 characters.").
