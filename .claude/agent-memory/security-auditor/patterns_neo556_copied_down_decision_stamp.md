---
name: patterns-neo556-copied-down-decision-stamp
description: NEO-556 set-level No Team — a server-stamped decision ({setAt,setByUserId}) copied down to rows and reused as the attribution for later background card stamps; what held, and the one-boolean-two-caps trap
metadata:
  type: project
---

NEO-556 added `selectorOptions.noTeamDefault: {setAt, setByUserId}` and two
admin fns (`cardNoTeamBulk.noTeamTargets` query, `applyNoTeamPage` mutation).
Audited 2026-11-14; auth was clean.

**What held (re-check on any copy of this shape):**
- The stamp is minted only in the one writer from `requireAdmin`'s subject;
  every other appearance (internal cascade arg, conversions' `SourceData`,
  copy-down at node creation) is derived from a stored row, never a public arg.
  Grep `v.object({ setAt` — only schema + an internalMutation arg.
- Card-level requests are booleans (`teamNone`) destructured OUT of
  `updateCard`'s arg spread before the filtered patch loop; the stamp is
  assigned after. Same rule as [[patterns-neo102-card-team-none]].
- Paged run cursor is JSON {i, t, c, r}: r binds the root, t binds the target
  id at index i (the [[patterns-neo528-multi-target-cursor]] fix), c is the
  Convex paginate cursor under a `withIndex` eq on the server-derived target,
  so a forged c cannot leave that row's cards.

**Accepted, worth knowing:** background paths (BSC lookup answer, parallel
build) credit `teamNoneConfirmedByUserId` to whoever set the default, possibly
long before and possibly since demoted. It is an audit-trail attribution, not
an authority check. Full-doc selectorOptions validators already ship
`createdByUserId` to admins, so `setByUserId` there adds no new audience.

**Trap:** one `truncated` boolean covering two different caps (row walk vs
card count) makes the UI copy wrong in one direction or the other; the run
honours only one of them. Ask for one flag per cap.
