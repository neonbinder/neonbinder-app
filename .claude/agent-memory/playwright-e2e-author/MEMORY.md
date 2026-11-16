# Playwright E2E Author — Agent Memory Index

Rules for never diagnosing timing, the 7 s budget, and the commit/stage boundaries live in the agent file and GUIDE.md, not here.

## Authoring rules and locators
- [Per-worker data isolation](patterns_per_worker_data_isolation.md) — HARD RULE: shared real sets are read-only; unique minted names; no counts on 
- [No hand-made anchor for marketplace rows](feedback_no_hand_made_anchor_for_marketplace_rows.md) — owner rejection: never nest synced rows under a
- [Credentials and sign-in](patterns_credential_seeding.md) — fake creds, seed-credentials hops, redirect chains, needsReauth, no secrets via env
- [Locator traps](patterns_responsive_duplicates_and_text_locators.md) — CSS-hidden twins, dual-layout rows, regex escaping, ariaSnapshot
- [Add as New Player substring trap](patterns_button_name_substring_hides_demoted_variants.md) — demoted variants; exact-match proof is the demoted 
- [Negative asserts pass on a dead page](patterns_negative_asserts_pass_on_a_dead_page.md) — pair toBeHidden/toHaveCount(0) with a positive assertion
- [Draft echo is not a read-back](patterns_draft_echo_is_not_a_read_back.md) — a Saved/preview line built from the draft proves nothing stored
- [aria-disabled refusal and drag](patterns_aria_disabled_refusal_by_keyboard.md) — focus()+Enter proof; dnd-kit autoscroll
- [Self-cleaning specs](patterns_failure_hook_that_finishes_every_step.md) — afterEach/finally cleanup, post-cleanup failure screenshot
- [Spec maintenance traps](patterns_dead_branch_guards_can_cover_a_second_outcome.md) — dead branch guards, copy sweeps missed by merges
- [Operator switch branching](patterns_operator_switch_branching.md) — env.SL_PAUSED branches and what a paused SportLots does to drills
- [Prove a theme by painted colour](patterns_prove_a_theme_by_painted_colour.md) — toHaveCSS, pre-mount false positive; print emulation

## Network, clock and injection
- [Route one of two PUTs](patterns_route_key_is_the_object_name_not_the_path.md) — key by object name, pathname match, event-based waits
- [Stale-chunk and analytics-leak checks](patterns_stale_chunk_injection.md) — NEO-434 injection, no-reload anchor, PostHog filter
- [page.clock for client timeouts](patterns_page_clock_for_client_timeouts.md) — install before signIn, fastForward, hold by never-resolving route
- [Fake a Convex query over the WebSocket](patterns_fake_a_convex_query_value_over_the_websocket.md) — routeWebSocket, udfPath+args key

## Fake BSC and running locally
- [Sibling edits reload a local Vite run](patterns_sibling_edits_reload_a_local_vite_run.md) — one-off local red green on rerun: check the Vite log for an HMR/page reload at that time
- [Fake BSC faults and the breaker job](patterns_fake_bsc_faults_and_the_breaker_job.md) — bscFake fixture, deployment-wide gate, @bsc-breaker
- [Worktree deployment onto the fake BSC](patterns_worktree_deployment_onto_the_fake_bsc.md) — script sets the fake env; reportMisses; recorder must
- [Local run backend, Vite, previews](patterns_local_run_backend_and_vite.md) — function-spec check, one Vite per worktree, CI seed resets
- [Full local run on one account](patterns_full_local_run_on_one_account.md) — reds caused by the single account; --output keeps artifacts
- [Flake and stall forensics](reference_flake_runtime_forensics.md) — runtime proof; backend stalls; socket reconnect; unstyled launch

## Set builder, checklists and variants
- [Set-builder column behaviours](patterns_entity_column_shapes_and_cold_sync.md) — search box, collapse, sync failures, year-wide sync, All Brands
- [One-marketplace sync surfaces](reference_neo255_one_marketplace_surfaces.md) — NEO-255; summary not a UI surface; name-fallback Match Cards
- [Variant types and inserts](reference_neo334_sub_variants_column_is_role_gated.md) — title is the kind, Insert/Base pair, insert writer
- [Collector insert checklist names](patterns_collector_insert_checklist_names.md) — collector drill; naming across heading, drawer, Sync status
- [Card-level feature snapshot](reference_card_level_feature_snapshot_assertability.md) — asserting a card row inherits the write-once snapshot
- [Pairing conflict pills](patterns_pairing_conflict_pills_are_bare_values.md) — NEO-344 bare-value choices, scoped checks
- [SportLots twin names](reference_sportlots_twin_names_and_public_search.md) — NEO-325 ` (#id)` suffix on shared names, public search
- [Published checklist upload fixtures](patterns_published_checklist_upload_fixtures.md) — NNO sets, N-of-M arithmetic, team claim vs career prefill
- [Same-text search legs go stale](patterns_convex_same_text_search_legs_go_stale.md) — two same-text search reads in one query
- [Title fixture arithmetic](patterns_title_fixture_arithmetic.md) — compute listingTitles with the real generator
- [Placeholder pair count forensics](reference_placeholder_pair_count_forensics.md) — explain a wrong "N pairs ready to print."
- [No seeded fixture / custom retired](reference_neo239_retire_custom_flow_impact.md) — what NEO-214 and NEO-239 changed for specs
- [Dashboard shelf and demo limits](reference_dashboard_shelf_boxes_and_demo_limits.md) — box counts per width, Sell vs Fresh Pulls, Hunt tray

## Entity-review wizard and fixtures
- [Wizard decided list and batch resume](reference_wizard_decided_list_and_batch_resume.md) — header/summary reads, batch order, late lookups
- [Pick a wizard fixture](patterns_pick_a_wizard_name_from_bsc_facets_and_the_gate_resolver.md) — BSC facets, gate resolver, slug probe, throughput
- [Record a fixture set's lookups](patterns_record_a_fixture_sets_lookups.md) — live lookups from logs, CI catalogue, staging
- [Same-name player pick step](reference_same_name_player_panel.md) — NEO-332 locators, click the top candidate
- [Tidy up this set (NEO-335)](reference_neo335_teams_on_cards_section.md) — wizard chrome, post-name steps, teams-line handles
- [Team picker ranking (NEO-331)](reference_neo331_team_picker_ranking.md) — 4 tiers, zero-write proof, level pills
- [Team alias fixture (NEO-284)](reference_neo284_team_alias_fixture.md) — one-sided fixture, remember-as-alias flow
- [Missing-team fixer and past-era team](reference_reaching_the_missing_team_fixer.md) — honest route to the fixer; era options scroller
- [READY preselect has no career editor](patterns_ready_at_insert_preselect_has_no_career_editor.md) — helpers skip it; namesakes across sports
- [Quick-add PlayerPicker](reference_quick_add_player_picker.md) — create/pick handles; drawer chip is the persistence proof
- [Custom-sport minted players](patterns_custom_sport_player_specs_skip_lookups.md) — no lookup, no clashes, birth-year forks, Back is an exit

## Collection, listing and photos
- [Placeholder real-intake specs](patterns_placeholder_real_intake_specs.md) — NEO-529: drop on /print/placeholders, cap recovery via Recent runs, second-page tidy
- [Shared fast pool read ceiling](patterns_shared_fast_pool_read_ceiling.md) — NEO-529: FAST_READ_CEILING for "All N photos read."; no fast-vs-heavy E2E spec
- [Collection checklist, binders](patterns_collection_checklist_total_and_drawer.md) — totals, drawer, hidden empty levels, binder flakes, page names
- [Collection optimistic writes](patterns_collection_optimistic_writes_wait_for_the_notice.md) — wait for the notice before leaving or pressing next
- [BSC budget rules and the SportLots helper](patterns_bsc_budget_rules_and_sportlots_helper.md) — rules 1-3, expectStepWithSportLots, TSV mis-match trap
- [Marketplace listing specs](patterns_marketplace_listing_spec_shape.md) — N listed, Sync status, eBay hop, step ledger, seller window
- [Card photo specs](patterns_card_photo_viewer_specs.md) — viewer/tile names, served-file proof, crop drag, held vs saved box
- [Add cards, caps and zip fixtures](patterns_add_cards_run_start_caps.md) — 12 starts/hour, pickIntakeSet first, flat oversize JPEGs
