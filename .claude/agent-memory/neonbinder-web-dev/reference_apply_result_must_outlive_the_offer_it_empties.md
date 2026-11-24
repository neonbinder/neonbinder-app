---
name: reference_apply_result_must_outlive_the_offer_it_empties
description: A bulk "Apply to all" button's own result line vanishes when applying shrinks its offer to zero, unless the result is keyed on the count at press time (smaller keeps, larger forgets)
metadata:
  type: reference
---

An Apply-to-all offer is derived from live rows: applying makes those cards stop fitting, so `count` drops to 0 and a component that returns null for `count < 1` takes its "Applied to N cards." line with it. Key the remembered outcome on the count at press time: a smaller or equal count keeps it, a larger one is a new question and forgets it. Keep the status wrapper mounted (button conditional inside it) so the live region is announced.

Also: the dark `neon-purple-text` role reads 4.15 to 4.5:1 on tile grounds (blue wash, plain raised) when painted on its own 10% tint; theme.css, tokens.ts and a tokens.test case move together when a role is corrected.
