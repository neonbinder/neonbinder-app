---
name: patterns_template_literal_backslash_b
description: new RegExp(`...\b`) in a template literal is a BACKSPACE, not a word boundary; the locator never matches (or a negative goes vacuous). Write \\b
metadata:
  type: feedback
---

In a JS template literal `\b` is the backspace escape (U+0008), so
``new RegExp(`^Unlink card #${n} ${name} from checklist row #9 ${name}\b`)`` asks for a
backspace character and matches nothing. A positive goes red with the button plainly in the ARIA
snapshot; a `toHaveCount(0)` built that way passes forever.

**Why:** NEO-591's team-leader stem-link check went red on a visible "Unlink card #9a …" button;
the regex was the cause, not the product.

**How to apply:** inside template literals write `\\b`, `\\d`, `\\s`, `\\.` (or use a regex
literal when nothing is interpolated). Grep before a run:
`grep -rn 'RegExp(`[^`]*[^\\]\\[bdsw.]' playwright/`.
Related: [[patterns_aria_hidden_glyph_breaks_exact_text]]
