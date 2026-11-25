---
name: patterns-left-out-pills-and-plural-team-fixture
description: NEO-665 "Left out to fit" pill list locators (regex keeps the sr-only ", " raw) and a single-token fixture that proves a team is named only by its exact words (no plural fold)
metadata:
  type: feedback
---

**Pills.** What a title left out is `getByRole("list", { name: "Left out to fit" })`
with one `listitem` per item (Tidy Up Listing title tile, card drawer; the Card
titles step's lines are unnamed because they sit inside an `aria-describedby`).
Every pill but the last carries an sr-only ", ". `toHaveText([regex, ...])` on the
listitems matches a RegExp against the RAW text ("Minnesota Twins, " with the
trailing space), so `/^X,?$/` fails; use `/^X(,\s*)?$/` (string expectations are
whitespace-normalised, regexes are not). "Nothing left out" = the named list
`toHaveCount(0)`, paired with the purple "Set name shortened to fit." note.

**Why:** a first run went red on exactly that trailing space.

**Plural-fold fixture (Red vs Reds).** The single-token rule forbids a two-word
minted team, so the plural rides on a ONE-word team: parallel name
`tupred<token>` padded with `x` to 36, team = that + "s". Under a saved set-name box
the parallel's card reads "<box> <parallel> <player> #n" (the box takes the
parallel's name after it); the sport is a quiet cut taken before the team, so the
team must overflow by more than the sport: 36 chars does on every worker/token.
Check with `npx tsx` over `assessListingTitle` + `leftOutOfTitle`, and
`roughlySays(title, team)` from `convex/listingShortName.ts` to show the old fold
would have hidden the pill. ATTEMPT_TOKEN ends in a digit, so "<token>s" always
folds under the old rule.

**How to apply:** any spec asserting left-out pills or a team-in-title rule; plant
the old fold in `titleNamesTeam` (`roughlySays`) to prove the assert bites.
Related: [[patterns-compute-titles-with-tsx-before-a-title-spec-runs]].
