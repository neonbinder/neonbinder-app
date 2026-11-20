---
name: no-team-defaults-share-one-gate
description: Any new "this card saves as No team by default" rule rides NEO-556's noTeamCardVerdict, decided in the commit chunk on the card as born; sport rows cannot carry the set Team default
metadata:
  type: project
---

A new default that stamps a card "No team" (set-level No Team, NEO-556; teamless home sport, NEO-426; anything later) goes through ONE gate: `noTeamCardVerdict` in `convex/lib/selectorTeams.ts`, asked in the commit CHUNK on the card as it will be born (after `settleCardTeamAnswer`, beside `insertNoTeamStamp`), and again by `applyBscTeamResolution` once a held-back lookup answers. Credit the stamp with `stampNoTeam` (operator, else the default's `setByUserId`).

**Why:** the first NEO-426 build put its own predicate in the commit ACTION and passed it as `teamNone`; NEO-556 then landed a different gate for the same outcome, and the two disagreed on lookup states ("checklist"), default players (NEO-528 adds them in the chunk, invisible to the action) and the background stamp. Re-planned 2026-11-19.

**How to apply:** plan the default as "a reason to stamp" feeding the shared verdict, never a parallel predicate; store the flag with `{setAt, setByUserId}` if a background path must credit it. The set Team default cannot sit on a sport row (`TEAM_EDITABLE_LEVELS` excludes sport, and a sport-wide cascade is unbounded), so a sport-wide fact needs its own field. The client mirror (teams-on-cards) may be one-sided (ask when unsure), never the reverse. See [[teams-step-membership-is-synchronous]], [[wizard-answers-are-not-stored-sync-is-one-time]].
