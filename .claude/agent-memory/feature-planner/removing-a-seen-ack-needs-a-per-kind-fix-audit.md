---
name: removing-a-seen-ack-needs-a-per-kind-fix-audit
description: Before planning removal of a stored "seen"/ack (tidyReviewed, chosen), check every item kind has a writer that clears it; some kinds (newPlayerCareer) are cleared only by "seen"
metadata:
  type: project
---

When a stored acknowledgement goes (NEO-656 removed `tidyReviewed` and `sourceDisagreements.chosen` under the no-stored-answers rule), list each attention kind it suppressed and find the writer that clears the underlying fact. `newPlayerCareer` in `tidyChecks` has no remover at all (written at createPlayer, hidden only by "seen"), and a career gap the operator "keeps as is" has nothing else either, so without the ack those cards stay blue forever.

**Why:** "blue items come back until fixed" assumes a fix exists; a kind with no clearing writer turns into a permanent stop, the walk/badge never empties, and that is a question for Jason, not something a builder may invent.

**How to apply:** grep each kind's writers (`tidyChecks` patches, flag clears such as `listingTitleTruncated`), tabulate "cleared by / operator can fix?", and raise any "no" as a needs-Jason with both branches. Also check consumers that read the acked structure without the ack (`lib/teamLine.ts`, `teamFillOnAnswer.ts` read ANY teams entry) and readers whose returns spread the doc (`getCardChecklist` spreads `...card`, so a dropped field must be projected out, not just removed from the returns validator). Related: [[optional-to-required-is-two-merges]], [[checklist-sync-is-one-time-never-store-dialog-answers]].
