---
name: players-insert-spread-pin-allows-one-conditional-form
description: players.sportsIndexPin scans every insert("players" block; only `...(cond ? { field } : {})` spreads pass, so a nested ternary spread fails the unit suite
metadata:
  type: reference
---

`convex/players.sportsIndexPin.test.ts` reads every non-test convex module and
flags any spread inside an `insert("players"` block that is not exactly
`...(cond ? { a } : {})` (one object literal, one nesting level). A nested
ternary (`cond ? {x} : other ? {y} : {}`) fails it with a truncated offender
string, in the FULL `test:unit` run only (`vitest related` on your own test file
never loads it). Compute the value in a `const` above the insert and spread the
simple form. Same trap for any writer you add to a bulk loader.
