---
name: patterns_near_match_absence_proved_by_the_same_locator
description: NEO-578 — prove a "row is NOT in Possible matches" assert is live by pinning the panel's row count first and making the SAME locator match (count 1) in a sibling query state; Player Management's add form is the minted-name route to players.nearMatches
metadata:
  type: feedback
---

A ranking rule in `players.nearMatches` (`rankPlayerCandidates`) is reachable
two ways: the Tidy-up wizard's New Player step and `/admin/players`' add form.
Both render `NearMatchPanel` (list `Possible player matches`). The wizard only
opens from a real checklist fetch (real names, R7a), so a minted-name fixture
(`W<token>`, `J. W<token>`, `Jonah W<token>` in `customSport(env)`) only works
on the add form. Say so in the spec header; the coverage auditor accepts it.

Make the absence non-vacuous without a backend push:
1. Positive anchors in the panel first (exact-name rows), then
   `panel.getByRole("listitem")).toHaveCount(N)`: an extra row breaks N.
2. The absent row's locator is an anchored regex on the row's name
   (`^Open W<token>\b`; every admin row starts `Open <name>`, the exact row ends
   ` — same name`, the primary button lives OUTSIDE the list).
3. Change the query (one-word surname) so that row legitimately appears and
   assert the SAME locator `toHaveCount(1)`: proves it can match.
4. A spec-only plant (`toHaveCount(0)` -> `1`) plus the error-context panel
   snapshot shows the panel rendered and the row truly absent. The backend
   plant (no-op the guard) needs `npx convex dev --once`, which is the
   coordinator's: hand them the one-line patch.

Fixture order matters: create the bare surname FIRST; once a fuller name is on
file a bare surname create is refused as a NEO-463 fragment. The create button
stays `Create player <name>` while only CLOSE matches exist (it becomes
`Open …` / `Create player … anyway` only on an exact one).

**Why:** a negative assert passes on a dead page or a wrong locator
([[patterns_negative_asserts_pass_on_a_dead_page]]); this agent may not push functions
([[patterns_planted_red_for_server_side_behaviour]]).
**How to apply:** any spec asserting something is LEFT OUT of a ranked list.
