---
name: patterns_prove_a_team_string_is_on_a_card_and_count_teams
description: Before pre-creating a team for a checklist string prove a card carries it; a two-team card sub-line cannot tell two links from one combined team, so count in Team Management
metadata:
  type: pattern
---

## A heading or registry note does not prove a card carries a team string

Before a spec pre-creates a team to match a CHECKLIST string, prove the string is on a CARD. A Team row/heading
the review once showed, or a SET-REGISTRY note listing a set's clubs, does not prove it.

**Why:** NEO-307 built a retro-rule proof on "Homestead Grays". The registry listed it among the Rickwood set's
clubs because the review had shown it as a heading. It was a career team staged from a player's Wikidata stint:
no card carries it, so the proof could never pass. Staged career teams also tend to be the first team presented.

**How to apply:** read the committed checklist. A linked card's sub-line prints its team's full name; an unlinked
one shows only the attention "!". Or read the alias a team link saved in Team Management ("Also known as"), which
is the raw checklist string. A throwaway probe spec run once and deleted does this in about a minute.
Related: [[reference_neo284_team_alias_fixture]].

## A two-team row needs a team count

The checklist row builds its sub-line as `teamRows.map(teamFullName).join(", ")`, so `Boston Red Sox, Detroit
Tigers` is what BOTH a correctly split card and a card linked to one combined team print. A full-match regex
`(A, B|B, A)( · .*)?` rules out a one-sided link and an `X (unconfirmed)` tail, but not the combined team.

Close it with Team Management's counter. It asks `teams.searchForManagement` from two typed characters and keeps
a row when EVERY typed word starts a word of its full name or an alias. The counter reads `N teams` browsing and
`N match(es)` filtering (`50+ matches` when capped), never "N of M". Filter one half (`Boston Red Sox`) and wait
for `1 match( . [0-9,]+ need attention)?`: a combined team carries the same words in either order, so "1 match"
is the positive and the negative in one read. The browser-side interim count runs over a capped window first,
so anchor a row assert under the counter. Scope to a name, never a bare `,`: real teams and staged career teams
carry commas and other flows' rows share the preview. The master row's first line is the SHORT name (`Red Sox`
or, when Location was left blank, the whole name): match `(Boston )?Red Sox`.
Related: [[patterns_draft_echo_is_not_a_read_back]], [[patterns_team_management_era_alias_specs]].
