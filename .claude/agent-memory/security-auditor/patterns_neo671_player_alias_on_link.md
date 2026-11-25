---
name: patterns-neo671-player-alias-on-link
description: Player saveAsAlias on a Tidy Up link - what held (card-sourced string, admin gate) and the guard gap (primary-name owner checked in home sport only, alias rows fan out to every playerSports sport)
metadata:
  type: project
---

NEO-671 added `saveAsAlias` to the `linkPlayer` answer of `tidyNames.answerName`
/ `answerOfferedName`, writing through `rememberPlayerAliases.ts` (twin of the
team writer).

- **What held: the string is the card's, not the client's.** `applyAnswer`
  refuses unless `cardHoldsName(card, kind, key)`; `printedRefOf` then returns
  the card's own stored spelling (`playerLinks.nameOnCard` or the pending name).
  The client `spelling` fallback is reachable only for `clear`, which carries no
  `saveAsAlias` (Convex object unions reject extra fields). Re-check this on any
  change to `printedRefOf` or the `clear` exception.
- **Gap: owner check vs alias fan-out.** `syncPlayerAliases` writes one alias row
  per sport the player belongs to (home + `playerSports`), but the writer checks
  "another player's primary name" only in `linked.sportId`. With `addSetSport`
  (set sport just added) the unchecked sport is exactly the one the card lives
  in. Effect: that name stops being exactly-one there (fails to the operator,
  not a mislink). Check every sport the row will be indexed in, including the
  `playerSports` name leg.
- **Guards-file pin.** The linkTeam variant had a row in
  `publicFunctionAuthGuards.test.ts`; the linkPlayer variant did not. See
  [[patterns-public-surface-prs-skip-the-guards-file-pins]].
- **Undo leaves the alias.** `clear` restores the card but not the alias (same as
  the team side); the player editor is the only removal.

Related: [[patterns-neo284-team-aliases]], [[patterns-neo602-era-aware-alias-rule]].
