---
name: derived-card-field-from-entity-fact
description: Design pattern for a saved per-card copy of a fact that lives on a linked entity (card league from team league) — settle at the link seam, compute before insert, follow-rule recompute that reads the live entity
metadata:
  type: feedback
---

When a `cardChecklist` field is a saved copy of a fact on a linked entity
(NEO-569: `leagueId` from `teams.leagueId`), the shape that held up in review:

- **Seam:** settle it inside the one link writer (`syncCardTeamLinks`), only
  when that writer's diff is non-empty (the team set changed). Change the
  seam's parameter from `cardId` to a `Pick<Doc<"cardChecklist">, ...>` so
  every existing caller becomes a compile error and gets reviewed; a new
  optional opts flag would let callers silently skip it.
- **Insert path:** compute the value BEFORE `insert` and put it in the row
  (the `fresh` path returns early for teamless cards, so a settle there misses
  them, and a post-insert patch is a wasted op per card). Make the cache a
  REQUIRED member of `insertCardRow`'s indexing arg.
- **Callers that already patch the card** (cascades) fold the value into their
  own patch and pass the updated doc, so the seam sees equality and writes
  nothing extra. Share the entity-doc read with `StoredCardReadCache` (titles
  already `db.get` every team).
- **Entity fact changes:** chunked recompute over the link table's `by_<entity>`
  index with the NEO-24 follow rule: a card follows when its stored value is
  absent or equals the entity's PREVIOUS value; derive from the LIVE entity doc
  (never the scheduled arg), so two overlapping chains converge on the later
  value without a stamp field on the (reference-seed) entity table.
- A rule that can yield "empty" (mixed entities) will clear an operator's pick
  on the next re-derive; call that out as a product question.

**Why:** a recompute that overwrites unconditionally erases operator overrides;
a stamp/guard field on `teams` drags the reference-seed bundle.
**How to apply:** any future "card carries X derived from its team/player"
field. Related: [[per-card-derived-state-hook-points]], [[card-derived-table-checklist]].
