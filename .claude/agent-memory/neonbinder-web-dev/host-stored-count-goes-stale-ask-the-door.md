---
name: host-stored-count-goes-stale-ask-the-door
description: A count stored when a background job ended (e.g. titlesToFix on a parallel build) goes stale after the operator fixes things; the fix pattern is a door-reported live count, not a subscription
metadata:
  type: feedback
---

A number stored on a result row at job end (NEO-535 `titlesToFix`) is stale the moment the operator fixes anything, and on every reload. Do not subscribe a query to keep it fresh when the parent can hold thousands of rows.

**Why:** NEO-581 showed a "Fix 4 card titles" button that opened to "Nothing to fix". The checklist hides its door off a live flag count; the build ticker had only the stored number.

**How to apply:** let the component that already does one-shot paged reads (`ParallelTitlesDoor`, `failingTitles` with `wantCards: 0`) report counts to its host (`onCounts`: from its load, a recount after every dialog close, and `countOnMount`). The host keeps a per-run override map and reads its run through a pure `withLiveTitles(run, counts)`. Keep the door mounted while busy (`onActiveChange`) and park focus on the host panel when the door leaves. Newest read wins via a sequence token; a failed recount stays silent. Tests that asserted "mockQuery not called" for a picked-up run now see counts-only reads.
