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
