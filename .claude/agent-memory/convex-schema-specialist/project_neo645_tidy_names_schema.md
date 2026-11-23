---
name: project-neo645-tidy-names-schema
description: NEO-645 one-card Tidy Up — tidyNames (per-leaf name answers, replaces entityReviewQueue + entityReviewSkips) and cardPrintedNames (card-derived printed-name index); the invariants a later change must keep
metadata:
  type: project
---

NEO-645 (designed 2026-11-21) replaces the pre-commit entity-review wizard with
a per-card walk after commit. Two tables carry it:

- **`tidyNames`**: one row per (scopeId = the leaf that printed the name,
  kind, `normalizeEntityName` key). Holds lookup state and the ANSWER
  (link player / link team / notEntity, `by: operator|auto`, auto reason).
  Shared across operators, like the skips it absorbs
  ([[entity-review-skip-is-per-set]]: per-leaf scope is the safety property).
- **`cardPrintedNames`**: one row per (card, kind, key) for names that have a
  tidyNames row. This is the fan-out index ("cards in this scope that printed
  N") and the record that lets an answer be changed back. Parallel copies keep
  the SOURCE leaf's scope. Exact single matches get no row at all, so a set
  that needs no walk writes ~0 rows.

**Load-bearing rules:**
- Operator answers beat every inference at commit, as review decisions did
  (D5); a `by: auto` answer is refreshed by the next gate.
- Fan-out is compare-and-set per card (skip `cardOverride`, skip a card whose
  state for that name is not what the previous answer produced), paged by an
  action: the page is chosen in a query and the mutation re-reads each card by
  id ([[convex-occ-read-set-is-the-third-budget]]).
- `order` on the printed row keeps playerIds = playerLinks order when a
  pending name is linked later.
- `tidyReviewed`, `tidyChecks`, `sourceNumbers` and printed rows never bump
  `cardChecklist.lastUpdated` ([[card-lastupdated-is-resync-baseversion]]).
- `sourceDisagreements` needs a byte cap: it persists on every row
  `getCardChecklist` returns ([[character-caps-are-not-byte-caps]]).

**How to apply:** any later card writer that changes pending names, playerIds
or teamOnCardIds on a card with printed rows goes through the printed-name
writer; a new auto-resolution rule writes a `by: auto` answer, never a
silent link the walk cannot explain. Related:
[[card-derived-table-checklist]], [[removing-a-human-pause-exposes-races]].
