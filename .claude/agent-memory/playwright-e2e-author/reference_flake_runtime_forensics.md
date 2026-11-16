---
name: reference_flake_runtime_forensics
description: Runtime proof for an intermittent red - flake forensics, backend stalls (create gate, heavy-write saturation, workpool restart), socket reconnects, commit headroom ruler, unstyled-launch signature
metadata:
  type: reference
---

Techniques proven during the NEO-81 set-selector flake sweep. Use when the user
demands PROVEN runtime evidence, not conclusions-by-elimination. (Originally
written against the Maestro suite; the technique is artifact-agnostic. Map "step
timestamps" to the Playwright report / JUnit step timings and "failure
screenshot + hierarchy" to the screenshot + `error-context.md`.)

## Capture artifacts FAST: they expire
`gh run download <run-id> -n <shard results artifact> -D <dir>`. Each shard's
artifact holds the failure screenshots, `error-context.md` and the report data.
All shard JOBS can show "success" even with failed specs (the gate job is what
reds), so read the gate and the per-spec results, not the shard's conclusion.
Never upload or commit traces (Clerk testing tokens).

## The strongest single technique: the in-run cross-client control
When spec A fails waiting on some query/render, find another spec B **in the same
run** that exercises the SAME query on the SAME deployment in an overlapping
window. Compare their step timings. If B resolved it in ~0.3 s while A stalled
16 s, the backend/query/data are healthy and the fault is **A's client**
(per-client websocket/subscription delivery), not the backend. This is MORE
probative than a fresh single-user reproduction because it uses the actual failing
deployment. Also check A's OWN earlier steps: if A's socket delivered shallower
queries fine right before, the stall is one specific late-added subscription, not
a socket outage.

## Concurrent-writer / contention check (refute or confirm)
Map every shard's per-spec execution window against the stall window. A
write-contention theory needs a spec that WRITES the same docs running DURING the
stall. (NEO-81: the only Topps-Chrome writer finished 58 s before, so contention was
refuted by timing.)

## Which runtime log sources are retrievable
- **CI preview Convex logs: retrievable, but only for ~15 minutes.** Take the
  deployment name from the `E2E / seed` job log, then `npx convex logs --deployment
  <name> --history 2000 --success --jsonl` as a logged-in CLI. It is read-only and
  needs no deploy key. `--history` caps at whatever the deployment still holds
  (~983 entries on a busy preview, 14 minutes), so **pull them while the run is
  still finishing or not at all.** It streams after printing the history, so wrap it
  in a timeout. macOS has none (no coreutils), so use `perl -e 'alarm 60; exec @ARGV' npx convex logs ...` (exit 142 is the alarm, the file is complete).
- **PostHog query API: NOT accessible from repo env** (only the client ingestion
  key; HogQL needs a personal API key that isn't present).
- **Shared dev backend:** read-only `npx convex logs`/`env list` works, but `npx
  convex run` on an admin-gated query fails (`requireAdmin` needs a user JWT the CLI
  lacks), so measuring a query needs driving the app.

## Gotcha: don't over-read the loading UI
EntityColumn's idle "Sync X" buttons render whenever `syncStatus?.status !==
"syncing"`, true for BOTH `null` (resolved, no sync) AND still-pending (undefined).
So idle buttons do NOT prove `getSelectorSyncStatus` resolved. The only hard client
fact is EntitySelector's "Loading X…" = its `getSelectorOptions` is `undefined`.

## A re-run DELETES the previous attempt's artifacts: download first
`gh run rerun` bumps the run to attempt 2 and GitHub drops attempt 1's artifacts
(`/actions/runs/{id}/artifacts` returns `total_count: 0`). Cost paid on NEO-236:
the screenshot for the one red spec was gone before diagnosis started. **Download
the shard artifacts BEFORE asking for a re-run.**

What survives a re-run is the attempt-scoped job log:
`gh api repos/O/R/actions/runs/{id}/attempts/1/jobs` for the job ids, then
`gh api repos/O/R/actions/jobs/{job_id}/logs --allow-escape-sequences | sed 's/\x1b\[[0-9;]*m//g'`.
That tells you WHICH spec and WHAT error, never what the screen showed.

## Size a real fixture from a GREEN run before writing an assert on it
Before asserting on a list whose length is the marketplace's business, read the
count from the last green run's rendered text or the convex-logs
`adapter_sync_call` lines: NEO-300 found 2026 Bowman nests 141 parallels, which ruled
out asserting a row inside a disclosure that renders in a dialog's non-scrolling
header; and a 156-set reconcile Save measured 1.0 s, which is the measurement a
sanctioned longer wait needs recorded at the site (GUIDE hard rule 3), not an
inherited large number.

## A sync-failed panel: prove the marketplace stalled, not the code
A red step whose screenshot shows a column's `Sync failed: could not load variants.
BuySportsCards failed, nothing was changed.` (with Retry/Cancel) is read from the
seed's convex logs: the matching `fetchBscSelectorOptions` `adapter_sync_call` line
carries `error_class: "timeout"`, `attempt: 3` and `filters_call_ms` of about 30000,
beside `BSC API request timed out after 10s (attempt n/3)` lines. Then prove the
request did not change: the same call (same level and parents) in the last green
seed, and `git diff <green sha> <red sha>` over the adapter, its caller and the spec
step. Identical code that answered in about 60 ms on green is a marketplace-side
stall: a full rerun, not a spec edit. Never add a Retry click to absorb it.

## Bound a backend stall with the create gate

When several specs on different shards go red within a few minutes and every
failing step is a WRITE waiting to return, do not diagnose them one by one. Bound
the window first.

**The ruler:** the hand-made "create" step (add a custom entry and wait for the
form to close) runs dozens of times per CI run (every hand-made ancestor of every
set-selector spec) and measures one thing: how long `addCustomSelectorOption` took
to return. Healthy was about 1 s on the previous suite (79/80 samples in one
run); re-measure on Playwright step timings. Pull the step durations from each
shard's report, sort by wall-clock, and the window falls out: a handful of 10 s
outliers between runs of 1 s samples.

**Then read each red against the window** with its own in-flight proof, from
the failure screenshot and `error-context.md`:
- the confirm `Create` button disabled while `creating`;
- `PlayerPicker` row `Create player <x>` reading `Creating…`; `NewTeamDialog`
  button `Creating team <full>` / `Creating…` (a portalled dialog);
- `CardChecklistItem`: `Confirm?` still rendered after the confirm click
  (`handleDelete` only flips it back after `await deleteCard`);
- `commitCardChecklist: finalize failed — Your request timed out performing too
  many system operations.` in the wizard's error card: Convex's per-mutation
  system-operation time budget tripped by the finalize phase under load;
- `RenameEntityControl`: the input is `aria-disabled` while saving; an enabled one
  means saving is FALSE (the keypress never reached `commit()`), a different class.

**What starts it:** look for the heaviest write that began right before the first
slow sample (a large inserts commit: hundreds of names created, hundreds of cards
written in chunks, creation-time enrichments scheduled). Every other red was a
bystander.

**Verdict shape:** the specs are correct; a rerun (or the next push) is the honest
answer, and the product findings are the finalize budget and the banner that says
"Nothing was saved" while chunk-written rows sit behind it. Never harden a
bystander spec against a window.

## Heavy write saturation vs blanket stall

[[reference_flake_runtime_forensics]] catches the window where
*everything* slows. There is a second, commoner shape: the deployment is
saturated by a **class** of work, so per-transaction cost scales while a 3-op
write stays fast. A healthy cheap-write measurement therefore **disproves a
blanket stall and proves nothing else**.

(The numbers below were measured on the previous Maestro suite; re-measure them
from Playwright step timings before quoting them.)

## Rulers that see it

Pick steps whose cost scales and whose fixture is pinned, then compare the SAME
step across runs of the same branch:

- **A big single transaction**: `Save N changes` on Group Parallels
  (`applyParallelGroupings`, ~4 ops/entry); the rendered N proves the fixture
  identical across runs.
- **A big query**: `Confirm card matches` to the `Review Changes` dialog
  (`diffChecklistAgainstExisting` over 220 rows). Healthy 0.33 s.
- **The entity-lookup drain**: the first "still looking up" going away per wizard
  spec. Healthy 1-26 s; a bad window puts six shards at 47-110 s at once.

Take per-step durations from the Playwright report / JUnit timings of the runs
being compared. Sanity-check with the median spec duration over the specs common
to both runs: a ratio near **1.00** with a handful of 1.3-2.0x outliers is this
shape; a globally slow run would move the median.

## Two run-level tells that precede any spec
Both come from `gh api .../actions/runs/<id>/jobs` plus the seed's own log:
- **The scripted reset's duration** (seed-step start to the first seed log line).
  Healthy is 10-16 s. It loops `resetSetBuilderDataFromCli` until `complete`, so
  its wall-clock is a direct read on how much residue the preview carries.
- **The seed step's own length.** Same code, same fixture: a +35% seed is the
  deployment, not the branch.

## The reset gap that makes late runs of the day worse
`runSetBuilderReset` (`convex/selectorOptions.ts`) drains exactly: selectorOptions,
cardChecklist, cardCrossListings, players, playerAliases, teams, teamAliases,
franchises, leagues. **`entityReviewQueue`, its batches and `checklistCandidates`
are not in that list**, and the only thing that removes them is the hourly `reap
abandoned entity-review batches` cron against a **24-hour** idle threshold. Several
CI runs in one day stack their review rows on one preview: a failure snapshot
showing `N checklist reviews are in progress here` with N in the thousands is that
residue, and the reset's cost climbs run over run (15 s, 69 s, 246 s observed
across one day). Ask for the reset to drain those tables: a product/CI fix, never
a spec wait. See feedback never diagnose timing first.

## Patterns backend restart stalls workpool for recovery scan

A backend restart can stop a workpool until its recovery scan runs, 5 minutes
later. A spec waiting on the 180 s lookup ceiling goes red on "still looking
up" even though nothing in the spec or the flow is wrong.

**Signature:** in the Convex logs, `Transient error while executing action`,
then no lookups at all for exactly 5:00, then lookups resume.

**Why:** the gap is the pool's own recovery interval, so a longer ceiling is
not the answer, and the 180 s budget stays as it is.

**How to apply:** read the logs for the gap before forming a theory. If the
signature is there, it is not a spec bug: rerun the whole workflow, never only
the failed jobs. If it is not there, the mechanism is something else, so keep
looking. See [[reference_flake_runtime_forensics]].

## Convex connection lost is a socket reconnect

A failure screenshot showing
`Error: [CONVEX A(<module>:<action>)] Connection lost while action was in flight  Called by client`
is **not** a slow backend, a short timeout, or an action that threw.

## Mechanism (read out of the pinned client, not the docs)

The string exists in exactly one place:
`node_modules/convex/dist/esm/browser/sync/request_manager.js`, inside
`RequestManager.restart()`. `restart()` is called from the sync client's WebSocket
**`onOpen`** handler (`browser/sync/client.js`), i.e. on every RE-connect. Queries
are resubscribed and mutations are replayed; actions are not idempotent, so every
in-flight action is rejected with this message.

So the fact asserted by that banner is narrow: *the tab's websocket was torn down
and re-established while an action was outstanding.* It says nothing about how far
the action got, and the action normally keeps running to completion on the server
after the client has given up.

Reconnect triggers, all in `browser/sync/web_socket_manager.js`: `ws.onclose` (any
network or server-side close), `FailedToSendMessage`, and
`closeAndReconnect("InactiveServer")`, which the client fires **itself** when it
has received no server message for `serverInactivityThreshold`, hard-coded to
`6e4` (60 s). Sixty seconds of silence on the socket is sufficient on its own, so
a long action with a quiet subscription is the exposed shape.

## Proving transport vs product regression

Never raise the spec's timeout and never call it a flake without a mechanism.
Discriminate from evidence already in the run:

1. **The in-run cross-client control** ([[reference_flake_runtime_forensics]]) is decisive
   here. Compare the same step's duration across every shard's report: nine
   sibling specs making the identical call against the same preview, seconds either
   side, all returning in seconds, means the deployment, the action and the
   marketplace were healthy. A deterministic regression cannot pass nine times and
   fail once.
2. **Check the deploy timeline**: `gh api .../actions/runs/<id>/jobs`. A Convex
   deploy or the seed job inside the window disconnects every client at once.
3. **Browser-service Cloud Run logs timestamp the fetch.** The per-worker
   `/credentials/<site>-.../token` requests are logged the instant
   `fetchCardChecklist` starts, so they pin the action's start time and show whether
   the marketplace side ever got into trouble.

## Before blaming a paged or chained write

A write that pages at N rows per transaction does **nothing at all** on a fixture
smaller than N: one clear page, one write page, zero `scheduler.runAfter` calls,
and every guard gated on `from > 0` is unreachable. `SET-REGISTRY.md` records each
real set's measured card count; read it before theorising about a chain that never
ran.

## The product finding that rides along

The raw Convex error string reaching the operator is worth filing on its own: they
lose a minute-long marketplace sync, are shown `[CONVEX A(...)]`, and are offered
no retry. Report it; never work around it in the spec.

See also feedback never diagnose timing first.

## Wizard save wait is a commit headroom ruler

`Confirm & Save` -> `Saved N cards` on a ~300-card set (the one-marketplace wizard
specs) is a 4-phase client-driven commit: prelude, 150-card chunks, finalize pages
(rows walk, then the review-row drain), then `discardCandidates`, and only then
the banner. Healthy it is about 3.5 s end to end from a laptop (server mutation
time under 3 s), so the 7 s budget leaves only ~2x headroom: any load window that
slows heavy writes 1.5-2x on a shared preview trips it on one shard while the
other project's pass is green.

Reading the failure artifacts of such a red:
- `error-context.md` shows the dialog still `Saving...` on the "Save N cards?"
  step with `Decided (N)` present and the banner still "Kept all N cards..."; no
  `Commit failed:` text means the commit had not thrown.
- The failure PNG can be taken a moment LATER and show the wizard at "Step 1 of N,
  Looking up 0 more names": that is not a reset. The finalize review-phase page has
  drained the batch's review rows under the still-open wizard, so it re-derives
  from nothing. It proves the commit was alive in its last phase.
- Cards already listed behind the dialog ("Cards (300)") mean the chunks landed.

Proof order: the other project's pass of the same spec (green, same shard cost),
the median ratio of all spec durations vs a prior green run (about 1.0 means not
a global slowdown; a few 1.5-2x outliers is the saturation shape, see
[[reference_flake_runtime_forensics]]), and a local run against the PR's
preview with `convex logs --success --jsonl` (Completion records carry
`executionTime` per mutation). `convex logs` history on a preview only reaches back
about 5 minutes, so the CI window itself is gone by the time you look: ask for the
capture to include the failing shard's whole window.

## Unstyled launch is a failed stylesheet

**Signature.** Failure screenshot is unstyled browser-default HTML: the logo SVG
fills the top half, serif text, every node starts at `x=8` (the body's default
margin, i.e. no Tailwind preflight), the document is thousands of px tall
(hierarchy `root` bounds start far negative) and Radix portals (dialogs,
modals) sit IN FLOW at the very bottom of the page instead of overlaid, so a
modal's footer lands below y≈629 and every assert on it fails as "not visible".

**Prove it is one launch, in one grep.** Every set-selector flow taps
`Search sports...` first; its bounds in `maestro.log` are a styling fingerprint.
Styled: `bounds=[88,369][380,407]`. Unstyled: `bounds=[8,147][193,168]`. Grep
every runner's `debug/*/maestro.log` for both — one unstyled hit among dozens of
styled ones on the same runner and same preview URL rules out the build.

**Why.** CI drives `http://localhost:3000`, a bare Node `http.createServer`
proxy (apps/web/.github/actions/maestro-runner/action.yml) to the Vercel
preview. It has no retry and answers an upstream error with 502; the global CSS
comes from one `<link rel=stylesheet>` (main.tsx imports globals.css + Radix
styles; no lazy routes), and Chrome does not retry it while the JS still runs.
The proxy's stderr (`proxy error: ...`) is NOT in the job log after its step
ends, so the HTTP status cannot be recovered from artifacts.

**How to apply.** Not caused by the PR unless the diff touches CSS,
`index.html`, `src/main.tsx`, `vite.config.ts` or `vercel.json`. Verdict: full
rerun (never `--failed`). Do not touch the flow. See present in failure dump means late arrival
for the other "visible in the PNG" class, which this is not.
