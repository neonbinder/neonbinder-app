---
name: reference-client-carried-gate-facts-rederive-sport-from-the-doc
description: When a gate's automatic links ride the browser to the commit (no storage), re-check each id server-side and take the row's sport from the player/team doc, never the client; set-history links are legitimately cross-sport
metadata:
  type: reference
---

A review gate that stores nothing hands its automatic answers (links with origin) back to the client, and the commit takes them as an arg. Re-check them in an internal query before the prelude reads them: the id exists, the kind has the id it needs, and the row's sport is read off the player's or team's own document.

**Why:** a set-history or Hall-of-Fame auto-link names a player whose HOME sport can differ from the set's (a guest link), so "in the set's sport" would drop legitimate links; the commit prelude's own `playerBelongsToSport(row.sportId)` check is satisfied by the home sport. See [[reference-review-row-sport-can-differ-from-the-set]].

**How to apply:** page the re-check (a read per link), drop and count what fails (counts only in logs, never a name), cap at the Convex array limit, and feed the prelude through a small row adapter so its decision rules run unchanged. A per-name fact the gate used to write onto a row (preselect, candidate teams, no-existing-match) is recomputed by calling the same derivation again over the leaf's pending names; golden tests prove parity by putting the gate's unknown names on one card and reading that derivation back.
