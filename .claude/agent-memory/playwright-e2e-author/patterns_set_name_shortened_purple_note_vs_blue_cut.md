---
name: patterns-set-name-shortened-purple-note-vs-blue-cut
description: NEO-645 Listing title tile - a box-built title that fits with nothing left out is a purple role=note "Set name shortened to fit." (plain tile); a box title that still drops something stays blue; fixture shapes for both
metadata:
  type: feedback
---

Since 2026-11-23 (NEO-645) a title built from the row's "Set name in titles" box that fits
with `tidyUp: false` and `dropped: []` stores NO `listingTitleTruncated` flag. In the walk:

- Purple case: Listing title tile has no description (plain), and
  `titleTile.getByRole("note").filter({ hasText: /^Set name shortened to fit\.$/ })` shows.
  TidyNote is `role="note"`, so filter by text (a note takes no name from content).
  It shows only while the stored title equals the live preview: a typed title hides it
  (a cheap negative paired with the positive). It never brings a card into the walk, so
  the fixture card needs another stop (a pink Team tile on a no-team card) to be seen.
- Blue case on the box: give the card something the box title still has to drop, e.g. a
  70-character no-Location team via `createTeamInCardForm` in `addCardViaForm`'s
  `beforeSubmit` (card numbers cap at 32, too short to be dropped on a short box).
  Tile reads "To check" and a `Left out to fit: <team>` note; the purple note is absent.
  Save & next marks it seen, so the walk still ends "All tidy" and the pill clears.
- Box titles replace the whole description (year, maker, set AND the insert level): the
  insert name is not in a box title. Compute with `assessListingTitle` first
  ([[patterns-compute-titles-with-tsx-before-a-title-spec-runs]]).
- Outside the walk, the checklist mark proves it: `cardAttentionMark(page, n, "listing title
  was cut short")` count 0 on the box-fit card, paired with a card that still has it.
- `addCardViaForm` with `playerName` fills only the Card NAME (no player link): since
  NEO-645 change 4 that name is in the title (`subjectName`).

**Why:** the rule flipped the same morning; specs asserted the old blue check on box titles.
**How to apply:** any spec that shortens a set name or asserts a box-built title's flags.
Plant: negate `titleFitsOnShortName(previewData)` in TitleTile.tsx (client-only, so it
does not touch other authors' server writes).
