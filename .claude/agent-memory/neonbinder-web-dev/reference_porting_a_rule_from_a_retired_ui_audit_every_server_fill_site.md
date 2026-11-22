---
name: porting-a-rule-from-a-retired-ui-audit-every-server-fill-site
description: When main adds a pre-fill/hold-back rule to a UI the branch deleted, the rule must be re-checked at every surviving server site, not just ported to the new tile; NEO-645 merge of NEO-639 found the commit fill ignoring a set-level No Team
metadata:
  type: reference
---

A rule added on main to a screen the branch has deleted (NEO-639: "a set-level No Team holds the
guess back", "a lookup that never answered is not a claim") is not done when the new tile follows it.
The walk has FOUR places that write or preselect a team, each with its own gate; check all four:

- the tile's chips (`TeamFillChips`: client preselect from `suggestedTeamsForCard.inSetYear`);
- the commit's fill (`selectorOptions` chunk, `planCardFill`, gated by `mayFill` and the chunk's `if`);
- the answer-time fill (`teamFillOnAnswer.planFillOnAnswer`, `cardMayTakeFill`);
- Apply to all (`tidyCards.cardTakesTeamFill`, mirrored client-side by `proposesTeam`).

**Why:** the commit chunk ran its career fill BEFORE the No Team stamp and never read the leaf's
default, so in a No Team set every card with a one-team player got the career team instead of the
set's answer. No test caught it because the old wizard (which asked, never wrote) had been the only
guard. A mutation check (delete the gate, watch the new test go red) proved the test was not vacuous.

**How to apply:** for each hold-back rule, grep the four sites and give each a test that goes red
without its gate. Facts that live on the leaf row (set-level default) reach the client as a prop from
the host that already reads the row (`CardChecklist` -> `TidyUpWalk` -> tile props -> chips), not as a
second server field; the server sites read `teamDefaultOf(await ctx.db.get(card.selectorOptionId))`
once per leaf behind a per-call cache (`FillReadCache.noTeamLeaf`, `TeamFillFacts.noTeamLeaf`).
A test that builds a `FillReadCache`/`TeamFillFacts` literal by hand breaks when the cache grows a
field: add the field there too.
