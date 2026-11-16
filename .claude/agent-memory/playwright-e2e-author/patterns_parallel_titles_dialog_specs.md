---
name: parallel-titles-dialog-specs
description: NEO-535 Card titles dialog on parallel copies: how to engineer fixtures from the builder, the box-beats-carry trap, duplicate status lines, full-reload false reds
metadata:
  type: pattern
---

- Engineer a failing/carried title from the product's own builder, not by guess: run `assessParallelCopyTitle` / `carriedTitleRest` (tsx script over the fixture CSV) and pick a parallel NB name whose description length puts exactly the wanted cards over 80. A parallel's description is `<year> <set> <insert> <parallel name>` and is never cut, so renaming a parallel (allowed with or without cards) is the lever. Rename BEFORE the card fetch for the ticker dialog, AFTER a build for the single-parallel dialog.
- Step 1 of the title order includes the box: once a parallel holds "Set name in titles" and the box title fits, the hand edit is never reached. Prove the carried edit on a parallel nobody has fixed (a second parallel), not the one the box was saved on.
- The dialog and the door status are mirrored by an sr-only status line that arrives late: `getByText(saved/"Every title fits now. Nothing to fix.")` is a strict-mode violation on some runs and not others. Use `.first()` on every such sentence.
- Dialog handles: dialog "Card titles", section `heading level 3` (`<parallel> N titles`), textbox "Set name in titles" (scope suffix only with >1 section), rows `Title for #<n> <player>`, "Save titles", "Not now" (a confirm only after an edit). Ticker door `Fix N card titles`, checklist door `Fix card titles` (beside `N need you`).
- A red with two page loads after a click and no navigation in the spec is a Vite full reload (new-dependency re-optimisation after pulling new commits), not product: the page loses its sync notice. Count `goto`/page loads in the trace before theorising; rerun.
- A fresh-only spec on a local deployment needs reseed + setup + bootstrap per run (about 3 minutes); batch the other specs behind it in one script.
