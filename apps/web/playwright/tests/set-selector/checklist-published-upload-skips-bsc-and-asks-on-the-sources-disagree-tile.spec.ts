// NEO-478 (R1): a publisher's checklist pasted into "Add the publisher's
// checklist" gives a fetch its teams without asking BuySportsCards for each
// card, lists what it could not read, and ASKS the operator where it disagrees
// with the marketplace instead of settling it silently (rule 7: a number that
// matches but a player that does not is a likely misread, never settled). And
// (NEO-591, names first) where the checklist cannot say which row is the card,
// it pairs neither and leaves the card to BSC alone. NEO-645: the asking is the
// per-card Tidy Up walk's "Sources disagree" tile, after the cards are saved.
//
// The flow, as the operator lives it, on a small BSC-only set:
//   1. Paste the checklist in the published line format ("<number> <player> -
//      <team>"), built from the set's own captured BSC answers
//      (fixtures/checklists/1995-hockey-oklahoma-city-blazers-chl-base.csv) with
//      FOUR deliberate changes: two players misspelt (cards #2 and #4), card #6
//      written twice, the same player and number on both lines, with a team
//      nobody else uses, and one line that is no card at all. The preview reads
//      "19 rows" (18 cards plus the repeated line) and lists the junk line under
//      "Skipped lines".
//   2. Use it and Sync. BSC and the checklist are two sources, so Match Cards
//      opens (NEO-496); while it is open the result line reads "Teams from your
//      checklist: 17 of 18 cards": every card but #6 took its answer from the checklist (#2 and #4
//      pair by number and only their players disagree). #6 is a TIE: two rows name
//      its player under its number, so neither row is the card (rule 7: a tie stays
//      unmatched, never given to the first candidate). In the dialog the card waits
//      in "BSC only (1)" and both rows in "Checklist only (2)", unlinked, with no
//      "Number for #6" picker and no Unlink on it. #2 and #4 sit in Matched, each
//      with one name picker ("Name for #2": BSC's spelling preselected, the
//      checklist's "· your checklist"), and the Matched toggle counts the two;
//      they are left untouched. The helper keeps the card and leaves the rows.
//   3. NEO-645: Confirm SAVES the cards ("Saved N cards."), then the walk opens.
//      A preselect is no answer, so #2 and #4 each open on a PINK "Sources
//      disagree" tile: its list "What each source says: Player name" shows BSC's
//      spelling and the checklist's, Save & next is held with the "N to fix"
//      line, and "Type another…" opens "Type the player name yourself" (Esc
//      closes it, nothing written). #2 takes the checklist's spelling ("Use
//      “<typo>”" -> "Using “<typo>” (Checklist)") and #4 the marketplace's, so
//      each side lands on a card; the tile stops being pink, and with no other
//      card holding the same disagreement no "Apply to the N cards with the same
//      disagreement" is offered. Every other card is skipped (its names are not
//      this spec's), so the end screen counts them skipped.
//   3a. NEO-680 (Jason, 2026-11-25: a lone alias match "should be automatic with a
//      purple pill tag that says it was linked"): before the fetch, Player
//      Management gets a per-attempt Hockey player whose one alias is #2's
//      checklist spelling. Picking that spelling links him by itself: the Player
//      tile's row "Player <typo>" reads "Edit <him>" with ONE purple note "Linked
//      by alias" under it, the tile is not pink, and nothing asks ("Link to …"
//      offers no lead, no "is new to NeonBinder"). Axe runs on that tile.
//   3b. NEO-680 link on open (Jason, 2026-11-25, Q1: "Link when card opens"; Edit
//      on it un-links and it stays un-linked): a name the commit left WAITING
//      (#16, no player answered to it then) links by itself when the walk opens
//      its card. The alias can only arrive after the commit (the commit links a
//      lone alias match itself), so once the walk is open on another card a
//      second tab gives a second per-attempt Hockey player that one alias. When
//      the walk reaches #16, with no click: its row "Player <name>" reads "Edit
//      <him>" with the "Linked by alias" note, no Player tile is pink, and the
//      walk's status line says exactly "Linked <name> to <him>." (only a waiting
//      name links on open, so the line is the proof the commit left it waiting).
//      Axe on that tile. Then Edit takes it back: the row waits again (pink), and
//      after Skip and the browser's Back to #16 (same sitting, no reload) it
//      still waits, with no "Linked" line; Forward returns to where Skip went.
//   4. D2 (Jason, 2026-11-10): card #6, which no row could be pinned to, is
//      looked up on BSC for just that card. Proof from the user's side:
//      the "17 of 18" line (the other 17 took the checklist's answer, so BSC was
//      asked for no card but #6), card #6 has no Sources disagree tile and the
//      invented team on #6's two rows is never shown in the walk, and the saved
//      card #6 carries its own name and not that team. NOT provable from the
//      screen: that BSC's own team then landed on #6 (it is a name NB does not
//      know, left for the operator). The backend's own log line for the fetch
//      ("calls":1 for 18 cards) is what shows BSC was asked once.
//
// BEFORE THE REAL PASTE the dialog is shown three things that are not the checklist:
//   * a paste that reads as no card: the count's status says "Nothing reads as a
//     card yet. Each line starts with its card number.", pressing Use says
//     "Nothing to use yet", and the dialog stays open (axe on that state);
//   * a paste with a "Card Set" column naming two subsets: the question "Which of
//     these belong to this set?" shows with NOTHING ticked, Use refuses with "Tick
//     at least one subset first", and ticking one subset narrows the preview to
//     that subset's rows (axe on that state);
//   * NEO-489: four of the set's cards with four kinds of team cell. The preview's Teams
//     column reads the team, "No Team" (the checklist's claim), and
//     "We'll look it up" (a blank cell is no claim); a "No Team; <team>" line is no row and is
//     listed under Skipped lines with "Says No Team and names a team — pick one." (axe on
//     that state). A throwaway paste: the real one below is unchanged.
// AFTER USING the real paste, "Remove the publisher's checklist" takes the chip
// away (and the button to add one is back); the checklist is then used again for
// the flow below. No plain Sync follows the Remove: that would ask BSC for each of
// the 18 cards live.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Oklahoma City Blazers CHL"):
// SOLE WRITER of that set (BSC only, 18 cards, reached through the All Brands
// view); FRESH-ONLY, it commits the checklist, so a re-run on the same seed fails
// at "No cards in this checklist yet." by name. Every name is left unanswered
// (skipped in the walk), so the walk mints no player or team. The one player
// this spec makes is the NEO-680 alias holder, added by hand in Player
// Management before the drill (`Kip Okc<token>`, Hockey, alias = #2's misspelling,
// which no other spec prints): #2's pick links the card to him, #4's pick writes
// BSC's spelling as a pending name. The holder is minted, not a recorded
// no-match (GUIDE "Enrichment fixtures"): every recorded Hockey no-match is a
// name some fixture checklist prints, and a holder sharing one would link that
// spec's card. Under the recording his lookup is refused (no live call), and
// the row stays bare. The second holder (`Kip Late<token>`, alias = #16's
// printed name, which no other spec prints) is added the same way in a second
// tab once the walk is open; his link on #16 is taken back with Edit, so #16
// ends waiting on its printed name (step 4 reads that back from its title).
//
// Desktop and mobile: one spec, no branch (role and label locators; click()
// scrolls). Axe runs in light and dark on the dialog's preview, Match Cards and
// the walk's pink Sources disagree tile, and on the Player tile of #2 (linked
// by the pick) and #16 (linked on open).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton, escapeRe } from "../../support/cards";
import { addPlayerByHand, expectPlayersLoaded } from "../../support/players";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  checklistRows,
  confirmChecklistMatchCards,
  matchCardsDialog,
  previewRowCount,
  publishersChecklistButton,
  publishersChecklistChip,
  publishersChecklistDialog,
} from "../../support/published-checklist";
import { openOneMarketplaceSetBase, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  settleWalkAfterCommit,
  skipCard,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const SET = "Oklahoma City Blazers CHL";
/** The dialog's own words for a paste that reads as no card, a Use with nothing to use, and a Use with no subset ticked. */
const NOTHING_READS = "Nothing reads as a card yet. Each line starts with its card number.";
const NOTHING_TO_USE = "Nothing to use yet — paste lines that start with a card number.";
const PICK_A_SUBSET = "Tick at least one subset first — then use it.";
const JUNK_LINE = "Page 1 of 1 - checklist continues on the back of the card";

/** Swap the first pair of different neighbouring letters after the first two of a surname: a misspelling no matcher takes for the same name. */
function misspell(name: string): string {
  const parts = name.split(" ");
  const surname = [...parts[parts.length - 1]];
  for (let i = 2; i < surname.length - 1; i++) {
    if (surname[i] !== surname[i + 1]) {
      [surname[i], surname[i + 1]] = [surname[i + 1], surname[i]];
      break;
    }
  }
  parts[parts.length - 1] = surname.join("");
  return parts.join(" ");
}

test(
  "Checklist — a pasted publisher's checklist gives a fetch its teams without asking BSC per card, lists what it could not read, and asks on the Tidy Up walk where it disagrees with the marketplace (NEO-478, NEO-645)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const bogusTeam = `Dup${env.ATTEMPT_TOKEN}`;
    const rows = checklistRows(CHECKLISTS.oklahomaCityBlazers);
    expect(rows, "the captured file holds the set's 18 cards").toHaveLength(18);
    const at = (n: number) => rows.find((r) => r.number === String(n))!;
    const [two, four, six] = [at(2), at(4), at(6)];
    const typoTwo = misspell(two.player);
    const typoFour = misspell(four.player);
    expect(typoTwo, "the misspelling changed the name").not.toBe(two.player);
    expect(typoFour, "the misspelling changed the name").not.toBe(four.player);
    // NEO-680: the one Hockey player who answers to #2's checklist spelling, by a saved alias.
    const holderSurname = `Okc${env.ATTEMPT_TOKEN}`;
    const holder = `Kip ${holderSurname}`;
    // NEO-680 link on open: #16's printed name, waiting after the commit, and the player given it as an alias later.
    const late = at(16);
    const lateHolderSurname = `Late${env.ATTEMPT_TOKEN}`;
    const lateHolder = `Kip ${lateHolderSurname}`;

    // The paste: the published line format, one line per card, with the changes above.
    const lines = rows.map((r) => {
      if (r.number === "2") return `${r.number} ${typoTwo} - ${r.team}`;
      if (r.number === "4") return `${r.number} ${typoFour} - ${r.team}`;
      if (r.number === "6") return `${r.number} ${r.player} - ${bogusTeam}`;
      return `${r.number} ${r.player} - ${r.team}`;
    });
    // Card #6's line again, word for word: the same player and number twice, a tie no rule may break.
    lines.splice(6, 0, `6 ${six.player} - ${bogusTeam}`);
    lines.unshift(JUNK_LINE);
    const rowCount = rows.length + 1;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── 0. NEO-680 fixture, from the UI: a Hockey player whose one alias is #2's checklist spelling ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, holder, "Hockey");
    const aliases = page.getByRole("textbox", { name: "Aliases", exact: true });
    await expect(aliases, "added by hand, so he starts with no aliases").toHaveValue("");
    await aliases.fill(typoTwo);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: `Saved ${holder}.` })).toBeVisible();
    await expect(aliases).toHaveValue(typoTwo);
    // He is the only one who answers to it: no "also answers to that name" line.
    await expect(page.getByText(/also answers to that name/)).toHaveCount(0);
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();

    await openOneMarketplaceSetBase(page, env, { set: SET });
    // The precondition for a FIRST fetch (fresh-only): a re-run fails here, by name.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 1. Paste, and read the preview ──
    await publishersChecklistButton(page).click();
    const dialog = publishersChecklistDialog(page);
    await expect(dialog).toBeVisible();
    // Escape cancels and hands focus back to the button that opened it.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistButton(page)).toBeFocused();
    await publishersChecklistButton(page).click();
    await expect(dialog).toBeVisible();
    const paste = dialog.getByRole("textbox", { name: "Paste the checklist" });
    const useButton = dialog.getByRole("button", { name: "Use this checklist" });

    // A paste that reads as no card: said at once, refused on Use, the dialog stays.
    await paste.fill("hello there\nnothing in this paste starts with a card number");
    await expect(dialog.getByRole("status").filter({ hasText: NOTHING_READS })).toBeVisible();
    await expect(dialog.getByText(/Try a line like/)).toBeVisible();
    // Use is aria-disabled while there is nothing to use, so click() would wait it out (GUIDE): the
    // press is made from the keyboard, which the product answers with its reason.
    await useButton.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status").filter({ hasText: NOTHING_TO_USE })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expectAccessible(page, { within: dialog, label: "Publisher's checklist dialog, a paste that reads as no card" });

    // A paste naming two subsets: asked before anything is used, none ticked to start.
    const base = rows.slice(0, 4);
    const insert = rows.slice(4, 6);
    await paste.fill(
      [
        "Card Set,Card #,Player,Team",
        ...base.map((r) => `Base,${r.number},${r.player},${r.team}`),
        ...insert.map((r) => `Insert,${r.number},${r.player},${r.team}`),
      ].join("\n"),
    );
    const subsetQuestion = dialog.getByRole("group", { name: "Which of these belong to this set?" });
    await expect(subsetQuestion).toBeVisible();
    const baseBox = subsetQuestion.getByRole("checkbox", { name: "Base", exact: true });
    const insertBox = subsetQuestion.getByRole("checkbox", { name: "Insert", exact: true });
    await expect(baseBox).not.toBeChecked();
    await expect(insertBox).not.toBeChecked();
    const previewRowsShown = dialog.getByRole("table", { name: "Preview of the rows the sync will use" }).getByRole("row");
    await expect(dialog.getByText("Tick the subsets that belong to this set, and their rows show up here.")).toBeVisible();
    await useButton.focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("status").filter({ hasText: PICK_A_SUBSET })).toBeVisible();
    await expect(dialog).toBeVisible();
    // Ticking one subset narrows the preview to its rows (the header row is one of the table's rows).
    await insertBox.check();
    await expect(previewRowsShown).toHaveCount(insert.length + 1);
    await expect(dialog.getByText("Tick the subsets that belong to this set, and their rows show up here.")).toBeHidden();
    await expectAccessible(page, { within: dialog, label: "Publisher's checklist dialog, one of two subsets ticked" });
    await baseBox.check();
    await expect(previewRowsShown).toHaveCount(base.length + insert.length + 1);

    // NEO-489 (Jason, 2026-11-11): what the preview's Teams column says for each kind of team cell.
    // A throwaway paste, read and replaced by the real one below, so the fetch's own arithmetic
    // ("17 of 18") and its BSC lookups are untouched: four of the set's own cards, each with a
    // different team cell. A named team reads as itself; "No Team" is the checklist's CLAIM that
    // the card shows no team, so it reads "No Team"; a blank cell makes no claim, so it reads
    // "We'll look it up"; "No Team" beside a team contradicts itself, so that line is not a row
    // and is listed under Skipped lines with the parser's own reason.
    const [teamed, claimed, blank, both] = rows.slice(0, 4);
    await paste.fill(
      [
        "number,player,team",
        `${teamed.number},${teamed.player},${teamed.team}`,
        `${claimed.number},${claimed.player},No Team`,
        `${blank.number},${blank.player},`,
        `${both.number},${both.player},No Team; ${both.team}`,
      ].join("\n"),
    );
    await expect(subsetQuestion).toBeHidden();
    await expect(previewRowCount(dialog, 3)).toBeVisible();
    const previewTable = dialog.getByRole("table", { name: "Preview of the rows the sync will use" });
    const teamCell = (player: string, text: string) =>
      previewTable.getByRole("row").filter({ hasText: player }).getByRole("cell", { name: text, exact: true });
    await expect(teamCell(teamed.player, teamed.team)).toBeVisible();
    await expect(teamCell(claimed.player, "No Team")).toBeVisible();
    await expect(teamCell(blank.player, "We'll look it up")).toBeVisible();
    // The contradicting line is no row of the preview, and is listed with the reason, not dropped.
    await expect(previewTable.getByRole("row").filter({ hasText: both.player })).toHaveCount(0);
    const contradiction = dialog.getByRole("listitem").filter({ hasText: both.player });
    await expect(contradiction).toBeVisible();
    await expect(contradiction).toContainText('Says "No Team" and names a team. Fix one in the file.');
    await expectAccessible(page, { within: dialog, label: "Publisher's checklist dialog, preview with No Team, a blank team and a contradiction" });

    // The real paste: the published line format, no subsets.
    await paste.fill(lines.join("\n"));
    await expect(subsetQuestion).toBeHidden();
    await expect(previewRowCount(dialog, rowCount)).toBeVisible();
    // The line that is no card is listed, not dropped silently.
    await expect(dialog.getByText("Skipped lines")).toBeVisible();
    // Read it off its own list item: the pasted text sits in the textarea too, so a bare text match finds two.
    const skipped = dialog.getByRole("listitem").filter({ hasText: JUNK_LINE });
    await expect(skipped).toBeVisible();
    await expect(skipped).toContainText("No card number at the start");
    // The misspellings are in the preview as pasted (the checklist is read, not corrected).
    await expect(dialog.getByText(typoTwo).first()).toBeVisible();
    await expectAccessible(page, { within: dialog, label: "Publisher's checklist dialog, preview with a skipped line" });
    await dialog.getByRole("button", { name: "Use this checklist" }).click();
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistChip(page, rowCount)).toBeVisible();
    const removeChecklist = page.getByRole("button", { name: "Remove the official checklist" });
    await expect(removeChecklist).toBeVisible();

    // ── 1b. Remove: the chip goes and the button to add one is back ──
    // (Not followed by a plain Sync: that would ask BSC for each of the 18 cards live, a burst
    // that has met BSC's 429 for the next spec. Use it again for the flow below.)
    await removeChecklist.click();
    await expect(publishersChecklistChip(page, rowCount)).toBeHidden();
    await expect(publishersChecklistButton(page)).toBeVisible();
    await publishersChecklistButton(page).click();
    await expect(dialog).toBeVisible();
    await paste.fill(lines.join("\n"));
    await expect(previewRowCount(dialog, rowCount)).toBeVisible();
    await useButton.click();
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistChip(page, rowCount)).toBeVisible();

    // ── 2. Sync: BSC is asked for the bulk checklist, and for no card one by one ──
    await syncChecklistButton(page).click();
    // NEO-496 (D10, NQ1): BSC plus the pasted checklist are two sources, so Match Cards opens.
    // One live BSC round trip: 7 s of our own time plus BSC's (NEO-487).
    const matchCards = matchCardsDialog(page);
    await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: "Match Cards after the fetch" });
    await expectAfterMarketplace(page, matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }), {
      platform: "BuySportsCards",
      what: "Confirm unlocked after the fetch",
    });
    // 17 of 18: every card but #6 took its answer from the checklist. #2 and #4 count
    // (their numbers pair; only their players disagree), #6 does not (two rows name its
    // player under its number, a tie: rule 7). Said while Match Cards is open: once the
    // wizard takes over, only the saved line repeats it.
    await expect(page.getByText("Teams from your checklist: 17 of 18 cards").first()).toBeVisible();
    // NEO-591: the tie is left for the operator. Card #6 waits in BSC's column, its two rows in the
    // checklist's (the same line twice reads ", row N of M" to tell them apart: N and M count the
    // rows left in the column, measured "row 1 of 2" / "row 2 of 2"), and nothing pairs
    // them: no Unlink on #6, no number picker for it.
    await expect(matchCards.getByRole("heading", { name: "BSC only (1)", exact: true })).toBeVisible();
    await expect(matchCards.getByRole("button", { name: `Keep #6 ${six.player} as BSC-only`, exact: true })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (2)", exact: true })).toBeVisible();
    await expect(
      matchCards.getByRole("radio", { name: new RegExp(`^Select #6 ${escapeRe(six.player)} · ${bogusTeam}, row [0-9]+ of [0-9]+$`) }),
    ).toHaveCount(2);
    // ...and the two names differ (each says its own place), so neither reads like the other.
    await expect(
      matchCards.getByRole("radio", { name: new RegExp(`^Select #6 ${escapeRe(six.player)} · ${bogusTeam}, row 1 of [0-9]+$`) }),
    ).toHaveCount(1);
    await expect(matchCards.getByRole("button", { name: /^Unlink card #6 / })).toHaveCount(0);
    await expect(matchCards.getByRole("radiogroup", { name: "Number for #6", exact: true })).toHaveCount(0);
    // NEO-591: #2 and #4 pair by number while the names differ, so each Matched row offers ONE name
    // picker: BSC's spelling bare and preselected, the checklist's marked as the operator's own. The
    // Matched toggle (collapsed: #6 waits in a column) counts the two. Left untouched: a preselect
    // answers nothing, so the wizard still asks about both (step 3).
    const expandMatched = matchCards.getByRole("button", { name: "Expand matched cards, 2 with a name conflict", exact: true });
    await expect(expandMatched).toBeVisible();
    await expandMatched.click();
    await expect(
      matchCards.getByRole("button", { name: "Collapse matched cards, 2 with a name conflict", exact: true }),
    ).toBeVisible();
    for (const [n, marketplace, checklist] of [["2", two.player, typoTwo], ["4", four.player, typoFour]] as const) {
      const group = matchCards.getByRole("group", { name: `Name conflict on #${n}`, exact: true });
      await expect(
        group.getByText(/^⚠ Potential names for this card — pick the right one before it is listed\.$/),
      ).toBeVisible();
      const names = group.getByRole("radiogroup", { name: `Name for #${n}`, exact: true });
      await expect(names.getByRole("radio")).toHaveCount(2);
      await expect(names.getByRole("radio", { name: `${marketplace} — use this name for #${n}`, exact: true })).toBeChecked();
      await expect(
        names.getByRole("radio", { name: `${checklist} · your checklist — use this name for #${n}`, exact: true }),
      ).not.toBeChecked();
    }
    await expectAccessible(page, { within: matchCards, label: "Match Cards with BSC and a pasted checklist" });
    // Keeps the card no row could be pinned to (#6), leaves its two rows, and confirms.
    await confirmChecklistMatchCards(page, { what: "the Oklahoma City Blazers fetch" });

    // ── 3. NEO-645: the cards are saved first, then the walk asks on each disagreeing card ──
    const saved = page.getByText(/Saved [0-9]+ cards/).first();
    await expect(saved).toBeVisible();
    expect(await settleWalkAfterCommit(page, saved), "two cards disagree with the checklist, so the walk opens").toBe(true);
    const walk = tidyWalk(page);

    // ── 3b. NEO-680: the walk is open on another card; a second tab gives #16's waiting name to one player, by alias ──
    await expectCardSettled(page);
    const firstCard = /^#(\S+)/.exec((await tidyCardIdentity(page).allTextContents())[0] ?? "")?.[1];
    expect(firstCard, "the walk opened on another card, so #16 opens after its alias exists").not.toBe(late.number);
    const admin = await page.context().newPage();
    await admin.goto("/admin/players");
    // A fresh app load in the new tab: the launch gate (R4).
    await expectPlayersLoaded(admin, LAUNCH_GATE);
    await addPlayerByHand(admin, lateHolder, "Hockey");
    const lateAliases = admin.getByRole("textbox", { name: "Aliases", exact: true });
    await expect(lateAliases).toHaveValue("");
    await lateAliases.fill(late.player);
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.getByRole("status").filter({ hasText: `Saved ${lateHolder}.` })).toBeVisible();
    await expect(lateAliases).toHaveValue(late.player);
    // He is the only one who answers to it by alias.
    await expect(admin.getByText(/also answers to that name/)).toHaveCount(0);
    await admin.close();
    await expect(walk).toBeVisible();

    const disagree = tidyTile(page, "Sources disagree");
    const says = disagree.getByRole("list", { name: "What each source says: Player name", exact: true });
    // Each source's column: its label, then its value (the differing letters underlined).
    const column = (source: "BSC" | "Checklist") => says.getByRole("listitem").filter({ hasText: new RegExp(`^${source}`) });
    // #2 takes the checklist's spelling, #4 keeps the marketplace's: each side lands on a card.
    const picks: Record<string, { marketplace: string; checklist: string; use: string; from: "BSC" | "Checklist" }> = {
      "2": { marketplace: two.player, checklist: typoTwo, use: typoTwo, from: "Checklist" },
      "4": { marketplace: four.player, checklist: typoFour, use: four.player, from: "BSC" },
    };
    const seen: string[] = [];
    // The walk's order is (ready, number), not fixed: every card is visited, bounded by the set's size.
    for (let i = 0; i <= rows.length; i++) {
      const done = tidyFooterButton(page, "done");
      await expect(tidyTile(page, "More about this card").or(done).first()).toBeVisible();
      if (await done.isVisible()) break;
      await expectCardSettled(page);
      const identity = await tidyCardIdentity(page).allTextContents();
      const number = /^#(\S+)/.exec(identity[0] ?? "")?.[1] ?? "";
      expect(number, `the open card reads its number (${identity.join(" | ")})`).not.toBe("");
      seen.push(number);
      if (number === late.number) {
        // NEO-680, link on open: nothing is clicked. #16's name waited after the commit and one player
        // now answers to it by alias, so opening the card linked him: his Edit line, the purple note,
        // a plain tile, and the walk says what it did (the line only a waiting name's link makes).
        const playerTile = tidyTile(page, "Player");
        const lateRow = playerTile.getByRole("group", { name: `Player ${late.player}`, exact: true });
        const lateEdit = lateRow.getByRole("button", { name: `Edit ${lateHolder}`, exact: true });
        const linkedLine = `Linked ${late.player} to ${lateHolder}.`;
        const said = page.getByRole("status").filter({ hasText: linkedLine });
        await expect(lateEdit).toBeVisible();
        await expect(lateRow.getByRole("note")).toHaveText(["Linked by alias"]);
        await expect(pinkTile(page, "Player")).toHaveCount(0);
        await expect(said).toHaveText(linkedLine);
        await expectAccessible(page, { within: playerTile, label: "Tidy Up walk, a waiting name linked by alias when its card opened" });
        // Edit takes the link back: the name waits again, pink, with no Edit line and no note.
        await lateEdit.click();
        await expect(pinkTile(page, "Player")).toHaveCount(1);
        await expect(lateRow).toBeVisible();
        await expect(lateEdit).toHaveCount(0);
        await expect(lateRow.getByRole("note")).toHaveCount(0);
        // The walk moves on, and the browser's Back returns to #16 in the same sitting: opening it
        // again does not link it again. These reads show the re-opened card, but a link made on
        // re-open lands a moment later, so they can pass before it: the proof that it held is
        // step 4's read-back of #16's title after the walk (planted: dropping the walk's held-back
        // names re-links #16 here and turns step 4 red on "Kip Late<token> #16").
        await skipCard(page);
        const afterLate = await tidyCardIdentity(page).allTextContents();
        await page.goBack();
        await expect(tidyCardIdentity(page)).toHaveText(identity);
        await expectCardSettled(page);
        await expect(pinkTile(page, "Player")).toHaveCount(1);
        await expect(lateRow).toBeVisible();
        await expect(lateEdit).toHaveCount(0);
        await expect(said).toHaveCount(0);
        // Forward is where Skip went (the next card, or the end screen when #16 was the last).
        await page.goForward();
        if (afterLate.length > 0) await expect(tidyCardIdentity(page)).toHaveText(afterLate);
        else await expect(tidyFooterButton(page, "done")).toBeVisible();
        continue;
      }
      const pick = picks[number];
      if (pick) {
        // Pink: the tile asks, with both spellings side by side.
        await expect(disagree).toHaveAccessibleDescription("To fix");
        await expect(says.getByRole("listitem")).toHaveCount(2);
        await expect(column("BSC")).toContainText(pick.marketplace);
        await expect(column("Checklist")).toContainText(pick.checklist);
        // Pink holds the card: Save & next is refused and the footer says why.
        await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
        await expect(mustFixLine(page)).toBeVisible();
        if (seen.filter((n) => picks[n]).length === 1) {
          await expectAccessible(page, { within: walk, label: "Tidy Up walk, a pink Sources disagree tile" });
          // "Type another…" opens a field of its own; Esc closes the field (not the walk) and writes nothing.
          const typeAnother = disagree.getByRole("button", { name: "Type another… player name", exact: true });
          await typeAnother.click();
          const typed = disagree.getByRole("textbox", { name: "Type the player name yourself", exact: true });
          await expect(typed).toBeFocused();
          await expect(typeAnother).toHaveAttribute("aria-expanded", "true");
          await typed.press("Escape");
          await expect(typed).toHaveCount(0);
          await expect(typeAnother).toBeFocused();
          await expect(walk).toBeVisible();
          await expect(disagree).toHaveAccessibleDescription("To fix");
        }
        await disagree.getByRole("button", { name: `Use “${pick.use}”`, exact: true }).click();
        await expect(disagree.getByRole("status").filter({ hasText: `Using “${pick.use}” (${pick.from})` })).toBeVisible();
        await expect(disagree.getByRole("button", { name: "Change the player name", exact: true })).toBeVisible();
        await expect(pinkTile(page, "Sources disagree")).toHaveCount(0);
        // No other card holds this disagreement, so there is nothing to apply it to.
        await expect(disagree.getByRole("button", { name: /^Apply to the [0-9]+ cards? with the same disagreement$/ })).toHaveCount(0);
        if (number === "2") {
          // NEO-680: one Hockey player answers to the picked spelling, by his saved alias, so the
          // pick links him by itself: his Edit line, one purple "Linked by alias" note under it,
          // and the tile stays plain (a purple note never makes a stop).
          const playerTile = tidyTile(page, "Player");
          const linkedRow = playerTile.getByRole("group", { name: `Player ${typoTwo}`, exact: true });
          await expect(linkedRow.getByRole("button", { name: `Edit ${holder}`, exact: true })).toBeVisible();
          await expect(linkedRow.getByRole("note")).toHaveText(["Linked by alias"]);
          await expect(pinkTile(page, "Player")).toHaveCount(0);
          // Nothing left to ask about the name: no "Link to …" offer, no "is new to NeonBinder".
          await expect(playerTile.getByRole("button", { name: /^Link to / })).toHaveCount(0);
          await expect(playerTile.getByText(/is new to NeonBinder/)).toHaveCount(0);
          await expectAccessible(page, { within: playerTile, label: "Tidy Up walk, a Player row linked by alias" });
        }
      } else {
        // Every other card's sources agree (#6 never paired a row, so the checklist cannot disagree with it).
        await expect(disagree).toHaveCount(0);
      }
      // D2: the invented team on #6's two unpaired rows is never put to the operator.
      if (number === "6") await expect(walk.getByText(bogusTeam)).toHaveCount(0);
      // Its names are not this spec's: skipped, nothing written.
      await skipCard(page);
    }
    expect(seen, "the walk showed both disagreeing cards and #16").toEqual(expect.arrayContaining(["2", "4", late.number]));
    // Every card shown was skipped, and the end screen counts them.
    await expect(
      walk.getByText(`${seen.length} ${seen.length === 1 ? "card" : "cards"} skipped, not ready to list`, { exact: true }),
    ).toBeVisible();
    await finishTidyWalk(page);
    // The result line stays on screen after the save too.
    await expect(page.getByText("Teams from your checklist: 17 of 18 cards").first()).toBeVisible();

    // ── 4. Each side landed on its card; the repeated number's card kept its own name and no invented team ──
    // A fresh load of the set (the commit leaves its virtualised list at the first
    // streamed batch); the picker reopens on every visit while SportLots is unmapped.
    await openOneMarketplaceSetBase(page, env, { set: SET });
    const drawer = page.getByRole("dialog");
    const cardName = drawer.getByRole("textbox", { name: "Card name" });
    const cardTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const builtFrom = drawer.getByRole("list", { name: "Title built from" }).getByRole("listitem");
    // The list opens where its first streamed batch left it (#9 here), so each card is found by
    // its player in the search box, as a collector would.
    const search = page.getByRole("searchbox", { name: "Search cards" });
    // A pick writes the card's PLAYER (and regenerates its generated title), never the other
    // source's spelling: read back from the title's own chips and the stored title. #2's spelling
    // linked the alias holder (NEO-680), so his NB name is the title's player; #4's waits as BSC
    // printed it. The search finds #2 by the name it printed, as the row shows it. #16's link on
    // open was taken back with Edit and never made again, so it waits on its printed name.
    for (const [n, picked, titled, other] of [
      ["2", typoTwo, holderSurname, two.player],
      ["4", four.player, four.player, typoFour],
      [late.number, late.player, late.player, lateHolderSurname],
    ] as const) {
      await search.fill(picked);
      await editCardButton(page, n).click();
      await expect(cardTitle).toHaveValue(new RegExp(`\\b${escapeRe(titled)} #${n}\\b`));
      await expect(builtFrom.filter({ hasText: titled })).toHaveCount(1);
      await expect(builtFrom.filter({ hasText: other })).toHaveCount(0);
      await drawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(cardTitle).toBeHidden();
    }
    await search.fill(six.player);
    await editCardButton(page, "6").click();
    await expect(cardName).toHaveValue(six.player);
    await expect(drawer.getByRole("button", { name: `Remove team ${bogusTeam}` })).toHaveCount(0);
    await expect(builtFrom.filter({ hasText: bogusTeam })).toHaveCount(0);
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();
  },
);
