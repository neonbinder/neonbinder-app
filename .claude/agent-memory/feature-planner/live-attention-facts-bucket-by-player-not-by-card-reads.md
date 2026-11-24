---
name: live-attention-facts-bucket-by-player-not-by-card-reads
description: A live attention fact that needs other tables (career gap needs player stints) goes in fixed client-bucketed subscribed queries that read no cards; and a stored "note" can double as a rule guard
metadata:
  type: project
---

When an attention item must be computed live from other tables (NEO-656: careerGap from the player's stints instead of stored `tidyChecks`), do not embed it in `getCardChecklist`. That query already `.collect()`s the whole leaf (~900 docs on a big leaf), and adding player and team reads roughly doubles it. It would also make it re-run on every player write, which stalls the walk's saves. Instead, the client derives the (player, team) pairs from the cards it already holds, puts them in a fixed number of buckets by a hash of playerId, and runs one admin query per bucket. Each query reads players and teams only, never cards. That is about 100-330 docs a bucket, and card writes re-run none of them. `deriveCardAttention` stays pure: it takes the live facts as a second argument.

**Why:** the subscribed-query budget (monorepo CLAUDE.md, "A subscribed query stays small") is about re-runs as much as size. A query that reads no cards is invalidated only by writes to the rows it actually reads.

**How to apply:**
- Keep the bucket count fixed so hooks stay stable and a single change moves one bucket.
- Key the pairs by the card's own `selectorOptionId`, so guest rows use their home year.
- Gate the walk on `ready`.
- Before dropping a stored "note", grep its predicate helper for rule uses. `teamFillOf` was also the guard "a team NB filled is never evidence" in `teamFillOnAnswer.ts` and `TeamFillChips.tsx`. Dropping the note drops the rule, so that is a question for Jason.

Related: [[removing-a-seen-ack-needs-a-per-kind-fix-audit]], [[review-gate-cost-is-the-sequential-name-loop]].
