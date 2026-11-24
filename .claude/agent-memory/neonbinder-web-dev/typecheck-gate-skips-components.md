---
name: typecheck-gate-skips-components
description: npm run typecheck only covers convex/; component and test .tsx are typechecked only by the root tsc, which is red at baseline
metadata:
  type: feedback
---

`npm run typecheck` runs `tsc -p convex/tsconfig.json`, whose `include` is the convex folder. A type error in
`components/**` or in a `.test.tsx` passes that gate, and `vite build` does not typecheck either.

**Why:** the root `tsc -p tsconfig.json --noEmit` is the only thing that sees components, and it has baseline errors
(a few in `EntityReviewWizard.test.tsx`, `EntityReviewWizard.checklist.test.tsx`), so it cannot be a pass/fail gate.

**How to apply:** after touching components or their tests, run the root tsc once and filter its output to the files
you changed (`npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "components/<Dir>/(<Names>)"`). It takes about two
minutes, so run it in the background. A changed exported type (an answer shape, a prop) shows up in sibling test files
there, not in the gate.
