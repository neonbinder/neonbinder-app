---
name: playwright-no-role-filter-for-aria-current
description: getByRole has no aria-current filter and eslint bans .locator(); give a "suggested/default" state a word in the accessible name (sr-only suffix) so specs find it by name
metadata:
  type: reference
---

`getByRole("button", { pressed })` exists but `aria-current` has no role option, and the playwright eslint config bans `.locator()` (GUIDE hard rule 2). Looping `.all()` + `getAttribute("aria-current")` works but is a smell, and a screen reader may skip `aria-current` on a button anyway.

**House pattern (NEO-656 A2):** a chip that acts on click (saves) is a plain button, not `aria-pressed`. The "suggested by default" cue is a visible check mark plus an sr-only suffix inside the label span (`<span className="sr-only">, suggested</span>`), so the accessible name reads "Padres, suggested · Jimmie Foxx played here". Specs find it by name (`{ name: /, suggested/ }` or the exact name) and prove the negative by `toHaveCount(0)` on that name; unit tests read `textContent`. happy-dom's name algorithm puts a space before the sr-only span ("Padres , suggested"), real Chromium does not: use `/^Padres ?, suggested/` in unit tests, the exact string in Playwright.
