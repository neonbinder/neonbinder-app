---
name: optional-result-field-omit-when-empty
description: Adding an optional field to a Convex query's per-item result — emit it only when non-empty; convex tests pin whole result objects with toEqual, so an always-present `[]` reds every existing case
metadata:
  type: reference
---

Convex query tests in apps/web (e.g. the `teamSuggestionsForPreview` suites)
assert per-item results with `toEqual({ playerId, answer, candidates })`.
`toEqual` treats an `undefined` property as absent, but an `[]` is a real
value: adding `stints: []` to every entry turned four unrelated cases red
(NEO-639). Spreading the field only when it has content
(`...(list.length > 0 ? { list } : {})`) kept every existing pin green and
leaves the wire unchanged for callers that never read it.

**How to apply:** when growing a return validator with `v.optional(...)`,
make "absent" mean "none" in the doc and omit empty values in the handler;
only the cases that genuinely produce the new data need a test update.
Related: [[convex-typecheck-excludes-test-files]].
