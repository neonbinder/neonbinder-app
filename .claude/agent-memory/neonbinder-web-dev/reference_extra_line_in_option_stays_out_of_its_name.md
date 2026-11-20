---
name: reference_extra_line_in_option_stays_out_of_its_name
description: A second line inside a role=option button joins the option's accessible name; keep it out with aria-hidden plus aria-describedby on the option; also t.run turns undefined into null
metadata:
  type: reference
---

The Checklists drill (`catalog/Cascade.tsx` -> `prototypes/p1/StaticColumn.tsx`) draws each row as a
`<button role="option">` whose children are a name span and an optional `description` span. Content
inside the button is the option's accessible name, so a description ("/5") silently became part of
it ("Gold Refractor /5") and any exact-name locator broke.

**How to apply:** give the description span an id derived from the option's id, `aria-hidden="true"`,
and put `aria-describedby` on the option. A hidden node is still a valid describedby target, so the
name stays the parallel's own and the run is read after it. Test with
`getByRole("option", { name, description })` (testing-library supports `description`).

`DrillOptions.tsx` (SetPicker / RequestCardForm) is a native `<select>`; an `<option>` cannot carry a
second line, so a description never shows there.

**Related:** `t.run(...)` in convex-test serialises a bare `undefined` return to `null`; a test helper
that reads an optional field through `t.run` must return `?? null` and assert `toBeNull()`.

**Related:** when a public mutation starts scheduling an internal refresh with `runAfter(0)`, every
existing test that calls it leaves a job in flight; drain with `drainScheduled(t)` (lib/testing) in
new tests and read `_scheduled_functions` BEFORE draining to assert the call.
