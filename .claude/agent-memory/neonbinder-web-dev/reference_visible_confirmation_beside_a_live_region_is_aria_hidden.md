---
name: visible-confirmation-beside-a-live-region-is-aria-hidden
description: A tile that shows a sentence the walk already announces renders it aria-hidden, so a spec's role=status text match stays unique and it is not read twice
metadata:
  type: reference
---

The Tidy Up walk keeps one always-mounted sr-only `role="status"` line (`onAnswered(message)`). When a tile also wants the same sentence visible for a few seconds, reuse `useFieldToast` (CardDetailFields, 6 s, the MoreAboutTile pattern) and render it `aria-hidden="true"` with `empty:hidden`. A second `role="status"` with the same text would be read twice and would make a spec's `getByRole("status").filter({ hasText })` ambiguous.

Swap pills (NEO-672) are `TeamChip variant="action"`: the default chip look is shared with TeamFillChips and must not change. Tile data carries only full team names (no short name), so a label wanting a "short name" falls back to the full one.
