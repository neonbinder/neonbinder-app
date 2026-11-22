---
name: patterns_button_name_substring_hides_demoted_variants
description: Button-name substring traps - the walk's "Add as new player" vs its demoted "anyway", and the admin add-player form's exact-match proof (the demoted Create anyway)
metadata:
  type: pattern
---

**Substring matching.** `getByRole("button", { name: "Add as new player" })` is a case-insensitive SUBSTRING
match, so it also matches "Add as new player anyway" when that is the only one on screen. A spec that pins the
plain string works by accident while a promoted "Link to <name>" leads the Player row, and goes strict-mode red
the day both buttons exist. Pin intent with an anchored regex, never the bare string.

**On the Tidy up walk** (`support/tidy-walk.ts`): `CREATE_PLAYER` = plain create or the one-name create with a
negative lookahead for ` anyway` (`( .+)?` allows a multi-name card's name suffix); `CREATE_ANYWAY` = the decline
of a promoted link. "anyway" only OPENS the plain create (and asks Wikidata about the name); the plain create
is pressed once it is usable. Use `createPlayerOnOpenRow` / `answerPinkPlayerTiles` where creating is the intent;
keep the exact name only where the spec asserts the row's identity.

**Why:** a catalogue refresh can silently change which shape a fixture name shows (promoted link vs plain create).

## Exact match proof on the admin add-player form

`AddPlayerForm` (Players admin) promotes the exact row to the primary button (`Open <name>`, visible text, no
aria-label) and adds the demoted `Create player <typed> anyway`. A CLOSE match also renders an `Open <name>` in
`NearMatchPanel`, so an `Open ...` button proves nothing about exactness; the `... anyway` control does, and
`getByRole("button", { name: "Create player <typed>", exact: true })` going absent is the negative. Assert the
positive first, then the negative ([[patterns_negative_asserts_pass_on_a_dead_page]]).

**Is a name in the seeded roster?** The local dev deployment carries no 2024 Topps Chrome roster, so
`npx convex data players` there proves nothing. Read-only instead: `convex/adapters/__fixtures__/enrichment-lookups.json`
holds every player name the committed sets produced (as committed); confirm the card from the set's public
checklist. Exclude names other committing specs could also produce
([[patterns_pick_a_fixture_name_from_bsc_facets_and_the_resolver]]). `npx convex data <table> --limit` caps below
50001 (8000 works).
