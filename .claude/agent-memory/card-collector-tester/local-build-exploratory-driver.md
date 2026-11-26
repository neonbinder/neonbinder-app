---
name: local-build-exploratory-driver
description: How to drive a local build for an exploratory pass when no browser MCP is wired up — scratch Playwright config reusing the support/ helpers; what got refused
metadata:
  type: reference
---

Driving the local build headless for a Mode 2 pass:

- Sign in once with a plain node Playwright script: open
  `/testing/sign-in?redirect=/testing/seed-credentials?redirect=/admin/set-builder&worker=<n>`
  (a spare worker index, not 0, so specs' worker 0 is untouched; skip `/testing/reset`).
  Without the seed-credentials hop the Set Builder shows the credentials gate.
  Save `storageState` and reuse it.
- Then a scratch `pw.config.ts` (testDir = scratchpad, `storageState`, baseURL) and
  stage files that import `playwright/support/set-builder` and `support/cards` by
  absolute path (`drillToCustom`, `openAttributesPanel`, `editCardButton`). Symlink the
  app's `node_modules` into the scratch dir or `@playwright/test` won't resolve.
- One stage per file; log `innerText` and `aria-describedby` text, screenshot crops.
- A long-running "eval whatever I POST" HTTP driver was refused by the permission
  classifier; don't try it again.
- Team picker options are named "Add <team> · <years>", not the bare team name.
- Delete a hand-made row from its attributes panel: "Delete <name>" then "Yes, delete".

Fast bulk seeding (2026-11-24, NEO-660): a scratch spec calling `addCustomEntry(page, "Inserts", name, { confirm: "required" })`
in a loop made 53 hand-made inserts in ~30 s. Traps:
- `waitForURL(/set-selector/)` matches the sign-in URL itself (the redirect param contains it): wait on
  `u.pathname` instead, or the drill runs before sign-in finishes.
- A brand-new custom sport did not stick; use Baseball > year > a custom manufacturer. `drillToCustom`
  then refuses to re-select that set ("Couldn't sync sets" on a manufacturer with no marketplace ids):
  for later stages pick each column by its `Search <col>` combobox + exact option instead.
- Chrome MCP `resize_window` may not shrink a maximised window; use a headless `viewport: 390x844` stage
  for phone width (headless defaults to the light theme).
- Group Parallels: tick one row, Shift+click the last tick to select the whole run.
