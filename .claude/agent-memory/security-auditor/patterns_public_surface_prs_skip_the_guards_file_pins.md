---
name: patterns-public-surface-prs-skip-the-guards-file-pins
description: A PR that adds public Convex functions usually pins publicFunctionAuth.test.ts (which gate) but skips publicFunctionAuthGuards.test.ts (write-nothing pins and audit-field pins) — check both files
metadata:
  type: project
---

Public-surface PRs often pin `convex/publicFunctionAuth.test.ts` (which gate
each new function carries) but skip `convex/publicFunctionAuthGuards.test.ts`,
the file that pins the two properties which survive however a refusal is
reported:

- **Write-nothing pins**: for a signed-out caller AND a non-admin, each new
  write leaves every table it could touch (and any metadata it patches) exactly
  as it was, with the fixture non-empty so the pin is not vacuous. Also assert
  no function was scheduled, since a refused call that still queued work is a
  write.
- **Audit-field pins**: a new admin read that returns rows carrying an audit
  field (`answeredByUserId`, `createdByUserId`, `closedBy`) must not ship it.
  Seed a row that HAS the field so the pin is not vacuous, and search the
  stringified result for both the key and the seeded value.

**How to apply:** when a diff adds `mutation(`/`query(`/`action(` exports, grep
`publicFunctionAuthGuards.test.ts` for the feature's ticket id. A missing block
is a finding even when `publicFunctionAuth.test.ts` has an entry for every
function. The same sweep catches a removal: a function deleted from the module
should leave a source pin (no `= query(`/`mutation(`/`action(` left) rather than
only losing its table entry.
