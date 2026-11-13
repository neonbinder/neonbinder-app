---
name: card-lastupdated-is-resync-baseversion
description: cardChecklist.lastUpdated is the NEO-203 re-sync review's per-card baseVersion; a backfill that bumps it makes an open review's accepted changes go stale — derived-field backfills on cards patch only their own field
metadata:
  type: project
---

`cardChecklist.lastUpdated` is not just a timestamp. The NEO-203 checklist
re-sync diff hands each matched card's `lastUpdated` to the wizard as
`baseVersion`, and the commit chunk applies an operator's `applyFields` only
when `card.baseVersion === existing.lastUpdated` (grep `baseVersion` in
`convex/selectorOptions.ts`, the commit chunk's `applyFields` gate). The
selectorOptions model backfills (`backfillBrandUnknownRole`) bump
`lastUpdated` on what they patch, so copying that shape onto cards is the trap.

**Why:** found sizing the NEO-535 description backfill (2026-11-13). Bumping
`lastUpdated` on ~100k cards would silently turn every in-flight review's
accepted field changes into "stale, not written" — counted, never thrown.

**How to apply:** a backfill of a field the re-sync diff does not compare
(listing description, a derived index, a denormalised copy) patches only that
field and leaves `lastUpdated` alone. A backfill that does change a diffed
field should bump it, and the run should be scheduled when no review is open.
The cursored cardChecklist backfill model is
`cardPlayerLinks.backfillCardPlayerLinks` (page mutation + action loop);
per-page caches of ancestor/player/team reads keep a 200-card page under
~500 system ops. Related: [[armed-backfill-models-have-no-cursor]],
[[convex-two-transaction-limits]].
