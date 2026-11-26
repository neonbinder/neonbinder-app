---
name: component-tests-have-no-jest-dom
description: apps/web component tests have no jest-dom matchers (toHaveAttribute, toHaveAccessibleName throw "Invalid Chai property"); assert with getAttribute/textContent and role+name queries
metadata:
  type: reference
---
Vitest in apps/web registers no jest-dom, so `expect(el).toHaveAttribute(...)`
fails at runtime ("Invalid Chai property") while still typechecking nowhere
useful. Use `el.getAttribute("href")` with `toBe`, `textContent`, and let a
`getByRole("link", { name })` query carry the accessible-name assertion.
Playwright's own `toHaveAttribute` is fine in specs.

A new component that returns `null` for "nothing to show" is pinned with
`container.innerHTML === ""`. Related: [[reference-external-links-house-pattern]].
