---
name: players-admin-row-needs-sport-and-born-year
description: /admin/players list rows are named "<name> <sport> b. <year> <team>"; the seed holds cross-sport namesakes, so a "not b. 1943" regex is ambiguous
metadata:
  type: feedback
---

On /admin/players a list row's accessible name is `<name> <sport>[ Also: …] b. <year> <team>`
(PlayerManagement.tsx). The reference seed carries every prod player across sports, so a famous
Baseball name usually has a Football/Hockey namesake too (Joe Morgan: Baseball b. 1943, Baseball
b. 1930, Football b. 1928). A row regex like `^Joe Morgan(?!.*b\. 1943)` resolved to two rows in
CI (NEO-645 set-history spec, a strict-mode red in a phase that never ran locally).

**Why:** the "Filter players" box filters across all sports unless the Sport select is set; a
negative lookahead on the year alone matches every other-sport namesake.

**How to apply:** name the row by sport AND year: `/^Joe Morgan Baseball\b.*\bb\. 1943\b/`, and
for "the other one" `/^Joe Morgan Baseball\b(?!.*\bb\. 1943\b)/`. Prefer regex literals over
`new RegExp(template)` (see [[template-literal-backslash-b]]). Before trusting a registry note
like "two on file", check whether it counted one sport only.
