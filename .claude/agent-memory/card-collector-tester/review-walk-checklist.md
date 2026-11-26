---
name: review-walk-checklist
description: Collector checks to run on any per-card review walk / tidy-up dialog proposal (stop count, keyboard, trivial disagreements, scope of Apply to all)
metadata:
  type: project
---

Checks that found real problems when reviewing a per-card walk (One-Card Tidy Up, 2026-11-21):

- Count the stops: if "should"/blue tiles keep a card in the walk, auto-links and career confirmations turn a 600-card set into ~600 stops. Ask whether blue-only cards stay in.
- Enter = Save & next and Esc = close collide with inline forms (team search, New Team, title edit). Keys must belong to the focused field first.
- "Sources disagree" must not fire on differences the shared name matcher treats as equal (accents, Jr./Jr, punctuation, case), or every Acuña is pink.
- "Apply to all" needs a scope a dealer recognises (this insert/subset vs whole set), and team apply-to-all must respect invariant 8 (traded players).
- A must that needs the card in hand (sticker vs on-card auto) cannot be answered while building from a checklist; offer "Not sure yet".
- Source columns that name a marketplace break the no-marketplace-named copy rule; today's wording is "Marketplace" vs "Your checklist".

**Why:** these were the high-frequency friction points for 300-600 card builds with rookie-heavy inserts.
**How to apply:** run this list first on any walker, wizard or bulk-review plan. See [[hobby-vernacular-and-team-livery-in-ui]].

Found live on the built walk (2026-11-22 pass):

- Answer, then press Enter: after a tile answer unmounts its buttons, focus often lands on the answer's own "Change". Enter then reopens or undoes the answer instead of Save & next. Test "click an answer, press Enter" on every tile type, not just Enter from the card header.
- A one-letter misspelling must surface the NB player it is close to (same team, same year) on the tile itself. "X is new to NeonBinder" with only Add as new player in green invites a duplicate player.
- Search results that are only names (three identical "Baltimore Orioles") can't be picked; every option needs league + years, as the player search already shows.
- Cards the parser already recognised (a team card whose name is its team, a "Checklist" row) should answer themselves (Not a player / No team), or they become a stop on every team card of a flagship set.
- Read the Listing title tile as a dealer would: a title that keeps filler ("Base Insert", "Baseball") while it leaves out the player or the team, or a card with no player at all that is not pink.
- Count stops per set: of 9 pasted rows, 4 were stops, and 3 of those could have answered themselves.

Found on the no-stored-answers walk (NEO-656 pass, 2026-11-24):

- "Edit" on a linked answer that re-asks the question must not clear the link until a new answer is picked: Edit then Esc should leave the card as it was, not pink.
- End-screen counts: check that a bulk "Apply to all", a chip saved in place, and a fix followed by Back all land in "fixed". Count only Save & next presses and the numbers lie.
- A blue card's "Skip: not ready to list" may do nothing; then "Review the skipped card" can open the blue card, not the pink one. Check the button opens what it names.
- Edit a card's team in the card drawer, then open the walk: the stored title can still carry the old team, with a "Left out to fit" chip naming the new one.
- Attention chip "N need you, M to fix" can count one card twice; read it as a dealer would (how many cards?).
