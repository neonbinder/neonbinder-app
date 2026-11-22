---
name: radix-button-size1-does-not-wrap-long-labels
description: NeonButton size="1" is a fixed 24px-high, flex-shrink-0 box with no wrap guard, so a data-driven label (player/team names, long phrases) overflows a phone-width container; the fix is a wrap class, with two precedents in tidy/parts
metadata:
  type: reference
---

Radix `.rt-BaseButton` sets `height: var(--base-button-height)` (size 1 = space-5 = 24px) and `flex-shrink: 0`, and no `white-space` rule, so a label wider than its container neither shrinks nor wraps cleanly. Any NeonButton whose text comes from data ("Link to {player} ({sport})", `Use “A / B” instead`, a "Not a player (checklist, team card, stadium)" sentence) can run past a ~300px tile on a 360px phone.

**Fix pattern already in the tree:** `className="h-auto min-h-6 max-w-full py-1 text-left wrap-anywhere"` (`tidy/parts/InlineNewTeam.tsx`, `tidy/parts/TeamCandidates.tsx`). Share it as one constant rather than repeating it per button. The raw dashed Apply-to-all button already wraps via `DASHED_APPLY_CLASS`.

**How to apply:** when auditing or building a dense tile of NeonButtons, grep for `size="1"` buttons whose children are interpolated; a label of ~40+ characters at 12px is about 300px.
