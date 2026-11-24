---
name: bsc-team-lane-is-shared-across-shards
description: The background BSC team lane (bscTeamPool) is one slot for the whole deployment at 1.7 s a card, FIFO across every test user; a spec asserting a lookup's answer within 7 s goes red in CI behind other shards' cards
metadata:
  type: feedback
---

A card waiting on its per-card BSC team lookup ("Still looking up teams for N cards.",
`isAwaitingTeamLookup`) is answered by `convex/bscTeamPool.ts`: ONE slot for the whole
deployment, each item sleeping `BSC_TEAM_ENRICH_DELAY_MS` (1.7 s) after its call, first in
first out across every test user. Locally the lane is empty and a card answers in ~2-4 s; in
CI the other seven shards' commits queue cards ahead (NEO-645 eject: seven items ahead, the
copies answered 18-21 s after the build). Even locally, the second of two cards is often still
queued when the first answers.

**Why:** never diagnose timing first: the mechanism is the shared queue, read from the
shard's `convex-logs-*` artifact (`runBscTeamCheckItem` / `applyBscTeamResolution` /
`bscTeamPool:enqueueBscTeamChecks` lines around the test's start time). No budget fixes it
and none may be granted without Jason.

**How to apply:** a row whose team comes from the lane is asserted as answered OR held back:
`rowSays(name, "No Team").or(getByText(/#NNO[^#]*<name>\s*BSC/)).first()` (name runs straight
into its BSC badge = no team at all) plus the row's "no team on this card yet" mark at count 0
(the attention rule allows a teamless unstamped BSC row unflagged only while the lookup is
owed). Annotate which branch ran (a read for the record only). Plant a team on the row in BOTH
branches (teamless and stamped), since which branch runs is not yours to choose. Related:
[[stuck-looking-up-check-returns-validators]], [[red-run-script-and-client-wire-log]].
