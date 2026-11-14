---
name: team-change-refreshes-description-via-owner
description: generateListingDescription prints a "Team:" line, so a team edit must refresh a generated description too; selectorOptions.ts may not name secondaryPlayerIds, so use cardSecondaryPlayers.refreshedGeneratedDescription
metadata:
  type: reference
---

A listing DESCRIPTION names the card's team ("Team: ..." further down
`generateListingDescription`, past the first 40 lines, so a quick grep of the
function head misses it). Any write that changes a card's teams and wants
"generated text follows the card" must refresh the description as well as the
title.

The description needs the card's cameo names, but
`cardSecondaryPlayers.pin.test.ts` pins `selectorOptions.ts` to name
`secondaryPlayerIds` exactly once (getCardChecklist's returns). Reading
`stored.secondaryPlayerIds` there fails the pin. Use the owner-module helper
`refreshedGeneratedDescription(ctx, card, next, cache)` (added NEO-556), which
reads the cameos inside cardSecondaryPlayers.ts and returns the new text only
when the stored description is still the generator's.

**How to apply:** title refresh = `titleForStoredCard` before/after compare
(cardPlayersBulk `putPlayerOnCard` pattern); description refresh = the helper.
Treat a value the caller re-sent unchanged (CardDetailPanel re-sends the title
on every save) as untouched. Related: [[convex-typecheck-excludes-test-files]].
