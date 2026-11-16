---
name: patterns_set_league_and_card_league_specs
description: NEO-569 set League row / card League select handles and the no-league held-back dashboard spec shape
metadata:
  type: reference
---

- Set row: group `League` (exact) in region "Set attributes panel"; chips are `listitem`s (filter by the league's full name, sr-only text), `Remove <full name>` buttons, combobox `Add league` (listbox `Add league suggestions`; a league the set has is not offered). Save toast text is `Saved League` / `Cleared League` (use `.first()`: duplicated live region). Born-with league = sport default LINKED from the catalogue (Baseball: Major League Baseball); NCAA is a Baseball catalogue league (option name starts "NCAA").
- Card drawer: combobox `Card league` under Teams, value is the league's full name; picks announce `Saved League` in the drawer's status. Use existing catalogue leagues for minted teams so no league is created (no recorded-name pool needed).
- A set born with the sport's league needs the REAL sport (`drillToCustom` sport "Baseball"); a hand-made set under `E2E Test Sport N` has no default league. Drill to `Insert` > `Base` with `drillToCustom(build)`, not selectOrCreate on the variant columns of a fresh set.
- `noLeague` held dashboard spec: `/testing/seed-dashboard?syncHeld=noLeague` writes eBay only; the panel's Report button must be scoped `page.getByRole("dialog").getByRole("button", ...)` (the Sync status one sits behind the overlay).
- macOS `sed -i` needs an extension arg; use python for in-place edits in scripts.
