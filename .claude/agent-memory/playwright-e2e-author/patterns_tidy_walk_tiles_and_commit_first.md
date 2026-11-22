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
- **A move is proved by the URL** (`?tidy=<card>|first|done`, pushed per move): `not.toHaveURL(before)`.
- **Commit first, walk second.** Match Cards' Confirm saves the cards ("Saved N cards.") and only
  then the walk opens if a card needs a person. Settle whether it opened by reading the "N need you"
  pill once the saved line is up (same render), never `isVisible` on the walk (a ms window).
- **Why it matters:** "Cancel → Discard, nothing saved" no longer exists. Any spec that fetched a
  shared real set and cancelled to keep it empty (the "read-only wizard specs" fixture) now WRITES
  the set (R7a). And a build from a source with any pink card is refused (J3), so a seed must leave a
  base with zero pink before building its parallels.
- **Player/team create can be pressed before the near-match evidence loads** (no perceivable
  loading state on the row): a spec cannot tell "create" from "link offered a moment later".
  Reported as a product gap in NEO-645; do not work around it with waits.

**How to apply:** use `tidy-walk.ts` helpers; never re-derive tile levels from colour; for a spec
that must not write a real set, there is no pre-save exit any more: give it its own set.
