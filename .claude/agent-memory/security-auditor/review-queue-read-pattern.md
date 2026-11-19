---
name: review-queue-read-pattern
description: How entityReviewQueue public reads must gate (requireAdmin then assertOwnsRow) and what to check when a new per-step read is added
metadata:
  type: project
---

Public reads on `entityReviewQueue` gate in this order: `requireAdmin(ctx)` first, then load the row, then `assertOwnsRow(row, callerId)` (rows are per review session; another admin's row must throw "different review session"). `getBatch` strips `createdByUserId` via `toPublicRow`; any new stored field must be stripped or narrowed there too, because `publicRowValidator` is the only thing between the stored row and the client.

**Why:** the batch belongs to one operator's session; admins share reference data (teams, players) but not each other's in-flight batches.

**How to apply:** for a new per-row query, check (1) an entry in `publicFunctionAuth.test.ts` (the hand-pinned surface), (2) a cross-admin refusal test, (3) bounds on anything iterated from the stored row (cards/players are bounded at gate write time by the card-player constants; the internal `startBatch` validator itself is unbounded, acceptable only because it is internal).

Related: team-name resolution is per NAME, not per card, so any change to `pickCardTeam`'s voting (e.g. silent cards abstaining) lets one card's player evidence decide the row for every card printing that name. Weigh that against invariant 8 ("a data claim holds back a guess"). See [[team-pick-per-name]].
