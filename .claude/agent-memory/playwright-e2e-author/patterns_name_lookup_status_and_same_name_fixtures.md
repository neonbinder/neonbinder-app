---
name: patterns-name-lookup-status-and-same-name-fixtures
description: NEO-645 walk fixtures — one exact namesake auto-links at the commit (two are needed for a stop); a Wikidata no-match name row can be status "error" while the tile says "No Wikidata match found."; probing the walk by ariaSnapshot when error-context has no page snapshot
metadata:
  type: project
---

- **One exact namesake never stops.** A pasted checklist name that exactly one player in the
  set's sport answers to is linked at the commit: the card is not in the walk at all ("N cards
  left" is one short). A fixture that needs a same-name card to STOP needs two players under
  the name: in Players admin, `addPlayerByHand`, then "Add player", the same name plus a
  "Birth year (optional)" nobody carries, "Create player <name> anyway" -> "Added <name>".
- **"No Wikidata match found." is not proof the lookup row is `ready`.** The tile prints it for
  status `error` too, and a Wikidata miss (and every name in a hand-made sport, which has no
  Wikidata mapping) has landed as `error` (the adapter writes error when the lookup returns
  null). A feature that keys on `status === "ready"` then silently skips every no-match name.
  When a server-offered control never appears for "new" names, read the lookup adapter's
  outcome before suspecting the debounce.
- **Probing the walk when `error-context.md` has no page snapshot** (direct `npx playwright
  test` runs here gave none): a temporary edit that logs `await walk.ariaSnapshot()` and loops
  `skipCard` logging each card's `getByText(/^#\S+ · .+$/)` lines, `--trace=off`, then remove it.
  One run shows which cards are in the walk and each tile's state.
- **Counter-fixtures in place of a product plant on a shared snapshot Vite**: edit one CSV row
  of the spec (e.g. team card's team cell -> another team; "Checklist" -> a person), run, restore
  byte-exact (`cp` backup + `cmp`). Each must go red at the assertion it guards.
- macOS has no `timeout` binary; run Playwright directly with the Bash tool's timeout.

**How to apply:** walk specs on a per-attempt hand-made sport ([[patterns-tidy-walk-spec-on-a-per-attempt-sport]]).
