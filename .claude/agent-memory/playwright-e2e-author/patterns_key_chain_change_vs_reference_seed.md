---
name: key-chain-change-vs-reference-seed
description: A change to the entity-name key chain turns seeded catalogue players/teams into "New player" steps in CI, because the reference seed imports stored nameNormalized verbatim
metadata:
  type: project
---

The reference seed is `convex import --replace` of a prod snapshot: every
`nameNormalized` / `aliasNormalized` arrives as the OLD code computed it. A
branch that changes `normalizeEntityName` (NEO-643: a hyphen became a space)
makes every affected catalogue row unreachable by the index lookups
(`sameNamePlayers`, `findAliasCollision`, team lookups), so a known player
reappears as an undecided "New player" step, often with a "Link to <name>"
near-match button, and pre-empts the step a spec expects.

Signatures in a red run:
- the PNG shows a wizard step for a well-known real name the spec never mentions;
- convex logs show `enrichment_fixture ... outcome: miss` (a Wikidata lookup)
  for that name: known players are never looked up;
- the retry fails on a fresh-only leftover from attempt 1 (an "Added X" notice
  missing, a strict-mode twin row): ignore the retry, read attempt 1.

Measure it read-only on a seeded worktree deployment running the branch:
`npx convex run rekeyEntityNames:run '{}'` (dry run) prints `toRekey` per
table and the collision groups. Compare old vs new keys with a tsx script that
imports `git show origin/main:.../normalize-name.ts` beside the branch copy.

**Why:** NEO-643 merge-group reds (set-history and Leaf Vivid specs) were this,
not the specs and not timing.
**How to apply:** the fix is the re-key (seed after import, prod at release),
never a spec change and never a two-shape key. See [[pattern-adopting-specs-need-reseed-for-planted-break]].
