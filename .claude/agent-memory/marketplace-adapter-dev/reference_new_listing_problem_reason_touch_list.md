---
name: new-listing-problem-reason-touch-list
description: Adding a listing problem reason (listingProblemReasonValidator) means editing about eight lists across convex and the web; which are type-checked and which only a test pins
metadata:
  type: reference
---

A new held-back reason (e.g. NEO-569 `noLeague`) is not one edit. The lists:

1. `convex/schema.ts` `listingProblemReasonValidator` (deploy before any writer).
2. The platform's hold type (`lib/ebayListing.EbayHoldReason`) and the drain's hold site.
3. `app/collection/final/data/types.ts` `ListingProblemReason` (hand mirror, not derived).
4. `inventory/listing/copy.ts` `problemCopy` (Record: a type error if missed) and,
   when the admin view should read differently, `problemCopyReadOnly`; plus
   `heldBackNotice` if the card panel's line needs its own wording.
5. `lib/collection/sync-report.REPORTABLE_SYNC_REASONS` when only an admin can fix it
   (drives the dashboard's Report button and what `syncReports.report` copies).
6. `app/testing/seed-dashboard/page.tsx` `SYNC_HELD_REASONS`: only a test pins it
   equal to the validator, tsc does not.
7. `convex/testing.ts` `seedMyTestSync` takes the validator, so a platform-only
   reason needs an explicit skip-with-note for the other platforms.
8. `convex/syncReports.test.ts` keeps its own local `Reason` union (stale but harmless).

**Why:** tsc catches only 3 and 4; 5 and 6 fail silently (no Report offered; a seed URL ignored).
**How to apply:** grep for an existing sibling reason (`"missingAspect"`) across convex, app, lib before calling it done. See [[narrowing-a-convex-validator-is-a-runtime-break]] for removals.
