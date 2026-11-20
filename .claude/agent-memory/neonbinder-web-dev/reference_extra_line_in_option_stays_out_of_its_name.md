---
name: reference_extra_line_in_option_stays_out_of_its_name
description: An extra visible line in a role=option button joins its accessible name; speak a different form with aria-hidden visible text plus an sr-only sibling (describedby on activedescendant options is unreliable); t.run turns undefined into null
metadata:
  type: reference
---

The Checklists drill (`catalog/Cascade.tsx` -> `prototypes/p1/StaticColumn.tsx`) draws each row as a
`<button role="option">` driven by `aria-activedescendant`. Content inside the button is the option's
accessible name, so a visible "/5" line becomes "Gold Refractor /5" in the name.

**What does not work:** `aria-describedby` on such an option pointing at an `aria-hidden` line. Several
screen readers drop describedby on activedescendant options and in browse mode.

**How to apply:** keep the visible line `aria-hidden="true"` and add a `sr-only` span as a SIBLING of the
name span (not inside it) holding the spoken form (", numbered to 5"). The name span's own text stays
exactly the name, so a Playwright `has: getByText(name, { exact: true })` locator still finds the row.
With no spoken form, leave the visible line exposed: it reads as part of the name as it always did.
A browser puts a space around the sr-only span, so the computed name can read "Gold Refractor , numbered
to 5": unit tests match `^Name ?, spoken$`, specs should match the name non-exact.

A native `<select>` option has one line only: append the run from its own field (`DrillItem.printRun`),
never a free `description`.

**Related:** `t.run(...)` in convex-test serialises a bare `undefined` to null; return `?? null`.
**Related:** a public mutation that starts scheduling an internal job with `runAfter(0)` leaves a job in
flight in every existing test that calls it; tests that count `_scheduled_functions` must filter by name.
