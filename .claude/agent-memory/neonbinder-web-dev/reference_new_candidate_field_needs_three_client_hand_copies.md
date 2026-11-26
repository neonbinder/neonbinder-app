---
name: reference-new-candidate-field-needs-three-client-hand-copies
description: A new field on checklistCandidates/getReadyCandidates reaches the commit only if three client mappers copy it by name; the server and typecheck stay green without them
metadata:
  type: reference
---

`components/SetSelector/pairing-cards.ts` (`candidateToPairingCard`) picks fields BY NAME off a streamed
candidate, `CardChecklist.tsx` `resolveChecklistPairs` rebuilds the request row and the answer field by field,
and `PairingCard`/`FetchPreview` are hand-typed. Add a candidate field on the server and forget these and the
field silently never reaches the dialog, the pair question or the commit: no type error, no test red.

**How to apply:** when a unit adds a wire field (NEO-591 `isProspect`/`prospectTeam`), grep the field name in
`pairing-cards.ts`, `CardChecklist.tsx` and `CardPairingModal.tsx` before calling the client side done.
A `level`-style field added to `teamSuggestionsForPreview` teams also breaks the 4 `toEqual` team objects in
`cardChecklist.teamSuggestionsForPreview.test.ts`.
