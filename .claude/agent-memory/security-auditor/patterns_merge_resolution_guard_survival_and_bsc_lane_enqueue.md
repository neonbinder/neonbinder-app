---
name: patterns-merge-resolution-guard-survival-and-bsc-lane-enqueue
description: Delta-audit techniques - prove a merge kept a branch's auth/validator lines (line-survival diff), and how to judge a new enqueue onto the one-slot bscTeamPool lane for amplification
metadata:
  type: project
---

**Merge kept the branch's guards?** For each guarded file, take the branch's own `+` lines
(`git diff $(git merge-base <pre-merge tip> <main parent>^) <pre-merge tip> -- f`), sort -u, and
`comm -23` them against `git show HEAD:f | sort -u`. Anything missing is either a hunk the other
side's final shape replaced (fine, read it) or a dropped guard / pin (blocker). Faster and more
reliable than reading a `--cc` diff, which shows only conflicted hunks.

**New enqueue onto `bscTeamPool` (one slot, deployment wide):** check (1) the scheduler call
targets `internal.bscTeamPool.enqueueBscTeamChecks` (internal, chunks 25 per mutation,
self-schedules the rest), so the caller schedules ONE job per page, not one per card; (2) the
caller's entry point is admin-gated or internal; (3) the work item re-reads the row via
`cardChecklist.getForBscTeamCheck` (internal query, BSC id from `platformData.bsc.ref`, the slot)
and answers `notNeeded` with no call when the row is gone or already settled, so rebuilds and
stale items cost a mutation, not a BSC request; (4) a looser caller-side predicate than
`needsCheck` is harmless for the same reason. Remaining cost is volume (copies x parallels)
paced by one slot, with 429 push-back and a 30-min operator hand-off: a note, not a finding,
while the trigger is admin-only. Compare [[patterns-wikidata-pool-abuse-surface]], where a
signed-in-only path enqueuing is the finding.

**Merged agent-memory index (MEMORY.md) resolution:** a raw "lines in parent not in merge"
diff overstates loss, because main's own index can already carry a duplicated block (old long
descriptions appended) and links to files a PR deleted. Classify each lost line by its link
target instead: exists in the merge tree AND linked exactly once = fine (a description variant
was kept); target absent from the merge tree = a dangling link correctly dropped; exists but
unlinked = loss. Then check every file in `git ls-tree <merge> <dir>/` is linked once. An
unindexed file that is also unindexed in the merge base and both parents is pre-existing, not
the resolution's fault: a note, not a finding.

**Merged golden snapshots (`__snapshots__/*.snap`) and union types.** A snapshot file one side
created can come back from a merge regenerated: `git diff <branch parent> <merge> -- f | grep -c '^-[^-]'`
must be 0 and every `+exports[` key must name a fixture the other side added. A `--cc` hunk
showing `-1,0` on one parent means that side never had the file, so it is not a conflict.
When one side adds a required field to a union (`& { teamless: boolean }`) and the other adds
a variant, read the merged variant's construction site: the default it picks is a semantic
decision (unknown = not teamless = ask), not a mechanical one. Line-survival alone misses it.

**A branch that redefines an enum value's meaning, merged with a side that writes it.** When the
branch changes what a value means (NEO-639: `teamLookup: "failed"` went from "a claim, hold the
pre-fill back" to "missing data, pre-fill as usual"), grep the OTHER side for new writers of that
value and read each writer's comment: if it still documents the old meaning, ask whether the
writer relied on it (a hold-back that silently became a pre-fill). For "failed" the only new
writer was the Unlink revert, which keeps the listing's own team strings, so `listedClaims` still
holds a real claim back; the stale comment is a note. Also check a new union variant without the
field a branch reads (`p.request` on a `kind: "new"` player): the merged default (no stints) is
the safe one; typecheck alone proves the field access, not the choice.
