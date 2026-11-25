# E2E quick card

The one-page card of `GUIDE.md`. Read this first; open a GUIDE section by its
heading (index below) only when the work reaches it. GUIDE is the authority:
where this card and GUIDE differ, GUIDE wins and this card is fixed in the same
PR. Cite rules by number (`// R7a ...`).

## Hard rules (GUIDE 1-8)

1. **Tests prove the product, never bend to it.** Product wrong: assert the correct behaviour (red) and report it; never weaken a test, never add app code only to appease one.
2. **Perceivable locators only:** `getByRole` (with `name`), `getByLabel`, `getByPlaceholder`, `getByText`, `getByTitle`, `getByAltText`; chain, `.filter({ hasText | has })`, `.or()`. Never CSS, XPath, ids, classes, `data-testid`, `page.locator("...")`, `nth-child`. `.first()`/`.nth()` only for "any one of these". Two siblings that read the same: fix the product's labels.
3. **7 s for every action and `expect` (R5).** A slow non-marketplace step (our multi-write saves too) is a product finding. Longer only for: a live SportLots round trip; BSC steps by the BSC rule (1: `expectAfterMarketplace`/`pickAfterBscSync` when a "Waiting on BuySportsCards" line covers it; 2: else 7 s if measured <= 3.5 s, else ceil(longest + 7 s), measurement at the site; 3: steps that also drive SportLots via `expectStepWithSportLots`); `setup.spec.ts` cold syncs; `LAUNCH_GATE` (45 s); the live Wikidata proof; a ceiling Jason signed off (date, measurement, what voids it, at the site). Each on that one call, commented. Never invent a number or raise one because a run was slow.
4. **No sleeps, no settle waits (R10):** no `waitForTimeout`, no `networkidle`, no `isVisible` polling loops; web-first assertions and auto-waiting actions; never branch or wait on something that synchronises nothing.
5. **CI retries once, local `retries: 0`;** `setup` never retries, `bootstrap` retries once in CI. A retried pass is a lucky red (listed, gets a `ci-fail` ticket; 3 retries in 20 runs is fixed before new feature work). One account per worker, no order dependence; after a red the harness resets that account. BSC fault specs retry like any other (the gate is per test user on the fake, NEO-628); a fresh-only one fails its retry by name.
6. **Public repo:** no secrets, account ids, internal URLs or deployment slugs in any file, comment, log or artifact. Never `git add -A`, never `git stash` in a shared worktree.
7. **No real secret typed into a field.** A spec revealing a one-time secret wraps reveal-to-dismissal in `try {} catch (e) { await page.goto("about:blank").catch(() => {}); throw e; }` and sets `test.use({ screenshot: "off" })`.
8. **The one exception to rule 2:** `support/theme-no-flash.ts`, for the two NEO-356 no-flash specs only; lint refuses any other importer.

## Spec rules (R-numbers)

- **R1** One user-facing feature, stated in the `test()` title and a top comment; if it is not one sentence, split it.
- **R2** Assert that and only that, and fail when it breaks: a branch around the core action has a hard assert of its precondition before and its result after; every branch (paused/live, open/closed) ends in hard asserts; a negative assert (`toBeHidden`, `toHaveCount(0)`) is paired with a positive one nearby.
- **R3** Reuse `support/`; never duplicate another spec. Deleting or merging a spec is propose-and-wait; retiring one needs replacement coverage first.
- **R4** Enter through `signIn("/route")` once (public `home/*`: `page.goto("/")`); no in-test re-login, credential setup or re-seed. First assert after it is the destination's marker with `{ timeout: LAUNCH_GATE }`; later asserts run at 7 s.
- **R5** = hard rule 3. **R10** = hard rule 4. (GUIDE defines no R6 or R8.)
- **R7** Nothing destructive: restore what you change, never delete, overwrite or wipe shared data. The global reset is the seed script, never a test step.
- **R7a** Sets with marketplace ids are read-only; `SET-REGISTRY.md` names each one's single writer. Writes go to a hand-made per-worker set (no marketplace ids, real ancestors, suffixed `-${env.WORKER_INDEX}`, prefix registered in the same commit). Never attach a marketplace to a hand-made row, never "Add as New" on a real set's children. A new real set needs owner approval, every time.
- **R9** Every set-builder drill goes through `drillToSet`, `drillToBaseVariant`, `drillToColdManufacturer`, `drillToCustom`, `drillToCustomSet`; "All Brands" only via `drillToColdManufacturer`. Diverge only for a genuinely different set, and say why.

Companion rules: fixtures come from the UI (exceptions: the seed and `/testing/seed-credentials`) · minted names are single tokens from `env.ATTEMPT_TOKEN`, never hyphenated or rebuilt by hand · committing specs are sole writers and self-cleaning · tags `{ tag: ["@smoke", "@<area>"] }` (`@smoke` is the fast subset, plus one grouping tag), no `@regression`, no `wip` · run only what you changed, on your own deployment · timing is never the first diagnosis: screenshot and `error-context.md` first · a green suite can mean the test stopped testing: plant a break.

## Running: `playwright/tools/e2e-run.mjs`

From `apps/web`, one run at a time per worktree, never in CI. Use it instead of
hand-built shells, `nohup`, sleeps or `until` loops. Before the first run the
worktree needs its own Convex deployment, made by your workspace's own script.

```bash
node playwright/tools/e2e-run.mjs run <spec-substring>...   # (npm run e2e:run -- ... also works)
node playwright/tools/e2e-run.mjs wait                      # after exit 75; Bash timeout 200000
node playwright/tools/e2e-run.mjs plant --edit break.json --expect '<regex>' <spec>
node playwright/tools/e2e-run.mjs status | digest [last|<runDir>] | stop | stop-vite | seed
```

- **What `run` does:** loads `.env.local` (refuses anything but your own `dev:` deployment, a deploy key or token in `.env`/`.env.local`/the shell, a `VITE_CONVEX_URL`/`VITE_CONVEX_SITE_URL` missing or naming another deployment, or CI; spec arguments cannot start with `-`), starts Vite on port `3` + ticket number if none is up, reads `PAUSED_PLATFORMS` from the deployment, runs `setup` and `bootstrap` if they have not passed since the last seed, then the specs with `--no-deps --retries=0` as worker 8, and prints a digest (<8,000 chars) with each failure's line, error and ARIA-snapshot window.
- **Exit codes:** 0 pass · 1 Playwright failures · 2 refused (reason printed) · 3 another run holds the lock · 75 still running: call `wait` (it waits 170 s a slice; the Bash tool backgrounds a command at about 180 s, so use Bash timeout 200000) until it ends.
- **Options:** `--project desktop|mobile|both` (default desktop) · `--worker N` (8) · `--port N` (override the `3` + ticket port) · `--grep <re>` · `--slice <s>` (0 = wait to the end) · `--push` (push `convex/` changes; the only sanctioned `convex dev --once`) · `--allow-shared-dev` (cloud threads; `seed`/`--fresh` still refuse there).
- **Paths:** `--edit`/`--patch` file paths are relative to `apps/web`.
- **`--fresh`** re-seeds first (reset + reference import + paused flag). Use it when a fresh-only spec already ran on this seed (the digest says "if fresh-only, this red is expected: rerun with --fresh"; that note appears only beside a red) or the data is in doubt.
- **`--setup`** forces `setup` + `bootstrap` again: a cold fake BSC, a pulled change to saved sign-ins, a worker you have not bootstrapped.
- **`--project both`** runs desktop, re-seeds, then mobile: every spec must pass on both before hand-back.
- **`plant`** proves a spec can fail: `--edit` takes `[{ "file", "find", "replace" }]` (each `find` matches exactly once) or `--patch f.diff`; the tool backs the files up, runs, restores byte-exact (and re-pushes Convex if touched). Exit 0 RED (as planted when `--expect` matched) · 1 STAYED GREEN (the spec does not prove it), or RED but `--expect` did not match (failed for another reason), or a setup/bootstrap phase failed before the spec ran · 4 restore failed: stop and report. A leftover plant is restored by the next `run`/`plant`/`seed` (never by `status`/`digest`), and only while the files still hold what the plant wrote. Plants are limited to `apps/web/` (no `.env*`, `node_modules`, `playwright/tools`, symlinks); `--patch` refuses copies and mode changes; `convex/` plants are refused on shared dev. **When to plant:** a new or changed spec, or a shared helper. Prefer `--expect '<regex>'`: it is matched against the failed tests' error text (ANSI stripped), proves the spec went red for the planted reason, and skips the ~3.5 min re-seed a spec that already ran on this seed would otherwise get (without `--expect` the tool re-seeds first and says so). The header reads `PLANT RED as planted`, `PLANT STAYED GREEN` or `PLANT RED (--expect not matched)`, and a planted red is not recorded as a real run.
- **Artifacts:** `apps/web/.e2e-local/runs/<stamp>-<project>/` (run.log, json, `results/` with screenshot, `error-context.md`, trace; the digest prints one path line each, relative to the repo root). Read the screenshot and `error-context.md` before any theory. Never copy traces, headers or tokens anywhere.

## Support helpers (top 10; import `test`/`expect` from `support/fixtures`)

- `fixtures.ts`: `test` gives `{ page, env, signIn, bscFake, ebayFake, isMobile }`; `signIn(redirect, { account? })` (nested `?` literal, nested `&` as `%26`); `LAUNCH_GATE` (45 s); `expectAccessible(page, { within?: Locator, label?: string })` runs axe in light AND dark.
- `env` (`support/env.ts` `FlowEnv`): `WORKER_INDEX` (account number, `signIn`'s `worker=`), `WORKER_KEY` (`3d`/`3m`, prefer for per-worker names), `ATTEMPT_ID` (`pw<worker><d|m>-a<attempt>-<random>`), `ATTEMPT_TOKEN` (hyphens stripped: mint from this), `TEST_USERNAME`, `PAUSED_PLATFORMS`, `SL_PAUSED`, `EBAY_PAUSED`, `APP_URL`.
- `set-builder.ts`: `setBuilderReady(page)`, `columnHeading(page, column)`, `columnSearch(page, column)`, `columnOption(page, column, name)` (exact own text, badges ignored), `pick(page, column, name, { search? })`, `selectOrCreate(page, column, name, { via?: "search"|"list", confirm? })`, `syncChecklistButton(page)`, `openAttributesPanel(page)`, `customSport(env)`.
- Drills: `drillToSet(page, env, { sport?, year?, manufacturer?, set?, createManufacturer? })` (default 2024 Topps Chrome), `drillToBaseVariant(page, env, target?)`, `drillToColdManufacturer(page, env, { sport?, year?, manufacturer?, expectSets? })`, `drillToCustom(page, { sport?, year?, manufacturer?, set?, variantType?, variant? })`, `drillToCustomSet(page, env, { set, variantType?, variant? })`.
- `cards.ts`: `addCardViaForm(page, { cardNumber, playerName, cardName?, beforeSubmit? })`, `addCustomCard(page, env, { set, cardNumber, playerName, cardName?, variantType?, insertName? })`, `editCardButton`, `deleteCardButton`, `confirmDeleteCardButton`, `escapeRe`.
- `tidy-walk.ts` (the per-card Tidy Up walk): `tidyWalk(page)`, `tidyUpName({ year, set, variant? })` (omit `variant` for Base), `settleWalkAfterCommit(page, savedLine)` (true when the walk opened), `openTidyWalk`/`needsYouPill`, `tidyTile`/`pinkTile`, `expectCardsLeft`, `saveAndNext`, `skipCard`, `skipUntil`, `saveForLater`, `finishTidyWalk`, `walkAnsweringEverything` (answer every pink Player/Team tile to the end screen; `career?: "skip" | "add"`, default `"skip"`: Save & next over an open Career gap writes a stint to the player, so a card with a gap and nothing pink is Skipped and counted in `WalkTally.careerSkipped`; never `"add"` on a catalogue player; there is no "Keep as is"), `applyNameToAll(page, "Player"|"Team", printed)` (an answer links the open card only; this presses "Apply to all cards printing “X”" and returns "Linked/Cleared N more cards."), `expectTidyEndScreen(page, { fixed, skipped?, stillToCheck? })`/`readTidyEndScreen` (pink skipped / blue still-to-check verdict and the tally, by live level), `suggestedTeamChip(page, team, why?)` (exact "<team>, suggested · <why>"), `EDIT` (an answered row's `Edit <name>` button name, cameo rows excluded; scope it to the row's group), `ruleOutOpenPlayerRows`, `takeSourceSide`, `fetchChecklistToTidyWalk(page, env, target?, { checklist?, firstFetch? })`.
- `published-checklist.ts`: `usePublishersChecklist(page, name, { noTeamOn?, extraRows? })` returns `ChecklistFacts`; `CHECKLISTS`, `checklistFacts(name)` (N of M read off the file); `settleChecklistFetch(page, env, { facts, what })` settles a fetch on the file's Match Cards fact (`opensMatchCards`; NEO-640: a run with every card Matched at 100% skips the dialog and saves first, then the walk), `confirmChecklistMatchCards` when it opens; `checklistFetchProgress`/`cancelCardFetchButton` for the progress line, `savedLine`/`skippedSavedReason` for a skip; assert the dialog's absence by role (`matchCardsDialog`), the saved line names Match Cards.
- `collection.ts`: `drillToCollectorBase(page, target = TOPPS_CHROME_2024)` returns a Locator; `createBox`, `deleteOpenBox`, `inventoryTabs`, `confirmRemoved`; Sync status: `syncRun`, `pressSync(page, sync, title)` ("ran"/"throttled"), `expectRunOrSellerWait`, `followRunToRest`, `queueSettled`, `walkForCleanup` (hooks only).
- `marketplace-wait.ts`: `expectAfterMarketplace(page, target, { platform, what?, cap?, state? })`, `expectStepWithSportLots(page, target, env, { liveMs, what, pausedMs?, statusLine?, state? })`.
- Names and players: `recordedNoMatchPlayer(env, pool)` / `recordedNoMatchName(env, pool)` for any name that reaches a lookup (fresh-only); `players.ts` `expectPlayersLoaded`, `addPlayerByHand(page, name, sport)`. Faults: `bscFake.setFaults([bscFault.*(BSC_PATH.*)])` (429/503/hang/reset open only this worker's own gate, NEO-628; no tag), `ebayFake`.

## Top gotchas

- String `name`/text matches are case-insensitive SUBSTRINGS: add `exact: true` when one name prefixes another; an sr-only suffix ("(opens in new tab)") is part of the name.
- `aria-disabled` buttons count as disabled: wait for `getByRole("button", { name, disabled: false })`; to prove a refusal, `toBeDisabled()`.
- Status text is often duplicated in an sr-only live region: scope to the visible container; "it went away" is `toHaveCount(0)`.
- Roles: `type="search"` is `searchbox`; column search is `combobox`; `<select>` is `combobox` (use `selectOption`); dialogs are portaled: locate from `page`, not `main`.
- A `has`/`hasNot` locator is relative to the filtered element: one rooted at page or region never matches, and `hasNot` then passes everything.
- A negative assert passes on a dead page: pair it with a positive one.
- Branch on app state only after `expect(a.or(b)).toBeVisible()`; bounded `for` loops only; a walk move is proved by the next card's face (`saveAndNext`/`skipCard` do it), never by the URL alone.
- The Tidy Up walk (`Tidy up <year> <set> [<variant>]`, `tidyUpName`): the cards are saved before it opens and each tile saves when answered; "Save for later (Esc)" and "Skip: not ready to list" write nothing; Save & next is held while anything is pink and adds the default stint for a Career gap on screen. Nothing records a card as seen: blue stays until the data is fixed. A tile's level is its description ("To fix" pink, "To check" blue). The pill reads "N need you" plus ", M to fix" when M are pink: assert the whole string.
- Fresh-only specs (live Wikidata proof, a real set's first fetch, recorded-name specs) pass once per seed: a second run's red is expected, rerun with `--fresh`.
- Paused or live: the spec branches on `env.SL_PAUSED`/`env.EBAY_PAUSED`, never on the notice; below Years a paused tree looks BSC-only.
- A BSC read that failed with no fault in the spec is an unrecorded request (`501`, `x-nb-fake: unrecorded`): a recorder run, never a spec change.
- A real-set fetch uploads its publisher checklist first; a live card is named at the call site; no blank team cell (`No Team`).

## GUIDE index (first cell = the heading line exactly as in GUIDE.md)

| GUIDE heading | Open it for |
|---|---|
| ## Hard rules | full text and the budget exceptions |
| ## Rules every spec satisfies (R1-R4, R7, R7a, R9) | R-rules in full |
| ### Companion rules | fixtures, minted names, tags, plant-a-break |
| ## Files, names, tags | file layout, the spec skeleton |
| ## Support (use these, keep the set small) | every helper, with its contract |
| ## Locators: names, substrings and scope | locator table, visibility, idioms |
| ## Gotchas (read before your first spec) | the Tidy Up walk, roles, live regions, fresh-only |
| ## Desktop and mobile | the two projects, mobile branches, `project-scope.mjs` |
| ## Accessibility checks | `expectAccessible`, light and dark, exclusions |
| ## Worker-state seeding | seed, bootstrap, checklist upload in the seed |
| ### The failure reset (NEO-592) | what a red resets |
| ### BuySportsCards is the fake (NEO-552) | fake BSC/eBay, faults, call gate, seller wait |
| ### Unrecorded request (`501`, `x-nb-fake: unrecorded`) | BSC miss triage |
| ### Checklist first; a per-card lookup only for the card under test (NEO-489, Jason 2026-11-11; NEO-552) | per-card lookups |
| ### Seeding a fixture that no UI can create (`/testing/seed-credentials`) | `sites=` fixtures |
| ## Operator switches (`PAUSED_PLATFORMS`, NEO-287) | paused branches, what the pause shows |
| ## SportLots never rejects a password in E2E (NEO-288) | SportLots login copy |
| ## Enrichment fixtures (NEO-289) | recorded names, the live Wikidata proof |
| ## Running | the run tool, the manual recipe, CI shape, reading a red run |
| ## Coverage checklist (per spec, before you hand it back) | the full checklist |

## Coverage checklist (before hand-back)

- [ ] Title states one feature (R1); path mirrors the area; tags set.
- [ ] Every user-visible claim is an `expect`; every branch ends in hard asserts (R2).
- [ ] Any timeout over 7 s is a listed exception, on that call only, justified at the site.
- [ ] No sleeps; no CSS/XPath/test ids; role/label/text locators only.
- [ ] Minted names are single tokens from `env.ATTEMPT_TOKEN`/`ATTEMPT_ID`; new per-worker names prefer `env.WORKER_KEY`.
- [ ] `expectAccessible` at every new screen or state the spec reaches.
- [ ] Passes on `e2e` AND `e2e-mobile`; a mobile branch keys on `isMobile` and ends in hard asserts.
- [ ] Writes go to a per-worker hand-made set or the registered sole writer (R7a); nothing destructive (R7).
- [ ] Real-set fetches upload the checklist first; BSC faults via `bscFake` only (429/503/hang/reset: no tag, they close only this worker's gate); eBay via `ebayFake` only; new catalogue requests come with their recorder run.
- [ ] A shared helper you changed: a planted break turns its covering specs red (`plant`).
- [ ] `npm run test:e2e:typecheck` and `npx eslint playwright` pass; `npm run test:e2e:list -- --project=e2e --project=e2e-mobile` lists the test once per project.
