---
name: patterns-e2e-run-tool-in-practice
description: How playwright/tools/e2e-run.mjs behaves in a live agent run (NEO-622 step V) — 180 s Bash auto-background vs the slice, plant auto re-seed, digest path quirks
metadata:
  type: feedback
---

Live behaviour of `e2e-run.mjs` seen on its first validation (2026-11-20). Check
the tool's current code before relying on any line here; some may be fixed.

- **The Bash tool moves a command to the background at ~180 s** whatever
  `timeout` you pass, so `wait` with a slice over 180 s gets backgrounded (the default slice is 170 s now, which stays in the foreground).
  That is harmless: you get a task notification with the digest when the run
  ends. Do not start a second `wait` while the backgrounded one runs. Passing
  `--slice 170` keeps `wait` in the foreground.
- **`plant` re-seeds by itself** when the spec has already run on this seed
  (`ranOnSeed` → fresh): seed + setup + bootstrap, about 3-4 min, even for a
  public spec like the landing smoke test. Budget for it, or plant before the first plain run.
- **To exercise the 75 → `wait` cycle**, pass `--slice 5`.
- A plant that went red as planted prints `PASS (exit 0)` in the header, and the verdict
  is the `PLANT RED as planted` line below it. Read that line, not the header.
- After a plant re-seeds, the digest's "ran on this seed ... rerun with --fresh"
  note can point at the run from before the re-seed. Ignore it for a plant.
- The digest's `json:` path can name `setup.json`. The spec report is
  `<runDir>/<project>.json` (e.g. `e2e.json`).
- The screenshot or trace path in the digest can be redacted (`[long token removed]`) or
  clipped at 200 chars. Find the files yourself with `ls <runDir>/results/<project>/*/`
  (screenshot, `error-context.md`, trace).
- `status` on a worktree with no `.e2e-local/` yet can crash (ENOENT on
  run.lock). Any `run` creates the folder.

**Why:** these cost time or misled the first live run. **How to apply:** any
agent driving e2e-run from the Bash tool. Related: [[patterns_local_run_backend_and_vite]].
