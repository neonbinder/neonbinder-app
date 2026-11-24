---
name: playwright-no-role-filter-for-aria-current
description: getByRole has no aria-current filter and eslint bans .locator(); assert a state attribute per element or iterate .all() with getAttribute
metadata:
  type: reference
---

`getByRole("button", { pressed })` exists but `aria-current` has no role option, and the playwright eslint config bans `.locator()` (GUIDE hard rule 2). To find or count "the chip with aria-current" use `expect(chip).toHaveAttribute("aria-current","true")` per known chip, or loop `await tile.getByRole("button").all()` and `getAttribute`. A chip that acts on click (saves) should not be `aria-pressed`; `aria-current` is the selected-by-default cue.
