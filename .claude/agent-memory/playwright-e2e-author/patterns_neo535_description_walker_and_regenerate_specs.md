---
name: neo535-description-walker-regenerate-specs
description: NEO-535 drawer/walker spec facts — Regenerate rebuilds only builder-shaped descriptions, walker order (team before title, answered card ends the sitting), rename fan-out spec shape, mobile-only wrap geometry, bite-plant traps
metadata:
  type: pattern
---

- **Regenerate and the description.** Edits to a card's facts already move a builder-written description along (stored text == builder text before the edit). Regenerate uses the looser rule (`readsAsGeneratedDescription`), so the way to make it CHANGE something is a stale builder-shaped text typed by hand: the card's own description plus one fact line it lacks (`Rookie Card (RC).`). A prose line is "hand-written": Regenerate leaves it. The "Description rebuilt" status is the drawer's one toast line; assert it with `.first()` and, for the leave-alone case, read the description AFTER a later write of the same client (Convex orders mutations), not right after the press.
- **Attention walker order.** A card linked to a catalogue player with no team is asked its TEAM step first (`No team on this card` records it), and an answered card ends that sitting ("All clear"); close and reopen from the `1 needs you` pill to reach the same card's title step. A card with no player link skips the team step.
- **Over-80 stored title is flagged on its own** (`titleOverLimit` is just stored length > 80); the `Trim Set name in titles` door shows only while the typed title is over, and the Attributes panel's box is `Value for Set name in titles` (focus target). `Toss what you typed?` is a plain dialog with Cancel and `Toss it and go`.
- **Rename fan-out spec shape.** Custom sport + minted player/team (no lookup); player rename on /admin/players (`Player name`, Save), team on /admin/teams (`Name`, Save), set on the set-level Attributes panel only (re-drill to the SET, the Base row's panel renames Base); `page.goBack()` restores the set builder; the collector hit reads `<player> <team>, <season> <set>, <row>, #<num>. Show it in Checklists`. Pick old/new names that are not prefixes of each other (search treats the last term as a prefix). Team search needs `No matches.` on screen before Enter opens the New Team dialog.
- **Wrap geometry is mobile-only.** On the 1024 desktop drawer an 80-char title is ONE line (`field-sizing: content` ignores `rows`), so the height check against the one-line Card name input branches on `isMobile`; desktop asserts the flattened value only.
- **Bite plants.** A planted Convex edit that fails typecheck makes the push exit 1 and the run goes GREEN on the old code: always check the push exit code before reading a "no red". `if (kind === "rows") return 0` before a later `kind === "rows"` test is a TS narrowing error; put the broader guard after. Two identical guard lines in one module need a context-unique OLD string.

## Bite-plant technique for many assertions (NEO-535 Bowman spec)

- One slow fresh-only spec with many new assertions: transform the spec for ONE run (`expect` -> `expect.soft`, `expectAccessible` -> a soft wrapper collecting labels) and plant every independent break at once; read each failure from `error-context.md` (the runner script's `head -60` hides the rest). Restore all files byte-exact afterwards.
- Flow-changing plants (Escape skips confirm, Cancel closes, a refusal that never renders) go in their own hard runs, and a plant that suppresses a state masks any axe plant on that same state: give it its own run.
- A server-side plant must change a value the spec reads. An argument that a fallback already supplies (`parallelName` vs `set.parallelLeafValue`) is redundant, so dropping it stays green; remove both. Always check the `convex dev --once` exit code on the plant AND the restore push.
- A setup-project failure ("Couldn't sync years", a missing Years/Manufacturers option) after a reseed is the external BSC sync, not the plant: rerun that plan.
