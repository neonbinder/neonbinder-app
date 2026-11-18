---
name: patterns-external-links-read-never-followed
description: How to assert outside-site links (new-tab, sr-only suffix) in a spec, in reading order, without clicking them; expected URLs hard-coded, not imported from the product list
metadata:
  type: feedback
---

An outside-site link (e.g. NEO-597's publisher checklist links) is asserted, never clicked or followed: a spec must not visit an outside site.

Shape (one helper in `support/`, scoped to whatever container shows the links, a region or a dialog):
- Collect the family by a regex on the shared name tail (`/ Checklists \(opens in new tab\)$/`), `toHaveCount(n)`, then `links.nth(i)` + `toHaveAccessibleName(exact string)` proves reading order. `toHaveAccessibleName` with a string is a whole-name match after whitespace normalisation, so the sr-only " (opens in new tab)" counts.
- Then each by `getByRole("link", { name, exact: true })` with `toHaveAttribute` for `href`, `target="_blank"` and `rel="noopener noreferrer"`. A bare string `name` without `exact` is a case-insensitive substring match.
- Hard-code the expected names and addresses in the helper. Do not import the product's own list (`lib/...`): a wrong address in the product would then still pass.

**Why:** the coverage auditor asked for one implementation reused by the panel and the dialog specs, and an axe call after it covers the links.

**How to apply:** any spec that meets an external link. Put the helper call right after the container is visible and before its `expectAccessible`.
