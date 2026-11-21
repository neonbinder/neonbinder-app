---
name: pre-fix-snapshot-is-the-planted-break
description: For a bug-fix spec, serve a git-archive snapshot of the commit BEFORE the fix as the prove-it-can-fail run; run the green one from a snapshot of the fix commit so builders' edits cannot HMR mid-run
metadata:
  type: patterns
---

A spec that proves a bug fix has a natural planted break: the product without
the fix. No edit, no restore, and it shows the spec reds on the real bug, not
on a hand-made break.

- `git archive <pre-fix sha> apps/web` and `git archive <fix sha> apps/web` into
  two scratch folders; symlink the worktree's `node_modules` and `.env.local`
  into each; in each snapshot's `vite.config.ts` only: `hmr: false`,
  `resolve.preserveSymlinks: true`, a scratch `cacheDir`
  ([[probe-vite-from-a-head-snapshot]]).
- Serve one at a time on the ticket port, and run Playwright from the WORKTREE
  (your edited spec) with `--output` in the scratchpad. Check which snapshot is
  listening (`lsof -a -p <pid> -d cwd`) before each run.
- A fresh-only spec needs a re-seed between the green run, the red run and the
  other project's run (three seeds; `agent-convex.sh --seed` then setup and
  bootstrap, about 4-5 min each).
- If the fix is server-side too, the deployment holds the FIXED server for both
  runs. The red then proves only a client-side cause. Say so, or push the
  pre-fix server for the red run.

NEO-625 example: the pre-fix bundle red at `reconcile toBeHidden` with the alert
"Couldn't save these sets. Nothing was changed ..." beside "Save 3 sets", which
is the production symptom; the fix bundle green.

Related: [[plant-product-breaks-in-a-head-snapshot]], [[a-green-suite-can-mean-the-test-stopped-testing]]
