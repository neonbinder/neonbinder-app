---
name: check-sibling-worktrees-before-planning-a-rule-change
description: Before planning work driven by a freshly rewritten product rule, check the other open ticket worktrees and todos for a branch already building its core; plan on top of it and sequence the merges
metadata:
  type: feedback
---

A product rule rewritten in the wrapper CLAUDE.md is usually rewritten because one ticket hit it, and that ticket's branch often already carries the shared core (helper module, validators, the monorepo CLAUDE.md text). Grep `../../todos/*.md` and `git diff --stat origin/main...HEAD` in each sibling `worktrees/neo-*` before designing a second copy.

**Why:** NEO-616 was asked to move a matcher to "names first" (rule 7) and update CLAUDE.md, while the unmerged NEO-591 branch already held the names-first core, the number-preference helper and the CLAUDE.md rewrite, and shared 11 files (schema stored-row validator, published checklist check, commit path) with NEO-616. Building in parallel would have meant two cores and a hand-resolved conflict on validators.

**How to apply:** list the overlapping files, put "sibling merges first, then merge main" as step 0, start only the units whose files don't overlap, and mark the order **needs Jason** with a fallback branch if the sibling stalls.
