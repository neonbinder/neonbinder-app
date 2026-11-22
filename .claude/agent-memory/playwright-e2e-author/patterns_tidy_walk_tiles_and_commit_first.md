---
name: patterns-tidy-walk-tiles-and-commit-first
description: NEO-645 per-card Tidy Up walk — tile = group named by heading, pink = description "To fix"; the commit lands BEFORE the walk, so there is no cancel-without-saving and read-only fetch fixtures stop being read-only
metadata:
  type: project
---

The NEO-645 walk (`support/tidy-walk.ts`) replaced the entity-review wizard and the attention walker.

- **A tile is a `group` named by its h3** ("Player", "Team", "Career", "Autograph", "Listing title",
  "Sources disagree", "More about this card"; a `region` before the a11y pass). Its level is NOT a
  name or a colour: it is the tile's accessible description, from a VISIBLE "To fix" / "To check"
  beside the heading (an sr-only "Waiting"). Branch
  with `tile.filter({ has: page.getByText("To fix", { exact: true }) })` (`pinkTile`) and count it;
  assert with `toHaveAccessibleDescription`.
- **A name row is a `group` "Player <printed>" / "Team <printed>".** Unanswered = it holds "Not a
  player (checklist, team card, stadium)" / "Not a team"; answered = it holds "Change player" / "Change
  team". Controls get a " <printed>" suffix only on a multi-name card, so match them with `( .+)?$`.
- **After the a11y pass:** Autograph is a radiogroup "Autograph format" of radios (`checked`, not
  `pressed`); More about's disclosure is "Card fields" (`aria-expanded`); Back and Skip are
  `aria-disabled` (prove a refusal with `toHaveAttribute("aria-disabled","true")`); an answer moves
  focus to Save & next (nothing pink) or the first pink tile's first control.
- **"More about this card" is on every card**: the positive marker that a card (not the end screen
  "Done (Esc)") is up. "Looking at this card" is the context-loading skeleton.
- **A move is proved by the URL AND the screen.** `?tidy=<card>|done` changes BEFORE the next card
  renders, so an `.or(card, end)` check right after the URL passes on the OLD card. Prove it with
  `not.toHaveText(before)` on the card's "#…" lines (or the end screen when the URL says `done`).
- **Settle a name row before branching:** the row says "Checking for players/teams by that name…"
  and holds its create until the lookups answer; reading it earlier picks the wrong branch.
- **Old seed parity (origin/main bulk "Add remaining players as new"):** created every settled
  player that its own sport did not make ambiguous, so a NEO-424 cross-sport preselect was CREATED,
  not linked; pick steps linked the top candidate. Over-80 titles were kept and stay pink; J3
  (`blocksParallelBuild`) blocks a build only on name/disagreement pink, not on titles.
- **Commit first, walk second.** Match Cards' Confirm saves the cards ("Saved N cards.") and only
  then the walk opens if a card needs a person. Settle whether it opened by reading the "N need you"
  pill once the saved line is up (same render), never `isVisible` on the walk (a ms window).
- **Why it matters:** "Cancel → Discard, nothing saved" no longer exists. Any spec that fetched a
  shared real set and cancelled to keep it empty (the "read-only wizard specs" fixture) now WRITES
  the set (R7a). And a build from a source with any pink card is refused (J3), so a seed must leave a
  base with zero pink before building its parallels.

**How to apply:** use `tidy-walk.ts` helpers; never re-derive tile levels from colour; for a spec
that must not write a real set, there is no pre-save exit any more: give it its own set.

## Driving the walk by keys, and a blue card on a hand-made set (NEO-645 walk spec)

- **Keys reach the walk only from inside the card.** Enter/Esc are the dialog root's `onKeyDown`;
  after a tile answer the pressed button may unmount and focus falls to `body`, where Enter does
  nothing (a vacuous "held" pass). Click the card's header line (`tidyCardHeader`, a `tabIndex=-1`
  div) first: focus lands on the card outside any control, where Enter = Save & next, Esc = Save
  for later. Prove "Enter held while pink" by the NEXT move: Skip right after it must land on the
  second card, not the third.
- **A pasted `?tidy=` and the sitting.** The sitting (`passed`, sessionStorage per tab) survives a
  `page.goto`; a bad id falls back to the first card NOT passed. Press the pill (new sitting) before
  any deep-link proof, or the fallback lands past a skipped card and proves nothing.
- **Blue on a hand-made card = a whole-team title cut.** A card with no linked player keeps its card
  name OUT of the title ("2024 Topps <set> Base #3 <team>"), so pad a one-token team to ~70 chars:
  it never fits, the title without it always does, and the badge reads "Card <n> is worth a check:
  listing title was cut short" (pink is "needs attention: …"). A 45-char team fit and stayed clean.
- **Planting a break needs a Vite nobody else is using**: a plant hot-reloads product code, so on a
  shared snapshot Vite it would red every other author's run. Hand the plant back instead.

## Sources disagree and the set-name shortener (NEO-645 published-upload and long-set-name specs)

- **Sources disagree tile:** list "What each source says: Player name", one listitem per source
  whose textContent starts with its label ("BSC…", "Checklist…"; the differing letters are a `<u>`,
  so use `toContainText`). Buttons `Use “<value>”`, "Type another… player name" (opens textbox
  "Type the player name yourself"; Esc closes only the field and refocuses the button; its submit
  is "Use this player name"), then status `Using “<value>” (<source label>)` and "Change the
  player name".
- **A pick writes the PLAYER, not "Card name".** The card name keeps the commit's (Match Cards
  preselected) spelling; read a pick back from the drawer's "Title built from" chips and the
  stored "Card title", never the Card name box.
- **Walk order is (ready, number):** visit every card in a loop bounded by the set's size, read
  the number off `tidyCardIdentity(page)` line 0 (`/^#(\S+)/`), and Skip the ones that are not
  the spec's.
- **Over-80 set name:** a 100-char unbroken set name makes every generated title pink; the tile
  opens in edit mode ("Card title for #<n>"). "Shorten the set name for every card" opens
  "Set name in titles" (focused) prefilled with the stored short name, else the builder's own
  description ("<year> <brand> <row name>", capped at 80), never the bare set name; Escape keeps
  nothing (reopen shows the prefill again). The title BOX's value follows each typed name (assert with two
  fills); "Save and apply to all N cards" -> status "Set name saved. The other cards' titles are
  updating." and the others are retitled by a scheduled page before the walk reaches them.

## Teamless default on the walk, filtered rows, and a fresh-only fetch's one shot (NEO-426 specs)

- **A row found by a control that the answer hides stops matching mid-answer.** `openTeamRows`
  filters on "Not a team"; pressing "+ New team" opens the form and hides it, so the same locator
  then finds nothing ("New team: …" form "not found" while the ARIA snapshot shows it open).
  Read the row's `aria-label` once and re-anchor by name (`createTeamFromRow` does now).
- **The teamless-sport default on the walk:** a card whose player name is still pending has a PINK
  Team tile (nothing can be stamped for an unknown person). Answering the name re-asks the default:
  the Team tile turns into "No team on this card." by itself, and a sibling card with the same name
  and nothing else leaves the walk ("N cards left" drops; Save & next never shows it). A card whose
  data names a team (checklist cell, BSC listing) is never stamped.
- **An NB team's name can be longer than the source string** (listing "Arizona State Sun Devils",
  NB row "Arizona State Sun Devils baseball"). Old substring locators hid it; an exact
  `Team <name>` group misses. Match from the start: `^Team <escaped>( |$)`.
- **A fresh-only real-set spec gets one run per seed.** If it goes red after the commit, check the
  rest of it on the same seed with a temporary, uncommitted copy that enters the committed set's
  walk from the "N need you" pill instead of fetching; delete the copy after the run.

## Listing title tile on hand-made quick-add cards (NEO-645 card-title specs)

- **Quick-add cards with no team are pink "noTeam"**, so the pill counts every teamless card in the
  open checklist; keep the over-cap card alone on its own row to keep the pill at "1 needs you".
- **Blue cut vs pink over:** a cut title that fits is "To check": shown as text, meter `N/80`, the
  plain "Left out to fit: …" line, no textbox, Save & next usable; Save & next is the answer (badge
  "is worth a check: listing title was cut short" goes, title unchanged). Over 80 is "To fix" and opens
  the "Card title for #<n>" editor with `aria-invalid` and `expectOverCapLook(box, overLine)`.
- **The tile's set-name save IS the row's "Set name in titles"**: after "Save and apply to all 1 card"
  the Attributes panel's "Value for Set name in titles" holds it, and the stored title (drawer) is
  the box title; read it back there instead of pressing a no-op Regenerate.
- **Back/Forward on a one-card walk:** opening is a push, Done/Save for later a replace. Back from the
  open card closes the walk with nothing written (pill still up); Forward reopens it on the card.
  Back AFTER Done lands on a `?tidy=<card>` entry, not the drill, so prove URL moves before the answer.
- **The Listing title tile's edit button is "Edit title"** (was "Edit card title"); levels via
  `toHaveAccessibleDescription(/To fix/)`.

## Career fallback chips and fetch-or-adopt rewrites (NEO-330 / NEO-528 specs on the walk)

- **No stint covers the set year:** the career chips' list is named by its heading "No <year> team on
  file. Here’s the whole career, so pick the one on the card." (curly apostrophe; match with `.`).
  An unpressed chip reads `<team> · <player> <from>–<to>`; only a PRESELECTED one reads `· <player>
  played here`. Prove "nothing picked" by `pressed: true` count 0 in that list plus no `^Save teams?$`
  button (it mounts with the first pressed chip). A pressed chip is a choice: tile still "To fix".
- **Quick-add card header names the linked player** (`#851 · George Brett`), not the card name: a
  free proof the PlayerPicker link landed.
- **Fetch-or-adopt specs:** the rewritten commit/walk code runs only when the set is still empty, so
  the first run on a seed is the only proof of it; the old "skip every name" maps to Save for later.

## Team-tile answers that change what the tile asks, and Back after Done (NEO-591 prospect, NEO-426 specs)

- **"Not a team" on a printed place turns the card into a no-team card with NO claim left**, so
  the fill chips PRESELECT a career team that meets the pre-fill rule ("Chicago Cubs · <player>
  played here", pressed) under "Suggested from career history.". A preselect is not a write: the
  tile stays pink, Save & next held, until "Save team". Assert pressed=true plus the card read
  back teamless after Skip; the old wizard's "none picked" is gone (NEO-639 rule 8).
- **A settled auto-link (place by stint, exact name, known Prospect X) makes no walk stop**; a
  catalogue player whose linked team is outside his career still stops the card BLUE (Career "To
  check"). Prove the walk's membership by the exact set of numbers shown plus `expectCardsLeft`.
- **BSC answered "no team" shows on the pink Team tile** as "The listing has no team for this
  card. …" while the person is pending; adding the person in a teamless home sport replaces the
  chips with "No team on this card." by itself.
- **Done replaces the `?tidy=done` entry**: browser Back from the checklist afterwards REOPENS the
  walk on its last card. A column Back/Forward check placed after a walk lands in the walk; put
  it before the fetch, or prove Back inside the walk (end screen -> last card -> Forward).

## "Add all N new players" and "Review the N skipped" (NEO-645 w8)

- **A created player leaves a BLUE Career check on the card it was made on** (`newPlayerCareer`),
  per-card add and bulk "Add all" alike. A name printed on #1 and #4 keeps #1 in the walk (blue,
  "1 to check") and drops #4. Count the walk as (first card per new name) + the still-pink cards;
  blue never holds Save & next.
- The Add-all trigger and its "Added N players." status sit in the walk's header (inside the
  dialog); after the add the trigger keeps its old label, aria-disabled.
- **"Review the N skipped"** (end screen, footer) lands on the first skipped card; the cards being
  reviewed count as left again ("N cards left"). Its move is a push: browser Back returns to the
  end screen with the same verdict, tally and button. Reaching it with several skipped cards: skip a
  blue card instead of Save & next.

## Autograph radiogroup and "Did you mean" on the Player tile (NEO-645 autograph + S2 specs)

- **Autograph radios save on an arrow** and are `aria-disabled` while the write runs: before
  the next key, wait for `getByRole("radio", { name, checked: true, disabled: false })`, or a
  quick second arrow is dropped by the busy guard while focus still moves. Enter on a radio is
  the radio's (useTidyKeys `ownsEnter`), never Save & next; it hands focus to Save & next when
  nothing else is pink. "Apply to all N autographed cards" counts the whole leaf; its status
  reads "Applied." (the cascade is scheduled; read other cards back in the drawer, 7 s).
- **Outline vs primary is provable by paint:** an outline NeonButton computes
  `background-color: rgba(0, 0, 0, 0)` (`--nb-fill: transparent`); assert `toHaveCSS` for the
  outline and `not.toHaveCSS` for the filled one, and pair it with the same control painted the
  other way on a counter card. Reading order of a row's buttons: `row.getByRole("button").allInnerTexts()`.
- **"Did you mean" fixture:** one player `Jackson Holliday<token>` with a stint at the card's team
  covering the year on a hand-made sport; print one letter dropped (suggestion) and three letters
  changed in the surname (none: the limit is 2 edits on >= 12-char names). Counter-fixture: the
  player three letters off the printed name, the spec goes red at the suggestion.

## A parse spec on the walk (NEO-645 set-checklist-pdf rewrites)

- **Checklist-only fetch, every name new:** "Saved N cards." then the walk opens by itself; reach
  one printed name with `skipUntil(page, tidyTile(page, "Player").getByRole("group", { name:
  "Player <printed>", exact: true }), { maxCards: N })`, assert the header (`#NNO · <printed>`),
  then Save for later; the pill reads "N need you". The checklist is Virtuoso, so a row-name check
  for one NNO card among dozens is not reliable: prove the name in the walk instead.
- **After a walk, re-drill instead of Back** (`drillToCustom` does its own `page.goto`): each card
  the walk showed is a history entry, so a goBack chain lands in the walk. Put the column's
  Back/Forward proof BEFORE the Sync.
- **Spec-only counter-fixture on a shared Vite:** a temp copy with the expected name flipped (the
  printed "last first" order) goes red at `skipUntil`; delete it after the run.
- **A real set whose commit would build parallels** keeps its "never committed" claim by leaving
  through Match Cards' "Cancel card matching" + `^Discard [0-9]+ pairings?$`; drop the walk proof
  there and say which spec covers the tile.
