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

Related: [[hand-made-rows-cannot-reach-the-commit-path]], [[capture-checklist-slug-probe]]
