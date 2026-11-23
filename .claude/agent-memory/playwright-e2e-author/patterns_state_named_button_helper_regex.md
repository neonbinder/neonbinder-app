---
name: patterns-state-named-button-helper-regex
description: A button whose accessible name is its visible, state-changing text (label in name): helper matches every state with an anchored regex; specs needing one state use the exact text
metadata:
  type: feedback
---

When an aria-label is dropped so a button's visible words are its accessible
name (WCAG 2.5.3, e.g. the card checklist's fetch button: "Fetch from
Marketplaces" / "Fetching..." / "Saving..." / "Refresh"), the shared helper
(`syncChecklistButton`) matches ALL states with one anchored regex, exported
beside it, and a spec that needs one state asserts
`getByRole("button", { name: "<state>", exact: true })` rather than
`helper().toHaveText(...)`.

**Why:** a helper keyed on one state breaks every spec that meets the button
mid-fetch; `toBeHidden()` on a single-state name passes vacuously while the
button shows another state. Anchoring (^...$) keeps the regex from catching
"Refresh"-like substrings elsewhere on the page.

**How to apply:** before tightening, grep the product for other buttons with
the same short word on the same screen (e.g. an admin page's "Refresh" is a
different route, so no clash). Transitional `.or()` / optional-word regexes
added for a rename (`/^Change( team)?/`) are removed once every build serves
the new name; tighten to the product's exact string. See
[[patterns_tidy_walk_tiles_and_commit_first]].
