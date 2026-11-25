---
name: new-player-prefill-rides-walk-memory
description: When a rule keyed on "the player was made on this card" must survive the stored-marker removal, hold it in WalkMemory (per card, cleared on leaveCard), not on the card or player
metadata:
  type: feedback
---

NEO-657's prefilled "+ Add stint" was gated by a stored `newPlayerCareer` check; NEO-656 deletes stored checks and makes the Career tile the live career gap. The port keeps the "new player only" scope by remembering `createPlayer`'s returned playerId in `WalkMemory.rememberMadePlayer(cardId, playerId)` (read with `madeOnCard`, dropped by `leaveCard`), and `CareerGapRow` prefills only then.

**Why:** applying the prefill to every gap row opened the form on existing players and broke the Career-tile spec that expects a collapsed "+ Add stint"; a stored flag would be an answer kept (rule 9).

**How to apply:** a live-gap row has no "new" notion; derive it from the sitting's memory. Expect side effects of the live model: "+ Add" removes the whole tile (the gap closes), a teamless card has no tile, and Save & next on a card whose form was Esc-closed still adds the default gap stint (Skip writes nothing).
