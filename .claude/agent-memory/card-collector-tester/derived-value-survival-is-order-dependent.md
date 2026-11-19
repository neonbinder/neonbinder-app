---
name: derived-value-survival-is-order-dependent
description: Review check — a stored value that is "kept while still valid" without a picked-vs-derived flag makes the outcome depend on edit order and silently settles conflicts
metadata:
  type: feedback
---

When a card fact is derived from its teams (league, etc.) and the rule is "keep the
current value while it is still one of the teams' values", check whether the code can
tell an operator's pick from its own derivation. If not, the result depends on the
order teams were added: Braves then Vanderbilt keeps MLB; Vanderbilt then Braves keeps
NCAA; and the "teams disagree, ask the operator" helper never shows.

**Why:** found on the NEO-569 card league (2026-11-16); product rule 8 says a
disagreement goes to the operator, never a guess. A draft-pick or college/pro dual-team
card is common in Bowman and Pro Debut.

**How to apply:** in any pass on derived card data, add team A, then team B in another
league, and read the field and its helper; repeat in the other order. Ask for a
"picked" flag (or blank + ask on any disagreement) if the answers differ.
