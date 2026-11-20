---
name: marketplace-spec-split-to-helper-drops-assertions
description: when a big live-marketplace spec is split into a prove-in-full spec plus a lean setup helper, the sections neither keeps vanish; grep each removed string across tests and unit tests
metadata:
  type: feedback
---

A cutover that turns one long spec into (a) a "proves every step" spec and (b) a lean helper other specs call silently drops whatever (a) did not re-list: section headings, default-checked toggles, copy for the branch the new fixture never takes, mid-run axe states, empty-state copy.

**Why:** NEO-555 B2 lost the eBay Offers section / "Take Best Offers" default, the "Sales empty state names eBay" proof, the Set-me-up running-ledger axe and the hand-pick Payment/Returns path; a green suite said nothing.

**How to apply:** take every removed `expect`/`expectAccessible` string from the diff, grep it across `playwright/tests`, `support` and the component unit tests; an unmatched string is a finding. Also check an injected one-shot fault (`times: 1`) against a background poll that may spend it: the spec then passes without the retry ever happening (R2); ask for a consumed-rule readback.
