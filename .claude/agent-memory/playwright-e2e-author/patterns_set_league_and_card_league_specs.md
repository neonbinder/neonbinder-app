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

## Round 2 additions (NEO-569 coverage audit)
- Wizard Teams-step proof rides the Roanoke ONE-marketplace fixture: add NCAA to the Base row's League list BEFORE the fetch (openAttributesPanel, "Add league"), stage a second same-window career team that is already in the catalogue (e.g. an NCAA program: no lookup, no New Team step), assert the NCAA team's radio is checked and the club's is not. The planted proof is skipping the "Add league" step. Do NOT use the `bscLookupOutcome` `.or()` here: a tie left unselected looks exactly like a cooldown, so the `.or()` cannot go red (GUIDE: BSC no longer 429s alone, no new `.or()` branches).
- No player with an undated NCAA stint exists, and the wizard needs a From year, so a single-team "college only" pre-fill cannot be staged; the set-league-sensitive path is the two-teams-in-window tie.
- Card league follows its teams on ANY change to the team set (no pick survival). Teams in two leagues -> League blank with the "different leagues" line.
- Team Management has two selects labelled "League" (filter and the team's); pick the team's by `.filter({ has: option "— none —" })`.
- Inherited row: `Remove <league> from this <noun>` only when the inherited list has more than one league; a lone inherited league has no x.
- Planting a server fault: use `if (x) throw` guards, an unconditional `throw` fails the Convex typecheck and the push aborts; deleting a returns-validator field makes the first card read red. Plant a pickerContext leagueIds assignment as `leagueIds = undefined`, not a throw (a throw breaks the whole Variant Types drill before the assertion).
