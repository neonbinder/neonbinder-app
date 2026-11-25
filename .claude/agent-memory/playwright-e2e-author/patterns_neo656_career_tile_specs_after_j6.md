---
name: neo656-career-tile-specs-after-j6
description: NEO-656 J6 Career tile fixtures - a Team-tile Change closes a gap with no stint, two same-team cards prove Save & next clears siblings, untick the card's own team to stage a new player's gap; plants that redden them
metadata:
  type: project
---

Rewrote the two Career tile specs after J6 dropped stored career checks (2026-11-24):

- **Gap without a second player:** a per-worker hand-made Baseball set, one pre-made player (Players
  admin, one stint), six pasted rows on catalogue teams. Two rows on the SAME uncovered team prove
  "Save & next writes the default stint and clears his other cards": the walk lands on the card
  after the sibling (`expectCardsLeft` drops by two).
- **Team-tile Change closes a gap:** `group "Team <team>"` > `Edit <team>` > textbox "Search existing
  teams" > option `Link to <covered team>` (assert count 1 before click). The Career tile goes; no
  stint is written (read back in Players admin).
- **New player's career as written:** put the card's team in his Wikidata career and UNTICK it on the
  Player tile's "Career teams to add:". After create the Career tile is blue with list "Career on
  file for <player>" holding only ticked teams NB holds; a ticked team on the card gives no tile.
  `createPlayer` drops teams NB lacks and unticked ones.
- **Skip leaves blue:** end screen `{ fixed, stillToCheck: 1 }`, checklist mark
  `Card N … is worth a check: team is missing from the player's career`, pill "1 needs you".
- **Plants:** `TidyUpWalk.tsx` `if (gaps.length > 0) {` + `setAfterSave` → `< 0` (lands on the
  cleared sibling); `tidyNames.ts` createPlayer's `excluded.has(...)` continue → never (convex plant;
  gap never appears). Card order is now the card number (B4), so no "whichever first" branch.
- Another builder sharing the worktree holds the run lock often: `wait`, then rerun; a `seed` you
  queued may be absorbed by their plant's reseed, so read `status` before assuming freshness.

Related: [[neo656-live-career-mark-and-apply-counts]], [[patterns-career-tile-fixtures]].
