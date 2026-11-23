---
name: count-pill-suffix-and-anchored-negatives
description: The checklist's "N need you" pill gains ", M to fix" when M counted cards are pink; an anchored regex ending in `you$` then makes every toHaveCount(0) pass vacuously
metadata:
  type: feedback
---

The checklist pill's name is "N need you" / "1 needs you", plus ", M to fix" when M of the
counted cards have something pink (NEO-645). Its text is its name.

- Assert the WHOLE string where the spec knows its cards: work out pink vs blue per card
  (pink: sources disagree, player name, team name, no team, autograph, title over 80;
  blue: NB picked, new player career, career gap, title cut, variation over 65, no player in
  title). Blue-only reads with no suffix, and asserting the bare "1 needs you" then proves no pink.
- Never write the pill as an inline anchored regex (`/^[0-9]+ needs? you$/`). When the name
  grew a suffix, every `toHaveCount(0)` / `toBeHidden()` on such a regex went green forever.
  Route every "pill gone" check through `needsYouPill(page)` (support/tidy-walk.ts) so the
  one regex tracks the product.

**Why:** a copy change to a count label silently turned negative asserts into no-ops in two
specs (bowman parallels, level-type-name cut) until a grep caught them.

**How to apply:** when a label that specs anchor on changes shape, grep for the anchored form
(`you$`, `exact: true`) and fix the negatives first; they never go red on their own.
Related: [[patterns_negative_asserts_pass_on_a_dead_page]].
