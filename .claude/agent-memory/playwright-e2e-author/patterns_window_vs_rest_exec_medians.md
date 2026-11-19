---
name: window-vs-rest-exec-medians
description: Two quick convex-logs checks that split "our code got slower" from "the deployment was loaded" (per-function exec medians in the failure window vs the rest of the shard) and an eBay policy-save red (getOptedInPrograms timeout lines) from our code
metadata:
  type: project
---

**Loaded deployment vs slow code (NEO-592 run, brand-unknown mobile red).** After
the requestId gap check ([[action-stall-between-child-calls]]) finds no idle gap,
compare each child mutation's `executionTime` median inside the 10-15 s failure
window against the same function's median over the rest of the shard log. A
year-wide Sets sync (`syncSetsAcrossManufacturers`: one `ensureBrandRow` per
brand, then one `storeSelectorOptions` per brand, all sequential) went 3.9 s to
12 s when `ensureBrandRow` ran at a 0.12 s median against 0.03 s elsewhere, while
other workers' 148-doc `collectionCatalog:drill` subscriptions re-ran 100+ times
in the same window (p90 0.4 s against 0.02 s). Each write of the sync invalidates
them. A retry passing proves little here: the catalogue is shared, so the rows the
first attempt synced are already there.

**eBay policy picks.** Each radio pick in the eBay setup fires its own
`ebayConnect:savePolicies`, which re-reads `getOptedInPrograms` under the 3 s per
try / 5.5 s budget (`EBAY_POLICY_READ_MS`). A red on "You're all set" with
"eBay took too long to answer" alerts under the radiogroups shows in the seller
log as `getOptedInPrograms outcome:"timeout"` (about 3003 ms, then 2500 ms with
`attempt:2`). Greens show the same four concurrent reads answering in 0.45-0.8 s.
Timers firing on time means the action ran; the fetch got no answer.

**How to apply:** quote both numbers (window vs rest) before naming a cause, and
look for the eBay timeout line before blaming the token or setup code.
