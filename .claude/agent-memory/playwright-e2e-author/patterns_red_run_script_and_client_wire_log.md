---
name: red-run-script-and-client-wire-log
description: NEO-398 tooling for a CI red — red-run.mjs prints each red try's error, screenshot/error-context paths, client-wire.log tail and the server's slowest calls; how its attempt pick works
metadata:
  type: reference
---

For a CI red, start with `node playwright/red-run.mjs <run-id>` from `apps/web` (NEO-398).
It fetches the run's `pw-report-*` and only the red jobs' `convex-logs-*`, then for every
red TRY of every failed or FLAKY test prints the error (ANSI stripped, scrubbed), the local
paths of that try's screenshot and `error-context.md` (open them first, per the
never-timing-first rule), the tail of `client-wire.log`, and the preview's slowest 15
completions in that try's last 20 s (`--window`). All users' calls, not just the test's.

- Attempts: default is the latest, picked per artifact base exactly like the report job
  (`scripts/pick-report-attempts.mjs`); `--attempt <n>` reads the run as of attempt n.
  A run with no red results exits early without fetching server logs.
- `client-wire.log` (support/wire-log.ts, automatic `wireLog` fixture, context-wide):
  console errors/warnings and page errors interleaved with Convex frames (type, request
  id, function path only), last 4000 lines. "(none attached)" = run predates the fixture.
  The opt-in `console` attachment (`captureConsole`) is the whole console.
- `describeFrame` / `wireLine` and `redTests` are unit-tested in `scripts/*.test.mjs`
  (vitest's convex-lib project imports `.ts` from `.mjs` fine).

Related: [[flake-runtime-forensics]], [[action-stall-between-child-calls]].
