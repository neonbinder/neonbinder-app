---
name: commit-path-default-player-needs-a-nameless-card
description: NEO-528 — a stored "Player on every card" fills a FETCHED card only when the listing names nobody; ruled-out and pending names hold it back, and a publisher's checklist cannot clear a name, so most real sets cannot prove the fill
metadata:
  type: reference
---

The checklist commit gives a new card the row's default player only when the card arrives with no
resolved player, no pending name AND no listed name (`listingNamedPlayer`, set in
`convex/selectorOptions.ts` whenever the marketplace card's `players` is non-empty; skip / "not a
person" in the wizard does not release it). Default CAMEOS are added either way.

- BSC names somebody on nearly every card: team-leader / team-checklist cards (`<Team> TL|TC`) report
  the team as a player too, and storyline cards ("1975 World Champions", "Former Teammates") stage as
  names. Probe the set's `players` with the public storefront search before choosing a fixture.
- A publisher's checklist only ADDS players to a card that has none (`publishedChecklistPairs`,
  `apply-published-row`), so an edited upload cannot manufacture a nameless card.
- A card whose listing names the stored player itself ("Pete Rose" stored, "Pete Rose" listed) links
  to him by resolution, so it proves nothing about the default; a planted break would stay green.
- What a fetched set CAN prove: cameos stored before the fetch land on every new card; a ruled-out or
  pending name holds the player back. The player fill at birth is proved by quick-add on a hand-made
  set (`set-selector/player-on-every-card`).
- Watch the wizard's teams step: the client files a NEW card with every printed name ruled out under
  the default player (`teams-on-cards.ts` `cardPlayers`), the server does not (2026-11-14).
- Measured on 2011 Leaf Pete Rose Legacy (75) and 2026 Topps Profiles (25): no card lists nobody, so
  the fetched-fill stays quick-add + unit tests. The wizard's teams step lists only cards with NO team
  claim; a checklist `No Team` or a listed team keeps a ruled-out card off it, so "Cards with no players"
  and the hold-back preview cannot be reached there. Assert the committed card instead: drawer has
  "Add player" and no `Remove player` chip, `Card title` reads `<set> #N <team> <sport>` (a player's card
  reads `<set> <player> #N ...`; when the set's own name contains the player, check the slot before `#N`).
- Rule names out ONE BY ONE to prove which were "not a person": loop on `/^Skip .* — not a person$/` or a
  team step's skip, read the label with `nameOf`, gate each press with `readStep` + `expectStepLeft`.
- A parallel built from Base copies the hold-back and the cameo (Printing Plates: only the Base numbers
  the plate's BSC list has, 43 of 75; its attributes heading reads `<name> (Insert)`).

Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[patterns_pick_a_fixture_name_from_bsc_facets_and_the_resolver]]
