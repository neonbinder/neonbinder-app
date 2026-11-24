---
name: numbers-differ-fixtures-need-non-prefix-pairs
description: cardNumbersAgree strips a leading letter prefix, so "12" vs "OV-12" AGREE; a numbers-differ test needs "12" vs "13b" (or letters in the middle)
metadata:
  type: reference
---

`cardNumbersAgree` treats "BCP-12"/"A1" and "12"/"1" as the same print (letter prefix stripped), so a
test fixture meant to be "numbers differ" must use genuinely different numbers (12 vs 13b, 38 vs 38a,
OV-ANFI vs NNO). A fixture that agrees silently produces no `sourceNumbers`, no note, and a green-looking
wrong test.

Also: a re-delivered `initialData` is folded in by ABSORB, so a seed-only mutation (e.g. pre-kept cards)
does not turn a test red; mutate the ABSORB path as well. Mutation-check every new test by editing the
source, running, and restoring from a scratchpad copy (never stash in a shared worktree).
