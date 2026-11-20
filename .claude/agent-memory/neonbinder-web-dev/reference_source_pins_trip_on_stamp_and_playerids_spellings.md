---
name: reference_source_pins_trip_on_stamp_and_playerids_spellings
description: Two readFileSync source pins in convex/ reject new code that spells a card's team stamp or playerIds the "wrong" way; use shorthand and dotted carries
metadata:
  type: reference
---

When adding a reader/writer in `selectorOptions.ts` or `cardChecklist.ts` that touches the "No team" stamp or a card's players:

- `noTeamDefault.pin.test.ts` flags any `teamNoneConfirmedAt: <expr>` or `teamNoneConfirmedAt = <expr>` that is not `stampNoTeam`, a `.teamNoneConfirmedAt` carry, or `undefined`/type position. Passing a ruling into `noTeamCardVerdict` as `teamNoneConfirmedAt: noneConfirmedAfter` trips it: return early on the ruling instead (the verdict's `alreadyNoTeam` is the same answer).
- `cardChecklist.playerLinksPin.test.ts` flags any `playerIds: x` line in `selectorOptions.ts` with no `playerLinks` within 60 lines. A helper argument spelled `{ playerIds: ids }` trips it; use shorthand (`{ playerIds, ... }`).

Both fail only when the pin file runs, not at typecheck, so run `convex/noTeamDefault` and `convex/cardChecklist` after touching the stamp or player code.
