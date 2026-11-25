---
name: patterns-held-insert-parallel-build-on-a-hand-made-insert
description: NEO-661 - prove the client's held auto-start (insert parallels wait for no pink) on a per-attempt hand-made insert with one grouped parallel; run lines by text behind the walk; plants
metadata:
  type: pattern
---

The held auto-start (`CardChecklist` `heldParallelBuildRef`, armed by a commit on any non-Base,
non-Parallel row: `parallelBuild.role === "insert"`) is provable without a real set:

- Fixture: `drillToCustom({ sport: hps<T>, year, manufacturer, set, variantType: "Insert" })`,
  `addCustomEntry("Inserts", INSERT)` + a second insert, pick INSERT, Group Parallels
  (`Select <sub>` checkbox, click `Parallels of "<INSERT>"`, "Save 1 change"); the Sub-Variants
  column (header "Parallels") lists it and INSERT's checklist is open. Paste `1,<name>,` (blank
  team cell): the card is pink twice (new name + no team), the walk opens on Sync.
- The run lines (`Building parallels of X — `, `Building N parallel(s) of X`, `X parallels — `)
  sit behind the walk dialog, which hides the page from the a11y tree: match them with
  `getByText`, not by role. After `saveForLater`, the ledger is a region + heading
  `X parallels — 1 built` and a listitem `<sub> — Built 1 card`.
- A hand-made set has no BSC team lookups, so the "lookup" hold cannot be shown on it.
- Plants that went RED as planted: `!cards.some(blocksParallelBuild)` -> `cards.length >= 0`
  (`--expect 'a pink card holds'`), and TeamFillChips' status pinned to "Looking up teams…"
  (`--expect 'still looking up teams'`, proves the `answerPinkTeamTiles` wait).
- `answerPinkTeamTiles` waits for the Team tile's "Looking up teams…" (role=status, by text) to
  go before choosing a chip or "No team on this card"; it reads it after `none` is visible, since
  both render together.

**Why:** NEO-661 coverage gap (2026-11-24). **How to apply:** any spec about when an insert's
parallels start. Related: [[patterns-parallel-build-specs-must-tidy-the-base-j3]].
