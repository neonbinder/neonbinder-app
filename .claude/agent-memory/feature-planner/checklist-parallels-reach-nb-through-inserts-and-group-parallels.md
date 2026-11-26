---
name: checklist-parallels-reach-nb-through-inserts-and-group-parallels
description: A set checklist's insert parallels become NB rows only via Inserts "Make its own set" then Group Parallels (name prefix, no numbers); print runs never ride a checklist; classify's stored summary reads initials-style numbers as "unknown" = parallel
metadata:
  type: project
---

How a publisher checklist's parallel sections reach NB (read while planning NEO-616):

- `fetchRawOptions` reads the set checklist only at `level === "insert"` (children of a variant type). There is no checklist door at the parallel level. Insert parallels land FLAT under Inserts ("Make its own set" / Keep all) and are nested by Group Parallels (`components/SetSelector/parallelDetection.ts` `detectGroupings`): pure name prefix, depth 1, a claimed child can't be a parent. So "X Mini" is claimed under "X" and every "X Mini <colour>" then falls back under "X". Promotion patches the same row id, so `publishedChecklistLinks` survive it.
- Base parallels are insert-level rows under a Parallel-titled type, built from Base.
- `classifySections` on the SERVER sees only the stored summary (first/last number, count). When first and last number have different prefixes (player-initials numbers like `89A-AW1` .. `89A-ZH1`) the profile is null, relation "unknown", which counts as a parallel. Number evidence can't separate such sections.
- Print runs: `parallelChecklistBuild` takes `printRun` from the linked SportLots card only (M3); stored checklist rows (`publishedChecklistStoredRowValidator`) carry no print run. A checklist-only parallel is an unlinked copy with no runs.

**Why:** a plan that assumes "the classifier already places parallels" or "the build can read the run" lands twice.

**How to apply:** for any checklist format that knows its own parent/child structure, carry it as declared data rather than leaning on name prefixes; check Group Parallels' suggestions on nested-prefix names (Base vs Base Mini) and the summary path in classify before promising placement.
