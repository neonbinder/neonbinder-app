---
name: convex-tests-have-no-static-gate
description: convex/*.test.ts is excluded from the convex tsconfig and outside every eslint files glob, so dead helpers and stale literals in tests pass typecheck and lint; plus the order for dropping a branch-only schema literal
metadata:
  type: reference
---

`apps/web/convex/tsconfig.json` excludes `./**/*.test.ts`, and
`eslint.config.mjs` only lints `{app,components,src,lib}/**` and playwright, so
`eslint convex/x.test.ts` prints "File ignored". Vitest transpiles without
type-checking. A convex test file therefore has NO static gate: an orphaned
fixture helper or import after you delete a describe block, or a removed
literal still seeded in a test, passes `npm run typecheck` and `npm run lint`.
What catches a stale literal is convex-test's runtime schema validation on
insert (only if the test actually runs that insert); orphaned helpers are
found only by grepping call counts.

**How to apply** when removing a field, literal or public function:
1. `git show origin/main:apps/web/convex/schema.ts` decides prod safety: a
   literal that never reached main has no prod rows; one on main needs the
   three-step stop-reading / clear / tighten migration instead.
2. Grep the literal across `convex lib components app src playwright`, tests
   included; fix seeds, then grep each helper the deleted tests used.
3. A retired public function also leaves: its `publicFunctionAuth.test.ts`
   pin, string-keyed api mocks in component tests (e.g. a
   `"module.fn"` ref map), and doc comments naming it in `convex/lib`.
4. The worktree's own deployment will refuse the push on rows from earlier
   manual testing: reset with the DEPLOYED code first
   (`e2e-baseline.sh reset --deployment <own>`), then push and reseed.
Related: [[strict-returns-drift-is-invisible-to-typecheck]],
[[reference_typecheck_convex_changes]].
