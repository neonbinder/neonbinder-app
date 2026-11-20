// NEO-591 (R1): a checklist team cell "Prospect" or "Prospect (X)" makes the card a Prospect
// Card, and X is the card's printed TEAM, read like any other team cell (Jason, 2026-11-19); a
// team cell printed as a PLACE settles only when exactly one team in the set's league, in any era,
// is located there; with several, the card's players' stints decide, else the operator is asked
// (never the set year; Jason, 2026-11-20):
//   - "Prospect" alone: the card is No Team (a claim, never asked);
//   - "Prospect (Oklahoma Sooners)": X is a team the catalogue has, so the card links it without
//     asking (no name step, no Teams-step line);
//   - "Prospect (Dbp<token>)": X is a team NB has no row for, so it goes through the Names gate
//     like any unknown team: a "New Team: Dbp<token>" step, answered Add as New Team, and the card
//     saves on that team (there is no held line and no Remember box any more);
//   - "Cincinnati Reds / Prospect (Oklahoma Sooners)": a mixed cell. The preview reads it as
//     printed (before 1a4def6c it read "Prospect (Cincinnati Reds / Oklahoma Sooners)"), and the
//     card carries both teams and is a Prospect Card;
//   - "Seattle": the set's league is Major League Baseball, and the catalogue holds two MLB teams
//     located in Seattle (the 1969 Pilots and the Mariners). The card's player has a Mariners
//     stint, which is also the team the set year covers, so the card commits with the Seattle
//     Mariners and is never asked (no name step, no decided "linked for you" row, no Teams-step
//     line);
//   - "New York": several MLB teams are located there and the card's player (Seiya Suzuki, a Cub)
//     has a stint on none of them, so nothing settles it. It is asked as a pick among the place's
//     MLB teams of every era ("Which team: New York": the Mets and the Yankees, which the set year
//     would not choose between, and past eras such as the Giants), nothing linked, and its
//     "Remember" box settles UNTICKED (a bare place is not a name to remember). Skipped as not a
//     team, the card is left on the Teams step with nothing pre-filled ("Leave for later") and
//     saved teamless;
//   - "Chicago" on a second Seiya Suzuki card (#7): five MLB teams are located there and his one
//     stint among them is the Cubs, so his card decides it. The set year would not have picked the
//     Cubs over the White Sox, so the link is not silent: the wizard opens with it already decided
//     ("Decided (1) · 1 linked for you", "Linked to Chicago Cubs · Seiya Suzuki played there",
//     Changeable), and the card commits with the Chicago Cubs.
// The leaf's checklist preview reads each claim as printed ("Prospect", "Prospect (X)", the
// mixed cell, the place), never "We'll look it up": none of these cards is looked up.
//
// The fixture is the 5-row CSV fixtures/checklists/prospect-team-cells.csv of catalogue players
// the seed already holds (2024 Topps Chrome Base names, each one player on file, so no player
// step and no lookup), uploaded EDITED in memory (the committed file is pinned by the parser's
// golden snapshot): #2's X is the catalogue's full team name, #3's X is minted per attempt, #5's
// place is New York (the file's "Chicago" is one his stints settle, so it moves to #7), a sixth row
// (#6, Matt McLain) carries the mixed cell and a seventh (#7, Seiya Suzuki again) prints Chicago.
// Uploaded through the leaf's "Add the official checklist" and synced: a checklist-only fetch (the
// set has no marketplace id; the checklist is the one source). Every Career check line the
// catalogue players raise is answered "Keep as is" (`passCareerCheck`): their careers are not this
// spec's to write.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `psp`): ONE hand-made set per attempt, `psp<token>`, under
// the REAL `Baseball` › 2024 › `Topps` (the team and player lookups read the set's sport and
// league, so not a custom sport), `Insert` › `Base`. No marketplace id anywhere beneath it. The
// seven cards are COMMITTED, read back and DELETED at the end; one team is minted per attempt
// (`Dbp<token>`, created by the wizard's New Team step; it stays, like every minted row); the
// catalogue's players, the Oklahoma Sooners, the Cincinnati Reds, the Seattle Mariners and the
// Chicago Cubs are only read. The set and its rows stand (per attempt, read by no other spec).
//
// Desktop and mobile: one spec, no branch (role and label locators; click() scrolls).
import { readFileSync } from "node:fs";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  columnOption,
  columnSelection,
  drillToCustom,
  escapeRe,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import {
  matchCardsDialog,
  previewRowCount,
  publishersChecklistButton,
  publishersChecklistChip,
  publishersChecklistDialog,
} from "../../support/published-checklist";
import {
  answerStepAsNew,
  confirmSaveButton,
  newStepHeading,
  nextStepButton,
  openDecidedList,
  passCareerCheck,
  reviewWizard,
  stepCounter,
  tidyUpName,
} from "../../support/wizard";

const FILE = new URL("../../fixtures/checklists/prospect-team-cells.csv", import.meta.url).pathname;
/** The catalogue team a known X names (NCAA; the set's league is MLB, so only its full name links). */
const SOONERS = "Oklahoma Sooners";

/**
 * The committed file with this attempt's edits: #2's X is the catalogue's full team name, #3's X
 * is `minted`, #5's place is one its player never played in, and #6 (the mixed cell) and #7 (a
 * place its player's stint settles) are appended.
 * Throws if the file no longer has the rows the edits name, so a changed fixture fails here by name.
 */
function editedChecklist(minted: string): string {
  const lines = readFileSync(FILE, "utf8").trimEnd().split("\n");
  const cell: Record<string, string> = { "2": `Prospect (${SOONERS})`, "3": `Prospect (${minted})`, "5": "New York" };
  let edited = 0;
  const out = lines.map((line) => {
    const [number, player] = line.split(",");
    if (!(number in cell)) return line;
    edited++;
    return `${number},${player},${cell[number]}`;
  });
  if (edited !== 3) throw new Error(`prospect-team-cells.csv: expected rows #2, #3 and #5, edited ${edited}`);
  return [...out, `6,Matt McLain,Cincinnati Reds / Prospect (${SOONERS})`, "7,Seiya Suzuki,Chicago"].join("\n") + "\n";
}

test(
  "Checklist Prospect and place team cells — every Prospect row is a Prospect Card; bare Prospect is No Team, Prospect (X) takes X as the card's team (a known X links, an unknown X is a New Team step), a mixed cell reads as printed, and a place settles only on its one team or the card's player (NEO-591)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `psp${env.ATTEMPT_TOKEN}`;
    /** The team an unknown X names: minted per attempt, so no catalogue row answers to it. */
    const minted = `Dbp${env.ATTEMPT_TOKEN}`;
    const BARE = { number: "1", player: "Gunnar Henderson", cell: "Prospect" };
    const KNOWN = { number: "2", player: "Colt Keith", cell: `Prospect (${SOONERS})` };
    const UNKNOWN = { number: "3", player: "Bobby Witt Jr.", cell: `Prospect (${minted})` };
    const PLACE = { number: "4", player: "J.P. Crawford", cell: "Seattle", team: "Seattle Mariners" };
    const AMBIGUOUS = { number: "5", player: "Seiya Suzuki", cell: "New York" };
    const MIXED = { number: "6", player: "Matt McLain", cell: `Cincinnati Reds / Prospect (${SOONERS})` };
    const BY_PLAYER = { number: "7", player: "Seiya Suzuki", cell: "Chicago", team: "Chicago Cubs" };
    const CARDS = [BARE, KNOWN, UNKNOWN, PLACE, AMBIGUOUS, MIXED, BY_PLAYER];
    const ROWS = CARDS.length;
    const target = { sport: "Baseball", year: "2024", manufacturer: "Topps", set, variantType: "Insert", variant: "Base" };
    // A checklist row is one run of text: "#<number> <name> <team or No Team> ...". The list's own
    // text joins every row, so the match stops at the next row's "#" (as set-no-team-* do). The
    // player is read off the row's Edit button.
    const rowSays = (n: string, text: string) => page.getByText(new RegExp(`#${n}[^#]*${escapeRe(text)}`));
    const needsTeam = (n: string, player: string) =>
      page.getByRole("img", { name: `Card ${n}, ${player} needs attention: no team on this card yet` });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToCustom(page, target);
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 1. The leaf's official checklist: each row's Teams cell is the claim as printed ──
    await publishersChecklistButton(page).click();
    const dialog = publishersChecklistDialog(page);
    await expect(dialog).toBeVisible();
    await dialog
      .getByLabel("Choose a file")
      .setInputFiles({ name: "prospect-team-cells.csv", mimeType: "text/csv", buffer: Buffer.from(editedChecklist(minted)) });
    await expect(previewRowCount(dialog, ROWS)).toBeVisible();
    const previewRows = dialog.getByRole("table", { name: "Preview of the rows the sync will use" });
    // Each row found by its own name (number, player, team cell), then its cells exactly. The mixed
    // cell reads as printed: the Prospect bracket holds only the team it held in the file.
    for (const card of CARDS) {
      const row = previewRows.getByRole("row", { name: `${card.number} ${card.player} ${card.cell}`, exact: true });
      await expect(row.getByRole("cell")).toHaveText([card.number, card.player, card.cell]);
    }
    await expect(previewRows.getByText(`Prospect (Cincinnati Reds / ${SOONERS})`)).toHaveCount(0);
    await expect(previewRows.getByText("We'll look it up")).toHaveCount(0);
    await expectAccessible(page, { within: dialog, label: "Official checklist preview with Prospect, mixed and place team cells" });
    await dialog.getByRole("button", { name: "Use this checklist" }).click();
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistChip(page, ROWS)).toBeVisible();

    // ── 2. Sync: one source, so no Match Cards. Two team names to decide: the minted X and New York ──
    await syncChecklistButton(page).click();
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAccessibleName(tidyUpName({ year: target.year, set }));
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // Chicago is already decided, by his Cubs stint, as a row the operator looks over: one name
    // linked, so the wizard opens on Step 2. Seattle settled silently (his Mariners stint is the
    // year's team too), so it is not among the linked names, and the Sooners matched by name.
    await expect(stepCounter(page)).toHaveText(/^Step 2 of [0-9]+$/);
    // Names are still owed, so the cue is the Decided summary's count, not the all-linked notice.
    await expect(wizard.getByText("· 1 linked for you", { exact: true })).toBeVisible();
    const decided = await openDecidedList(page);
    await expect(decided.getByRole("listitem")).toHaveCount(1);
    const linked = decided.getByRole("listitem").filter({ hasText: BY_PLAYER.cell });
    await expect(linked).toContainText(`Linked to ${BY_PLAYER.team} · ${BY_PLAYER.player} played there`);
    await expect(linked.getByRole("button", { name: `Change decision for ${BY_PLAYER.cell}`, exact: true })).toBeVisible();
    await expect(decided.getByText(/Seattle/)).toHaveCount(0);
    await expectAccessible(page, { within: wizard, label: "Tidy-up wizard, a printed place linked from the card's player's stint" });
    // Folded again, so the steps below read only their own list items.
    await wizard.getByText(/^Decided \([0-9]+\)$/).click();
    await expect(decided).toBeHidden();
    // The minted X and New York were not settled. They come in the batch's order, so each is
    // answered by its heading.
    const unknownStep = wizard.getByRole("heading", { level: 3, name: `New Team: ${minted}`, exact: true });
    const placeStep = wizard.getByRole("heading", { level: 3, name: `Which team: ${AMBIGUOUS.cell}`, exact: true });
    const heading = newStepHeading(page);
    let sawUnknown = false;
    let sawPlace = false;
    for (let i = 0; i < 2; i++) {
      await expect(unknownStep.or(placeStep)).toBeVisible();
      if (await unknownStep.isVisible()) {
        // X is the card's team, asked like any team NB has no row for: the step opens with X as the
        // new team's whole name. Created here, it is the card's team at the save.
        await expect(wizard.getByRole("textbox", { name: "New team name" })).toHaveValue(minted);
        await expectAccessible(page, { within: wizard, label: "Tidy-up name step for a Prospect (X) team NB does not have" });
        await answerStepAsNew(page);
        sawUnknown = true;
        continue;
      }
      // The place's in-league teams of every era are offered and none is chosen: the two the set
      // year covers (the year never decides between them) and a past era.
      const placeTeams = wizard.getByRole("list", { name: /^We've got [0-9]+ teams from New York\. Pick the one on these cards\.$/ });
      for (const team of ["New York Mets · 1962–present", "New York Yankees · 1913–present", "New York Giants · 1885–1957"]) {
        await expect(placeTeams.getByRole("button", { name: `Link to ${team} · Major League Baseball`, exact: true })).toBeVisible();
      }
      const linkTo = wizard.getByRole("group", { name: "Link to existing team" });
      await expect(linkTo.getByRole("combobox", { name: "Search all teams" })).toHaveValue("");
      // The box is held while the place lookup runs, then settles unticked: a place is no team's name.
      const rememberPlace = linkTo.getByRole("checkbox", { name: `Remember “${AMBIGUOUS.cell}” as a name for this team`, exact: true });
      await expect(rememberPlace).toBeEnabled();
      await expect(rememberPlace).not.toBeChecked();
      await expectAccessible(page, { within: wizard, label: "Tidy-up name step for a team printed as an ambiguous place" });
      await wizard.getByRole("button", { name: `Skip ${AMBIGUOUS.cell} — not a team`, exact: true }).click();
      await expect(placeStep).toBeHidden();
      sawPlace = true;
    }
    expect(sawUnknown && sawPlace, "both the minted X and New York were asked as team names").toBe(true);
    // No other team was asked (the Sooners, the Reds, Seattle and Chicago settled): the names are done.
    await expect(nextStepButton(page)).toBeVisible();
    await expect(heading).toHaveCount(0);
    await expect(wizard.getByRole("heading", { level: 3, name: /^Which team: / })).toHaveCount(0);

    // The catalogue players' Career check lines (the Sooners, the new team) are not this spec's to write.
    await passCareerCheck(page);
    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
    // Only the New York card: the bare Prospect is answered No Team, and every other card has its team.
    const lines = wizard.getByRole("listitem");
    await expect(lines).toHaveCount(1);
    const placeLine = lines.filter({ hasText: `#${AMBIGUOUS.number} · ${AMBIGUOUS.player}` });
    const placeChoices = placeLine.getByRole("radiogroup", { name: `Team for ${AMBIGUOUS.player}` });
    // A team is offered (his Cubs), none is picked.
    await expect(placeChoices.getByRole("radio", { name: `Chicago Cubs — ${AMBIGUOUS.player}`, exact: true })).not.toBeChecked();
    await expect(placeChoices.getByRole("radio", { checked: true })).toHaveAccessibleName(`Leave for later — ${AMBIGUOUS.player}`);
    // Skipped as not a team, "New York" is the operator's ruling, so it is no longer listed; and no
    // line is a held prospect any more (there is no Remember box).
    await expect(placeLine.getByText(/Listed as/)).toHaveCount(0);
    await expect(wizard.getByRole("checkbox")).toHaveCount(0);
    await expectAccessible(page, { within: wizard, label: "Tidy-up teams step, the ambiguous place's card" });

    // ── 3. Save ──
    await nextStepButton(page).click();
    await expect(wizard.getByRole("heading", { name: `Save ${ROWS} cards?` })).toBeVisible();
    await confirmSaveButton(page).click();
    await expect(wizard).toBeHidden();
    // The count includes checklist-named teams the operator still settles (New York, saved teamless), as it counts unresolved checklist teams: intended.
    await expect(page.getByText(`Saved ${ROWS} cards. Teams from your checklist: ${ROWS} of ${ROWS} cards.`)).toBeVisible();

    // ── 4. Read back: the rows, then each card's drawer ──
    for (const card of CARDS) {
      await expect(editCardButton(page, card.number)).toHaveAccessibleName(`Edit card ${card.number}, ${card.player}`);
    }
    await expect(rowSays(BARE.number, "No Team")).toBeVisible();
    await expect(rowSays(KNOWN.number, SOONERS)).toBeVisible();
    await expect(rowSays(UNKNOWN.number, minted)).toBeVisible();
    await expect(rowSays(PLACE.number, PLACE.team)).toBeVisible();
    await expect(rowSays(BY_PLAYER.number, BY_PLAYER.team)).toBeVisible();
    // New York was left: that card alone is badged.
    await expect(needsTeam(AMBIGUOUS.number, AMBIGUOUS.player)).toBeVisible();
    for (const card of [BARE, KNOWN, UNKNOWN, PLACE, MIXED, BY_PLAYER]) await expect(needsTeam(card.number, card.player)).toHaveCount(0);

    const teamsOn: Record<string, string[]> = {
      [KNOWN.number]: [SOONERS],
      [UNKNOWN.number]: [minted],
      [PLACE.number]: [PLACE.team],
      [MIXED.number]: ["Cincinnati Reds", SOONERS],
      [BY_PLAYER.number]: [BY_PLAYER.team],
    };
    for (const card of CARDS) {
      await editCardButton(page, card.number).click();
      const drawer = page.getByRole("dialog", { name: `Card #${card.number}` });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("textbox", { name: "Card name" })).toHaveValue(card.player);
      await expect(drawer.getByRole("button", { name: "No Team for this card" })).toHaveAttribute(
        "aria-pressed",
        card === BARE ? "true" : "false",
      );
      const teams = teamsOn[card.number] ?? [];
      const chips = drawer.getByRole("button", { name: /^Remove team / });
      await expect(chips).toHaveCount(teams.length);
      for (const team of teams) {
        await expect(drawer.getByRole("button", { name: `Remove team ${team}`, exact: true })).toBeVisible();
      }
      // A Prospect row makes a Prospect Card (the mixed cell too); a place row does not.
      const prospect = card === PLACE || card === AMBIGUOUS || card === BY_PLAYER ? "false" : "true";
      await drawer.getByRole("button", { name: "Show features editor" }).click();
      await expect(drawer.getByRole("button", { name: "Value for Prospect Card" })).toHaveAttribute("aria-pressed", prospect);
      if (card === BARE) await expectAccessible(page, { within: drawer, label: "Card drawer of a Prospect Card" });
      await drawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }

    // Navigation lives in the URL: Back is the Insert type with Base not picked, Forward is Base.
    await page.goBack();
    await expect(columnOption(page, "Inserts", "Base")).toBeVisible();
    await expect(columnSelection(page, "Inserts", "Base")).toHaveCount(0);
    await page.goForward();
    await expect(columnSelection(page, "Inserts", "Base")).toBeVisible();
    await expect(rowSays(KNOWN.number, SOONERS)).toBeVisible();

    // ── 5. Clean up the cards ──
    for (const card of CARDS) {
      await deleteCardButton(page, card.number).click();
      await confirmDeleteCardButton(page, card.number).click();
      await expect(editCardButton(page, card.number)).toHaveCount(0);
    }
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  },
);
