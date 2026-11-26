---
name: convex-test-alias-seed-needs-player-alias-rows
description: tidy-world addPlayer({aliases}) writes only players.aliases; sameNamePlayers reads the playerAliases index, so an alias test needs syncPlayerAliases or it passes vacuously
metadata:
  type: reference
---

`addPlayer(ctx, w, name, undefined, { aliases: [...] })` in `lib/testing/tidy-world.ts` inserts the
`players` row only. `sameNamePlayers` (and so `resolveName`, `linkOnOpen`) finds an alias through the
`playerAliases` index rows, which `syncPlayerAliases(ctx, { playerId })` (convex/players.ts) writes.
A "an alias is not adopted" test seeded without it passes for the wrong reason; after a rule change to
"an alias links" it would fail for the opposite one. Seed through `addPlayer` + `syncPlayerAliases`.

`normalizeEntityName` strips a hyphen with no space: "Hye-Seong" is "hyeseong", so "HYE SEONG KIM"
is NOT the same key as "Hye-Seong Kim". Vary case and trailing punctuation, not hyphen-to-space.

Link-on-open pattern (NEO-680): a client-held "taken back" set (WalkMemory.heldBack, kept past
leaveCard) is sent as `skip` to a server mutation that re-reads the card; client args only narrow
what the server links. Nothing stored (invariant 9).
