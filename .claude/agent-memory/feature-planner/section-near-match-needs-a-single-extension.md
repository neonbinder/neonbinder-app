---
name: section-near-match-needs-a-single-extension
description: Reconcile's near-name pass must treat "several marketplace names extend this section" as a tie; a foil-only marketplace (no plain subset) otherwise pairs the subset with its shortest foil
metadata:
  type: feedback
---

`matchChecklistSections` pass 3 picks the best Levenshtein ratio under 0.4 with a token-subset guard. When a marketplace lists only foil parallels of a subset ("X Lazer Red", "X Prismatic Blue", …) and no plain "X", the shortest extension wins at ~0.63 and the subset is wrongly linked to one foil.

**Why:** NEO-616 Pro Set Metal: "1989 Pro Set Base" paired with BSC's "1989 Pro Set Base Lazer Red" out of 28 extensions. A single extension ("Future Stars" vs "Future Stars Die-Cut") is a legitimate near match and has a unit test.

**How to apply:** two or more targets whose words strictly contain the section's words = a tie (rule 8), unmatched with candidates; one extension still matches. Any similar near-name matcher (Parallels reconcile, set names) needs the same check.
