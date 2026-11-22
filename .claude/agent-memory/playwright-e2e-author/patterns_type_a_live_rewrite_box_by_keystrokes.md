---
name: type-a-live-rewrite-box-by-keystrokes
description: A control that rewrites other fields on every change (the Card titles "Set name in titles" box) must be driven by keystrokes in at least one spec step; fill() is one change event and hides intermediate states
metadata:
  type: feedback
---

`locator.fill(text)` on a textarea selects all and inserts once: the app sees ONE change from the old text to the new. A person trims with Backspace, so the app sees every intermediate text. When each change re-reads a per-row predicate from the list as rendered (NEO-637: "does this row show the Left out to fit line" under the box text in effect), an intermediate text can flip the predicate: a hand-written title holding the box text shows no line under "…Artists Proofs", shows one under "…Artists Proof" (mid-word, the box phrase is no longer in it), and the next keystroke rebuilds it.

**Why:** tests prove the product as a user drives it (hard rule 1); a fill-only spec stays green over a control that destroys work under real typing.

**How to apply:** for any box whose onChange rewrites sibling fields, drive at least one step with `box.focus(); box.press("End");` and a bounded `for` of `box.press("Backspace")` (or `pressSequentially`), then assert the final values. Before writing it, run the product's own helpers over each intermediate text in a scratchpad tsx script (`leftOutOfTitle`, `swapSetNameInTitle`) to predict where a row flips. Keep `fill` where a paste-like replace is the claim. Related: [[title-fixture-arithmetic]].
