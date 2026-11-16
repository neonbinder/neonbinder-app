---
name: wildcard-regex-around-a-label-hides-doubled-words
description: A spec asserting a summary line with `.*LABEL.*` cannot catch a label fix that removes a doubled word (brand repeated, "1984 Topps Topps"); pin the exact text
metadata:
  type: feedback
---

When a diff changes how a name is composed (e.g. a set label dropping a
prefixed brand), check the spec assertion on the user-facing line. A regex like
`^Takes P, and .*${SET_LABEL}.*, cameos included\.$` passes on both the fixed
"1984 Topps" and the bug "1984 Topps Topps" (brand row and set row share the
word). Unit tests may pin it, but the live proof is vacuous.

**Why:** NEO-528 smart rule summary: the fix shipped with a spec whose wildcards
matched the old wording too. Real fixtures where manufacturer == set name make
this common.

**How to apply:** for any label/wording change, find each spec assert on that
line and ask for exact `toHaveText` (or a negative on the doubled form). Also
flag spec header comments that claim a transient state ("Checking…") the body
only asserts as gone. Related: [[spec-rename-mojibake-vacuous-negatives]].
