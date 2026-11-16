---
name: client-preview-of-a-commit-rule-shares-its-predicate
description: When the checklist wizard previews what the commit will write (default player, set team, titles), the client and the server must read ONE pure predicate from convex/lib; a re-derived client rule drifts (NEO-528 default player planned on cards the commit left blank)
metadata:
  type: feedback
---

A server "birth" rule that the wizard also previews (who a new card's player
is, its team, its title) lives as one pure function in `convex/lib/*`, and
every client consumer calls it. Never re-state the condition on the client.

**Why:** NEO-528 shipped the "Player on every card" rule on the server
(commit's `listingNamedPlayer`: any non-blank printed name blocks the
default) while three client paths each re-derived "nobody on the card" from
the review rows (ruled-out names dropped). Ruled-out and still-pending names
look like "nobody" to the client and like "named" to the server, so the teams
step and titles preview planned a player the save never wrote.

**How to apply:** for any rule shared by the commit and the wizard, grep
every client reader of the same wire field (here `titleContext.setPlayerNames`
/ `setPlayerId`, `defaultPlayer.positions`): the host that builds the
positions (`CardChecklist.resolveAndCommit`), the per-card reader
(`teams-on-cards.cardPlayers`, which feeds grouping, evidence requests and
batch evidence), and the titles preview (`card-titles.cardNames`). Gate all of
them, the host and the reader both (defence in depth against another host).
Pure `convex/lib` modules importing only types and `convex/features/*` are
client-safe; see [[client-imports-from-convex-only-pure-modules]].
