// NEO-591 (R1): a checklist team cell "Prospect" or "Prospect (X)" makes the card a Prospect
// Card, and X is a team only when it names exactly one minor-league or college team:
//   - "Prospect" alone: the card is No Team (a claim, never asked);
//   - "Prospect (Oklahoma)": Oklahoma is the place of exactly one college team on file, the
//     Oklahoma Sooners (NCAA), so the card carries that team;
//   - "Prospect (Dallas Baptist)": no minor or college team on file answers to it, so the card
//     is HELD (product invariant 8): the wizard asks, shows X as "Listed as: Dallas Baptist",
//     pre-fills nothing (not even the player's own big-league club) and offers only "No team"
//     and "Leave for later"; saved as left, the card has no team and X is never written as one.
//
// The fixture is a 3-row CSV (fixtures/checklists/prospect-team-cells.csv) of catalogue players
// the seed already holds (2024 Topps Chrome Base names, each one player on file, so no name step
// and no lookup), uploaded through the leaf's "Add the official checklist" and synced: a
// checklist-only fetch (the set has no marketplace id; the checklist is the one source).
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `psp`): ONE hand-made set per attempt, `psp<token>`, under
// the REAL `Baseball` › 2024 › `Topps` (the team and player lookups read the set's sport, so not a
// custom sport), `Insert` › `Base`. No marketplace id anywhere beneath it. The three cards are
// COMMITTED, read back and DELETED at the end; the catalogue's players and the Oklahoma Sooners
// are only read. The set and its rows stand (per attempt, read by no other spec).
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
import { confirmSaveButton, nextStepButton, reviewWizard, tidyUpName } from "../../support/wizard";

const FILE = new URL("../../fixtures/checklists/prospect-team-cells.csv", import.meta.url).pathname;
/** The file's rows: number, player, and what its team cell becomes. */
const BARE = { number: "1", player: "Gunnar Henderson" };
const RESOLVED = { number: "2", player: "Colt Keith", team: "Oklahoma Sooners" };
const HELD = { number: "3", player: "Bobby Witt Jr.", listed: "Dallas Baptist" };
const ROWS = 3;

test(
  "Checklist Prospect team cells — every card is a Prospect Card; bare Prospect is No Team, Prospect (X) takes X's one college team, and an unknown X is held for the operator, never pre-filled (NEO-591)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `psp${env.ATTEMPT_TOKEN}`;
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

    // ── 1. The leaf's official checklist: the three rows, the bare Prospect read as No Team ──
    await publishersChecklistButton(page).click();
    const dialog = publishersChecklistDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Choose a file").setInputFiles(FILE);
    await expect(previewRowCount(dialog, ROWS)).toBeVisible();
    const previewRows = dialog.getByRole("table", { name: "Preview of the rows the sync will use" });
    await expect(previewRows.getByRole("row", { name: `${BARE.number} ${BARE.player} No Team`, exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Use this checklist" }).click();
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistChip(page, ROWS)).toBeVisible();

    // ── 2. Sync: one source, so no Match Cards; the held card alone is asked ──
    await syncChecklistButton(page).click();
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAccessibleName(tidyUpName({ year: target.year, set }));
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // Every name is on the catalogue, so the wizard opens straight on the teams step.
    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Step 1 of 2", { exact: true })).toBeVisible();
    // Only the held card: the bare Prospect is answered No Team, the resolved one has its team.
    const lines = wizard.getByRole("listitem");
    await expect(lines).toHaveCount(1);
    const held = lines.filter({ hasText: `#${HELD.number} · ${HELD.player}` });
    await expect(held.getByText(`Listed as: ${HELD.listed}`, { exact: true })).toBeVisible();
    const choices = held.getByRole("radiogroup", { name: `Team for ${HELD.player}` });
    // Nothing pre-filled: no team is offered (Dallas Baptist is no minor or college team on file,
    // and his big-league club is never a prospect's choice), and the line stays "Leave for later".
    await expect(choices.getByRole("radio")).toHaveCount(2);
    await expect(choices.getByRole("radio", { name: `No team on this card — ${HELD.player}` })).not.toBeChecked();
    await expect(choices.getByRole("radio", { name: `Leave for later — ${HELD.player}` })).toBeChecked();
    await expectAccessible(page, { within: wizard, label: "Tidy-up teams step with a held Prospect (X) card" });

    // ── 3. Save as left ──
    await nextStepButton(page).click();
    await expect(wizard.getByRole("heading", { name: `Save ${ROWS} cards?` })).toBeVisible();
    await confirmSaveButton(page).click();
    await expect(wizard).toBeHidden();
    await expect(page.getByText(`Saved ${ROWS} cards. Teams from your checklist: ${ROWS} of ${ROWS} cards.`)).toBeVisible();

    // ── 4. Read back: the rows, then each card's drawer ──
    for (const card of [BARE, RESOLVED, HELD]) {
      await expect(editCardButton(page, card.number)).toHaveAccessibleName(`Edit card ${card.number}, ${card.player}`);
    }
    await expect(rowSays(BARE.number, "No Team")).toBeVisible();
    await expect(rowSays(RESOLVED.number, RESOLVED.team)).toBeVisible();
    await expect(rowSays(HELD.number, "No Team")).toHaveCount(0);
    // The held X is never written as a team: the card is teamless and badged.
    await expect(needsTeam(HELD.number, HELD.player)).toBeVisible();
    await expect(rowSays(HELD.number, HELD.listed)).toHaveCount(0);
    await expect(needsTeam(BARE.number, BARE.player)).toHaveCount(0);
    await expect(needsTeam(RESOLVED.number, RESOLVED.player)).toHaveCount(0);

    for (const card of [BARE, RESOLVED, HELD]) {
      await editCardButton(page, card.number).click();
      const drawer = page.getByRole("dialog", { name: `Card #${card.number}` });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("textbox", { name: "Card name" })).toHaveValue(card.player);
      const noTeam = drawer.getByRole("button", { name: "No Team for this card" });
      if (card === BARE) {
        await expect(noTeam).toHaveAttribute("aria-pressed", "true");
      } else {
        await expect(noTeam).toHaveAttribute("aria-pressed", "false");
      }
      if (card === RESOLVED) {
        await expect(drawer.getByRole("button", { name: `Remove team ${RESOLVED.team}` })).toBeVisible();
      } else {
        await expect(drawer.getByRole("button", { name: /^Remove team / })).toHaveCount(0);
      }
      await drawer.getByRole("button", { name: "Show features editor" }).click();
      await expect(drawer.getByRole("button", { name: "Value for Prospect Card", pressed: true })).toBeVisible();
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
    await expect(rowSays(RESOLVED.number, RESOLVED.team)).toBeVisible();

    // ── 5. Clean up: the three cards go ──
    for (const card of [BARE, RESOLVED, HELD]) {
      await deleteCardButton(page, card.number).click();
      await confirmDeleteCardButton(page, card.number).click();
      await expect(editCardButton(page, card.number)).toHaveCount(0);
    }
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  },
);
