---
name: parallel-names-stay-literal-print-run-is-a-row-attribute
description: Jason (NEO-616) — checklist-derived parallel names are the publisher's literal words, never tidied; "/N" never goes in a name; a parallel's print run is a row attribute filled at >=90% agreement of its cards
metadata:
  type: feedback
---

Parallel names built from a publisher checklist are the literal "<Subset> <Foil> <Colour>", even when that repeats a word ("Silver Circles RWB RWB") or reads oddly ("Super Prismatic Gold Silver"). No de-duplication or single-colour shortening rules. A print run never goes into a name. Each card keeps its own `printRun`, and the parallel row gets a print-run attribute only when at least 90% of its cards share one run. Non-admin selectors show it when it is known.

**Why:** Jason rejected the planner's tidy-name rule and the "/N in the name" option (2026-11-19, NEO-616). Runs vary per card inside one parallel, and names are NB data that should match the source text.

**How to apply:** never propose name normalisation for checklist-derived rows. Put any run or count summary in a typed attribute on the row and render it beside the name, outside the accessible name ([[aria-names-and-roles-are-the-spec-handles]]).
