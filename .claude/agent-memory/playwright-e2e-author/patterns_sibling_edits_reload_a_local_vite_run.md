---
name: sibling-edits-reload-a-local-vite-run
description: A local spec red with "element not found" on a link that exists in other runs can be a Vite HMR reload caused by a sibling agent editing files in the same worktree; check the Vite log timestamps
metadata:
  type: pattern
---

In a shared worktree another agent's edits (even `*.test.tsx` under `app/`, or a new scratch spec under `playwright/`) make the running Vite dev server hot-update or full-reload the page under a running spec. Signature: one red on a step that is green on every rerun, the failure screenshot showing the page in a different state than the assertion implies. Proof: the Vite log (`[vite] hmr invalidate ... / page reload <file>`) has lines at the red's timestamp. Rerun; do not touch timeouts.

Also: never create a scratch spec inside `playwright/tests/` mid-run for the same reason; make it between runs and delete it.

Related: [[patterns_local_run_backend_and_vite]], never diagnose timing first (GUIDE).

Pick List / Sales eBay specs (NEO-520): the toggle of a title-only eBay line is named `Pulled <title>, not in NB, eBay <order>` even though no "Not in NB" chip renders; a no-title line is `Unmatched sale, eBay <order>`. A `has:` filter built from a locator scoped to the same group never matches (GUIDE has/hasNot gotcha); build it with `pickRow`.

NEO-645 additions: Vite's `server.watch.ignored` covers only `playwright/report` and `playwright/results`, so a Playwright `--output` inside the project (e.g. `.e2e-local/...`) and any rsync into a frozen run snapshot's `playwright/` both reload pages under running tests. Put `--output` in the scratchpad. With no Vite log at hand, the trace proves it: unzip `trace.zip` to the scratchpad and list `console` events `[vite] connecting...` against the `before` actions; one not preceded by a `goto` is an unprompted reload (a black failure screenshot is the page mid-reload).
