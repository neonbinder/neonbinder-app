---
name: agent-memory-index-overwrite
description: A builder that Writes (not appends) an agent's MEMORY.md wipes the whole index; spot it with diff --stat on .claude/agent-memory/*/MEMORY.md
metadata:
  type: feedback
---

On a delta audit, run `git diff --stat <range> -- .claude/` and look at every
`MEMORY.md`: a large deletion with a one-line addition means an agent wrote the
index with Write instead of appending, dropping hundreds of pointers. The
memory files stay; only the index is lost, so nothing reads them.

**Why:** NEO-645 morning round cut the web-dev index from ~320 lines to 1.
**How to apply:** report it as a should-fix condition (restore the base
index from the range's parent, then append the new line). It is public-repo
hygiene, not an exposure, but merging it loses another agent's knowledge.
