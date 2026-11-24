---
name: macos-sed-i-needs-an-empty-suffix
description: BSD sed -i on macOS takes the next argument as a backup suffix, so a forgotten '' turns the file name into a w command and drops a stray file
metadata:
  type: feedback
---

`sed -i 's/a/b/' file.ts` on macOS treats the script as the backup suffix and the file name as the script. A bare file name starting with `w` is the "write" command, so it silently creates a stray empty file (`ipeVariantTypeSubtree.ts` from `wipeVariantTypeSubtree.ts`) in the tree and edits nothing.

**Why:** hit on NEO-656 while stripping tables from `wipeVariantTypeSubtree.ts`; the stray file showed up in `git status` as untracked.

**How to apply:** use `perl -pi -e` or a short `python3 -I` script for edits, and check `git status --short | grep '??'` after any sed run. Also see [[index-gates-and-tooling]].
