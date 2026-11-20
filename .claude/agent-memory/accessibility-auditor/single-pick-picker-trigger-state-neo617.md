---
name: single-pick-picker-trigger-state-neo617
description: TeamPicker `single` mode (NEO-617) - what held up, and the two gaps (chip x strands focus, picked team never reaches a screen reader)
metadata:
  type: project
---

A single-value variant of a typeahead picker that closes on pick and returns focus to the trigger has two recurring gaps:

- The held-value chip's x button unmounts on click; in single mode that is every clear, so focus always drops to body. Park focus on the (still mounted) trigger after removal.
- Focus returns to the trigger, which sits AFTER the chip in DOM, so a screen reader hears only the new trigger name ("Change team") and never which team was picked. Fix without new copy: give the chip text an id and add it to the trigger's aria-describedby (compose with the caller's ariaDescribedBy). Do not touch the name: visible text == aria-label (2.5.3) and E2E keys on "Add team" / "Change team".

Held up: name/visible text equal in both states, same DOM node so focus survives the label flip, Escape/Enter/Tab contracts unchanged, `labels.change` optional with default.
Note: chip `aria-label="Team: X"` sits on a role-less span (not reliably exposed) - pre-existing.
See [[patterns_aria_disabled_focus_park]] and [[focus-park-pattern]].
