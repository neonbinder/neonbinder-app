---
name: patterns_entity_column_shapes_and_cold_sync
description: Set-builder column behaviours - search box, selected column collapse, column sync failure, year-wide sets sync, All Brands, brand-unknown rows, committed checklist mid-list
metadata:
  type: pattern
---

# Selector column shapes, and why "Sync <X> is visible" is not "the column has data"

Verified live against dev on 2026-09-03 (NEO-211) with deliberate-failure probes.
Check `EntitySelector.tsx` for the current search-box rule: NEO-224 later made
the box unconditional (see [[patterns_entity_column_shapes_and_cold_sync]]).

## 1. An empty column renders its idle buttons BEFORE the sync starts

`EntityColumn.newPathContent()` shows the `Syncing <X>` panel only while
`selectorSyncStatus.status === "syncing"`. A cold, empty column renders
`Sync <X>` + `+ Custom` **immediately**, and only switches to the panel once
`ensureSelectorOptions` has round-tripped (~300 ms later). So an assertion that
`Sync Sets` is visible passes in the first fraction of a 60 s fetch (a probe
dumped a completely empty Sets column at exactly that moment).

**How to apply:** use the shared cold-column helper (`drillToColdManufacturer`,
and the settle helpers in `support/set-builder.ts`) rather than hand-rolling. The
shape is: `await expect(syncingPanel.or(content)).toBeVisible(...)`, wait for the
panel to go (`toBeHidden`), then assert the content (the row, with the sanctioned
cold-path timeout from GUIDE hard rule 3 only where the fetch is genuinely live).
The VALUE must not match an ancestor's collapsed chip, or the assertion is
satisfied before the column loads. A `toBeHidden` on the panel alone is a
negative: pair it with the positive content assertion ([[patterns_negative_asserts_pass_on_a_dead_page]]).

## 2. Enumerating a column's real contents

To find out what a marketplace actually returned, run the spec once with a
deliberately wrong expectation and read `error-context.md` (the ARIA snapshot
lists every option in the column), or `await page.getByRole("listbox", { name:
"Sets" }).getByRole("option").allTextContents()` in a scratch run. Filter the
column first when the list is long. Delete the probe afterwards.

Related: [[patterns_local_run_backend_and_vite]].

## Search box is not a content signal

Before NEO-224 `EntitySelector` rendered its search box only above 8 rows, and
many gates used "the Search box is visible" as the CONTENT gate. NEO-224 made the
box unconditional (it is the column's combobox and the cascade's focus target), so
those gates pass in the first frame of a cold fetch and the next row click dies on
its timeout.

**Why:** a gate that passes before the thing it waits for is a false gate; the
seed (`setup.spec.ts`) is the costliest place to have one.

**How to apply, the replacement signals:**
- the column's LISTBOX (`getByRole("listbox", { name: "<Column title>" })`) holds at
  least one `option`: EntitySelector renders the listbox only when the column has
  at least one row;
- type the target name FIRST (the filter survives rows landing), then assert the
  filtered option is visible; for an alternation with a dialog use `.or()` and type
  a PREFIX so the box's own value can never satisfy the row locator;
- **typing first races an auto-opened dialog.** At Insert/Parallel level the
  auto-sync opens ReconciliationModal the moment both fetches return; it focuses
  its own root on mount and restores focus on close, so keys typed in that window
  vanish and the box comes back focused but EMPTY. Guard the `fill` by asserting
  the dialog is not open, and after the save re-fill only if the box is empty
  (`toHaveValue("")`);
- Manufacturers only (its listbox always holds the pinned All Brands entry):
  positive pinned-entry gate, then assert the idle empty text is hidden;
- "no search box means short column" fallbacks are dead code now, but first check
  what other outcome their guard caught
  ([[patterns_dead_branch_guards_can_cover_a_second_outcome]]).
Related: [[reference_neo255_one_marketplace_surfaces]].

## Selected column collapses to card

Rule: after a spec clicks a row in an EntityColumn, do not assert or act on that
column's search box, its heading or any row in it: `EntitySelector.select()` calls
`setExpanded(false)` and the column renders only its collapsed card
(`aria-label "<Title>: <name> — change"`). What survives the collapse is
EntityColumn's own action row underneath: `Sync ...`, `Add custom <Title>` and
`extraActions` (`Group Parallels`). That is why the parallel-grouping specs can
press `+ Custom` and `Group Parallels` right after a row auto-selects, and why a
search-box locator that worked BEFORE the click finds nothing after it.

**Why:** a first NEO-293 draft scrolled to the Insert column's search box right
after a step that had clicked the insert row. The box did not exist any more; the
step would have burned its budget and failed on a healthy page.

**How to apply:**
- Need the list back? Click the collapsed card
  (`getByRole("button", { name: /<Title>: <name> — change/ })`, em-dash): that is
  what an operator does. Or re-drill with the helper.
- Need a deterministic page position whichever branch ran? Re-enter through the
  launch-gate heading (`Build set parameters using marketplace APIs` on the set
  builder) and work from there.
- Once something is typed into an input, locate it by its label / accessible name
  (`getByRole("combobox", { name: ... })`, `getByLabel`), not by placeholder text;
  the placeholder is not a name once a value is present.

## Column sync failed hides the empty line

Since NEO-450 a set-builder column whose own sync failed shows ONLY the
box `Couldn't sync <column> — please try again.` (role `alert` only when
THIS session's own attempt failed, role `status` for an error the server
already held, e.g. a faked one; `columnSyncError` matches both, text from
`columnSyncFailedMessage` in `components/SetSelector/column-sync-failed.ts`,
React-free so specs import it). The idle "No <x> available. Sync from
marketplaces to populate." line is hidden meanwhile, so:

- A wait that settles on the idle line or the rows must also wake on
  `columnSyncError(page, column)` (support/set-builder.ts), then assert it
  hidden with a message, so a failure reds by name instead of as a timeout.
- `empty.toBeHidden()` is no longer proof rows landed: pair it with the
  alert hidden (see [[patterns_negative_asserts_pass_on_a_dead_page]]).
- `.or()` with the alert needs `.first()`: the alert may sit beside rows a
  sync stored earlier (strict mode).

**Why:** the old `/Couldn.t sync options/` page check would have silently
matched nothing after the copy change.

**How to apply:** to match "any column" copy, build the regex from the
builder: `builder("\u0001").split("\u0001")` gives head/tail, escape both,
join with `.+` (setup.spec.ts `ANY_COLUMN_SYNC_FAILED`); never hand-copy the
sentence. Use `toHaveCount(0)` for page-wide absence (two failed columns
would make `toBeHidden` a strict-mode error).

## Sets sync is year wide and populated gated

Read out of `ensureSelectorOptions` / `syncSetsAcrossManufacturers` (NEO-237,
NEO-305 era). Three facts that decide whether a fixture spec gets SportLots-derived
sets at all:

1. **The auto-sync fires only on an EMPTY column** (`already_populated` skip, no
   `force`). Pressing the idle `Sync Sets` button is the forced path.
2. **A brand column's Sets sync is year-wide on the BSC side** (BSC has no
   manufacturer facet; the whole year list is filed under every brand by prefix,
   rest under `Unknown`) **but brand-scoped on the SportLots side**
   (`manufacturerId` = the brand whose column fired it).
3. **No "already syncing" guard, MEASURED harmless (NEO-330).** Five simultaneous
   `ensureSelectorOptions` calls (five admin accounts, via `npx convex run --identity`
   with an admin subject) on a cold year, manufacturer level then the All Brands view's
   year-wide Sets: all ran, each ~2x slower, zero duplicate rows (by name or id), one
   `Unknown`, no stuck status. So several specs may drill the same cold column; do not
   pre-sync it in setup. Re-measure this way (on an unused cold path) if the store code
   changes.

**Consequence:** once brand A's column has synced a year, brand B of that year is
already populated by BSC's filing, so opening B runs NO SportLots phase: a spec
expecting B's SportLots-only sets is order-dependent unless it presses `Sync Sets`.
Pick one brand-year per spec, or force the sync.

**NEO-305 corollary:** where BSC answered and the brand has a flagship (a set named
exactly the brand prefix), EVERY SportLots-only name in that brand is absorbed
(`flagshipAbsorbs`), not only colours. SportLots-derived sets still appear under
`Unknown` (never absorbs), under brands with no flagship set, and when the BSC phase
did not file. The dependable live source of a SportLots-derived set on a flagship
brand is `Promote to set` on a parallel that the Parallels reconcile paired with
SportLots.

Related: [[patterns_record_a_fixture_sets_lookups]] for measuring a candidate
year.

## All brands is where the one sided sets live

`syncSetsAcrossManufacturers` (`convex/selectorOptions.ts`) is **BSC-only**. It
fetches one flat BSC set list for a sport+year and buckets it under the
SportLots-derived Manufacturer rows by **name prefix** (longest brand name first).
Anything whose name starts with no brand goes under **"All Brands"**: minor-league,
junior, college, team and food-issue sets. Where the row is created by
`addCustomSelectorOption` it carries **no marketplace ids of its own**, which makes
SportLots unresolvable beneath it (SL needs sport + year + **manufacturer**).

**Measured 2026-09-07 on PR #242's preview: Hockey differs.** `All Brands` is a
row in **SportLots' own hockey brand list**, so the ordinary manufacturer sync
creates it, with a SportLots id, before any Sets column has mounted. Hockey 1995
and 1997 both return the same 18 rows (All Brands, Bowman, Classic, Donruss,
Finest, Fleer, ITG, O-Pee-Chee, Pacific, Panini, Pinnacle, Score, Skybox, SP,
Stadium Club, Topps, Ultra, Upper Deck). **One cold-drill pass is enough**
(`drillToColdManufacturer`); a two-pass drill buys nothing. Check the
Manufacturers column before assuming either way for another sport.

Consequence: **SportLots IS resolvable under Hockey's All Brands**, and the base
picker offers the year's whole SportLots catalogue (measured: 1 BSC candidate, 321
SportLots candidates, and the "no base set" line never renders).

**A set under All Brands is still ONE-SIDED**, for this reason: `attachedSidesOf`
counts a SportLots id only on a row at `SL_SET_LEVELS` = `setName | variantType |
insert | parallel`. A MANUFACTURER's id is deliberately not enough. The set row and
its `Base` row carry a BSC id and no SportLots id, so what keeps the set one-sided
is that the spec CANCELS the picker rather than attaching one.

Do **not** assert `SportLots returned no base set for <set>` under All Brands: it
never appears. Assert the BSC base candidate option (`getByRole("option", { name:
/^BSC base candidate: / })`) and let the product state the outcome itself at the
result line, `Kept all N cards from BSC. Nothing to match, no other marketplace
attached.` Cancelling writes nothing and leaves the SL slot empty, and
`CardChecklist` still mounts, because `cardChecklistId` is the variantType id the
moment a Base row is selected, regardless of `baseHasMapping`.

Careful: if BOTH sides come back empty AND the set carries no BSC slug,
`BaseMappingForm` takes its "nothing to link" branch and the picker never opens at
all; such a set is unusable as this fixture.

See also [[reference_neo255_one_marketplace_surfaces]].

## Patterns brand unknown row fixtures and all brands option names

**All Brands view option names are "<set> <brand>".** The set builder's All Brands
view lists each set with its brand as part of the option's accessible name:
"Topps Topps", "Topps Traded Topps", "Donruss Unknown". `columnOption(page, "Sets", X)`
filters by an exact TEXT X, which also matches every sibling whose brand badge reads X,
so once a brand row is minted for the line ("Donruss Elite Donruss") the helper hits a
strict-mode violation. Pick a flagship by role name instead:
`getByRole("option", { name: /^Donruss \S+$/ })`, or assert the filing with an exact
name (`"Topps Topps"`, and `"Topps Unknown"` toHaveCount(0)).

**Known-brands list (NEO-294, majors since NEO-527) mints brand rows on any year-wide
Sets sync, SportLots paused or not.** A year's brand column is not "only what the spec
hand-made" any more; `selectOrCreate` finds the sync's row when the year was filed first.

**The brand-unknown row exists only on a year some year-wide Sets sync has filed** (no
custom-sport path mints it, and Move to another brand only offers an existing one). Drill
the year through All Brands first, then ASSERT `columnOption(page, "Manufacturers",
"Unknown")` is listed before any `drillToCustom(..., manufacturer: "Unknown")`:
`selectOrCreate` would otherwise hand-make a fake brand called Unknown.

**Collector side (NEO-527):** the collection's Checklists drill never lists the row; its
sets sit in the year's brand column (after a "More sets" group), and picking one skips
the Sets column. The column's title depends on what else the year holds ("Brands",
"Sets" when all are sets, "Brands and sets" when mixed); a picked loose set collapses to
"Sets: <name>, change", a brand to "Brands: <name>, change". Assert ONE EXACT title per
year (`exact: true`), never a regex accepting two: `getByRole`'s non-exact name is a
case-insensitive substring, so a plain `listbox "Brands"` also matches "Brands and sets"
and would hide the change. The shared brand drill (`collectorCascade` in
support/collection.ts) matches `BRAND_COLUMN_TITLE` exactly, so a drilled year gaining a
carded loose set breaks that one constant.
A set WITH CARDS under a year's Unknown changes that year's column for every spec that
drills it (brand drills, the request form's "Brand" select), so host such a fixture on a
year no collector spec drills: Hockey 1995 for an all-loose column (its Unknown already
holds the wizard fixtures' committed sets), Baseball 1996 for a mixed one (a hand-made set
under the sync-minted Topps beside one under Unknown). Never Baseball 2024 or 2026.
The request form and the set pickers label the same field with `brandFieldLabel`: "Set"
(no separate Set select follows), "Brand or set" when mixed. Request a card PREFILLS from
the Checklists drill, but `selectOption` on a `<select>` always fires React's onChange (React
does not skip an unchanged select), so re-picking Sport resets every field below it.
Card search needs every typed word in the card's listing title, which never holds
"Unknown", so "Unknown <set>" finds no card (set SUGGESTIONS may still match; do not
assert on them).

**Dashboard surface that proves it per account:** the Fresh Pulls tile (a link named by
the listing title, "1995 <set> Base Insert #<n> Hockey"). "New on NeonBinder" also names
the set but is GLOBAL and shows 6, so concurrent shards can push a spec's set out of it.
The card panel's Set line is a `definition` (the card face repeats the same words).

Related: [[patterns_entity_column_shapes_and_cold_sync]], [[patterns_responsive_duplicates_and_text_locators]]

## Committed checklist opens mid list

`CardChecklist`'s Virtuoso has `initialTopMostItemIndex = last row` and an
inner scroller (`min(70vh, 800px)`) that a page-level scroll cannot move.
A commit streams cards in batches; the list MOUNTS on the first batch (its
"last row" then is the batch's last) and keeps that scroll position as the
rest arrive. Measured on a 300-card commit: the list showed #146–#150 at its
bottom edge, and the cards a flow wanted (#2–#34) were ~140 rows away.

**How to apply:** to assert a committed card's sub-line, re-enter the set
(a fresh load mounts with every card, so it opens at the true end) and make
the card you assert one of the LAST in natural card-number order. Find which
cards a club owns from the marketplace's facets before choosing (BSC
`teamName` + `cardNo` aggregations). Small sets (≤ ~7 rows) need none of
this. Worked example: the past-era team-link spec (#34–#36 are the last rows of a 36-card
Base; #25–#27 are ~5 rows up, reached by scrolling the list's own scroller from a row),
re-entering through the open-one-marketplace-set-base helper. Pin a sub-line to ONE row
by its position between its own number node and the next row's. Related:
virtualized list phantom rows.

**A set named like its own brand (Donruss, Bowman, Score, Topps) in the All Brands view:** `columnOption(page, "Sets", "Donruss")` matches 2 options, because every sibling's brand text is also exactly "Donruss". Pick by the option's whole name, `^<set> \S+$` (set, then one word of brand), in EVERY helper that opens such a set, including a red-path cleanup helper (`removeSetChecklistUnderAllBrands`) that only runs when the body failed. A set whose name is not a brand ("Topps Chrome") is unaffected by the exact-text match. Probe by counting both locators in a throwaway spec.
