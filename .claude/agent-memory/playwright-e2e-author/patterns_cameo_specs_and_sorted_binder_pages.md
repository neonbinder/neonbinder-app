---
name: patterns_cameo_specs_and_sorted_binder_pages
description: NEO-528 cameo specs - a player's cameo needs are catalogue-wide (one spec per player), sorted-binder page names and turn buttons, count lines move off the cover on a phone, drawer toast is outside the dialog, failure-hook page must be brought to front on mobile
metadata:
  type: feedback
---

Learned writing `collection/smart-binder-secondary-player` and `set-selector/player-on-every-card` (was `also-pictured-bulk-every-card`; NEO-528).

- **Cameo counts are catalogue-wide.** A smart binder's "Cameos: N have, N need" counts every card in the catalogue that lists the rule's player as also on the card. Any other spec (or a failed run of this one) that puts the SAME player on a card changes the need count. So each cameo spec uses its own seed player (first vs second ordinary Base row, asserted different), and the spec needs a failure hook that deletes its hand-made card. Recorded in SET-REGISTRY under `cmo`/`pev`.
- **Sorted binder pages:** group names are `Page N, 2024 <set>` for a Base checklist (Base left out) and `Page N, 2024 <set> Base` for a hand-made Insert > Base. A hand-made set sorts before `Topps Chrome`, so the seed card is on a later page. Turn with `/^Next pages?$/` ("Next pages" desktop spread, "Next page" phone).
- **Count lines (`1 have, 0 need`, `Cameos: ...`)** sit inside the region `<binder>, open` on desktop but above it on a phone: locate on the page.
- **Set-builder card drawer toast** ("Saved ...") is a `role=status` rendered OUTSIDE the drawer dialog and lives 6 s: `page.getByRole("status").filter({ hasText })`, right after the action.
- **PlayerPicker chip row and chips** carry `aria-label` on generic elements (no role): find them with `getByLabel(..., { exact: true })`, not `getByRole("group")`.
- **Bulk run ledger** is its own `region` named by its heading (`Added <P> to 2 cards`), a sibling of the control's region, not inside it.
- **Failure hook on mobile:** a `context.newPage()` cleanup page left behind the test page stalled (a 7 s step took ~1000 s). `await clean.bringToFront()` fixed it. Using the test's own `page` also works but the failure artifacts then show the post-cleanup page.
- **Parallel builders edit copy live:** Vite serves the working tree, so names can change between two runs. Read `git diff` of the labels module before trusting a red on a name; keep the names in one support module.

**Why:** each of these cost a red run. **How to apply:** any spec on smart binders, cameos/also-on-this-card, or a sorted binder.
Related: [[patterns_failure_hook_that_finishes_every_step]], [[patterns_responsive_duplicates_and_text_locators]]
