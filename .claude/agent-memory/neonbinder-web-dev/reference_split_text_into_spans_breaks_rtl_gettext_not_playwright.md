---
name: reference-split-text-into-spans-breaks-rtl-gettext-not-playwright
description: Splitting one line of text into styled child spans keeps Playwright getByText(exact) green but breaks Testing Library getByText (own text nodes only)
metadata:
  type: reference
---

Styling part of a line (`<span><span class="text-ink-2">Q</span> <span class="text-ink-3">(from X)</span></span>`)
has different effects on the two drivers:

- **Playwright** `getByText("Q (from X)", { exact: true })` still finds the outer span: its
  text engine matches an element's combined descendant text and returns the deepest match.
  E2E specs keep working unchanged.
- **Testing Library** `screen.getByText("Q (from X)")` FAILS: its default matcher reads only
  the element's OWN text nodes, so the outer span's text is `" "`. Use a function matcher
  that checks `el.textContent === text` and that no child already has the whole text
  (otherwise ancestors match too).

**How to apply:** before splitting a "one text node, so it is found as one line" string for
colour, grep the component's `.test.tsx` for `getByText` of that string and switch those to a
whole-text matcher; leave the Playwright spec alone. Related: [[copy-that-names-a-button-goes-stale]].
