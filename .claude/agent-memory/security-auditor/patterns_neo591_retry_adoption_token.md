---
name: patterns-neo591-retry-adoption-token
description: Client-minted retry token stored on a row (players.creationRef) - adoption vs sibling-exclusion scoping, public-shape stripping, and pinning the internal writer that takes userId
metadata:
  type: project
---

NEO-591 `commitCardChecklist.careerNewPlayers` mints players at commit and stores a
client-minted `creationRef` so a retried Confirm ADOPTS the row instead of minting twice.

Checks that held (re-run them on any similar "idempotency token on a row" design):
- Adoption requires token AND `createdByUserId === operator` AND same nameNormalized+sport
  (index read), so one admin cannot adopt another's row even with the token.
- Token format-checked server-side (`^[A-Za-z0-9_-]{1,32}$`), client mints ~82 random bits.
- Stripped in `toPublicPlayer` AND added to the internal `playerDocValidator`; every public
  player query has a strict `returns`, so a missed strip fails loud rather than leaks.
- Refusals name entries by position, never the name; log carries ids and counts only.

Gaps found (2026-11-19):
- The sibling filter (`excludePlayerCreationRefs` in the prelude, "this row is my own retry,
  not a namesake") matched the token only, NOT the creator, so it was wider than adoption.
  Rule: every place a retry token changes behaviour must use the same predicate as adoption.
- New internal writer `players.createCareerNewPlayers` takes `userId: v.string()` and was not
  in the publicFunctionAuth "declared internal*" test.each; a later `mutation(` flip would be
  an unauthenticated player writer with a spoofable creator. Pin every internal writer that
  takes a userId arg (see [[patterns-public-function-auth-registry]]).
