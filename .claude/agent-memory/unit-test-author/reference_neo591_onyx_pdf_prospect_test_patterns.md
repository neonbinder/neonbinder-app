---
name: neo591-onyx-pdf-prospect-test-patterns
description: NEO-591 test recipes - hand-built PDF pages through the real groupPageItems, real-fixture Onyx pipeline, resolveProspectTeams convex-test world, mutation driver
metadata:
  type: reference
---

- Hand-built PDF records: feed `groupPageItems` (`PdfTextItem` with `fontName`) per page and map to `{line,page,cells,xs,items}`; cells, xs and runs then match what the reader hands the parser. Header cells need wide x spacing (35 pt+) or the reader merges them. Header font vs data font drives mid-page headings; no fonts = only ALL CAPS headings (Title Case rows get "Not under any section heading").
- A same-key straddle ("De La Torre Luis") needs two distinct pairs: ("De La Torre","Luis") and ("De La","Torre Luis"). 9 pairs in a header still split (unit of 6 repeats 3x); use 11 pairs to prove the group cap.
- Real fixture pipeline: legacy pdf.js + `readPdfLines` + `readChecklistFile` + `readChecklistSections`, as the golden test does; `console.log` is swallowed by the vitest config, write probes to a file under the scratchpad or use `npx tsx` for pure modules.
- `resolveProspectTeams` world: sport -> year node -> leaf is enough (no setName chain); `teamRowFields` makes nameNormalized; aliases need a `teamAliases` row too; `search_name` works in convex-test. The "back-check" case is an MLB row with the SAME full name as the only qualifying college row. Punctuation folds ("Oklahoma*" settles), so do not expect search syntax to hold.
- Commit tests: a held X card is `teamLookup:"checklist"`, `teams:[]`, `prospectTeam`, `rawTeamName`; the hint branch for cards WITH and WITHOUT a bsc ref are two different code paths in `settleCardTeamAnswer`, test both.
- Mutation driver: python script that swaps one string in a product file, runs the named test files, restores from the in-memory copy and asserts a sha1 match; run it with the shared worktree in mind (other builders edit other files).
- Another builder can add fields end to end under you (NEO-591 `prospectTeams`); re-run the whole `lib/checklists convex` slice before reporting.
