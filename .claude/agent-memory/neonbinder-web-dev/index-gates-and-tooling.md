# Gates and Tooling

Typecheck, lint, worktree, node/shell and macOS tooling gotchas that make gates lie or stall.

- [Eslint flat config skips ts](project_eslint_flat_config_skips_tsx.md) — apps/web ESLint lints .tsx (react-hooks + the NEO-44 raw-input rule) but NOT plain .ts (playwright/**/*.ts excepted since NEO-341) — a .ts file reports "File ignored because no matching configuration was s…
- [Apps web root tsc is red at baseline](reference_apps_web_root_tsc_is_red_at_baseline.md) — root tsc is red at baseline AND no gate typechecks components/app/src — grep the root run for your own .tsx files; an empty grep is the gate
- [Fresh worktree missing env local](reference_fresh_worktree_missing_env_local.md) — A fresh apps/web worktree has no .env.local, so every route renders a blank black page and the only clue is a ClerkProviderBase warning — not a code bug
- [Vercel build runs convex typecheck](reference_vercel_build_runs_convex_typecheck.md) — apps/web Vercel build = convex deploy + vite build; why local vite build can pass while Vercel fails, and how to reproduce the convex typecheck locally
- [Gates in a shared worktree](gates-in-a-shared-worktree.md) — eslint "File ignored" on lib/*.ts is baseline; wait for a sibling's npm ci; `test:unit -- filter` runs everything; link-deps.sh broken; stale install → own npm ci; attribute sibling reds by grep; re-grep your edits before reporting (siblings restore files); plain rm not git rm; npm install -D may prune unrelated lock entries; zsh: unquoted $FILES is one arg; playwright --output to scratch; never grep|head the unit verdict; a red during a sibling's main.tsx edit is a Vite full reload; spare Vite ports are often a sibling worktree's (check lsof cwd); zz-tmp spec copy to prove your steps past a sibling's red; other worktrees' load times out component tests (rerun alone)
- [Convex typecheck excludes test files](reference_convex_typecheck_excludes_test_files.md) — convex/tsconfig excludes *.test.ts, so a changed args/returns shape is green at the gate while every test call site is stale
- [Never stash in a shared ticket worktree](reference_never_stash_in_a_shared_ticket_worktree.md) — stashing reverts siblings' edits; `git checkout --` throws away your own
- [Agent Bash node ignores .nvmrc](reference_agent_bash_node_ignores_nvmrc.md) — agent shells skip load-nvmrc; export PATH to ~/.nvm/versions/node/v$(cat apps/web/.nvmrc)/bin per gate call
- [No prettier config in apps/web](reference_no_prettier_config_in_apps_web.md) — prettier --write reformats whole hand-formatted files; never run it, eslint is the gate
- [Agent Bash skips load-nvmrc](reference_agent_bash_skips_load_nvmrc.md) — the agent's Bash tool does not run the load-nvmrc function; prepend the pinned node version's bin to PATH for every gate
- [Parallel builders share the scratchpad](reference_parallel_builders_share_the_scratchpad.md) — per-agent subdir for scripts/shots; own Vite port; check root for stray folders
- [Local screenshot script gotchas](reference_local_screenshot_script_gotchas.md) — sign-in redirect fools waitForURL; missing Convex fn; hand-set data-theme misreads livery; oklch colours; tall element shots cut (fullPage+clip)
- [Write tool turns unicode escapes into chars](reference_write_tool_turns_unicode_escapes_into_chars.md) — a written `￿` can land as the literal char; grep and fix
- [No timeout binary empties a grep gate](reference_no_timeout_binary_empties_a_grep_gate.md) — `timeout` is missing on macOS; `timeout … tsc | grep` is a false green; tee to a file, check line count
- [Typecheck a client against a contract stub](reference_typecheck_a_client_against_a_contract_stub.md) — parallel backend: scratch tsconfig paths map api to a stub; missing members hide bugs as any
- [macOS FS is case-insensitive](reference_macos_fs_is_case_insensitive.md) — a new file differing only by case overwrites the old one; Write says "updated" — grep -i first
- [pdf.js 6 quirks](reference_pdfjs_6_driver_quirks.md) — no isEvalSupported/eval path; task.destroy(); legacy build in Node; TextItem from types/src/display/api
- [Lockfile peer-flag churn](reference_lockfile_peer_flag_churn.md) — npm install drops stale @esbuild "peer": true flags; restore by script; install with .nvmrc Node
- [Differential check against HEAD](reference_differential_check_against_head.md) — prove a bounds/perf rewrite changes no answer: HEAD copy in scratchpad + tsx .mts driver + seeded random diff, or real checklist files row-dumped; `.default` interop
- [Agent shell Node is not the apps/web pin](reference_agent_shell_node_is_not_the_apps_web_pin.md) — prepend nvm's $(cat .nvmrc) bin in the same call as each gate; print node --version
- [Stacked branch merge after parent squash](reference_stacked_branch_merge_after_parent_squash.md) — merge base predates the parent: clean hunks duplicate code; re-merge with merge-tree base
- [Symlinked node_modules can lag the lockfile](reference_symlinked_node_modules_can_lag_the_lockfile.md) — build/one lib test red on a missing package you never touched = stale shared install, not your diff
- [PDF runs ride along only with evidence](reference_pdf_runs_ride_along_only_when_they_add_evidence.md) — new reader record fields move the Topps golden snapshot; gate them; tsx probes need .mts
- [macOS has no timeout](reference_macos_has_no_timeout_command.md) — `timeout N tsc | grep` is command-not-found and looks clean; run root tsc in background to a log, check count > 0
- [Read-only diagnosis on a deployment](reference_read_only_diagnosis_on_a_deployment.md) — convex data caps 8192; internal fns run without identity; open-wizard cards live in checklistCandidates
- [Typecheck gate skips components](typecheck-gate-skips-components.md) — npm run typecheck covers convex/ only; filter the root tsc to your files
- [BSD sed has no \b](reference_bsd_sed_has_no_word_boundary.md) — macOS sed ignores \b so a bulk rename silently no-ops; python re.sub; keep a Legacy-named old body when a shared fn changes shape
- [macOS sed -i needs an empty suffix](macos-sed-i-needs-an-empty-suffix.md) — BSD sed eats the script as a suffix; use perl or python, check git status for strays
- [Dropping a schema field strands its read guards](reference_dropping_a_schema_field_strands_its_read_guards.md) — tsc flags only Doc-typed `!e.legacy` guards; twin types, helpers and tests keep it: grep repo-wide
