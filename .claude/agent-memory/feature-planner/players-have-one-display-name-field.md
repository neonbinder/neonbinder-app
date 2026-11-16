---
name: players-have-one-display-name-field
description: players rows store only `name` (display) + token-sorted `nameNormalized`; no first/last split. Any first-name/surname rule is a token rule over the display name (lib/players/name-fragment.ts strips a trailing Jr/Sr/II/III/IV)
metadata:
  type: project
---

`players` has `name` and `nameNormalized` (token-SORTED, so its first/last
tokens are alphabetical, never first name and surname). There is no given or
family name field. `lib/players/name-fragment.ts` (NEO-463) is the house
reading: tokens of the display name, minus a trailing generational suffix.

**Why:** NEO-535 needed "drop the first name, keep the surname" for titles.
Dropping the first token gets "Elly De La Cruz" → "De La Cruz" and "Vladimir
Guerrero Jr." → "Guerrero Jr." right, but family-name-first names stored as
printed ("Lee Jung-hoo") come out wrong.

**How to apply:** plan name-part rules as first-token / last-token rules over
`name`, reuse `isGenerationalSuffix`, flag the family-name-first case to the
owner, and never read `nameNormalized` for order.
