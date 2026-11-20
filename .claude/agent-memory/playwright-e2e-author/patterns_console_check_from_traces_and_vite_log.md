---
name: console-check-from-traces-and-vite-log
description: How to check a local spec run for render-loop / console errors without a scratch copy of the spec — local traces outside the repo plus Vite 8's forwarded client console
metadata:
  type: feedback
---

To check the browser console of a real spec run (render loops, page errors), do not
build a scratch copy of the spec with `page.on("console")`: a fresh-only spec then
needs an extra seed per copy. Run the real specs once instead:

- `npx playwright test ... --trace=on --output=<scratchpad dir> --reporter=list`
  (output OUTSIDE the repo; traces carry Clerk testing tokens, so delete them after
  and never attach or quote them). Each `trace.zip` holds `*.trace` JSONL: console
  lines are `{"type":"console","messageType":"error|warning",...,"text":...}`, page
  errors `{"type":"event","method":"pageError",...}`. Scan with `python3 -I`, print
  only type + the first few hundred chars of text, grep for "Maximum update depth",
  "Too many re-renders", "getSnapshot should be cached".
- Cross-check: the Vite 8 dev server forwards the browser console into its own log as
  `(client) [console.warn] ...` / `[console.error]`. Note the log's line count before
  the run and read only what follows it.

Baseline on a healthy run (NEO-574, 2026-11-17): only two warnings per page load, the
PostHog "already initialized" and Clerk "development keys" lines. Anything else is new.

**Why:** the coordinator asks for a console check at release time; the trace route
covers every spec in the one run that also proves pass/fail, on both projects.
**How to apply:** add `--trace=on` to the final run's command; scan; `rm -rf` the
output dir before handing back. Related: [[sibling-edits-reload-a-local-vite-run]].
