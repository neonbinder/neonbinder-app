---
name: every-title-builder-passes-the-card-name
description: A card's name reaches a generated title only if the builder passes it through cardSubjectName; a new caller of assessListingTitle or assessNewCardListing that skips it silently drops the name
metadata:
  type: reference
---

`cardSubjectName` (lib/cards/unnamed-card.ts) is the one rule for whether a card's name is in its title: not blank, not `Card #N`, not just the players' own names or printed spellings, not a name that already contains them. Every builder must set `inputs.subjectName` from it: the stored-card reader, `buildCardRowForInsert`, `addCustomCard`, and `assessNewCardListing` (give it `cardName` + `printedPlayerNames`). A caller that hand-builds inputs without it gives a title that disagrees with Regenerate, and the parallel build's fit decision then disagrees with the row it writes. Sweep `assessListingTitle(` callers when adding one.

Test fixtures named `Card 1` (no `#`) are real names to this rule; use `Card #1` for an unnamed card.
