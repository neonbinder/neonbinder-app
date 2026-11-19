---
name: patterns_local_run_backend_and_vite
description: Local runs - a stale or shared Convex backend hides functions (function-spec check), one Vite serves one worktree, CI seed job resets a shared preview, previews start empty, re-seed keeps the catalogue. Since NEO-438 a worktree has its own deployment; the shared-dev notes apply to seller specs and cloud threads
metadata:
  type: reference
---

> Since NEO-438 a local run uses the worktree's OWN deployment (the root CLAUDE.md recipe); shared dev is for seller specs and cloud threads. The shared-dev, `convex dev --once` and "run on dev first" notes below describe those two cases and the failure signatures, which are the same on any stale deployment.

## Patterns check dev function spec before local run

# Know which surfaces will render BEFORE you run locally against dev

A branch's local Vite runs against whatever functions the dev deployment last
received. Any component that `useQuery`s a function dev lacks throws during render
and the WHOLE SPA falls to its boundary: the failure screenshot is one line, `An
error occurred. Please refresh the page.`, and the step reads as "locator not
found" (the NEO-102 wall). `useMutation` / `useAction` / imperative `convex.query`
refs are harmless until invoked.

## The 30-second check (verified 2026-09-14, NEO-279)

```bash
cd apps/web
npx convex function-spec > <scratch>/devspec.json     # read-only: {url, functions:[{identifier:"mod.js:fn",...}]}
grep -oh "api\.[A-Za-z]*\.[A-Za-z]*" components/SetSelector/*.tsx components/modules/SetSelector.tsx | sort -u
# compare `api.mod.fn` -> `mod.js:fn`; anything missing that a component
# useQuery's is a surface the local run cannot reach.
```

Then grep the missing names for `useQuery(` to know exactly which step will die.
On 2026-09-14 the New Team dialog (`useQuery(api.teams.erasByNameAndSport)`) was
behind the wall, so EVERY spec that creates a team through the dialog is
unrunnable on dev until dev is brought up to date; everything before that step validated fine
locally.

## `npx convex dev --once` is the fix, but not a guaranteed one

When dev lacks a function, merge main into the branch and push it with `npx
convex dev --once` (NEO-390). That also pushes the branch's SCHEMA, and the push
is refused when any stored row carries a field the new schema no longer has
(`Schema validation failed ... extra field`). Cleaning shared dev data is not a
spec author's call: stop, report the partial validation and let the coordinator
validate against the PR's Convex preview
([[patterns_local_run_backend_and_vite]],
feedback run specs on dev before first push).

## Read the partial run for what it DID prove
Report which steps passed before the wall; that is evidence worth putting in the
report even when the spec went red later for an environment reason.

## Project dev must carry the branch before a local run

When a spec exercises a Convex function that exists **only on the branch**, dev
cannot run it until the branch is pushed to dev. Since NEO-390 (2026-10-29)
that push is the expected step before the first push to GitHub
(feedback run specs on dev before first push). First verified 2026-09-01 on
a resync branch, when the rule was still "use the PR preview instead".

**Why:**
- `apps/web/.env.local` points `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL` at the
  shared dev deployment. Confirm what a deployment actually has with `npx convex
  function-spec | grep <fnName>`: the decisive check, and read-only.
- With `CONVEX_DEPLOYMENT` set and no deploy key, `npx convex deploy` targets
  the project's **production** deployment: never run `deploy`. The dev push is
  `npx convex dev --once`.
- `npm run dev:backend` is NOT a local backend: it is `npx convex dev` against the
  same shared dev deployment every other session uses, so merge main into the
  branch before it pushes (feedback run specs on dev before first push).
- The seed's global reset wipes dev under every session, so it is not run on dev unannounced (GUIDE), and a spec
  whose precondition is "this real set does not exist yet" fails on dev, where it
  usually already does.

**What the failure looks like at run time:** a missing function makes the
`useQuery` throw, the SPA falls to its error boundary and the page collapses to
`"An error occurred. Please refresh the page."`, so the spec dies on whatever
assertion follows, often reading like an unrelated locator bug.

**Run it anyway, and say where it stopped.** The client half of a feature (pure
derivations, meters, alerts, dialogs) ships in the LOCAL BUNDLE, so a run against
shared dev still validates every step BEFORE the first branch-only server call.
Report the exact step it reached; that is a far better disclosure than "cannot
run locally". Beware [[patterns_negative_asserts_pass_on_a_dead_page]] when reading the
result.

**How to apply:** before a local run for a spec on a backend-touching branch, run
the `function-spec` check ([[patterns_local_run_backend_and_vite]]).
If the function is missing, merge main and push the branch with `npx convex dev
--once`, then run. If that push is refused, say so as a disclosure (CLAUDE.md:
"an unrunnable test is a disclosure, an unrun one is a defect") and use the PR
preview after the first push. Never `convex deploy`.

**One unconditionally-mounted panel takes the WHOLE page down.** NEO-212 mounted a
panel with a `useQuery` inside `CardChecklist` with no gate, so on shared dev EVERY
set-selector spec died the instant the checklist opened, several steps before the
new feature. A drill helper failing with a blank "An error occurred" screenshot is
this, not a locator bug.

**Shared dev can lag **main**, not just your branch.** Merging to main deploys
PRODUCTION Convex, never dev (`release.yml`); shared dev only moves when a human
runs `convex dev`, so it drifts behind main indefinitely. On one branch EVERY
set-selector spec died at the sport level with `Could not find public function
for 'selectorOptions:getSelectorOptionHoldings'` (shipped in NEO-219, on main, not
on dev) inside a control in `SetAttributesPanel`'s header, which mounts once ANY
selector row is selected, so the page dies one click into the drill.
`git diff <base> -- <component>` came back EMPTY, which proved the crash was not the
branch's. When every set-selector spec fails identically and early, check
`function-spec` in BOTH directions (a function your branch added; a function `main`
added that dev never received). If it is the second, bring dev up to date: merge
main into the branch and push it to dev.

**Why a push to dev fails when another branch owns it.** Convex validates every
existing document against the incoming schema, so **whichever branch pushed last
owns dev**, and a branch that predates those fields cannot push at all (`Schema
validation failed ... extra field`). The only override is `schemaValidation: false`
in `schema.ts`, which is app source and must never be left in a branch.

## Local vite serves one worktree

Local E2E drives whatever bundle is on `APP_URL`. With several agents working in
parallel worktrees, the Vite already listening on `:3000` frequently belongs to a
DIFFERENT branch, so a "local validation" of your new spec can silently exercise a
bundle that does not contain your feature at all, and every new locator fails for
the wrong reason.

**Check first:**

```bash
PID=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t | head -1)
lsof -a -p $PID -d cwd -Fn | tail -1     # the worktree it is serving
```

**If it is not yours, do not restart or kill it.** Start your own alongside (full
recipe in CLAUDE.md "Debugging a red spec against the PR's own services" and GUIDE
"Running"):

```bash
cd <your worktree>/apps/web
VITE_DEV_DISABLE_HTTPS=1 npx vite --port 3001 --strictPort &
APP_URL=http://localhost:3001 WORKER_INDEX=0 \
  npx playwright test --project=e2e --no-deps <path-substring>
```

`VITE_DEV_DISABLE_HTTPS=1` matters: without it `vite-plugin-mkcert` serves
**https** and the browser (which does not accept the self-signed cert) never
finishes loading. **Failure signature when Vite is on https:** the first
navigation hangs, the screenshot is blank white, and EVERY spec fails
identically, including known-good ones like the worker bootstrap. **A blank
screenshot with every spec failing at its first navigation means the transport,
not your locators:** check `http` vs `https` (the `Local:` line in the Vite log)
before touching a spec. `curl -sk` against the same URL returning 200 does not
clear the server: curl does not enforce the cert.

Note the Convex backend is still whatever `VITE_CONVEX_URL` says regardless of
which Vite you run; see [[patterns_local_run_backend_and_vite]].

## Reference ci seed resets the preview under your local run

# CI's seed job will reset the preview out from under your local run

The PR preview Convex deployment is **shared with CI**, and `e2e.yml`'s `seed` job
opens with the global reset. If a push happens while you are running locally
against the preview, that reset drains `selectorOptions` under your live page.

## The signature, and why it reads as a product bug

Observed once: the drill worked normally, then mid-run the page
showed:

```
Years          "No years available. Sync from marketplaces to populate."
Sets           "No sets available…"  +  "Cannot sync sets — no year ancestor."
Variant Types  "Couldn't sync options — please try again."
Manufacturers  (still fully populated)
```

No error boundary, no crash: a *healthy* page reporting empty ancestors, exactly
what a broken resolvability gate would look like. It cost a wrong "possible
product bug" call before the timeline was checked.

- **It is gradual, not instant.** `resetSetBuilderData` deletes in batches, so
  columns empty one after another over ~45 s while earlier steps keep passing. A
  column that already rendered can still show stale rows.
- **Later steps fail, earlier ones passed.**

## The check, before diagnosing anything

```bash
gh run list --branch <branch> --limit 2 --json databaseId,headSha,status,createdAt
gh run view <id> --json jobs --jq '.jobs[] | select(.name|test("E2E")) | "\(.name) \(.status) \(.startedAt)"'
```

Compare the `E2E / seed` `startedAt` (UTC) against your spec's wall-clock window
(convert to the same zone). In the case seen, the seed started in the exact minute
the teardown began.

## The rule

**Do not run against a PR preview while a CI run is in flight**, and re-check after
any push: a push you did not make (a teammate agent's) starts a run that will reset
the deployment. Conversely, never start a local `setup` while CI's shards are
draining. Dev comes first since NEO-390 (feedback run specs on dev before first push);
the preview is for a red dev cannot reproduce. See
[[patterns_local_run_backend_and_vite]] for what the seed job does.

## Reference ci convex preview starts empty

# CI's Convex preview starts EMPTY — the seed is the only populate step

- `apps/web/vercel.json` → `buildCommand: npx convex deploy
  --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm run build'`. **No
  `--preview-run`**, and there is no preview-seed function anywhere in the repo.
  A Convex preview deployment is created fresh; it does **not** clone dev's data.
- `.github/workflows/e2e.yml` job `seed` runs the scripted reset and the `setup`
  project as worker 0, before the shards fan out (GUIDE "Worker-state seeding").
  It does the global reset and then a LIVE BSC/SL sync that creates Baseball /
  2024 / Topps / Topps Chrome, its Base/Insert/Parallel variant types and their
  checklists from scratch.

## What follows

1. **A one-shot data backfill is never a CI prerequisite.** Every row in a CI
   preview is created by that first sync, so whatever the backfill repairs must
   ALSO be derived at insert time in the sync path. If a new field is only set on
   the "match existing row" branch and not on "insert", CI breaks even though dev
   looks fine after the backfill. Backfills exist for dev and prod only.
2. **Local runs against SHARED DEV are the opposite case**: dev's rows are old and
   were never re-synced, so a local run needs the backfill or a forced sync. Do not
   read a local failure there as a CI failure.

## Patterns local reseed keeps the reference catalogue

`./e2e-baseline.sh reset` clears ALL tables, the eight reference-seed tables
included. A deployment seeded with the reference catalogue (CI previews, a
per-worktree deployment) gets it back only through `e2e-seed-reset.sh` with
`NB_REFERENCE_BUNDLE` pointing at the bundle. That fetch needs a live `gcloud`
token, and with none the script refuses before it touches anything (safe).
Never fall back to the plain reset: the catalogue stays gone until someone can
fetch the bundle.

**Why a re-seed exists between `e2e` and `e2e-mobile`:** fresh-only and
sole-writer specs pass once per seed. A spec that writes only the worker's own
rows under minted names and cleans up after itself (public-share-link) runs on
both projects on one seed; `bootstrap` alone clears the account. Say in the
report that the re-seed was skipped and why.

**Keep artifacts:** the next run empties `playwright/results`, so a red's
`error-context.md` is gone once anything else runs. Pass
`--output=<scratch dir>` to any run you may need to read back, the seed included.

Related: [[patterns_record_a_fixture_sets_lookups]]
