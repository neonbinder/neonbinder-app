---
name: field-removal-on-a-staying-table-is-two-releases
description: Removing a field (or a sub-field) from a table that stays cannot ship in one deploy; PR1 stops writing + ships the armed clear, ops runs it, PR2 tightens; legacy "presence = settled" reads stay through PR1
metadata:
  type: feedback
---

Removing a field from a table that STAYS takes two releases, and no single-PR
variant is safe. Convex validates every stored row against the new schema at
push time, before any function in that push can run. So a clearing migration
can never ship in the same deploy as the tighten. The armed clear's dry run is
also the only proof that zero rows remain on prod, and it needs the code from
the first release. Dropping a whole table is different: unlisted tables are not
validated, so a table drop is one PR.

**Why:** NEO-656 (2026-11-23) planned removing `cardChecklist.tidyReviewed` and
`sourceDisagreements[].chosen`. "Keep it deprecated-optional forever" leaves the
stored data and a lingering validator (the `isCustom` precedent), and the user
treats that as a known gap.

**How to apply:**
1. PR1 stops every writer. The field stays `v.optional` + `@deprecated`.
   Strict `returns` over stored rows keep listing it, or stale rows fail at
   runtime ([[strict-returns-drift-is-invisible-to-typecheck]]). Reads that
   treat "field present" as "settled" (e.g. `!e.chosen`) STAY in PR1: they are
   the correct reading of stale rows until the clear runs.
2. PR1 also ships the armed clear: the action loops an internalQuery page that
   selects ids, and an internalMutation point-reads and patches
   ([[convex-occ-read-set-is-the-third-budget]]). The clear patches only the
   removed field, never `lastUpdated` on cards
   ([[card-lastupdated-is-resync-baseversion]]).
3. Ops runs the clear on prod, shared dev and the live worktree deployments.
4. PR2 drops the field from the validator. Typecheck then flags every
   leftover read of the field. Test files escape typecheck, so grep them
   ([[convex-tests-have-no-static-gate]]). PR2 also deletes the clear.
5. Other open PRs' previews that ran the old writers fail after PR2 lands. The
   fix is a reset, then a rerun.
Merge PR2 only after the dry run reads 0 on prod. Related:
[[tightening-a-validator-shared-with-stored-drafts]].
