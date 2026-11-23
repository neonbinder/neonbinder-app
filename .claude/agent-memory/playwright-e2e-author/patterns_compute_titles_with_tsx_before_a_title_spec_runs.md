---
name: patterns-compute-titles-with-tsx-before-a-title-spec-runs
description: Derive an expected listing title offline with npx tsx over convex/features/generateListing.ts before spending a fresh-only run; variation is never cut
metadata:
  type: feedback
---

Before running (or rewriting) a title spec, compute the exact title the generator
gives for the fixture with a scratch script: `npx tsx <scratch>.ts` importing
`assessListingTitle` from `apps/web/convex/features/generateListing.ts` by absolute
path, inputs `{ cardNumber, year, manufacturer, setName, titleLevels: [{ name, typeName }],
cardVariation, teamNames, sport }`. Try the shortest and the longest ATTEMPT_TOKEN (1 and
12 chars): the quiet cuts (type name, sport) differ by token length, so assert with
optional groups, e.g. `Base (Insert )?#101`.

**Why:** fresh-only specs get one run per seed; a wrong title expectation spends it.
The generator never cuts a card's variation, so a walk write that rebuilds the title
(NEO-645: every walk write regenerates title + description, typed titles included)
can store a title still over 80 even after the variation is trimmed to its 65 cap.

**How to apply:** any spec asserting a rebuilt title after a walk write (variation
trim, Apply to all, set-name shortening): check the length offline first, pick fixture
values that make the intended state (fits / over cap / cut flag) true on every worker.
