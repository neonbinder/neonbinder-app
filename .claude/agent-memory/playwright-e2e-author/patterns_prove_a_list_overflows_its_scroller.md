---
name: prove-a-list-overflows-its-scroller
description: Perceivable proof that a list still overflows its scroll container (so axe's scrollable-region rule is exercised) - scroll the last row into view, then the first row must be out of the viewport
metadata:
  type: feedback
---

A scroll container usually has no role or name, so its overflow cannot be read with a locator. Prove it through the rows instead:

```ts
const rows = page.getByRole("main").getByRole("listitem").getByRole("button");
await expect(rows.first()).toBeVisible();
await rows.last().scrollIntoViewIfNeeded();
await expect(rows.last()).toBeInViewport();
await expect(rows.first(), "the list overflows its scroller").not.toBeInViewport();
```

`toBeInViewport` uses an IntersectionObserver, which clips by scroll ancestors. If the list fit, its container (Team Management: 32rem = 512 px) is shorter than either project's viewport (629 / 839 px tall), so both ends would be in view at once; only an overflowing list puts the first row out of view after the last is scrolled in.

**Why:** NEO-628 checks a league-filtered Team Management list instead of the 2,000-row window; a league short enough to fit would silently stop exercising `scrollable-region-focusable`.
**How to apply:** any spec that shrinks a list for cost and still needs the scroll rule. Gate on the filtered answer first (Team Management announces "N teams in <league>" in a status) so the rows are the filtered ones. Related: [[patterns_axe_cost_options_and_result_types]].
