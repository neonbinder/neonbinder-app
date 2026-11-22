---
name: revert-narrows-input-validator
description: Auditing a logic revert that drops a field/literal from an input validator while the schema keeps it for stored rows
metadata:
  type: project
---

When a revert removes a field or literal from an INPUT validator (public args,
internal gate items) but the schema keeps it so stored rows still validate,
check three things, in order:

1. Public `returns` validators that carry the stored shape reuse the schema
   validator (e.g. `sourceDisagreementValidator`, `tidyNameAnswerValidator`),
   so a stored legacy value still returns. A hand-copied returns validator
   would throw on read: that is the real breakage.
2. Stored rows never round-trip back through the narrowed input validator.
   Look for a client that re-sends a server row: in this repo the Match Cards
   pairs call (`applyPublishedChecklistPairs`) rebuilds the row field by field,
   and the stored-checklist re-check (`checkPublishedChecklist`) is a TS
   function, so an extra stored field is dropped, not refused.
3. Narrowed internal validators (scheduled-function args) only bite
   in-flight jobs on a deployment that ran the pre-revert code: transient.

Also diff any reverted public query against `origin/main` by extracting the
`export const X = query({ ... });` block; "identical" is a stronger claim than
"pins still green". [[convex-auth-boundary]]
