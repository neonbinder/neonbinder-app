---
name: dropping-a-schema-field-strands-its-read-guards
description: Removing an optional field from a Convex validator leaves "ignore the legacy value" guards behind; tsc only flags the ones typed off Doc, structural twin types and helpers keep compiling
metadata:
  type: reference
---

When a field is dropped from `schema.ts` after a PR that stopped reading it, the
guards that skipped its legacy values (`!e.chosen`, an `isOpen…` helper, an
`Omit<Doc, "field">` row type, a strip-on-read function) are now constant-true or
identity. `npm run typecheck` only catches the ones typed off `Doc<…>`. Hand-written
**structural twins** of the validator (e.g. a `type X = { …; legacy?: … }` kept in
`features/` so client code avoids generated types) still carry the field and keep
compiling, and so do the helpers and client callers built on them.

**How to apply:**
- After removing the field, grep the field name repo-wide, not just the tsc errors.
  Remove it from every twin type too, or the twin silently disagrees with the schema.
- A helper whose only job was the legacy field (`Pick<Twin, "legacy">`) hits TS's
  weak-type check ("has no properties in common") the moment a Doc-typed caller
  passes an object without it; delete the helper and its predicate at each call site.
- Tests are excluded from the convex tsconfig ([[reference-convex-typecheck-excludes-test-files]]),
  so test fixtures still writing the field and assertions reading it stay green at the
  gate. Grep them; a test that only proved "the stored field is ignored" can go.
- Report the predicate removals as no-behaviour-change dead code, with the list, so the
  coordinator can see them.
