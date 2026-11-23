# E2E, Playwright and Screenshots

Playwright and e2e-viewport behaviour, print and demo paths, screenshots and harness quirks.

- [E2e viewport is the ux constraint](e2e-viewport-is-the-ux-constraint.md) — Admin screens are judged at the CI E2E viewport (1024x629); put status/feedback next to the control that produced it, because role="status" hides sighted-user gaps
- [Visual harness: fake Convex client](reference_visual_harness_fake_convex_client.md) — screenshot a dialog dev cannot show: iframe + real component + 3-method fake client; hidden tab = no rAF/RO
- [Router navigation is a transition](reference_router_navigation_is_a_transition.md) — setSearchParams commits in startTransition; a sibling setState renders the OLD URL first; wrap it in startTransition, or hold a pending value when a child moves focus
- [Ensure-sync idle window races Playwright](reference_ensure_sync_idle_window_races_playwright.md) — idle "Sync X" shows before the syncing write; wait for data, not the button (NEO-341 SPx notice)
- [Dark variant is class-based (was OS-based)](reference_playwright_default_light_scheme_breaks_dark_variants.md) — NEO-341: @custom-variant + html.dark; light halves of dark: pairs are dead; never force colorScheme
- [Print paths and Radix root scheme](reference_print_paths_and_radix_root_scheme.md) — Print buttons use isolated docs (globals.css never prints); print override needs html:root to beat Radix
- [Print-only region needs the :has() prefix](reference_print_only_region_has_specificity.md) — visible rule must match hide rule weight; fullPage print-emulated shots go blank
- [Printed output is a srcdoc capture](reference_printed_output_is_srcdoc_capture.md) — prove print unchanged by hooking the print iframe srcdoc / QR popup, not page screenshots
- [Static page outside the SPA shell](reference_static_page_outside_the_spa_shell.md) — public/ HTML + vercel rewrite before catch-all + vite dev/preview rewrite; JS in lib/ emitted; template for happy-dom
- [Playwright click checks first mouse event only](reference_playwright_click_checks_first_mouse_event_only.md) — mid-press reflow: click() succeeds, onClick never runs; line up convex-logs with the click
- [Click before the passive flush](reference_click_before_passive_flush_via_layout_effect.md) — click from a child useLayoutEffect to test a press beating a pending effect; functional updater fixes only stale closures
- [Failure PNG is viewport-only](reference_failure_png_is_viewport_only.md) — under-card content is off a 629px frame; read error-context in the blob zip; grep templated locators too
- [Clipboard write with a promise](reference_clipboard_write_with_a_promise.md) — copy text that lands after awaits: start clipboard.write in the click with a promise; headless shell denies writes, so specs stub it
- [Patch a Vite module for demo screenshot variants](reference_patch_a_vite_module_for_demo_screenshot_variants.md) — page.route + route.fetch rewrites fake-data.ts in a temp spec; no product code
- [Signed-in pages must not import demo values](reference_signed_in_pages_must_not_import_demo_values.md) — fake-data value import drags demo store into /dashboard; trace built chunks
- [canvas.toBlob waits ~1 s in the app page](reference_canvas_toblob_waits_a_second_in_the_app_page.md) — each encode ~1000 ms under Playwright Chromium (idle deadline) after a write; encode at pick time, concurrently
- [Real-app screenshots via suite helpers](reference_real_app_screenshots_reuse_the_suite_helpers.md) — scratch config + {"type":"module"}; emulateMedia per mode; force-click an aria-disabled NeonButton
- [Playwright harness mirrors the checklist parser](playwright-harness-mirrors-checklist-parser.md) — checklistFacts must share lib/checklists rules; check it on parser changes (NEO-489)
- [Demo content column is ~806px at 1024](reference_demo_content_column_is_806px_at_e2e_width.md) — lg:pr-170 rail gutter; budget demo tables to ~800px or they slide under the exit rail
- [Setup project is once per seed](reference_setup_project_is_once_per_seed.md) — rerun on a seeded deployment reds at "No manufacturers available" by design; bootstrap only
- [Split text into spans: RTL vs Playwright](reference_split_text_into_spans_breaks_rtl_gettext_not_playwright.md) — styled child spans keep Playwright getByText(exact) green, break RTL getByText; use a whole-text matcher
- [Spec arithmetic: old vs new probe](reference_spec_arithmetic_old_vs_new_probe.md) — zzold_ copy of HEAD + CSV probe; OLD must reproduce the spec first
- [Repeating a set-building spec needs a full reseed](reference_repeating_a_set_building_spec_needs_a_full_reseed.md) — partial reset breaks setup; each repeat = agent-convex --seed + setup + bootstrap
- [Printed place reads players, never the year](reference_printed_place_reads_players_never_the_year.md) — pairing settles only a lone in-league place team; several → card rule, playersMustDecide; a marketplace team among them AGREES
