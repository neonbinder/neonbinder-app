---
name: patterns-neo426-teamless-sport-default
description: NEO-426 teamless-sport "No team" default (sport-row teamlessSport stamp) — server auto-stamp of a suppression flag; the re-sync door that ignores an unaccepted incoming team; operator un-confirm has no stored marker; who sees setByUserId
metadata:
  type: project
---
NEO-426 lets the server stamp `teamNoneConfirmedAt` (the missing-team
suppression flag, see [[patterns-neo102-card-team-none]]) WITHOUT an operator
answer when every player's HOME sport row carries `teamlessSport`
(`{setAt,setByUserId}`, same shape as [[patterns-neo556-copied-down-decision-stamp]]).
Rebuilt 2026-11-19 on NEO-556's shared `noTeamCardVerdict`; auth was clean
(setter + list query requireAdmin, registered; player-sport reader internal).

**Escalation test for any server-derived default of an operator answer:**
compare it with what the client wire can already send (`teamNone: true` per
card from an admin). A default fed into the same verdict grants nothing new
at BIRTH. It is the doors that never had an operator answer that bite.

**Trap 1 (re-sync door): the verdict reads what the row WILL HAVE, not what
the incoming data CLAIMS.** On an existing row, an incoming
`card.teamOnCardIds` is written only through `applyFields` + `baseVersion`;
unaccepted or stale, `effectiveTeamIds` stays empty and the verdict says
`stamp` although the data named a team (rule 8). Any "stamp on re-sync" must
also hold on the incoming card's resolved teams. NEO-556 never stamped on
re-sync, so this door is new whenever a later default adds it.
Resolved in NEO-426 by removing the re-sync stamp: the sport default stamps
at birth, addCustomCard and the BSC no-team answer only (NEO-556's shape).

**Trap 2: operator un-confirm leaves no trace.** `updateCard teamNone:false`
and `addCustomCard teamNone:false` only clear/omit the stamp; nothing records
"operator wants a team". A later automated stamp path that runs on existing
rows (re-sync; a no-ref hand-added row matches by number via
`existingIdByNumberNoRef`) silently re-suppresses it. Ask for a stored
decline marker honoured by every automated stamp, or no stamp on existing rows.
NEO-426 took "no stamp on existing rows".

**setByUserId audience:** whole-doc `selectorOptionDocValidator` readers
(getSelectorOptions, getSelectorOptionById, getInsertTreeByVariantType) are
all requireAdmin and already ship `createdByUserId` and `noTeamDefault`;
`getAncestorChain` projects (boolean only). No non-admin reader of sport rows
exists; brandView projects platformData only. Same audience, so a note, not a
finding — re-check if a non-admin reader of selectorOptions docs appears.

**Absent-vs-failed lookup trap (still true):** a predicate that refuses on
`teamLookup === "failed"` but passes on `undefined` treats "no lookup" as "no
team"; the shared verdict's `hasBscRef && teamCheckDoneAt === undefined` holds.
