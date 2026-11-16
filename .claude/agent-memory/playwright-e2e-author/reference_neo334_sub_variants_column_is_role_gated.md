---
name: reference_neo334_sub_variants_column_is_role_gated
description: Variant types - NEO-334 title is the kind, Insert/Base pair, insert fixtures need their column writer, NEO-458 prefixed parallel numbers
metadata:
  type: reference
---

**The kind is the title (Jason, 2026-10-10; supersedes the flag rule this
note first recorded).** `variantTypeKind(row)` (convex/variantRole.ts) reads
the row's value after trim / whitespace-collapse / case-fold: `base`,
`insert`/`inserts`, `parallel`/`parallels`. No substring matching —
"Insert Set", "Base Parallels" have no kind. No `metadata.variantRole` /
`isBase` is read any more, so a type an operator TYPED ("Insert" via
util-drill-to-custom `VARIANT_TYPE`) is an Insert type exactly like a synced
one: Group Parallels and the seventh column are there. A flow proving nesting
no longer needs a synced fixture.

**What each kind changes on screen:**
- Insert type: picking an insert opens column 7 (`Sync Sub-Variants`,
  `+ Custom` = `id: "Add custom Sub-Variants"`, confirm `Create sub-variant`).
- Parallel type: no column 7; the `Parallels of <Base>` section mounts under
  the columns, and an insert's empty checklist shows the build stand-in
  (`Can't build yet` when the set has no Base) instead of `Fetch from
  Marketplaces`. That section lists hand-made rows as
  `<row> — skipped: not linked to a marketplace yet`, so a `.*<row>.*`
  pattern also matches (and taps) the section — use exact `text: "<row>"`.
- Base: terminal — no Variants column, the checklist (`Open add card form`)
  hangs off the type, the `Base set` tag sits in the attributes header, and
  on a hand-made set the Base mapping panel answers `Nothing to link yet…`
  with no round trip. A type becomes the Base by being RENAMED "Base".

**Refusals and where they render:**
- Custom-add of a singular/plural twin ("Insert" beside "Inserts"):
  EntityColumn refuses on Enter, before the confirm, in the form's alert
  (`…one word gets one row…`); then `id: "Cancel new variant type"`.
- Rename (attributes-panel pencil): a `<p role="alert">` under the header;
  the field STAYS OPEN holding the refused text, so tap the field itself and
  `eraseText` before typing the next name. Kind change with sub-variants →
  `…only live under an Insert type…`; second Base → `…already has a Base.`
  The one-Base check runs before the sibling clash.

**Re-pointing the attributes panel at the variant type.** The panel follows
the DEEPEST selection, and re-picking the selected type clears nothing below
it (handleVariantTypeSelect). Pick a different type, then come back: tap
`id: "Variant Types: <name> — change"`, tap/type into
`id: "Search variant types"`, tap `{text: <name>, below: {id: "Search
variant types"}}`. Gate every pick on its collapsed card before tapping
anything to its right (late collapse, columns row clip and late collapse).

**Variants header handles.** `Sync <label>` / `Add custom <label>` /
`Search <label lower>` all derive from the header; `text: "<label>"` does
not prove the header because the collapsed Variant Types card shows the same
word. A title ending in "s" is not re-pluralised ("Inserts" → "Inserts"), so
util-drill-to-custom's `${VARIANT_TYPE}s` waits break for such titles —
create those types inline.

**Telling the two "Parallels" columns apart** (under a type titled
"Parallel", column 6 is titled "Parallels" too): column 7's buttons are
`Sync Sub-Variants` / `Add custom Sub-Variants`. After a row in column 6 is
picked it collapses to `Parallels: <row> — change` and its `Search
parallels` box is GONE, so from then on `id: "Search parallels"` can only be
column 7's; that box renders from frame 1, so it is the decisive negative.

Proved by `variant-type-title-is-its-kind.yaml` (hand-made) and
`bowman-sportlots-links-move-between-set-parallel-insert` claim 10 (synced).
See [[patterns_entity_column_shapes_and_cold_sync]],
[[patterns_negative_asserts_pass_on_a_dead_page]],
erase text needs the caret at the end.

## Neo334 title kind and insert base pair

NEO-334 reads a kind off a title ONLY at `variantType` level (`variantTypeKind`
in convex/variantRole.ts): exact word base(s) / insert(s) / parallel(s).

- The suite's default hand-made pair (`util-add-custom-card` INSERT_NAME
  default "Base", `util-drill-to-custom` VARIANT_TYPE "Insert" + VARIANT
  "Base", and inline in set-fill-teams / set-team-carries-down) is a TYPE
  "Insert" with an INSERT "Base". The insert is not the Base; the set has no
  Base, so teamFill's `baseSet` tier is skipped. Easy to misread as "a
  hand-made Base" — check the level before "fixing" it.
- Keep the type titled "Insert": it is Insert-kind, so picking "Base" opens the
  Sub-Variants (7th) column — the layout these flows were measured with.
  Retitling it to a non-kind word removes that column and changes the
  horizontal-scroll measurements (set-team-carries-down's re-drill comment).
- Typing a kind word as a VARIANT TYPE now has effects: "Base" is terminal
  (no Variants column; util-drill-to-custom cannot drill it), a second Base and
  a same-word sibling ("Insert" beside "Inserts", "Promo" beside "Promos") are
  refused at create. Same-word is variant-type level only; inserts keep the
  exact-name rule.
- Sweep recipe: grep `inputText` after `Add custom Variant Types` plus every
  `VARIANT_TYPE:` env, grouped by SET_NAME prefix, to find sibling pairs.

Related: variant type title is its kind flow owns the rule's E2E proof.

## Insert fixture needs its column writer

**Rule:** before proposing an insert as a fixture, answer two questions with
read-only evidence:

1. **Who writes its column?** `SET-REGISTRY.md` names a sole writer per
   variant-type column. If that writer REQUIRES a fresh column (its reconcile
   "opens on its own", e.g. `reconcile-sportlots-twins-save-each-to-its-own-set`
   on 2024 Topps flagship › Insert), no other flow can save that column
   without breaking it, in either run order (the queue has no ordering).
2. **Is the insert auto-matched?** The reconcile auto-pairs by name; BSC and
   SportLots often name one insert differently (BSC `1989 Topps Baseball 35th
   Anniversary All-Stars` vs SportLots `2024 Topps 1989 Topps All Star`
   #307353, brand-stripped to `1989 Topps All Star`). Such a pair waits in
   Pending and the row is created only by an operator pairing (or `Make its
   own set`) plus a Save. Check the saved column read-only after a green CI run
   (`selectorOptions` children of the variant-type row): 2024 Topps flagship ›
   Insert held 149 rows and no 1989 All-Stars row.

**Why:** NEO-330 (2026-10-10) — an owner-approved insert fixture turned out to
need a reconcile Save on a column another flow owns fresh; found at the clash
check, before any flow was written.

**How to apply:** a fixture's provisioning is part of the proposal: name the
step that creates the row (setup, the fixture flow, or the column's writer)
and what the column's current writer must change. SportLots' public listing
by year (`SetNbr`/`SetInfo`/`CardInfo`) and BSC's shop facets (`variantName`
under `setName`) give both names offline. See [[patterns_per_worker_data_isolation]].

## Neo458 prefixed parallel numbers stay bare

A parallel's cards are a COPY of Base's NB cards (NEO-312/321), each re-linked to
the parallel's own BSC card by number with the row's Card prefix taken off BSC's.
So the prefix is a LINK key, never stored on the number: Football 2026 Bowman
Base is bare (`#26 Dak Prescott`), Parallel > Chrome built from it is bare too,
while BSC spells them `BCV-26`. Setting the prefix AFTER the build links nothing
new; set it first, then "Build from Base" (`Chrome - Built 198 cards, 2 left
off ... 2 on BSC that Base doesn't have`). A prefix on a parallel row is read by
`prefixOf(chain)` in `parallelChecklistBuild.ts`; the BSC fetch path
(`fetchCardChecklist`) strips it only for the SportLots lookup and stores BSC's
number as given - that was the wrong model for this flow.

The tree under a SportLots pause: `drillToColdManufacturer(..., manufacturer:
"Bowman")` hand-makes the brand; the Set is `Bowman`, variant types `Base` /
`Insert` / `Parallel`; the parallel's row is an `insert`-level row named
`Chrome` under the `Parallel` variantType. The collector cascade reads Football >
2026 > Bowman > Bowman > Parallel > Parallel (column, singular) > Chrome, and the
checklist region is `2026 Bowman Chrome` (year + set + parallel name). Base is
200 cards, four unknown players, no team step, saved in about 15 s.

Traps met on the way:
- After picking Base the Variant Types column is the collapsed card
  `Variant Types: Base - change`: click it to reopen before picking Parallel.
- Wait for `Parallels: Chrome - change` before `Edit attributes`, or the toggle
  opens the Parallel TYPE's panel (no Card prefix field).
- A parallel-role leaf has no "Sync card checklist", only "Build from Base".
- The card drawer has NO number field, and a BSC ref is only set by a fetch or a
  build, so a card cannot be given a number that differs from its BSC row through
  the product. The "stays held for a different number" negative control is
  unit-test only (`lib/bscSheetPlan.test.ts`, `listingDrain.test.ts`).
- A filtered collector checklist with no hits reads `No cards match.` and `0 of
  198 cards`, not `0 cards`.
