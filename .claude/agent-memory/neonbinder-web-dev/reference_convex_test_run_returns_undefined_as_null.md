---
name: convex-test-run-returns-undefined-as-null
description: convex-test's t.run(...) hands back a bare `undefined` result as `null`, so `expect(await t.run(() => doc.field)).toBeUndefined()` fails on an absent field
metadata:
  type: reference
---

`t.run(async (ctx) => (await ctx.db.get(id))!.someOptionalField)` resolves to
`null`, not `undefined`, when the field is absent: the result crosses the
convex-test value boundary, which has no `undefined`. Seen in NEO-528 round 3
("expected null to be undefined").

**How to apply:** in a helper that returns one optional field from `t.run`,
write `?? null` and assert `toBeNull()`; or return the whole document and
assert `"field" in doc` / `doc.field` outside the run (a returned document
keeps absent keys absent).
