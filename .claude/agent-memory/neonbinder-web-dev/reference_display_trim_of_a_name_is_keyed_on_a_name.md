---
name: display-trim-of-a-name-is-keyed-on-a-name
description: A display-only "drop a trailing Base" string trim is behaviour keyed on a name; leave the Base variant type out by its row's kind, never trim joined text
metadata:
  type: reference
---

A title helper that strips a word ("Base") off the joined display string eats
words that belong to an insert, set or parallel name ("1989 Pro Set Base")
and keys behaviour on a name (product invariant 4). The sanctioned reading is
`variantTypeKindFromTitle` (convex/variantRole.ts, NEO-334, pure, importable
from components): act only on a `variantType`-level row whose kind is `base`,
and take every other name exactly as stored.

**Why:** NEO-616, the Tidy up title for the insert "1989 Pro Set Base".

**How to apply:** when a display rule needs "is this the Base", decide it from
the row's level plus its kind where the row is known (the ancestor chain
carries `level`), never from the text. An insert-level row called "Base"
(many E2E fixtures hand-make `Insert > Base`) is an ordinary insert, so its
title now says "Base"; any spec asserting the old trimmed title for such a
checklist must change.
