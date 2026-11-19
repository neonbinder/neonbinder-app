---
name: fields-beyond-the-plan-ship-untested
description: Result fields a builder adds beyond the plan (counts, flags, truncation markers, stop-not-throw caps) and bare toThrow() refusals usually ship with no assertion; grep the test file for each new field name
metadata:
  type: project
---

When a builder runs in parallel with a test author who works from the plan's contract, any field the builder adds beyond the plan has no test.

On NEO-611 that was six fields, and none of them had a single test reference: `twinOfKey`, the alias added/skipped counts, `candidatesTruncated`, the alias-cap stop, `nearExisting`, and the stint cap.

The refusal tests also used bare `.rejects.toThrow()`. That passes on any error, including a validator typo.

**How to apply:** for every audit, grep the test file for each new result field and each new `throw` message. Ask for a message regex on every rejection. When a shared helper was refactored, ask for a planted-break proof.
