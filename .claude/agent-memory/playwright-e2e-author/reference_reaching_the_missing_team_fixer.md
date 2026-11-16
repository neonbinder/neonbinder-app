---
name: reference_reaching_the_missing_team_fixer
description: Team fixtures - the missing-team fixer route and the past-era team spec
metadata:
  type: reference
---

**The honest path is a hand-added card** (NEO-330, 2026-10-12;
the missing-team-fixer hand-added-card spec). Quick-add on
a per-attempt hand-made set under the REAL `Baseball › 2024 › Topps`, pick a
reference-catalogue player in the form's PlayerPicker, leave Team empty. No BSC
ref = no automatic team source, so `deriveCardAttention` badges `missingTeam`
at once. The walker's fixer then shows `Players: <name>` and, when no stint
covers the set year, the whole-career fallback: heading `No 2024 team on file —
here’s the whole career. Pick the one on the card.`, chips named
`<team> · <player> played here`, NOTHING preselected (hint `Pick at least one
team, …` is the perceivable proof). Pick a retired one-team player (catalogue:
George Brett, one stint, Kansas City Royals). Linking writes the CARD only;
the catalogue rows are never mutated.

**The wizard is not a route.** A team step has three exits — link (`Search all
teams`), `Add as New Team`, `Skip <name> — not a team` — and `Confirm & Save`
needs every row decided; there is no "leave it for the card". Skip is a false
operator statement ("not a team"), and a NEO-330 fix (2026-10-12) blocks the
old side effect where the skipped card went to the BSC per-card queue and came
back with a listing hint for the very name ruled not-a-team. Read the queue code
before assuming any Skip → hint route exists. Never build a flow on it.

**Unit-only:** the listing's era chips (`The listing names …`) need
`bscTeamName` + a known sport, written only by the background BSC lookup on a
marketplace-linked card. Ctrl/Cmd+Enter save is a keyboard shortcut for the same `save()`; plain Enter is skipped on INPUT/BUTTON targets, so a spec clicks `Save & Next`.

Related: reference neo102 card attention walker,
[[patterns_record_a_fixture_sets_lookups]].

## Past era team fixture

**Fixture shape (measured 2026-10-11, catalogue preview):** 36-card Base,
BSC-only fetch stages `0 new players + 1 new teams`: `New Team: Philadelphia
Athletics` (four catalogue rows, none covering 2025). Brooklyn Dodgers (one
dated row) links on its own at the fetch. Spec: `checklist-wizard-past-era-team-link-commits`. It is the ONLY small
2012–2026 Base found with a player carrying both an ambiguous-era club card
and another club's card (Foxx #34/#35 A's, #36 Red Sox); the BSC scan over
every set naming Phil. A's / St. Louis Browns / Washington Senators / St.
Louis Stars / Detroit Stars found one other, 2016 Panini Pantheon (95 cards,
same-name legends Frank Thomas and Tony Gwynn).

**The era options are an inner scroller.** Focusing the empty `Search all teams` opens a
`max-h-48` (192px) list ABOVE the field: the exact rows first ("same name · <league> ·
<years>"), then close matches. Five options overflow it, so the last era can be clipped:
scroll the list itself to its end, then click the era LINE by a full-match pattern
(`same name . [A-Z]+ . 1901.1954`). A hidden sentence in the step lists all four eras in
ONE node, so a loose `1901.1954` pattern hits that sentence instead.

**No card surface prints an era**: the decision line ("Linked to
Philadelphia Athletics"), the row sub-line, the drawer chip and Player
Management's card list are all `teamFullName`. Prove WHICH era at the pick
(the option's era line), and the link's arrival by the sub-line; the stored
id is a read-only `--inline-query` measurement, not an E2E claim.

**One commit per run decides the fixture's outcome.** The wizard link
(operator past-era link → cards) and a teamless A's card (needs-a-team
fixer with era chips, Fill conflict) are mutually exclusive on #34/#35: a
team decision applies to every card naming the club, and a card resolved at
commit never gets `bscTeamName` (only the post-commit BSC check stamps it,
and only on a teamless card). Removing the team in the drawer later leaves no
listing name.

**Fill's conflict rows need a fillable card beside them.** `FillTeamsControl`
opens its preview only when `fillable > 0`; an all-conflict set gets the
count-only notice "Nothing to fill — N cards still need a team, and they're
your call (N where the listing disagrees)…". So "Listing: X · Fill: Y (from
#N)" is reachable only on a set that ALSO has a teamless card a tier can fill
without a contradicting listing (e.g. a card BSC lists with no team). See
[[patterns_record_a_fixture_sets_lookups]], 
[[patterns_entity_column_shapes_and_cold_sync]].
