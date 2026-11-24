---
name: patterns-tidy-walk-spec-on-a-per-attempt-sport
description: NEO-645 walk specs that need a first fetch run rerunnably on a per-attempt hand-made sport + pasted checklist (commit, then the walk opens); how to read axe node detail from the json reporter
metadata:
  type: project
---

Since the NEO-645 commit lands before the walk, a real set can no longer be fetched and left unwritten. A Player/Team-tile spec that only needs "unknown names on cards" runs best on its OWN per-attempt sport (`<pfx><token>` › 2026 › Topps › `<pfx2><token>` › Insert › Base via `drillToCustom`), a pasted checklist (`usePastedChecklist`, columns `number,player,team`), then `syncChecklistButton`: one source, so no Match Cards; the line is `Saved N cards.` (always "cards"), and `settleWalkAfterCommit` opens the walk. No Wikidata lookups (hand-made sport), not fresh-only, registered as a prefix row in SET-REGISTRY "Custom sets".

- Team cell `No Team` = a no-team claim (card not pink for team); a BLANK cell = no claim, so the card is pink "noTeam".
- "Add as new player" leaves a blue newPlayerCareer item on the card it was pressed on ONLY; the fan-out answer empties other cards printing the name, which drop out of `N cards left` at once.
- Fixture players: `drillToCustom({ sport })` first (makes the sport), then the admin tab link "Players" (client-side, 7 s) and `addPlayerByHand`.
- axe failures name only `.w-fit`-style targets; run with `--reporter=line,json` (`PLAYWRIGHT_JSON_OUTPUT_NAME` in the scratchpad) and decode the `axe …` attachment for colours and sizes; the error-context ARIA snapshot names the element's text.

**How to apply:** prefer this over registering a new real set unless the behaviour needs marketplace data (catalogue players, BSC listings).
