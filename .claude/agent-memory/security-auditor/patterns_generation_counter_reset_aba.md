---
name: patterns-generation-counter-reset-aba
description: A row "reset" that sets a compare-and-set generation back to 0/undefined re-admits an in-flight async result once the counter climbs to the same number again (ABA)
metadata:
  type: project
---

When a row guards async results with a generation (`lookupGen`, `answerGen`,
attempt ids) and a reset/sweep path writes the counter back to undefined or 0,
the guard is no longer monotonic. If the enqueue step then bumps 0 -> 1 again,
a result still in flight from the OLD gen-1 job matches the new gen-1 and is
applied. A doc comment saying "the generation goes back to zero, so an in-flight
result is dropped" is the tell: it is only true while the row sits at 0.

**Why:** NEO-645 `tidyNames.resetForRefetch` and `sweepExpiredLookupOutput`
cleared `lookupGen`; `enqueuePendingLookups` uses "gen 0 = not enqueued" and
sets gen 1, so an old gen-1 Wikidata result could land on the re-asked row. Low
impact there (same name; `applyLookupResult` also checks `sportId`), but the same
shape on an answer/ownership generation would be a real stale-write bug.

**How to apply:** for any reset that touches a generation field, check (1) what
value the next enqueue assigns, (2) whether a job can outlive the reset (shared
FIFO workpool: yes), (3) what else the apply step checks (sport, answer, status).
Fix: keep the counter monotonic (reset bumps it, and "not yet enqueued" is its own
flag/status), or bind the result to a request stamp as well. See
[[patterns-neo411-retry-generation-and-dispatcher]].
