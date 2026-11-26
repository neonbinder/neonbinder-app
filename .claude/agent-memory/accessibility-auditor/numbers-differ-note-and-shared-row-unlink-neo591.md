---
name: numbers-differ-note-and-shared-row-unlink-neo591
description: Match Cards "Numbers differ" note (title + sr-only), shared checklist row Unlink focus park to the Matched toggle; what held and what to check next time
metadata:
  type: project
---

- `text-ink-2` is a theme token (dark oklch ~slate-300, light #322b48); it passes on the dialog surfaces at text-xs. The weak token is ink-3, not ink-2.
- A `title` on a plain span that already has visible text plus an sr-only twin is redundant for SR (some read both) and is hover-only for sighted touch/keyboard users. Prefer sr-only alone, or make the detail visible.
- Parking focus after a chip Unlink: the card row usually survives (marketplace pair, kept/unmatched lists keep the card), so focus `[data-card-title]` via `refocusCardTitle`; fall back to `matchedToggleRef` only when the card left Matched (single-marketplace + checklist pair moves to Keeping).
- `refocus()` is a bare rAF with no activeElement guard (see [[raf-focus-park-race]]); fine for a stable mounted target.
- Repeated "Checklist: #38" chips are distinguished by the Unlink aria-label (card label + row line) and by the row's title button; acceptable.
