---
name: checklist-matcher-strips-letter-prefix-ties-need-digit-first-numbers
description: matchPublishedChecklist pairs "M-1" with card "1" by number before any name pass; a tie test must use digit-first numbers like "89M-1"
metadata:
  type: reference
---

`matchPublishedChecklist` is number-first: exact, case-folded, then a
letter-prefix strip (`/^[A-Z]+-?(?=\d)/`, so "M-1" and "US12" lose their
letters). A fixture meant to prove "a player with two cards is a tie and
pairs nothing" that numbers the row "M-1" against cards "1" and "2" is
paired by NUMBER on card "1", and the tie test goes red for a reason that has
nothing to do with names.

**How to apply:** when a test needs the name path (or a name tie), give the
two sides numbers the strip cannot meet: digit-first prefixes ("89B-1" vs
"89M-1" never strip), as the real Mini/Base files number them. A pair with a
players conflict is the guard on a wrong number pair; check
`match.conflict?.players` before taking anything off the row.
