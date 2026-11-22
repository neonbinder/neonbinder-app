---
name: reference_compiler_memoization_error_points_at_unrelated_callback
description: react-hooks/preserve-manual-memoization errors on an old useCallback ("inferred dependency was setX") when a NEW render-scope value breaks the compiler; bisect by reverting hunks, not by reading the flagged line
metadata:
  type: reference
---

In CardChecklist.tsx, adding `const progress = liveCandidates ? { ready, total } : undefined` in the component body made ten OLD `useCallback`s fail with "inferred dependency was `setPairingPhase`, but the source dependencies were [...]". The flagged callbacks were untouched. Reading a ref inside a `setState(updater)` was NOT the cause here (it is still worth hoisting the read out of the updater).

**How to apply:** when lint reports that error on code you did not edit, bisect your own hunks (copy the file aside, strip one hunk at a time, `npx eslint <file>`). Fix by passing the query value straight to a pure helper (helper accepts `{ready,total} | null | undefined`) instead of building an object in render scope. Baseline check: `git show HEAD:<path> > <path>`, lint, restore from your copy.
