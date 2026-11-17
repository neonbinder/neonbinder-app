---
name: seam-signature-change-breaks-call-text-pins
description: Changing a shared write seam's signature (syncCardTeamLinks, insertCardRow) breaks pin tests that regex the exact call text and convex-test callers that typecheck never sees; make new per-transaction caches optional with a fallback
metadata:
  type: reference
---

`cardTeamLinks.pin.test.ts` (and its player twin) assert the seam is called
with literal text such as `syncCardTeamLinks(ctx, existing._id, teamsWritten)`.
Changing the seam's parameters (NEO-569 made it take the card shape plus a
`leagueCache`) turns those regexes red even when every call site is right.
Separately, `convex/tsconfig` excludes `*.test.ts`, so a new REQUIRED field on
an options object (`CardRowIndexing.leagueCache`) is green at `npm run
typecheck` while dozens of convex-test callers crash at runtime with
"Cannot read properties of undefined".

**How to apply:** when you change a seam signature, grep the pin tests for the
old call text and update the regexes in the same change. Make a new cache or
context parameter optional with a fresh-per-call fallback (same answer, more
reads), and pass it explicitly from every production caller; that keeps test
fixtures working and still shares reads in real chunks. Related:
[[convex-typecheck-excludes-test-files]], [[source-slice-tests-key-on-export-names]].
