---
name: reference-neo628-guard-test-patterns
description: NEO-628 guard tests - stub AxeBuilder with replace semantics, workflow yaml section pins without a parser, ?raw source scan with control, Sync wait-line stand-down
metadata:
  type: reference
---

- playwright/support/a11y.ts is importable from a lib/ test: `vi.mock("@axe-core/playwright")` with a stub whose `options()` REPLACES and `withTags()` MERGES, recording the option object at `analyze()`; `vi.mock("../../playwright/support/theme")` for pageHasBanner/paintsLook. Assert the final option object, not call order alone: both an order flip and a dropped call turn it red.
- Workflow pins in .github/scripts/workflow-path-filters.test.mjs: slice a job with `jobSection(lines, name)` (2-space job key to next 2-space key), then regex inside it. Derive counts from the matrix and compare, never a literal.
- Edge-runtime convex tests have no fs: scan sibling test sources with `import.meta.glob("./**/*.test.ts", { query: "?raw", import: "default", eager: true })`, exclude the guard itself, and add a control (known file names present, count floor) plus a matcher self-test so a regex that stops matching cannot pass vacuously.
- CardChecklist Sync wait line: two-sided set sets pairingPhase "review" at fetch start, so the page line stands down and the dialog's waitingSlot is the one copy (`closest('[role="dialog"]')`); one-sided set shows the page line with no dialog. A mocked `waitingSince: 1` renders absurd minutes, so do not assert the seconds text.
- BSD sed on macOS needs `sed -i ''`; break-check loop: cp backups to scratchpad, plant with sed, cmp after restoring.
