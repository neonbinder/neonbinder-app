---
name: exploratory-pass-driving-recipe
description: How to drive a local-build exploratory pass headlessly (Playwright persistent profile), which flows reach the wizard's Card titles step, and driver traps
metadata:
  type: reference
---

Driving a Mode 2 pass without browser MCP tools: a small node script that `require`s
`@playwright/test` from the worktree's `apps/web`, `launchPersistentContext` on a
scratchpad profile dir (sign-in survives between runs), screenshots straight to disk.
Sign in with `/testing/sign-in?redirect=/set-selector&worker=<n>`; not every worker has a
saved BSC sign-in (no sign-in = "Set Builder requires marketplace credentials"), so try a
few workers and keep the profile of the one that works.

- One script run = one tab with empty history: `page.goBack()` from the first page lands on
  a blank page. Visit another app page first before judging Back.
- Light/dark and phone width in ONE run: `page.emulateMedia({colorScheme})` +
  `setViewportSize` — needed when the state (an open wizard) can't be recreated cheaply.
- The review wizard (and its Card titles step) only opens from a marketplace fetch. A
  hand-made row with a pasted publisher's checklist + Sync says "Saved 0 cards". Hand-added
  cards reach the attention walker's per-card title fixer only after Regenerate.
- Registry sets are read-only for us; a small non-registry real set (a team "Topps Now
  Road to Opening Day" base set, ~10 cards, players already in the catalogue) reaches the
  Card titles step with no player/team steps. Check SET-REGISTRY.md first.
- With SportLots paused, "Select Base Set" reopens on every visit to a BSC-only base row;
  Confirm (BSC preselected) to get past it.

Related: [[pasted-checklist-format-traps]]

With the Chrome browser tools (2026-11-22): a hand-made set under Baseball > 2024 > Topps reaches the Tidy Up walk with real NB/Wikidata lookups. Set level "Paste one instead" (sections like BASE / FUTURE STARS), then + Custom "Insert" type, Reconcile Inserts: tick "Show all checklist sections", Keep all, Save. Open an insert and press the card-list fetch button (accessible name "Sync card checklist"). The walk opens by itself after the save; `?tidy=` holds the position. Use a sport with real players, not a hand-made sport, if you want lookups. Viewing a registry set's walk is read-only only if you answer nothing; close it with Esc.
