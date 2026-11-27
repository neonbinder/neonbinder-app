---
name: label-text-is-the-target-and-its-plant
description: Proving "clicking a checkbox's label text toggles it" in a spec, and the plant that breaks only that (pointer-events-none on the input's wrapper does not)
metadata:
  type: project
---

Spec shape: keep the role locator for the asserts, click the perceivable text.
`const box = getByRole("checkbox", { name })`; `expect(box).not.toBeChecked()`;
`scope.getByText("<title>").click()`; `expect(box).toBeChecked()`. getByText
returns the smallest element holding the text, so a title span that also wraps a
hint span still resolves to the title's own span (substring, not `exact`).

Plant that breaks ONLY the label activation (the box itself still works, the
name is unchanged, so the red lands on `toBeChecked`, Received unchecked):
add `onClick={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }}`
to the wrapping `<label>`. A `--expect 'toBeChecked[\s\S]*<name>'` matches.

**Why:** label activation is a synthetic click on the control, so
`pointer-events-none` on the input or its wrapper does not stop it (NEO-682
plant STAYED GREEN). Swapping the `<label>` for a `<div>` also drops the
accessible name, so the red lands on the locator instead of the toggle.

**How to apply:** for a bare box inside a CALLER's `<label>` (print-run cards),
the caller's label is what toggles, so plant on the caller's label, not the
primitive. For a fresh-only spec, `plant --fresh --expect ...` re-seeds first
(without `--fresh`, `--expect` skips the re-seed and the red is the adoption
precondition, not the plant). Related: [[adopting-specs-need-reseed-for-planted-break]].
