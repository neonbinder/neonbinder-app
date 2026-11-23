---
name: patterns-walk-keeps-a-card-that-clears-on-screen
description: The Tidy Up walk keeps the open card on screen after a write clears its last stop (membership is live, the face is the URL's card), so the cleared tile is assertable in place; scratch files need unique names
metadata:
  type: feedback
---

The walk's membership is live (`walkOrder` over `deriveCardAttention`), but the open
card is the URL's `cardId` looked up over ALL the checklist's rows, so a write that
clears the open card's last stop (e.g. "Save and apply to all N cards" for the set
name, which clears the cut flag on box-fit titles since NEO-645) leaves that card's
face up. Assert the cleared state right there: the plain tile
(`not.toHaveAccessibleDescription(/To check/)`) paired with the positive that replaced
it (the purple `role="note"` "Set name shortened to fit."). The pill and the walk's
"N left" are what move; the card does not.

Proof outside the walk is the checklist row: `cardAttentionMark(page, n, reason)`
`toHaveCount(0)` beside `editCardButton(page, n)` visible (the row is there).

**Why:** NEO-645 1996 Score inserts spec: all 110 box titles clear at once, so a
"paired card that still has the mark" does not exist; the walk stays on #12 anyway.

**How to apply:** a spec that writes from the walk and then reads the same card's
tiles. For a fresh-only sole-writer spec with one run per seed, take the green run and
leave the plant as a ready `--edit` JSON under `apps/web/.e2e-local/` for the next
fresh seed ([[patterns-plant-first-on-a-one-shot-fresh-fixture]] when the plant matters more).

Scratchpad note: parallel sessions may share one scratchpad directory; give scratch
scripts a unique name (another session overwrote a generic `titles.ts`).
Related: [[patterns-set-name-shortened-purple-note-vs-blue-cut]],
[[patterns-compute-titles-with-tsx-before-a-title-spec-runs]].
