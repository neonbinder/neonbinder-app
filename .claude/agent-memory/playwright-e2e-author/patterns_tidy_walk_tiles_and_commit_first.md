---
name: patterns-tidy-walk-tiles-and-commit-first
description: NEO-645 per-card Tidy Up walk — tile = region named by heading, pink = description "To fix"; the commit lands BEFORE the walk, so there is no cancel-without-saving and read-only fetch fixtures stop being read-only
metadata:
  type: project
---

The NEO-645 walk (`support/tidy-walk.ts`) replaced the entity-review wizard and the attention walker.

- **A tile is a `region` named by its h3** ("Player", "Team", "Career", "Autograph", "Listing title",
  "Sources disagree", "More about this card"). Its level is NOT a name or a colour: it is the
  section's accessible description from an sr-only span ("To fix", "To check", "Waiting"). Branch
  with `tile.filter({ has: page.getByText("To fix", { exact: true }) })` (`pinkTile`) and count it;
  assert with `toHaveAccessibleDescription`.
- **A name row is a `group` "Player <printed>" / "Team <printed>".** Unanswered = it holds "Not a
  player (checklist, team card, stadium)" / "Not a team"; answered = it holds "Change". Controls get
  a " <printed>" suffix only on a multi-name card, so match them with `( .+)?$`.
- **"More about this card" is on every card**: the positive marker that a card (not the end screen
  "Done (Esc)") is up. "Looking at this card" is the context-loading skeleton.
- **A move is proved by the URL AND the screen.** `?tidy=<card>|done` changes BEFORE the next card
  renders, so an `.or(card, end)` check right after the URL passes on the OLD card. Prove it with
  `not.toHaveText(before)` on the card's "#…" lines (or the end screen when the URL says `done`).
- **Settle a name row before branching:** the row says "Checking for players/teams by that name…"
  and holds its create until the lookups answer; reading it earlier picks the wrong branch.
- **Old seed parity (origin/main bulk "Add remaining players as new"):** created every settled
  player that its own sport did not make ambiguous, so a NEO-424 cross-sport preselect was CREATED,
  not linked; pick steps linked the top candidate. Over-80 titles were kept and stay pink; J3
  (`blocksParallelBuild`) blocks a build only on name/disagreement pink, not on titles.
- **Commit first, walk second.** Match Cards' Confirm saves the cards ("Saved N cards.") and only
  then the walk opens if a card needs a person. Settle whether it opened by reading the "N need you"
  pill once the saved line is up (same render), never `isVisible` on the walk (a ms window).
- **Why it matters:** "Cancel → Discard, nothing saved" no longer exists. Any spec that fetched a
  shared real set and cancelled to keep it empty (the "read-only wizard specs" fixture) now WRITES
  the set (R7a). And a build from a source with any pink card is refused (J3), so a seed must leave a
  base with zero pink before building its parallels.

**How to apply:** use `tidy-walk.ts` helpers; never re-derive tile levels from colour; for a spec
that must not write a real set, there is no pre-save exit any more: give it its own set.

## Driving the walk by keys, and a blue card on a hand-made set (NEO-645 walk spec)

- **Keys reach the walk only from inside the card.** Enter/Esc are the dialog root's `onKeyDown`;
  after a tile answer the pressed button may unmount and focus falls to `body`, where Enter does
  nothing (a vacuous "held" pass). Click the card's header line (`tidyCardHeader`, a `tabIndex=-1`
  div) first: focus lands on the card outside any control, where Enter = Save & next, Esc = Save
  for later. Prove "Enter held while pink" by the NEXT move: Skip right after it must land on the
  second card, not the third.
- **A pasted `?tidy=` and the sitting.** The sitting (`passed`, sessionStorage per tab) survives a
  `page.goto`; a bad id falls back to the first card NOT passed. Press the pill (new sitting) before
  any deep-link proof, or the fallback lands past a skipped card and proves nothing.
- **Blue on a hand-made card = a whole-team title cut.** A card with no linked player keeps its card
  name OUT of the title ("2024 Topps <set> Base #3 <team>"), so pad a one-token team to ~70 chars:
  it never fits, the title without it always does, and the badge reads "Card <n> is worth a check:
  listing title was cut short" (pink is "needs attention: …"). A 45-char team fit and stayed clean.
- **Planting a break needs a Vite nobody else is using**: a plant hot-reloads product code, so on a
  shared snapshot Vite it would red every other author's run. Hand the plant back instead.
