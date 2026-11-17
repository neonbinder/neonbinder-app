---
name: stacked-branch-merge-after-parent-squash
description: Merging main into a ticket branch stacked on another ticket's branch, after that parent squash-merged — git's merge base predates the parent, so "clean" auto-merged hunks silently duplicate code; re-merge with the true base
metadata:
  type: reference
---

When ticket B was branched off ticket A's branch and A then squash-merges, `git merge origin/main`
on B picks the last main commit B merged as the base. A's commits are on BOTH sides relative to
that base (B has A's earlier tip, main has A's squash), so git treats A's code as two independent
additions. Result (NEO-556 on NEO-528, 2026-11-16): the 29 reported conflicts were the visible
part; three "auto-merged" hunks were silently wrong — a `vi.mock` block and an 18-line
`addCustomCard` block duplicated, a doc paragraph duplicated, and a registry section main had
retired re-added. Typecheck would not catch any of them (the test file is excluded; the duplicate
`const`s happened to be in different scopes or comments).

**How to apply:** build the true base and re-merge every two-sided file with it.

- `X=$(git merge-tree --write-tree <A's tip B forked from> <last main B merged> | head -1)`
- Classify: `git diff --name-only $X ORIG_HEAD` vs `git diff --name-only $X origin/main`. A file
  only one side changed must equal that side exactly (check with `git diff --quiet <side> -- f`).
- For files both changed: `git merge-file` with `$X:f` as base; the conflicts left are the real
  ones (29 → 6 here), and its clean output replaces git's.
- Then check B's own additions survive: every `+` line of `git diff -U0 $X ORIG_HEAD` present.
