---
name: plant-product-breaks-in-a-head-snapshot
description: When another agent's Vite serves the worktree, plant a temporary PRODUCT break (prove-it-can-fail) in a git-archive HEAD snapshot served by your own hmr-off Vite, never in the worktree; specs still run from the worktree
metadata:
  type: patterns
---

A planted product break (e.g. dropping `aria-valuetext` from WizardChrome to prove
`expectWizardStep` can fail) edited in the worktree HMR-reloads every other Vite
serving that worktree (another agent's screenshots, builders' probes). Instead:

- Serve a HEAD snapshot ([[patterns_probe_vite_from_a_head_snapshot]]), `git init` + one
  commit INSIDE the scratch snapshot so `git diff` there proves the restore.
- Run Playwright from the WORKTREE (your edited specs/support) with `APP_URL` at the
  snapshot's port and `--output` in the scratchpad.
- Plant, restart the snapshot Vite (hmr is off), run, then `git checkout --` the file
  in the snapshot and `git show HEAD:<path> | cmp - <snapshot path>`; the worktree's
  own `git diff -- <path>` stays empty throughout.
- Vite strips comments, so a `/* PLANTED */` marker is not visible in the served
  module; prove the plant by the red (e.g. `aria-valuetext` received null).
- Support-file plants (a helper that clicks nothing) live in the worktree: back up
  the file, plant, run, copy back and `cmp`.
- Use a WORKER_INDEX other than the one the other session uses (8 is the default);
  workers 8-11 are one user locally, so never run `bootstrap` for it mid-session.

Related: a green suite can mean the test stopped testing, [[patterns_local_run_backend_and_vite]]
