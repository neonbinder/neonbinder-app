// NEO-591 (R1): a checklist team cell "Prospect" or "Prospect (X)" makes the card a Prospect
// Card, and X is a team only when it names exactly one minor-league or college team; a team cell
// printed as a PLACE settles only when exactly one team in the set's league is located there:
//   - "Prospect" alone: the card is No Team (a claim, never asked);
//   - "Prospect (Oklahoma)": Oklahoma is the place of exactly one college team on file, the
//     Oklahoma Sooners (NCAA), so the card carries that team;
//   - "Prospect (Dallas Baptist)": no minor or college team on file answers to it, so the card
//     is HELD (product invariant 8): the Teams step asks, shows X as "Listed as: Dallas Baptist",
//     pre-fills nothing (not even the player's own big-league club) and offers only "No team"
//     and "Leave for later". Its "Remember “X” as a name for this team" box is held (disabled,
//     unticked) until ONE existing team is picked: the spec mints that team from the line's own
//     "Other team…" field, ticks the box, saves, and reads the alias back on Team Management,
//     then takes it out again (the alias would otherwise settle the next attempt's X);
//   - "Seattle": the set's league is Major League Baseball and exactly one MLB team is located in
//     Seattle, so the card commits with the Seattle Mariners and is never asked (no name step, no
//     Teams-step line);
//   - "Chicago": two MLB teams are located there, so nothing settles it. It is asked as a team
//     name ("New Team: Chicago"), nothing linked, and its "Remember" box settles UNTICKED (a bare
//     place is not a name to remember). Skipped as not a team, the card is left on the Teams step
//     with nothing pre-filled ("Leave for later") and saved teamless.
// The leaf's checklist preview reads each claim as printed ("Prospect", "Prospect (X)", the
// place), never "We'll look it up": none of these cards is looked up.
//
// The fixture is a 5-row CSV (fixtures/checklists/prospect-team-cells.csv) of catalogue players
// the seed already holds (2024 Topps Chrome Base names, each one player on file, so no player
// step and no lookup), uploaded through the leaf's "Add the official checklist" and synced: a
// checklist-only fetch (the set has no marketplace id; the checklist is the one source).
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `psp`): ONE hand-made set per attempt, `psp<token>`, under
// the REAL `Baseball` › 2024 › `Topps` (the team and player lookups read the set's sport and
// league, so not a custom sport), `Insert` › `Base`. No marketplace id anywhere beneath it. The
// five cards are COMMITTED, read back and DELETED at the end; one team is minted per attempt
// (`Dbp<token>`, it stays, like every minted row) and its remembered alias is removed again; the
// catalogue's players, the Oklahoma Sooners and the Seattle Mariners are only read. The set and
// its rows stand (per attempt, read by no other spec).
//
// Desktop and mobile: one spec, no branch (role and label locators; click() scrolls).
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
import { expectTeamsLoaded, teamsCounter } from "../../support/players";
import {
  matchCardsDialog,
  previewRowCount,
  publishersChecklistButton,
  publishersChecklistChip,
  publishersChecklistDialog,
} from "../../support/published-checklist";
import { confirmSaveButton, nextStepButton, reviewWizard, stepCounter, tidyUpName } from "../../support/wizard";
import type { Page } from "@playwright/test";

const FILE = new URL("../../fixtures/checklists/prospect-team-cells.csv", import.meta.url).pathname;
/** The file's rows: number, player, and what its team cell says. */
const BARE = { number: "1", player: "Gunnar Henderson", cell: "Prospect" };
const RESOLVED = { number: "2", player: "Colt Keith", cell: "Prospect (Oklahoma)", team: "Oklahoma Sooners" };
const HELD = { number: "3", player: "Bobby Witt Jr.", cell: "Prospect (Dallas Baptist)", listed: "Dallas Baptist" };
const PLACE = { number: "4", player: "J.P. Crawford", cell: "Seattle", team: "Seattle Mariners" };
const AMBIGUOUS = { number: "5", player: "Seiya Suzuki", cell: "Chicago" };
const CARDS = [BARE, RESOLVED, HELD, PLACE, AMBIGUOUS];
const ROWS = CARDS.length;

/** The admin Team Management page, filtered to `query` (as checklist-wizard-link-team-saves-alias does). */
async function openTeam(page: Page, query: string) {
  await page.goto("/admin/teams");
  await expectTeamsLoaded(page);
  await page.getByRole("textbox", { name: "Filter teams" }).fill(query);
  await expect(teamsCounter(page, "1 match")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(escapeRe(query)) }).click();
}

test(
  "Checklist Prospect and place team cells — every Prospect row is a Prospect Card; bare Prospect is No Team, Prospect (X) takes X's one college team, an unknown X is held and can be remembered once a team is picked, and a place settles only on its one team (NEO-591)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `psp${env.ATTEMPT_TOKEN}`;
    /** The team picked for the held card, minted from the Teams step's own field. */
    const picked = `Dbp${env.ATTEMPT_TOKEN}`;
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
    await dialog.getByLabel("Choose a file").setInputFiles(FILE);
    await expect(previewRowCount(dialog, ROWS)).toBeVisible();
    const previewRows = dialog.getByRole("table", { name: "Preview of the rows the sync will use" });
    // Each row found by its own name (number, player, team cell), then its cells exactly.
    for (const card of CARDS) {
      const row = previewRows.getByRole("row", { name: `${card.number} ${card.player} ${card.cell}`, exact: true });
      await expect(row.getByRole("cell")).toHaveText([card.number, card.player, card.cell]);
    }
    await expect(previewRows.getByText("We'll look it up")).toHaveCount(0);
    await expectAccessible(page, { within: dialog, label: "Official checklist preview with Prospect and place team cells" });
    await dialog.getByRole("button", { name: "Use this checklist" }).click();
    await expect(dialog).toBeHidden();
    await expect(publishersChecklistChip(page, ROWS)).toBeVisible();

    // ── 2. Sync: one source, so no Match Cards. Three steps: Chicago, the teams, the save ──
    await syncChecklistButton(page).click();
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAccessibleName(tidyUpName({ year: target.year, set }));
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // Seattle settled before the wizard opened (no step of its own); Chicago did not.
    await expect(stepCounter(page)).toHaveText("Step 1 of 3");
    await expect(wizard.getByRole("heading", { level: 3, name: `New Team: ${AMBIGUOUS.cell}`, exact: true })).toBeVisible();
    const linkTo = wizard.getByRole("group", { name: "Link to existing team" });
    await expect(linkTo.getByRole("combobox", { name: "Search all teams" })).toHaveValue("");
    // The box is held while the place lookup runs, then settles unticked: a place is no team's name.
    const rememberPlace = linkTo.getByRole("checkbox", { name: `Remember “${AMBIGUOUS.cell}” as a name for this team`, exact: true });
    await expect(rememberPlace).toBeEnabled();
    await expect(rememberPlace).not.toBeChecked();
    await wizard.getByRole("button", { name: `Skip ${AMBIGUOUS.cell} — not a team`, exact: true }).click();

    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
    await expect(stepCounter(page)).toHaveText("Step 2 of 3");
    // The held card and the Chicago card; the bare Prospect is answered No Team, and Oklahoma and
    // Seattle have their teams.
    const lines = wizard.getByRole("listitem");
    await expect(lines).toHaveCount(2);
    await expect(lines.filter({ hasText: PLACE.player })).toHaveCount(0);
    const held = lines.filter({ hasText: `#${HELD.number} · ${HELD.player}` });
    await expect(held.getByText(`Listed as: ${HELD.listed}`, { exact: true })).toBeVisible();
    const choices = held.getByRole("radiogroup", { name: `Team for ${HELD.player}` });
    // Nothing pre-filled: no team is offered (Dallas Baptist is no minor or college team on file,
    // and his big-league club is never a prospect's choice), and the line stays "Leave for later".
    await expect(choices.getByRole("radio")).toHaveCount(2);
    await expect(choices.getByRole("radio", { name: `No team on this card — ${HELD.player}` })).not.toBeChecked();
    await expect(choices.getByRole("radio", { name: `Leave for later — ${HELD.player}` })).toBeChecked();
    // Remembering X as a team's name waits for exactly one existing team to be picked.
    const remember = held.getByRole("checkbox", {
      name: `Remember “${HELD.listed}” as a name for this team — ${HELD.player}`,
      exact: true,
    });
    await expect(remember).not.toBeChecked();
    await expect(remember).toBeDisabled();
    // The Chicago card: a team is offered (his Cubs), none is picked.
    const chicago = lines.filter({ hasText: `#${AMBIGUOUS.number} · ${AMBIGUOUS.player}` });
    const chicagoChoices = chicago.getByRole("radiogroup", { name: `Team for ${AMBIGUOUS.player}` });
    await expect(chicagoChoices.getByRole("radio", { name: `Chicago Cubs — ${AMBIGUOUS.player}`, exact: true })).not.toBeChecked();
    await expect(chicagoChoices.getByRole("radio", { checked: true })).toHaveAccessibleName(`Leave for later — ${AMBIGUOUS.player}`);
    await expect(chicago.getByRole("checkbox")).toHaveCount(0);
    await expectAccessible(page, { within: wizard, label: "Tidy-up teams step with a held Prospect (X) card" });

    // The held card's team: one existing team, minted here through the line's own field.
    await held.getByRole("button", { name: `Other team… — ${HELD.player}`, exact: true }).click();
    await held.getByRole("combobox", { name: "Team name to find" }).fill(picked);
    await page.getByRole("listbox", { name: "Team name to find suggestions" }).getByRole("option", { name: `+ New team “${picked}”…`, exact: true }).click();
    const newTeam = page.getByRole("dialog", { name: `New team: ${picked}` });
    await expect(newTeam.getByRole("textbox", { name: "New team name" })).toHaveValue(picked);
    await newTeam.getByRole("button", { name: `Create team ${picked}`, exact: true }).click();
    await expect(newTeam).toBeHidden();
    await expect(choices.getByRole("radio", { name: `${picked} — ${HELD.player}`, exact: true })).toBeChecked();
    await expect(remember).toBeEnabled();
    await expect(remember).not.toBeChecked();
    await expectAccessible(page, { within: wizard, label: "Tidy-up teams step, a held card's Remember box offered" });
    await remember.check();
    await expect(remember).toBeChecked();

    // ── 3. Save ──
    await nextStepButton(page).click();
    await expect(wizard.getByRole("heading", { name: `Save ${ROWS} cards?` })).toBeVisible();
    await confirmSaveButton(page).click();
    await expect(wizard).toBeHidden();
    await expect(page.getByText(`Saved ${ROWS} cards. Teams from your checklist: ${ROWS} of ${ROWS} cards.`)).toBeVisible();

    // ── 4. Read back: the rows, then each card's drawer ──
    for (const card of CARDS) {
      await expect(editCardButton(page, card.number)).toHaveAccessibleName(`Edit card ${card.number}, ${card.player}`);
    }
    await expect(rowSays(BARE.number, "No Team")).toBeVisible();
    await expect(rowSays(RESOLVED.number, RESOLVED.team)).toBeVisible();
    await expect(rowSays(HELD.number, picked)).toBeVisible();
    await expect(rowSays(PLACE.number, PLACE.team)).toBeVisible();
    // The held X is never written as a team, and Chicago was left: that card alone is badged.
    await expect(rowSays(HELD.number, HELD.listed)).toHaveCount(0);
    await expect(needsTeam(AMBIGUOUS.number, AMBIGUOUS.player)).toBeVisible();
    for (const card of [BARE, RESOLVED, HELD, PLACE]) await expect(needsTeam(card.number, card.player)).toHaveCount(0);

    const teamOn: Record<string, string | undefined> = {
      [RESOLVED.number]: RESOLVED.team,
      [HELD.number]: picked,
      [PLACE.number]: PLACE.team,
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
      const team = teamOn[card.number];
      if (team === undefined) {
        await expect(drawer.getByRole("button", { name: /^Remove team / })).toHaveCount(0);
      } else {
        await expect(drawer.getByRole("button", { name: /^Remove team / })).toHaveAccessibleName(`Remove team ${team}`);
      }
      // A Prospect row makes a Prospect Card; a place row does not.
      const prospect = card === PLACE || card === AMBIGUOUS ? "false" : "true";
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
    await expect(rowSays(RESOLVED.number, RESOLVED.team)).toBeVisible();

    // ── 5. Clean up the cards ──
    for (const card of CARDS) {
      await deleteCardButton(page, card.number).click();
      await confirmDeleteCardButton(page, card.number).click();
      await expect(editCardButton(page, card.number)).toHaveCount(0);
    }
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 6. The remembered name: on the picked team, then taken out again ──
    await openTeam(page, picked);
    const aka = page.getByRole("textbox", { name: "Also known as" });
    const currentAliases = page.getByRole("list", { name: "Current aliases" });
    await expect(aka).toHaveValue(HELD.listed);
    await expect(currentAliases.getByText(HELD.listed, { exact: true })).toBeVisible();
    await aka.clear();
    await expect(currentAliases).toBeHidden();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${picked}`)).toBeVisible();
    await openTeam(page, picked);
    await expect(aka).toHaveValue("");
  },
);
