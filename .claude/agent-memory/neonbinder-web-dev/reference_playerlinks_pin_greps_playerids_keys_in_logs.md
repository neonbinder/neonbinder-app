---
name: playerlinks-pin-greps-playerids-keys-in-logs
description: cardChecklist.playerLinksPin.test.ts source-greps every `playerIds:` in selectorOptions.ts, so a log/JSON key of that name fails it; and a re-minted same-name row breaks the commit's other cards
metadata:
  type: reference
---

- `convex/cardChecklist.playerLinksPin.test.ts` greps the source for `playerIds:` writes that lack `playerLinks` nearby. A structured-log key called `playerIds:` in `selectorOptions.ts` trips it (the full `npx vitest run convex` caught it, the targeted commit tests did not). Name log keys differently (`newPlayerIds`).
- Minting a player whose normalized name already has a row must happen AFTER the prelude's resolve walk (NEO-591 `createCareerNewPlayers`): `sameNamePlayers` then sees two rows and drops every other card with that name to unreviewed. A retried commit finds its own earlier row, so the prelude takes `excludePlayerCreationRefs` and filters it out of the same-name reads (`sameNameForCommit`). Sabotage that filter and the retry test goes red; keep it.
- Run the whole `npx vitest run convex --reporter=dot` (about 25 s, 480 files) after touching selectorOptions.ts; source-pin tests only show up there.
