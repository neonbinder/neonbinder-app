---
name: neo656-linked-name-rows-and-edit-reask-sport
description: NEO-656 J1 walk specs - a linked team is the card's line (no per-name row), the lone open name loses its button suffix ("Not a team"), and Edit on an NB-made player link re-asks in his own sport after a second facts call (reopenName)
metadata:
  type: project
---

Learned rewriting the two "Linked for you" specs (2026-11-24):

- **A linked team is the card's own line**, `group "Team <team>"` with `Edit <team>`, read from
  `ctx.teams` (onCard). The per-name row (`TeamNameRow`) has the same group name, so prove "no
  per-name row" by the group count being 1 plus the absence of the name row's own controls ("Which
  team:", "Not a team"), and J1 by `getByText(/Linked for you/)` and `getByRole("note")` at 0.
- **Button suffixes follow the count of OPEN names.** `Not a team${suffix}` / `Not a player…${suffix}`
  carry " <printed>" only when the tile has several rows. Once a linked name stopped being a row, a
  card with one linked + one unknown name shows plain "Not a team": scope it to the row's group and
  use the exact bare name.
- **Edit on a player link NB made (set history, Hall of Fame) re-asks in the player's OWN sport.**
  Walk facts (`tidyLeafFacts` gate items) cover only names pending at walk open, so a name linked at
  the commit had none and Edit re-asked in the set's sport as new to NB (the 2026-11-24 gap). Fixed:
  `WalkMemory.reopenName` runs the facts call again after the clear lands, and lookups wait on it
  (`factsLoading`). The spec's `expect(Link to <name>).toBeVisible()` at 7 s covers that extra call;
  a planted `const run = null` in `reopenName` turns the set-history spec red at that line.

**How to apply:** any walk spec reading a linked row, pressing Not a team/Not a player on a mixed
card, or pressing Edit on an automatic link. Related: [[neo656-tidy-walk-helpers-skip-apply-end-screen]].
