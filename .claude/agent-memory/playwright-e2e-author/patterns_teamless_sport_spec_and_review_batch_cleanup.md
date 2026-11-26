---
name: patterns_teamless_sport_spec_and_review_batch_cleanup
description: NEO-426 "No teams in this sport" spec shape on the walk - toggle helpers in support/teamless-sport.ts, the hand-made commit fixture, proofs that the default worked, the checklist team claim leg
metadata:
  type: patterns
---

**Handles** (`support/teamless-sport.ts`, one implementation for every such spec): `teamlessToggle(page, pressed?)`
(the sport row's Attributes cell `Set feature No teams in this sport` holding an aria-pressed button of the same
name; sport rows only; aria-disabled while the write flies), `openSportAttributes(page, sport)` (drills with
`drillToCustom`, heading `Attributes for <sport> (Sport)`), `pressTeamlessToggle`, `ensureSportHasTeams` (the
`afterEach` that turns the flag off). Match the toast CLAIMS (`TEAMLESS_MARKED` / `TEAMLESS_CLEARED`), not the
sentences. Use `customSport(env)`, never a shared sport: the flag is per sport.

**Fixture that reaches the commit path with no marketplace:** hand-made set under `customSport(env)`, `Insert` >
`Base`, `usePastedChecklist(page, "number,player,team\n1,<Minted>,\n", 1)` (blank team cell = no claim), Sync. The
walk opens on the minted name's Player row (no lookup: a custom sport has no Wikidata mapping); `Sport for this
name: <sport>` is the set's sport by default; a one-token minted name is NOT treated as a name fragment unless a
fuller player shares the word. The walk's name is `tidyUpName({ year, set })` (an insert named Base drops "Base").

**Proof the default worked:** after `createPlayerOnOpenRow` the card needs nothing more (no Team tile ask, the walk
ends on its end screen); with the flag off the same fixture asks for a team (planted red). Committed row `#1 ... No
Team`, no `Card 1 needs attention: no team...` img, no `/^[0-9]+ needs? you/` pill ([[patterns_count_pill_suffix_and_anchored_negatives]]).
The drawer's "No Team for this card" reads pressed; creating a team there un-presses it.

**Checklist team claim leg:** a pasted row naming a minted team for the same teamless player (`3,<Player>,TLC<token>`)
raises a pink printed-name row `Team TLC<token>` on the Team tile (answer it with `createTeamOnOpenRow`), and card 3
commits with its team: this proves "a named, resolved team is kept". A claim that stands UNRESOLVED (held for the
operator) needs BSC's rawTeamName, i.e. a recorded listing. Flag-off leg: `drillToCustom(page, { sport })` does goto
+ one pick (two history entries), so return to the leaf with `page.goto(leafUrl)`, not one goBack.

**Commit-first:** the cards are saved BEFORE the walk opens, so there is no open review batch to cancel or discard,
and a red body leaves no batch refusing the rows' deletes; cleanup is the spec's own rows
([[patterns_match_cards_specs_after_commit_first]], [[patterns_finally_cleanup_without_an_isvisible_branch]]).
A pasted checklist lives only on the page that pasted it: a fresh page's Sync with no checklist says "Saved 0
cards.".

**Real-set fixtures meet the Career tile.** A real set's checklist name that resolves to ONE catalogue player is
career-checked against the card's team at the commit: on the ONIT Arizona State set one such player has no Sun
Devils stint, so the card's blue Career tile appears (find the group `Career <person>`; team half is NB's full
name, which the CSV does not spell; prove "Keep as is" pressed). See [[patterns_career_tile_fixtures]].
Related: [[reference_hand_made_rows_cannot_reach_the_commit_path]], [[patterns_set_no_team_spec_shape]],
[[patterns_failure_screenshot_shows_the_finally_end_state]].
