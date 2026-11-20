---
name: neo426-teamless-sport-default
description: NEO-426 sport-level "No team" default — birth-only by design; the async BSC-answer door still reaches existing rows; bounded sport scan fails closed
metadata:
  type: project
---

A "default to No team" rule (leaf NEO-556, sport NEO-426) is a birth-time answer.
Stamping it on a re-synced row fired when an incoming team was named but not
accepted (no applyFields / stale baseVersion), breaking invariant 8, and re-stamped
cards an operator had taken out of No team. Fix was to drop the re-sync stamp.

**Why:** "operator took it out of No team" is not persisted (only
teamNoneConfirmedAt exists), so any later default door cannot tell it apart from
"never ruled".

**How to apply:** when auditing a new default-stamp, grep every caller of the
default reader (`defaultFor(`, `stampNoTeam(`). The BSC lookup answer
(`applyBscTeamResolution` → `noTeamDefaultStamp`) still applies defaults to an
EXISTING row when a re-sync attaches a BSC ref and enqueues the lookup — accepted
because BSC's data names no team, but it is the one surviving existing-row door.
A bounded flagged-row scan (`.take(N)`) must fail closed (empty map + warn), and
its test must cover both cap-1 (read in full) and cap (empty). Related:
[[neo102-card-team-none]], [[attention-flag-suppression]].
