---
name: over-cap-field-look-and-team-city-fixtures
description: NEO-606 — how specs prove a too-long field (aria-invalid on titles only, pink edge via support/theme expectOverCapLook) and how to build a title fixture where a team's location is the cut that makes it fit
metadata:
  type: patterns
---

**The over-cap look (NEO-606).** A field over its length cap is pink as a whole
(edge, ring, tint) keyed on length alone (`data-over`), never on a save error.
- Title fields (drawer `Card title`, walker `Card title for #N`, Card titles step
  `Title for #N ...`) also carry `aria-invalid="true"` while over; assert it with
  `toHaveAttribute`, and `not.toHaveAttribute("aria-invalid", "true")` once trimmed.
- Variation fields (over 65) are ADVICE: pink box plus the note, NO aria-invalid.
- Read the pink as painted with `expectOverCapLook(field, note)` /
  `expectNoOverCapLook(field)` in `support/theme.ts` (dark, the suite pin:
  `neon-pink-text` rgb(255, 64, 163); light is rgb(196, 0, 104)). Never assert
  `data-over` (a DOM hook). Pair the negative with a positive (fits-now text, 80/80).
- Put the look assert BEFORE the state's `expectAccessible`, so axe runs on the
  painted over state in both modes.
- Card titles step: each title is an `<li>`; its note is the row's `role=status`
  (empty, `empty:hidden`, once it fits). Scope with
  `wizard.getByRole("listitem").filter({ has: page.getByRole("textbox", { name }) })`
  (the `has` locator rooted at `page`, not at the wizard).

**Team city cut (cut row 8.5/9a).** A team row with a Location gives up the
location first, every split team last-first, then teams go whole. Only teams
with rows (`teamIds`) have a split; a typed or location-less team goes whole and
"Left out to fit" names it in full; a city-only cut lists nothing.
- Hand-made fixture that isolates it (card-title-uses-short-name-for-titles,
  cards D/E): Brett under `Insert > Rw<token>` (NEO-609: not `Base`), 15-char
  set, 14-char row, location and nickname each padded to 15 (`Lc<token>`,
  `Nk<token>`), and a 31-char single-token team with no location for the
  contrast. Compute with the bundled generator ([[title-fixture-arithmetic]]).
- Over-cap look on the Card titles step without a generated over-80 card (the
  step draws only 50 rows): TYPE a title past 80 into a listed row; the row's
  `role=status` reads "Too long to list as-is." (inserts-1996-score, #8).
- The reference catalogue's teams ARE split ("Kansas City" / "Royals"), so a
  real-set fixture title can change shape under this rule: the 1996 Score #107
  boxed title went from "... #107 Baseball" to "... #107 Royals Baseball".
  Recompute real-set titles with `teamSplits` before trusting an old constant.
- The stored title is written server-side at creation, so a planted break in
  generateListing.ts needs a push to your own deployment; restore the file right
  after the push (other agents may edit it) and push again after the red run.

**Keep a red's artifacts.** Each `npx playwright test` wipes `playwright/results`,
so a setup red followed by the bootstrap run loses its screenshot and
error-context. Pass `--output=<scratchpad dir>` per run when chaining runs.
