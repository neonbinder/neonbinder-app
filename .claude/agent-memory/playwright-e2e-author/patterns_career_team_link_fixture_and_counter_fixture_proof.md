---
name: patterns-career-team-link-fixture-and-counter-fixture-proof
description: NEO-490 rule 6b (same-name player linked by a career-team stint begun by the card year) on a per-attempt hand-made sport; and proving a spec can fail with a spec-only counter-fixture when a product plant would hit a shared Vite/deployment
metadata:
  type: project
---

**Reaching rule 6b alone** (`narrowSameNamePlayersByCardYear`, convex/players.ts): rules 4-6 must
pick nobody first. Recipe that works on a hand-made sport (no Wikidata, not fresh-only):
set year 2020; two `Cal <tok>` players in Player Management (b. 1990 then b. 1991 — the second is
the demoted `Create player <name> anyway` and FORKS because both are dated), each ONE stint at the
same team: NEAR 2010-2012, FAR 2024-2025. Both spans miss 2020 +-2 (no survivors, so no rule 4/5),
no Hall of Fame (rule 6 skips), every candidate has a career (6b's precondition: one empty career
= "ask"), and only NEAR's stint BEGAN by 2020 (NEO-574) -> NEAR is linked at commit, no stop.
Do NOT give FAR a stint covering the card year: that is rule 4, a different feature.
Team: make it in the career editor (`Add team` -> `Search teams` -> "No matches." -> Enter ->
dialog `New team: <name>` -> `Create team <name>`); the second player picks `^Add <team>` in
listbox "Team typeahead results". Player list rows are buttons whose name holds `b. <year>`.
Read-back: "Cards for <name>" list vs "No cards link to <name> yet. Link them from a set's checklist."

A linked card with nothing else never enters the walk, so add a second card with an unknown name:
the walk opens (positive) with "1 card left" and only `#2 · …` (the negative for #1).

**Counter-fixture as the planted break.** When the shared snapshot Vite/deployment forbids a
product plant, copy the spec to a temp file in the same folder with ONE fixture value changed so
the rule must NOT fire (here FAR 2015-2016: both stints begun by 2020 -> 6b tie -> "Which <name>
is this?" on #1, "2 cards left"), run it, read error-context.md to confirm the red is that stop,
then `rm` the copy. It proves the spec tells the rule's two outcomes apart.

**Answered name rows drop the name from the card header:** after "Not a player" the header need
not say `#1 · <name>`; locate a card by `^#<n>( · .+)?$` across an answer.

Related: [[patterns-tidy-walk-spec-on-a-per-attempt-sport]], [[patterns-tidy-walk-tiles-and-commit-first]].
