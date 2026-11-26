---
name: reference_neo284_team_alias_fixture
description: NEO-284 team-link-remembers-the-name spec on the walk - the New Haven Ravens Rally Raffle fixture, Link to existing team + Remember box, alias read-back in Team Management, the one-sided set picker recovery
metadata:
  type: reference
---

Spec: `tidy-up-team-link-saves-the-printed-name-as-a-team-alias.spec.ts` (renamed from `checklist-wizard-link-team-saves-alias` in NEO-645).

**Fixture:** Baseball > 1996 > `New Haven Ravens Rally Raffle` (BSC only; filed under the year's Unknown row,
reached through All Brands), 9 cards, ONE club the catalogue lacks (`New Haven Ravens`, a recorded no-match so the
New team form opens on the whole name). Sole writer, fresh-only (SET-REGISTRY): the fetch commits the set, so a
local re-run fails at `No cards in this checklist yet.`: re-seed. Fetched with
`fetchOneMarketplaceSetChecklistToTidyWalk` (`support/tidy-walk.ts`), not a hand-rolled sync: the set is one-sided,
so Match Cards' solo path (NEO-255, "Kept all N cards from BSC") is handled there.

**The linked string must be one no other spec can look up.** The alias is live deployment-wide between commit
and cleanup: "whichever club comes first" once linked a career team other specs also stage and changed their
walks ([[patterns_per_worker_data_isolation]]). Mint the fixture team per attempt (`Loc<token> Ali<token>`) and
act on the checklist club BY NAME (`group "Team New Haven Ravens"`).

**Team row handles** (`tidyTile(page, "Team")`): `“<printed>” isn't linked to a team yet.`, `Checking for teams by that
name…` (wait it gone before reading the row), `Not a team`, `+ New team`, group `Link to existing team` holding
combobox `Search all teams` (opens EMPTY, placeholder `Type a team name`: `toHaveValue("")`) and checkbox
`Remember “<printed>” as a name for this team` (held while near-matches load, then ON). Pick by `option` name; the
answer saves at once; the row reads `Change team`. The open `New team: <printed>` form stands in for the search and
its remember box; `Cancel new team` closes it and writes nothing.

**Assert the box by its effect**, not its value: the answer reaches the NEXT card that prints the club (Back returns
to the first), and Team Management (`/admin/teams`, filter by the single token, open the row by its short name)
lists the printed spelling under `Also known as` (on screen twice: the textarea value and the chip; the
`Current aliases` list is the chip list; `toHaveValue("")` is the positive for "gone").

**Recovering from a wrong SportLots slot on a preview:** the `MultiSourcePanel` chip (`Remove <label>` then
`Confirm detach <label>`) takes the slot off; the base picker auto-reopens and the set is back to the fresh-sync
shape. No reseed. A staged career team's row waits on the deployment-wide 5-wide Wikidata pool: assert the
`Checking for teams…` text going away rather than a fixed delay.
Related: [[patterns_draft_echo_is_not_a_read_back]], [[reference_neo255_one_marketplace_surfaces]].
