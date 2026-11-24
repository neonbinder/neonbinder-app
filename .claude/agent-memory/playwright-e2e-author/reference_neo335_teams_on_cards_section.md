---
name: reference_neo335_teams_on_cards_section
description: What survives of the NEO-335 teams-on-cards work after NEO-645 - the "N need you" pill, the card badge, the drawer Next-card walk, and the set-name shortener on the Listing title tile
metadata:
  type: reference
---

The wizard chrome (`Step x of y`, subtitles, `Confirm New Players & Teams`, Teams / Card titles / Save steps,
`Team for <owner>` radio lines, `Skip for now, card <n>` walker) was replaced in NEO-645 by the Tidy up walk
(`support/tidy-walk.ts`; handles in [[patterns_tidy_walk_tiles_and_commit_first]]). Team answers are the Team
tile's rows now ([[patterns_walk_on_nno_cards_and_team_chips]], [[patterns_team_apply_to_all_fixture]]).

**The pill.** ONE amber header button, text `<N> need you` / `1 needs you` (+ `, M to fix` when some are pink); its
visible text is its name, so an exact-text assertion IS the exact-count assert (`needsYouPill` is the anchored
regex; a spec that knows its cards asserts the whole string). Clicking it opens the walk (`openTidyWalk`). A
sibling sr-only status exists per checklist. "Which rows are flagged" is proved by walking, not by a filter chip
(no `Show only cards needing attention`, no post-save banner CTA, no `Fill teams` header). The row badge keeps
the accessible name `Card <number>[, ...] needs attention: no team on this card yet`.

**Reaching identically-numbered cards:** open any drawer, click `Next card` until no `Remove team …` chip is
present; read which chip from the `Team: <name>…` node; click Next once and wait the chip gone before walking to
the next teamed card. Order is `compareCardNumbers`. See [[patterns_find_one_card_among_nno_cards]].

**Set name in titles.** An insert row's name joins the title core after the set's, so a long set name cuts titles
and raises a "To check" Listing title tile. On that tile: button `Shorten the set name for every card`, textbox
`Set name in titles`, `Was “<set>”`, `Save and apply to all N cards`, status `Set name saved. The other cards'
titles are updating.`, then each card's title reads with the short name. Settings panel row `Value for Short name
for titles` (setName + card-prefix levels), toast `Saved Short name for titles`; drawer cut note `Auto title was
cut short — rewrite it`. A short name replaces set AND insert names; the maker stays. Spec:
`tidy-up-long-set-name-shortened-for-every-card-title.spec.ts`.
