---
name: opener-disconnected-check-races-query
description: "opener?.isConnected ? opener : fallback" focus restore runs in a rAF right after a Convex mutation resolves, before the reactive query re-renders, so a destroyed opener still looks connected (NEO-645 Remove cameo)
metadata:
  type: feedback
---

A focus-restore that checks `opener.isConnected` inside `requestAnimationFrame` after `await mutation()` is racy when the action itself deletes the opener's row: the live query has not pushed yet, the stale opener is still in the DOM, focus lands on it, then it unmounts and focus drops to body.

**Why:** found on PlayerTile's Remove cameo / Edit cameo (NEO-645); the same shape was accepted earlier for "Edit swapped the player".
**How to apply:** when the action is known to destroy the opener (remove, delete), null the stored opener before closing so the fallback target (+ Cameo / add button) takes focus; or park focus on the fallback first. Related: [[focus-park-pattern]].
