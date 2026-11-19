---
name: patterns_button_name_substring_hides_demoted_variants
description: Add as New Player substring-matches its demoted variant; exact-match proof is the demoted Create button
metadata:
  type: pattern
---

`getByRole("button", { name: "Add as New Player" })` is a case-insensitive SUBSTRING match, so it already matches "Add as New Player anyway" when that is the only one on screen. Two traps follow:

- A spec that pins the plain name works by accident when the step demotes creating (a suggested "Link to <name> (<sport>)" leads), and goes strict-mode red the day both exist. Pin intent with `/^Add as New Player( anyway)?$/`, never the bare string.
- "anyway" is not always a create. On a row the batch inserted READY with no lookup (the suggested-player step, NEO-424), that press only opens the plain New Player step and records nothing. A create helper must press, then wait for either the counter's x to move or the exact "Add as New Player" primary, and press that. Check "x moved" first so the NEXT row's primary is never mistaken for the plain step.

**Why:** E(2) makes the player's create conditional on the catalogue, so a catalogue refresh can silently change which shape a fixture name shows.

**How to apply:** use `answerPlayerAsNew(page)` in `support/wizard.ts` wherever creating a player is the intent (teams and leagues have `answerStepAsNew`). Keep the exact name only where the spec asserts the step's identity.

## Exact match proof is the demoted create

**Asserting an EXACT key match on the add-player form.** `AddPlayerForm` promotes
the exact row to the primary button (`Open <name>`, visible text, no aria-label)
and adds `Create player <typed> anyway` (aria-label). But a CLOSE match also
renders an `Open <name>` button, in `NearMatchPanel` below the form. So an `Open
...` button proves nothing about exactness; the `... anyway` control does, and
`getByRole("button", { name: "Create player <typed>", exact: true })` going absent
is the negative. Assert the positive first, then the negative (see
[[patterns_negative_asserts_pass_on_a_dead_page]]).

**Verifying a name is in the seeded roster without a seeded backend.** The local
dev deployment carries no 2024 Topps Chrome roster, so `npx convex data players`
there proves nothing. What works read-only:
`convex/adapters/__fixtures__/enrichment-lookups.json` holds every player name the
committed sets produced (and their spelling as committed); then confirm the card
is in the seed set from its public checklist (a web search for "<set> <player>
card number"). Exclude names other committing specs could also produce
([[patterns_pick_a_wizard_name_from_bsc_facets_and_the_gate_resolver]]).
`npx convex data <table> --limit` caps below 50001 (8000 works).
