---
name: reference-new-listing-problem-reason-has-hand-lists
description: Adding a member to listingProblemReasonValidator means updating several hand-kept lists and deciding reportability; pins that go red or silently stale
metadata:
  type: reference
---

A new member of `listingProblemReasonValidator` (convex/schema.ts) is not done
when the schema, `app/collection/final/data/types.ts` and the copy in
`inventory/listing/copy.ts` have it. Hand-kept lists also need it:

- `app/testing/seed-dashboard/page.tsx` `SYNC_HELD_REASONS` (its page test pins
  it equal to the validator, so it goes red; this is how it was found).
- `lib/collection/sync-report.ts` `REPORTABLE_SYNC_REASONS` — a judgement, not
  a mirror: reportable iff only the admin team can fix it. Its test pins the
  exact list. The dashboard Report offer, crewFix lead, admin review and
  crewDesk all read it generically, so no per-consumer change is needed.
- `syncReportDetail` keeps a detail only for named reasons; a reason whose
  hold carries no detail needs nothing there.
- `convex/syncReports.test.ts` has its own `Reason` string union (stale, not red).

**How to apply:** grep for an existing reason literal (e.g. `"setupIncomplete"`)
across app/ convex/ lib/ and walk every hit. Collector copy for a reportable
reason states the fact and whose fix it is ("on our end"); it never sends the
collector to an admin-only screen. The crew action lives in the dashboard lead
and Report button, not in the per-card sentence. Also grep playwright/ for the
old sentence: specs pin copy as literals, never import it.
