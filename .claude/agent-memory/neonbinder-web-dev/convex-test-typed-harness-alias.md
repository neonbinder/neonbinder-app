---
name: convex-test-typed-harness-alias
description: In convex-test files, `type T = ReturnType<typeof convexTest>` loses the schema and fails root `tsc -p .`; use a factory alias instead
metadata:
  type: feedback
---

Declare `const makeT = () => convexTest(schema, modules); type T = ReturnType<typeof makeT>;` and build harnesses with `makeT()`. A bare `ReturnType<typeof convexTest>` is schema-less, so `t.run(ctx => ctx.db.query("x").withIndex(...))` and `cancelScheduled(t)` raise TS2345 under `npx tsc -p .` (siblings carry the same error; the convex tsconfig gate does not see it). `cancelScheduled` still needs `t as unknown as Parameters<typeof cancelScheduled>[0]`.

**How to apply:** new or touched `convex/*.test.ts` files. Also: when planting a break by sed/insert, confirm the plant landed (a regex `...name` matches the declaration too) before trusting a green run.
