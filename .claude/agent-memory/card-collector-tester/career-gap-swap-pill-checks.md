---
name: career-gap-swap-pill-checks
description: What to test when a career-gap card offers one-click team swaps (Tidy Up Team tile "Swap for"): look-alike chips, two-team cards, year notation, title churn
metadata:
  type: feedback
---

Checks that found real friction on the Tidy Up "Swap for" pills (NEO-672 pass, 2026-11-25):

- Non-clickable career chips (Career tile "Team · years") and clickable swap pills share
  the same outlined-pill look; at phone width they stack one over the other. Ask: which is a button?
- The same stint printed two ways side by side ("2024–" in the career, "2024–present" on the pill).
- A two-team card (checklist "Mets / Yankees"): a pill naming the team already on the card
  is really "remove the other team"; the combo card silently becomes a one-team card.
- The swap block sits between two team rows on a two-team card and reads as the next row's header.
- Order is career order (oldest first); for a set-year card the set-year team is the likely pick.
- Enter on a focused pill swaps only, then focus lands on Save & next (good; keep it that way).
- Title regen after a swap can change filler words (team nickname vs full name, "Insert", sport)
  because of the 80-char budget; that is the title rule, not the swap, so confirm with Regenerate
  on an untouched card before blaming the feature.
- A stint that ended years before the set year still counts as "in the career by <year>": no gap,
  so retro/old-team cards never reach the swap.

Driving: build under Baseball > 2024 > Topps, hand-made set > Insert > Base, a player made in
Players admin with 3 stints first, then a pasted CSV; the walk opens itself after the sync.
Phone width needs the headless stage ([[local-build-exploratory-driver]]); reopen the walk from the "N need you" pill.
