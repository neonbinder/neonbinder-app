# Feedback and Product Rules

Jason feedback, project scope notes and cross-cutting patterns about UI conventions and product behaviour.

- [Linking uis are drag and drop](feedback-linking-uis-are-drag-and-drop.md) — Any "these two lists describe the same things" pairing/linking UI must be drag-and-drop, and must say so on screen — Jason's operator feedback on NEO-189 / PR #205
- [No inline sub object forms](feedback-no-inline-sub-object-forms.md) — Owner rejects inline fields that create a DIFFERENT object inside a form; use a modal that completes the sub-object first, then selects it
- [Feedback no self opening modals](feedback-no-self-opening-modals.md) — Never let a modal open itself off a background/reactive event — advertise the work in a live region and let the operator press a button
- [Feedback notice ctas need a structural marker](feedback-notice-ctas-need-a-structural-marker.md) — Extra affordances on a shared status banner must key off an explicit marker on the notice state, never the tone bucket or the message text
- [Feedback team location is any place including a school](feedback-team-location-is-any-place-including-a-school.md) — Team `location` is wherever the team is from — city, state, region OR school; never write that colleges/national sides "have no location
- [Midbuild security conditions](feedback_midbuild_security_conditions.md) — On this project a security-auditor pass lands mid-build as numbered conditions that OVERRIDE the launching prompt; fold them in immediately and report per-condition wi…
- [Pendingteamnames invisible until sync](pendingteamnames-invisible-until-sync.md) — A quick-added card's typed team used to land in pendingTeamNames, which no checklist UI rendered and NEO-102 also un-badged — fixed and merged in NEO-208 (PR #215); on…
- [Bsc attach only functions on insert rows](project_bsc_attach_only_functions_on_insert_rows.md) — Known gap found in NEO-196 — a row's attached BSC ids only affect card fetching on `insert` rows; on variantType and parallel rows they are attribution-only. SportLots…
- [Selector deadline scope](project_selector-deadline-scope.md) — NEO-198 deliberately did NOT bound the credential/re-auth path behind the selector-option adapters; do not re-propose that surgery.
- [Growing lists are type-ahead](feedback-growing-lists-are-type-ahead.md) — one-of-N over a growing table = Autocomplete picker mode, never pills/radiogroup; Jason on NEO-307 League pills
- [Variant type title is its kind](project_base_role_and_row_are_one_thing.md) — NEO-334: Base/Insert(s)/Parallel(s) exact word via variantTypeKind; no flags; kind-changing rename refused with rows beneath
- [Sync Sets held notices not surfaced](project_sync_sets_held_notices_not_surfaced.md) — setName store's held/withheld are dropped at the action boundary on purpose (NEO-312); don't re-propose a channel
- [Reuse the status-ledger spinner→check pattern](feedback_reuse_the_status_ledger_spinner_to_check_pattern.md) — owner-approved (NEO-312 ParallelBuildPanel): per-item ledger, clock→spin→check glyphs, sleeve strip; reuse for any multi-item run, extract on second use
- [Result ledgers grow, the page scrolls](feedback-result-ledgers-grow-the-page-scrolls.md) — no max-h-48 inner scroller on a list the operator reads; 70vh cap only past a pathological count (Jason, NEO-321)
- [Error state is neon pink on title fields](feedback_error_state_is_neon_pink_title_fields.md) — NEO-606: too-long counter/note/box pink via OVER_FIELD_CLASS; DESIGN.md updated; no wider sweep (Jason decides)
- [Tidy walk answer focus belongs to the walk](project_tidy_walk_answer_focus_belongs_to_the_walk.md) — tiles call useAnswered(); walk lands on Save & next / next pink tile; opener restore only on Cancel/Esc
- [Stored key vs comparison key split](feedback_stored_key_vs_comparison_key_split.md) — a name-rule change goes in an explicit comparison step, never the stored-key fold; prove stored keys vs origin/main by fuzz
- [Mixed preselect: focus the open question](pattern_mixed_preselect_focus_goes_to_the_open_question.md) — some ticked, one tied: focus its chip by ref, not Save; heading names both
- [Capped history router test](pattern_capped_history_router_test.md) — push per step to a depth cap (40) then replace; test with HistoryRouter + a 50-entry capped memory history
- [Every title builder passes the card name](pattern_every_title_builder_passes_the_card_name.md) — set inputs.subjectName via cardSubjectName in every assessListingTitle caller; fixtures named "Card 1" are real names, use "Card #1"
- [Title counter has no soft band](feedback_title_counter_has_no_soft_band.md) — warn only past 80; no "may clip" (NEO-645)
- [Walk focus is one owed rule](pattern_walk_focus_is_one_owed_rule.md) — placeFocus for arrival/answer/repair; combobox via focusWithoutOpening; pink controls can mount late (NEO-645)
