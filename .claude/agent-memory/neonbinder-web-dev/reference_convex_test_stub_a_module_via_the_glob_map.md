---
name: convex-test-stub-a-module-via-the-glob-map
description: To test a Convex function that ctx.runAction's into another module (a "use node" module, or one a parallel builder has not written yet), add a key to convex-test's modules map that returns a stand-in module of registered internal functions; and flipping a public mutation to an action breaks every `.mutation(api.x)` test call site, not only the obvious ones
metadata:
  type: reference
---

**Stub a whole Convex module in convex-test.** The `modules` argument is just a
map of `"./file.ts" -> () => Promise<module>`. Spread the usual
`import.meta.glob("./**/*.*s")` and add (after it, so it wins)
`"./fakeBsc.ts": async () => ({ resetNamespace: internalAction({...}), ... })`,
built from `./_generated/server`. `internal.fakeBsc.resetNamespace` then
resolves to the stand-in, which records its args and returns a configurable
result. Works before the real file exists (`internal` is anyApi at runtime)
and keeps a `"use node"` module (google-auth-library etc.) out of the
edge-runtime test. Pins the seam (which args are sent), not the other
module's transport. Used in NEO-552 `convex/testing.fakeBsc.test.ts`.

Mirror the real module's RESULT contract in the stand-in: NEO-552's control
actions report `{ok:false, error}` instead of throwing, so a caller that just
`await`s them passes silently on failure. Check the result and throw; test the
failure branch through the stand-in.

**Mutation -> action flip.** When a public function must finish an outbound
call before returning (a scheduled reset from a mutation races the next step
the page takes), it has to become an action wrapping an internalMutation. Then:
grep every test for `.mutation(api.<module>.<fn>` repo-wide; NEO-552 found two
call sites in unrelated test files (collectionWants, listingSales) only via the
full unit run ("Expected a mutation function ... is not a mutation"). The page's
`useMutation` becomes `useAction`. Annotate the `ctx.runMutation` result type
in the same file to dodge the TS7022 inference cycle.

Related: [[reference_component_tests_hand_build_the_api_mock]],
[[reference_convex_codegen_only_blocks_types]].
