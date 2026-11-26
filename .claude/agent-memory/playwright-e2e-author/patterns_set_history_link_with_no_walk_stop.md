---
name: patterns-set-history-link-with-no-walk-stop
description: NEO-645 walk — how to prove an automatic link "makes no stop" AND show its purple "Linked for you" note in one spec, by giving one card a covering stint and leaving the other with a blue career gap; and how to prove such a spec can fail without a product plant
metadata:
  type: feedback
---

**NEO-656 (2026-11-24): the purple notes are GONE (J1).** A linked team is now the card's own line
(`group "Team <full name>"` + `Edit <full name>`, one `Team ` group, no `Team <printed>` row) and
`getByRole("note")` is 0. The two-card shape below still proves "no stop"; the blue card is now
Skipped, never Save & next (that writes a stint). Notes about the note are historical.

The purple notes ("Linked for you: …" from `linkedForText`, "Team filled from the player's …" from
`teamFillText`) are rendered ONLY inside the walk's tiles. There is no drawer copy. So a card with
nothing pink or blue is never shown, and its note is never visible. To prove both the "no stop" and
the "why" in one spec:

- **Two cards, one rule.**
  - Card A's player has a stint that covers A's linked team by the set year. A makes no walk card:
    `expectCardsLeft(n)` plus `walk.getByText(/^#A · /)` toHaveCount(0). Read A's link back in the
    card drawer.
  - Card B's linked team is NOT in that player's career. B is in the walk for the blue career gap
    alone (Career tile description /To check/, `No <team> in the career by <year>.`). B's Team tile
    shows `pinkTile(Team)` count 0, no "Not a team", the group `Team <printed>` with the full name,
    and `getByRole("note")` with the note's exact text.
- **The career gap comes only from a pre-existing player.** It is raised for a card whose player
  EXISTED before the sync, and only on teams that were printed or linked by name. A Q1-A filled
  card (`teamFill`) never gets a gap, because the gap reads the incoming team ids. A filled card
  therefore shows its "Team filled from…" note only if something else (a title cut, say) puts it
  in the walk.
- **A Players-admin stint can predate the team's era.** For a team whose era starts after the set
  year, a 2025– stint on a 2026– team is accepted, and it does not change the team rule: one row is
  never put to the players (they are consulted only past two candidates).
- **"Can fail" without a product plant** (on a shared snapshot Vite): run a throwaway copy that
  drops the fixture the rule needs (here, the saved card's nickname team). It must go red at the
  feature's own assert (`pinkTile(Team)` received 1). Delete the copy afterwards.

**Why:** the walk's membership is attention-only (count = pill = walk), so "linked for you"
cannot be read off a clean card. The old wizard's Decided list showed every auto-link; the walk
does not.

**How to apply:** for any auto-link rule (set history, Hall of Fame, careerTeam, Q1-A fill), make
one card clean and one card carry a known blue stop, then assert the note on the blue card. Use
tolerant regexes for "Change"/"Change team"/"Change player" and for "To check".
