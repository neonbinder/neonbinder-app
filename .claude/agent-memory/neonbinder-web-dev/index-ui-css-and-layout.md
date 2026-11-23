# UI, CSS and Layout

Radix, Tailwind, theming, sticky/scroll layout, wrapping, Clerk appearance and design-system quirks.

- [Clerk ui strings live in clerk ui package](reference_clerk_ui_strings_live_in_clerk_ui_package.md) — Clerk's prebuilt-component text is NOT in node_modules — clerk-react loads clerk-js by MAJOR from Clerk's CDN and the UI (plus every en-US string) ships in a separate…
- [Clerk links and field edges](reference_clerk_appearance_links_and_field_edges.md) — links follow colorPrimary; field edge = 11% box-shadow; fix via appearance.elements
- [Reference field marker class is two classes and mangles camelcase](reference_field_marker_class_is_two_classes_and_mangles_camelcase.md) — An apps/web Input carries TWO mb-field-* classes (the primitive's own plus the caller's fieldClass key), and useFieldTestClass mangles a camelCase key — "cardNumber" b…
- [Slate border contrast on slate-900](reference_slate_border_contrast_on_slate_900.md) — slate-600 still fails 3:1 on the slate-900 dialog panel (2.4:1); slate-500/gray-500 (~3.7:1) is the passing boundary tone
- [Wrap-boundary toolbars move under the cursor](reference_wrap_boundary_toolbar_moves_under_the_cursor.md) — fix the width, not the flow; all 4 admin screens carry it, and the width follows the longest realistic option
- [Autocomplete list is a fixed layer](reference_autocomplete_list_is_a_fixed_layer.md) — portalled into nearest role=dialog, fixed, body-bounded; focus returns use focusWithoutOpening; act() around el.focus() in tests
- [SetRowActionButton quiet tone is dark-only](reference_setrowactionbutton_quiet_tone_is_dark_only.md) — on the white-in-light-OS checklist card use NeonButton + its contract
- [Runtime colour needs a per-theme split](reference_runtime_colour_needs_a_per_theme_split.md) — livery never passes both modes; decide per useTheme().mode against tokens.ts surfaces (hover + /20 tint too)
- [light-dark() follows data-theme](reference_light_dark_follows_data_theme.md) — oklch light-dark() arbitrary value for a colour with no role; bg-hover == bg-raised in dark; neon borders → -text
- [Caption under an image never widens it](reference_caption_under_an_image_never_widens_it.md) — figure flex-col + caption `w-0 min-w-full wrap-anywhere text-balance`; `w-min` zeroes preflight images
- [Abs child escapes an unpositioned scroller](reference_abs_child_escapes_unpositioned_scroller.md) — sr-only in an overflow-x row widens the doc; isMobile zooms out → "intercepts pointer events"; make the row relative
- [Container's own cqw resolves upward](reference_container_own_cqw_resolves_upward.md) — size the container itself in %, cqw only on children; a cqw radius on the root made a pill (NEO-350); happy-dom drops min()/cqw inline widths, test a pure helper
- [Radix button outside a Theme portal](reference_radix_button_outside_theme_portal.md) — createPortal(body) loses Radix tokens (NeonButton padding 0): prop-less nested <Theme> in the portal, never portal into the root Theme
- [Radix Themes tooltip needs Theme in tests](reference_radix_themes_tooltip_needs_theme_in_tests.md) — Tooltip throws outside <Theme> in component tests; child aria-describedby overrides the trigger; headless .focus() never opens it, Tab does
- [Tailwind JS-config colours are inlined](reference_tailwind_js_config_colours_are_inlined.md) — neon-* compile to literal hex; redeclare in @theme to theme them by variable
- [Radix scale overrides lose to Radix](reference_radix_scale_overrides_lose_to_radix.md) — Radix sets --green-9/--focus-8 on the Theme element, so html-level remaps never reach it; set them there, probe computed values
- [data-theme="dark" scopes a subtree](reference_data_theme_dark_scopes_a_subtree.md) — pin roles dark for one scene (spin shelf, /u storefronts); light signatures still match; waitForURL glob matches query
- [Unlayered CSS beats Tailwind utilities](reference_unlayered_css_beats_tailwind_utilities.md) — feature stylesheets are unlayered and outrank @utility/@layer rules; strip legacy colours before adding a signature class
- [Radix layer under Tailwind utilities](reference_radix_button_box_beats_tailwind.md) — Radix CSS is `layer(radix)` in globals.css (NEO-364): plain utilities on NeonButton work, no `!`; never import it from JS
- [Sticky sub-bar must bump scroll padding](reference_sticky_subbar_must_bump_scroll_padding.md) — a bar sticking under the sm-sticky header needs html scroll-padding-top grown inline while mounted; hint text outside the sticky part
- [backdrop-filter makes a containing block](reference_backdrop_filter_makes_a_containing_block.md) — a "fixed" button in a blurred scroller scrolls away; blur a sibling. Also h-0 min-h-full
- [Sticky header in a padded scroller](reference_sticky_header_in_a_padded_scroller.md) — sticks at the padding edge; thead bg does not paint; sticky+bg per th, border-separate, overflow-clip
- [SetAttributesPanel children route status via showToast](reference_set_attributes_panel_children_route_status_through_showtoast.md) — one role=status in the panel (NEO-412); add the child's api namespace to the test's api mock
- [break-words does not shrink a table cell](reference_break_words_does_not_shrink_a_table_cell.md) — auto-layout table + unspaced title: use wrap-anywhere; flex + min-w-0 is fine with break-words
- [Unlayered text-wrap beats truncate](reference_unlayered_text_wrap_beats_truncate.md) — globals.css p/li/h text-wrap is unlayered, so `truncate` wraps; long names use min-w-0 + wrap-anywhere
- [Centred fixed toast shrink-wraps to 50vw](reference_centred_fixed_toast_shrink_wraps_to_half_the_viewport.md) — use a fixed inset-x-4 flex band + max-w-full box; items-start + mt nudges keep one-line rows
- [Image-sized link is 0 px wide before decode](reference_image_sized_link_is_zero_wide_before_decode.md) — `h-N w-auto` img in a link fails axe target-size pre-load; frame the link aspect-[5/7] h-N
- [Device preference store](reference_device_preference_store.md) — per-device setting shared by page + layout: one useSyncExternalStore module, storage try/catch, test reset in afterEach
- [Tokens scan reads state variants](reference_tokens_scan_reads_state_variants.md) — aria-disabled:/disabled: classes are scanned; ink-3 on button-neutral fails dark, held fields use ink-2
- [Inline-block is a reader group](reference_inline_block_is_a_reader_group.md) — inline-block span in a one-phrase <p> = Chrome AX generic; role="presentation" flattens it
- [Error ink = neon-pink-text alias](reference_error_ink_is_neon_pink_text_alias.md) — notice-danger-ink inherits its TEXT_NEVER_ON bars; error in a dark tile goes on a bg-field well
- [Dense one-line rows: wrap atomic pieces, never clip](reference_fixed_table_layout_counts_a_hidden_column_in_a_colspan.md) — nowrap atoms, w-1 short cols, no-clip assertion; table-fixed colSpan phantom col
- [Radix size-1 button does not wrap](reference_radix_button_size1_does_not_wrap_long_labels.md) — 24px fixed height, no wrap; data-driven labels overflow phones; use h-auto min-h-6 max-w-full wrap-anywhere
