---
name: bsd-sed-has-no-word-boundary
description: macOS `sed -i ''` silently ignores `\b`, so a "rename this identifier everywhere" sed is a no-op; use python re.sub or perl
metadata:
  type: reference
---

On the agent's macOS shell `sed -i '' 's/\bfoo\b/bar/g'` matches nothing and exits 0, so a bulk
identifier rename looks done. Verify with `grep -c` after, or use
`python3 -I` with `re.sub(r'\bfoo\b', 'bar', s)` over a file list. Line-number addressed
`sed -i '' '9s/foo/bar/'` without `\b` is fine.

Also: a loop over an unquoted zsh variable (`for f in $=FILES`) can trip the harness's
removal-safety check; write the file list to the scratchpad and iterate in python instead.

**Rename pattern that worked:** when a widely-used pure function must change shape, keep the old
body under `deriveLegacy…` (same module), repoint its ~15 callers and tests with one python pass,
and leave the old `needsAttention`-style helpers on the legacy rule until the UI flips them.
