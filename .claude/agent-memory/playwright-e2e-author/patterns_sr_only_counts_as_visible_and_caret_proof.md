---
name: patterns-sr-only-counts-as-visible-and-caret-proof
description: Playwright's toBeVisible passes on an sr-only element (1x1 box); prove a visual swap another way. Prove caret-at-end by Backspace from the opening caret, never End.
metadata:
  type: feedback
---

Playwright's visibility is "non-empty bounding box and no `visibility: hidden`"
(`computeBox` in playwright-core, checked on 1.63). Tailwind `sr-only` is a
1x1 px clipped box, so `toBeVisible()` PASSES and `not.toBeVisible()` FAILS on
it. A heading that steps aside to `sr-only` while an editor is open (NEO-667
rename field) cannot be asserted hidden by visibility, and `toHaveCount(0)` is
wrong because it stays mounted.

**Why:** a builder's spec asserted `toHaveCount(0)` on the heading; once the
product kept it mounted sr-only for screen readers that went red, and the
"obvious" `not.toBeVisible()` swap would too.

**How to apply:** prove the swap by the field (visible, holding the name) and
the heading reading the right name after close; while open, `toBeVisible()` on
the heading only proves it is still in the tree for a screen reader.

Caret position: after `toBeFocused()`, press Backspace WITHOUT pressing End and
assert `toHaveValue(name.slice(0, -n))`. Pressing End first masks a caret
placed at the start. A `setSelectionRange(0, 0)` plant turns it red.
