---
name: neo656-refetch-asks-again-and-catalogue-career-skip
description: NEO-656 re-fetch proof (a ruled-out name is pink again, cards-left count, commit-merge plant) and walk loops over catalogue players that must Skip a Career tile
metadata:
  type: project
---

- **Re-fetch asks again (B3a).** Nothing stores "Not a player", so a re-sync of the same checklist
  re-adds the printed name to the card's pending list (commit's `mergePendingNames` with the
  incoming `card.pendingPlayerNames`) and the walk reopens on that card with a pink Player row.
  Proof: `expectCardsLeft(n)` right after the reopen counts the re-asked card. Plant: pass
  `undefined` for the incoming list in that merge call (convex push via the plant tool): the count
  drops by one and the spec goes red at "the walk has N cards left". A card the operator linked by
  hand stays linked (the card's own link is data on file); no "Linked for you" note (J1).
- **Catalogue players in a real-set walk.** A 2026 set's cards often carry a live Career gap (the
  seed's careers end before the set year). A hand-written loop that Saves & nexts every unpinked
  card writes stints onto shared catalogue players: branch first on
  `save visible && tidyTile("Career").count() > 0` → `skipCard`, and count it.
- **Linked team row shape (B11) also hits helper functions inside specs:** after "Search all teams"
  links a printed club, read `group "Team <club>"` + `Edit <club>`; the `Team <printed>` row is gone.
- **Fresh-only plant:** a fresh-only spec already run on this seed needs `seed` before
  `plant --expect` (with --expect the tool skips its own re-seed).

Related: [[neo656-tidy-walk-helpers-skip-apply-end-screen]], [[neo656-live-career-mark-and-apply-counts]].
