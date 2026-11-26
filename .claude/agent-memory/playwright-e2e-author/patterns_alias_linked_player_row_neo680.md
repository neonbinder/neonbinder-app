---
name: patterns-alias-linked-player-row-neo680
description: NEO-680 Tidy Up alias auto-link — fixture (hand-added player + Aliases box Save), the "Linked by alias" note handles, title read-back after an alias link, and why the holder name is minted
metadata:
  type: reference
---

- **Fixture from the UI:** Players link → `addPlayerByHand(page, holder, sport)` → the detail
  panel's `getByRole("textbox", { name: "Aliases", exact: true })` (empty for a hand-added row),
  `fill(alias)`, `getByRole("button", { name: "Save", exact: true })`, then
  `getByRole("status").filter({ hasText: `Saved ${holder}.` })`. A second holder of the alias shows
  "<name> also answers to that name…" (role=status); assert it absent to prove a LONE match.
  `page.goBack()` returns to the set builder.
- **Proof on the walk:** row group `Player <printed>` inside `tidyTile(page, "Player")`:
  `Edit <holder>` button, `row.getByRole("note")` → `toHaveText(["Linked by alias"])` (array form
  pins exactly one note), `pinkTile(page, "Player")` count 0, no `/^Link to /` button, no
  `/is new to NeonBinder/` text. The note is `TidyNote` (purple, informational, never a stop).
- **Title after an alias link:** `playerNames` in the stored title are the linked players' NB
  names, so the title carries the HOLDER's name, not the printed alias; the card search still
  finds the card by the printed name (search reads `nameOnCard`).
- **Holder name minted, not recorded:** every recorded Hockey no-match in the enrichment
  recording is a name some fixture checklist prints (checked by grepping playwright/ for each),
  so a recorded name as the holder would link another spec's card. A minted name's lookup is
  refused under the recording switch (no live call) — this deviates from GUIDE's "never mint a
  name that reaches a lookup"; say so in the spec header and the report.
- Where the link happens: source pick (`tidyPickSource.resolveName`, alias counts) and on card
  open (`tidyCards.linkOnOpen`, waiting names). The commit path already counted aliases before.

Related: [[patterns-player-alias-read-back-and-remember-box]]

## Link on open, live (the same spec's step 3b)
- **The alias must arrive AFTER the commit:** the commit already links a lone alias match, so a
  holder saved before the fetch leaves nothing waiting. Once `settleWalkAfterCommit` is true, open a
  second tab (`page.context().newPage()`, `/admin/players`, `expectPlayersLoaded(admin, LAUNCH_GATE)`,
  `addPlayerByHand`, Aliases, Save) and assert the walk did not open on the target card first.
- **Proof it was waiting:** the walk's sr-only status `Linked <printed> to <holder>.` is said only
  for a waiting name linked on open: `page.getByRole("status").filter({ hasText }).toHaveText(line)`.
- **Edit holds on revisit is racy in-walk:** after Edit, Skip, Back, a re-link on re-open lands a
  moment AFTER the card renders, so "still pink / no Edit / no Linked line" pass before it. The
  real proof is reading the card's title back after the walk (holder surname absent). Planted
  (drop `skip` in `useLinkOnOpen`): red at the read-back, not in the walk.
- Plants: `useLinkOnOpen(memory, undefined, onAnswered)` → red at `Edit <holder>`. Fresh-only:
  `seed` before each `plant --expect`.

## Helpers must tolerate link on open (merge-group red, desktop shard)
- Link on open answers a Player row in the BACKGROUND, any time after the card opens (often while
  the row still says "Checking for players by that name…"). A helper that takes a row through the
  "Not a player" filter (`openPlayerRows(page).first()`) and then waits on its buttons sees the
  row drop out of the filter and times out on "offers an answer": a race, not a slow step.
- Pattern (tidy-walk.ts `nextPlayerRowName` / `playerRow`): read row NAMES off every Player group
  (answered rows keep their `Player <printed>` group), re-locate by exact name, and settle into
  ONE state: `edit.or(pick).or(create).or(anyway)`; Edit up = answered, press nothing, don't count
  it (setup.spec asserts `players === 0` on the Future Stars insert).
- Residual window: a row seen offering an answer can still be linked between the check and the
  click (ms). No perceivable "link on open done" signal exists to close it.
