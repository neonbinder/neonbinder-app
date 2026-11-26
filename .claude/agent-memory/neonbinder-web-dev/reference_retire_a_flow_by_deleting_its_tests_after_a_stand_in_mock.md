---
name: retire-a-flow-by-standing-in-the-replacement
description: Replacing a flow inside a 4,500-line component test - mock the replacement with a stand-in first, then the failures sort themselves into delete vs rewrite
metadata:
  type: reference
---

When a component swaps one flow for another (wizard -> walk), do not fix its giant test file test by test.
1. Add a `vi.mock` stand-in for the NEW component (a dialog named from its `title` prop plus a close button) and wrap every `render`/`rerender` in `MemoryRouter` if the new code reads the URL (a regex over `<Comp ... />` blocks does it; grep afterwards for bare `render(<Comp {...props} />)` and `view = (x) => <Comp/>` shapes the regex misses).
2. Run with `--reporter=json --outputFile=<scratch>` and group failures by describe: every failure that asserts the OLD flow's text ("Wizard opened...", "Wizard summary") is a retired behaviour, delete it; the few that assert shared behaviour (pill, banner, count) are rewritten.
3. Delete `it(` blocks by script: match the title, walk to the line equal to the indent + `});`, take the preceding comment lines with it, then drop describes left with no `it(`.
Also: a walk-order test that reads `window.sessionStorage` works in happy-dom as is; Radix-free dialogs with `inertBackground` need no provider in tests.
