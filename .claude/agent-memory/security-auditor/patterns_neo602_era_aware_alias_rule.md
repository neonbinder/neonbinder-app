---
name: patterns-neo602-era-aware-alias-rule
description: NEO-602 made the team alias rule era-aware; era numbers became security-load-bearing (NaN/inverted eras break erasOverlap and eraCoversYear in opposite directions), and a gate/commit resolver split must share one guard or a TOCTOU re-opens the fixed bug
metadata:
  type: project
---

NEO-602 relaxed NEO-307's era-blind rule: an alias may equal another team's
primary name when the two teams' `yearsActive` do not overlap. The card's
players (stints) then pick the era at the review gate (`resolveCardTeamName` /
`pickCardTeam`), with an alias-only guard on a year pick.

**Rule 1: once a write-side refusal reads an era, the era is an auth-adjacent
input.** Check every public writer that stores `yearsActive` for whole-year,
in-range, `to >= from` validation (`entityReviewQueue.requireTeamEra` has it;
at NEO-602 time `teams.findOrCreate` / `teams.saveTeamFields` did not). Convex
`v.number()` accepts NaN and +/-Infinity. `{from: NaN}` makes `erasOverlap`
false against every dated row (the collision check passes) while
`eraCoversYear` is true for every year (it survives narrowing). That is the
unsafe direction on both sides. The fix belongs in the shared pure helpers
(treat a malformed era as undated) as well as at the writers.

**Rule 2: gate and commit must apply the same resolver.** The review gate is an
action and the commit prelude is a later mutation that does NOT re-run it. When
the gate gains a guard (alias-only year pick, players), grep the prelude's own
fast path (`resolveTeamForSetYear` calls with `allowPastEra: true`). If it keeps
the old year-only rule, any change between gate and commit (an alias added in
Team Management in another tab), or a commit on the zero-unknowns path with no
`batchId`, links by the old rule silently.

**Rule 3: a helper whose result type documents "link silently only when X"
(`agreesWithYear`) needs every caller checked against X.** Unattended internal
callers (BSC team fill, legacy backfill) tend to take `teamId` and ignore the
qualifier.

Related: [[patterns-neo284-team-aliases]], [[patterns-neo307-alias-reverse-order]].
