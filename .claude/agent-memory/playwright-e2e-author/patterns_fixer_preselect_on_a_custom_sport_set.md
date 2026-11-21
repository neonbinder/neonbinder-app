---
name: patterns-fixer-preselect-on-a-custom-sport-set
description: NEO-639 - prove the MissingTeamFixer's set-year preselect, tie focus and set No Team on a hand-made custom-sport set with minted players built on /admin/players; walker closes by Escape mid-walk; Space proves focus among twin chips
metadata:
  type: feedback
---

The fixer's preselect rules need only hand-added cards, never a fetch: build the
players with careers on `/admin/players` in `customSport(env)` (minted names, no
lookup, re-runnable), `page.goBack()` restores the set builder's drill, then quick-add
the cards with `Add <player>`.

- Fixer chips are toggle buttons named `<team> · <player> played here`; assert
  state with `getByRole("button", { name, pressed })`. Heading lines are plain text
  (careerHeading copy; `it’s` uses U+2019, match with `.`).
- Mid-walk the walker has NO "Done (Esc)" button (only at "All clear"); close it with
  `page.keyboard.press("Escape")`.
- "Focus lands on one of two same-kind chips" without `.first()` or CSS: press Space,
  expect exactly one chip pressed and that one `toBeFocused()`; Space again to undo.
  Focus on Save or the picker presses no chip, so a planted focus break goes red.
- The walker walks cards in number order: number the cards to fix the order.
- Set-level "No Team for new cards here" (confirm "Yes, set No Team") leaves cards
  already there teamless and badged, so the fixer is still reachable under No Team.

**Why:** found writing checklist-missing-team-fixer-preselects-one-set-year-team.
**How to apply:** any fixer/walker spec. Related: [[patterns_set_no_team_spec_shape]],
[[patterns_custom_sport_player_specs_skip_lookups]].
