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
