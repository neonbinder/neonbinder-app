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
