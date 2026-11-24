---
name: neo656-minted-team-cut-from-title-turns-card-blue
description: NEO-656 live blue - a minted card name plus a minted team overflows the 80-char title, so saving the team turns a "no mark" card blue "listing title was cut short"; drop the card name; plants for the two Team-tile preselect specs
metadata:
  type: project
---

After J5 (blue reads live data, 2026-11-24) a title cut is never cleared by Save & next, so a fixture
whose title is incidentally cut now leaves a blue mark where a spec asserts none.

- **Mechanism:** a quick-added card with a minted card name (`Mtpcard<token>`), a minted player and a
  minted team (`MTA<token>X`, no Location/Name split, so it cannot shorten) has no room for the team;
  the chip click saves it, the generator drops it, and the card reads
  `Card N … is worth a check: listing title was cut short`; the pill reads "4 need you, 3 to fix".
  Catalogue teams ("St. Louis Cardinals") shorten through their split, so specs on real teams pass.
- **Fix:** omit `cardName` in `addCardViaForm` (the name then equals the player's, which
  `cardSubjectName` drops from the title). Check with `assessListingTitle` via tsx on short and long
  tokens (`pw8d-a1-1`, `pw11m-a2-99999`): `tidyUp` must be false on all.
- **Plants (TeamFillChips.tsx `preselect` memo):** `line.suggestion.slice(0, 0)` reddens the
  lone-set-year spec at the suggested chip; `line.options.map((o) => o.teamId).slice(...)` reddens the
  whole-career spec at the career list (heading flips to "Suggested from career history."), so
  `--expect 'No 2024 team on file'`, not `'suggested'`.

Related: [[patterns-compute-titles-with-tsx-before-a-title-spec-runs]], [[neo656-live-career-mark-and-apply-counts]].
