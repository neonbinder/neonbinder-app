# React Patterns

React rendering, refs, effects, router, dnd-kit, optimistic updates and compiler gotchas.

- [dnd-kit row control is a handle sibling](reference_dndkit_row_control_is_a_handle_sibling.md) — button beside the handle; set an activator node; onClick on the handle is pointer-only (Enter drags), so announce the drag
- [dnd-kit pointerWithin kills keyboard drops](reference_dndkit_pointerwithin_kills_keyboard_drops.md) — use lib/dnd/keyboard-aware-collision; lib/testing/keyboard-drag runs a REAL keyboard drag in happy-dom
- [Interactive controls carry no DOM id](reference_interactive_controls_carry_no_dom_id.md) — specs find controls by role + accessible name only; ids go on non-interactive ARIA targets; find controls in code by data attribute
- [Rerender same element bails out](reference_rerender_same_element_bails_out.md) — module-state useQuery mocks need a FRESH element per rerender; a live region repeating text doubles getByText
- [Absence assertions go vacuous on a rename](reference_absence_assertions_go_vacuous_on_a_rename.md) — queryBy…toBeNull on an old name passes forever; change the builder signature so root tsc flags stale calls
- [Latest-entry ref is stale at render after POP](reference_latest_entry_ref_is_stale_at_render_after_pop.md) — Link href/state from useLocation, rebuild the push in onClick; MemoryRouter clamps go(-n), add an entry ahead
- [New string locator collision sweep](reference_new_string_locator_collision_sweep.md) — Playwright name/text matching is a substring; grep the specs for the new copy and check the page each hit runs on
- [Static markup visual check](reference_static_markup_visual_check.md) — built CSS + scratch HTML + headless Chrome; phone widths via iframe; measure heights per case matrix; tsx `.css` import stub loader
- [Live validation without keystroke renders](reference_live_validation_without_keystroke_renders.md) — drafts in a ref + snapshot state swapped on answer change; ref.current in useMemo fails react-hooks/refs; blocked button gets title for Maestro
- [Local override of server state needs a null tombstone](reference_local_override_of_server_state_needs_a_null_tombstone.md) — `null` not a deleted key over a stored per-row value; merge save results; readyTitleClashes reuse for own-set names
- [Readline iterator loses lines under a slow consumer](reference_readline_iterator_loses_lines_under_slow_consumer.md) — ERR_USE_AFTER_CLOSE + dropped last line when the loop awaits; split child.stdout by hand
- [Panel-wide shortcut via capture phase](reference_panel_wide_shortcut_via_capture_phase.md) — Ctrl+Enter over a typeahead: onKeyDownCapture + stopPropagation, guard nested role=dialog; stub spy proves the typeahead never sees it
- [Render-phase state for previous-render values](reference_render_phase_state_for_previous_render_values.md) — conditional setState in render passes lint; reducer returns same object; key transient lines on progress, not x; focus effects key on "focused for"; keep such blocks above every useCallback
- [App-wide useQuery needs its own boundary](reference_app_wide_usequery_needs_its_own_boundary.md) — a failing/missing Convex function throws in render; boundary + Sentry once
- [Compiler memo lost by a derived JSX map](reference_compiler_memo_lost_by_derived_jsx_map.md) — preserve-manual-memoization: drop the manual memo, never disable the rule
- [Collection views test on a hand-built store](reference_collection_views_test_on_a_hand_built_store.md) — RealCollection.test.tsx fakes the store; add each new hook to it
- [Optimistic id swap remounts id-keyed rows](reference_optimistic_id_swap_remounts_id_keyed_rows.md) — key rows via useLineKeys; ids replay per args (optimisticIdFor); writes await landedCopy
- [HMR context-module edit crashes the page](reference_hmr_context_module_edit_crashes_the_page.md) — sibling edits mode.tsx → "outside Provider"; reload. select-on-focus field: → test selectionEnd only
- [Leave hook survives StrictMode](reference_leave_hook_survives_strictmode.md) — leave-time writes in effect cleanup fire on dev double mount; defer + cancel by view id
- [Fixed redirect target becomes a landing](reference_fixed_redirect_target_becomes_a_landing.md) — moved UI off an OAuth return route: landing Navigates replace + location.state; NavLink cannot light an alias
- [Structural row types must not narrow server unions](reference_structural_row_types_must_not_narrow_server_unions.md) — NavRow union narrower than the validator breaks every nav-helper call site; mirror schema.ts exactly
- [useEffectEvent does not evade set-state-in-effect](reference_effect_event_does_not_evade_set_state_rule.md) — compiler traces through it; justified disable for a one-edge effect; rAF is FIFO after close(); one-shot intent → adjust state while rendering
- [Failed dynamic import is cached per document](reference_failed_dynamic_import_is_cached_per_document.md) — Chromium: re-import or lazy retry cannot recover, only a reload; prefetch failures poison the route
- [dnd-kit droppables in their own scroll pane](reference_dndkit_droppables_in_their_own_scroll_pane.md) — two-pane drags need no measuring config (Rect tracks its pane's scroll); what autoscroll scrolls; grid-rows-1 + min-h-0
- [react-hooks/refs flags helper arguments](reference_react_hooks_refs_flags_helper_arguments.md) — a ref-reading closure passed INTO renderRow() trips the lint; build it in the JSX prop instead
- [Ref guard in a handler passed to a render builder](reference_ref_guard_in_a_handler_passed_to_a_render_builder.md) — react-hooks/refs flags it via idleButtons(fn); go refless: scope in state, render-time reset, updater bail-out
- [Long admin lists freeze whole-DOM scanners](reference_long_admin_lists_freeze_whole_dom_scanners.md) — 2,000 rows = 20k nodes, axe 10 s; a select INP report there is DOM size or popup-open time, not the handler
- [Browser-probe a lib through Vite](reference_browser_probe_a_lib_through_vite.md) — spare-port Vite, goto /robots.txt (not /), page.evaluate(import("/lib/…ts"))
- [Compiler memoization error points at unrelated callback](reference_compiler_memoization_error_points_at_unrelated_callback.md) — bisect your hunks; a new render-scope object breaks old useCallbacks
- [Stale-while-loading hides an in-flight query](reference_stale_while_loading_hides_in_flight_query.md) — derive `ready` from the raw useQuery result, not the held value; sr-only span pads Chromium names, use aria-label
- [ModeRadioGroup empty value = nothing checked](reference_modeRadioGroup_empty_value_means_nothing_checked.md) — no-default picker; labelId for aria-describedby; useConvex().mutation keeps old mocks green
- [Visible confirmation beside a live region is aria-hidden](reference_visible_confirmation_beside_a_live_region_is_aria_hidden.md) — useFieldToast line aria-hidden when the walk already announces it; TeamChip variant="action"
- [Hold from first commit needs a render-time mark](reference_hold_from_first_commit_needs_a_render_time_mark.md) — uSES rows subscribe passively; layout-effect bump is too late; Set.add in parent render; no ref read
