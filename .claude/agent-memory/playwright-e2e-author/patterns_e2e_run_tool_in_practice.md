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
- The digest's "convex/: CHANGED since the push (rerun with --push)" compares
  against e2e-run's OWN push stamp. A push by the workspace's deployment script
  (its seed path runs `convex dev --once`) does not update it, so the warning can
  be stale. Check the deployed code by a function or behaviour only the
  current commit has before you trust or dismiss it.
- `seed` does not start Vite. After `stop-vite`, its setup phase dies on
  `net::ERR_CONNECTION_REFUSED` at the sign-in hop (the reset and import still
  ran). Harmless: the next `run --setup` starts Vite and runs setup again.
- **Several authors on one runner:** a `wait` then `run` in two calls loses the lock to
  another author's queued command almost every time (exit 3). Put the retry in ONE
  backgrounded Bash call: `for i in $(seq 1 15); do wait; run --slice 0 <specs> > file; [ rc != 3 ] && break; done`,
  then read the file on the notification. `status` plus the newest run's `job.json`
  (`"specs"`) tells whose run holds the lock. In zsh, a spec list in a plain variable
  does not word-split; use an array for `git add -- $F`.
- **`setup ✘ not since seed` can be a dead seed, not a pending phase.** `setup` warms
  the deployment (syncs Manufacturers, etc.) before it asserts a cold column, so once
  its FIRST attempt after a seed dies part-way, every later attempt reds earlier (e.g.
  the paused branch's "No manufacturers available" with the listbox full). Every
  `run` then dies in setup for every author. Check the run dirs since `seededAt` for
  a first setup red; if so, no spec can run until a reseed: hand back "needs fresh
  seed", never reseed a shared worktree deployment yourself.
- `status` on a worktree with no `.e2e-local/` yet can crash (ENOENT on
  run.lock). Any `run` creates the folder.

**Why:** these cost time or misled the first live run. **How to apply:** any
agent driving e2e-run from the Bash tool. Related: [[patterns_local_run_backend_and_vite]].
