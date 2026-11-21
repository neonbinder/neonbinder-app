---
name: spec-helper-restates-matcher-goes-stale
description: when a product matcher is rewritten, E2E support helpers that re-derive its counts, and fixtures built to hit a removed rule, go stale silently; audit them first
metadata:
  type: feedback
---

A Playwright support helper that re-implements the product's pairing rule to predict a count (`checklistFacts`, `nameFallbackFacts` in `playwright/support/published-checklist.ts`) is a second copy of the matcher. When the matcher is rewritten (names-first, NEO-591) the helper keeps passing its own arithmetic asserts (`expect(x.matched).toBe(0)`) while describing a rule that no longer exists.

**Why:** the helper's `expect`s test the helper, not the product, so they stay green. Fixtures engineered to hit a removed rule (a number repeated on a row naming a DIFFERENT player, to force "pairs with neither") become a different case: the card now pairs by name, a team conflict can appear, and a count such as "17 of 18" can survive by coincidence for a new reason while the wizard's group count changes.

**How to apply:**
- On any matcher rewrite, grep specs for the helper and for the removed rule's vocabulary ("counts differ", "applies nothing", "equalCounts", "suggested", "pins nothing down") and list each as stale, even when the numbers still agree.
- Ask for the fixture to be rebuilt so it hits the NEW equivalent (a repeated number on rows naming the SAME player is the surviving tie) and for a live assert on the line the removed rule used to produce (for example "Teams from your checklist: N of M" now counting unequal-count name pairs).
- Dormant (SportLots-paused) live branches carry measured counts from the old rule too; list them as "re-derive on the first live run", never as passing.
- Real-set fixture needs for a stem or variation path: a checklist CSV transform (drop or split rows) on an already recorded set beats a new real set; the carrier must be that set's sole-writer spec.
