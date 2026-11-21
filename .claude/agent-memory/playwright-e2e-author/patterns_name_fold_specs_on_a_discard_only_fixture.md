---
name: name-fold-specs-on-a-discard-only-fixture
description: NEO-643 — how to prove a name-matching change in Match Cards without committing: Stars of MLB Network reader, full-row in-memory CSV, the matched toggle's conflict clause, catalogue probe, plant targets
metadata:
  type: pattern
---

Proving a name-matcher change (accents, junk characters) through Match Cards:

- **Fixture:** a discard-only reader set (Topps Stars of MLB Network Base), never a set whose sole writer commits in-pass (2026 Donruss Signature Series): CI runs both on one seed in parallel shards, so a reader sees an empty or committed set by shard order.
- **Cover every card with a row.** A real-set checklist that leaves a card out asks BSC live for that card's listing; an unrecorded one is a 501. Build the CSV in memory from `checklistRows(CHECKLISTS.x)` (all rows), respell some, append checklist-only rows with numbers BSC does not list; paste it with `usePastedChecklist`.
- **Exact pair at 100%:** chip text "On checklist" (no number, no %), no "Numbers differ", no `Name for #n` radiogroup. The matched toggle's name is EXACTLY `Expand|Collapse matched cards` only with no conflict; it gains `, N with a name conflict`. The list may open expanded: `expect(expand.or(collapse))` then click expand if visible.
- **Keep a confirmed unknown name in the batch** (an unknown person or team the set already asks): if every name is known and no post-name step applies, Confirm in Match Cards COMMITS with no wizard. Then `Skip remaining names (N)` and "N names need a look before this saves." count the names asked; a junk-spelled catalogue player adds one when unfixed.
- **Catalogue probe:** `npx convex run players:search '{"query":"Acuña","limit":30}' --identity '{"subject":"probe","issuer":"probe"}'` on your own deployment; the search index is accent-sensitive ("Acuna" finds nothing).
- **Plant:** remove `\\` from `NAME_JUNK` (lib/entities/cleanse-name.ts) plus a comment touch in a `convex/` file so `plant` pushes (it pushes only when a `convex/` path is in the edit). E1-style admin near-match reds at the "Create … anyway" button; Match Cards reds at the toggle (`, 1 with a name conflict`).
- An HMR-killed Match Cards session (a sibling's edit) left a checklist-only candidate behind for the worker: the next fetch listed the row twice ("row 1 of 2"). `--fresh` cleared it; `--setup` alone fails (setup is not re-runnable on a used seed).

Related: [[sibling-edits-reload-a-local-vite-run]], [[patterns_checklist_is_a_match_cards_source]].
