// ONE FEATURE (NEO-602): when the card's player cannot say which of two eras a
// printed team name means, the review ASKS the operator; nothing links it, and
// the card gets only the team the operator picks.
//
// The two-era club, minted as in checklist-team-name-on-two-eras-follows-the-player:
// `Loc<token> Ath<token>` (1968–2024, the name is its own) and `Ath<token>`
// (2025–present, which holds that name as an alias). Every card is in a 2025
// set and prints the OLDER team's full name. Two outcomes the rule leaves to
// the operator (lib/teams/team-era.ts `pickCardTeam`):
//   (a) "option A": the player has NO stints. The year alone would pick the
//       newer team, but only through its alias while the older team holds the
//       name as its own, so the rule refuses the guess;
//   (b) the player has stints on BOTH eras: the players' evidence is a tie.
// Each is its own one-card set: the review asks one question per printed
// name, so one sync could carry only one of the two answers. For each, the
// negative (no "linked for you", the wizard not on Save) is paired with the
// positive (the name's own team step, asked); the operator then picks a
// DIFFERENT era in each case, and the card carries exactly that team.
// (The positive outcome, a player with a stint on one era, is the sibling spec.)
//
// Fixtures through the UI (GUIDE "Fixtures come from the UI"), all in this
// attempt's private sport `aeq<token>` (SET-REGISTRY "Custom sets"), year
// 2025, brand Topps, sets `aen<token>` and `aeb<token>` with Insert > Base,
// no marketplace ids. Both players and both teams are made in Player
// Management: a minted player in a sport with no `sportConfig.wikidata` makes
// no lookup, and teams are never looked up on creation. The cards come from
// pasted one-row publisher's checklists, fetched with the checklist as their
// only source (NEO-496 D10). Every name carries the attempt token, so the spec
// re-runs on the same seed.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns
// to the first set's empty checklist.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded } from "../../support/players";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { advanceToSave, confirmSaveButton, reviewWizard, stepCounter } from "../../support/wizard";
import type { Page } from "@playwright/test";

/**
 * Sync the open (empty) checklist from one pasted row, and prove the review
 * ASKS about `team`: its own team step, nothing linked, not on Save.
 */
async function syncAndExpectTheTeamAsked(page: Page, row: string, team: string, axeLabel: string) {
  const facts = await usePastedChecklist(page, `number,player,team\n${row}`, 1);
  expect(facts.rows).toBe(1);
  await syncChecklistButton(page).click();
  const wizard = reviewWizard(page);
  await expect(wizard).toBeVisible();
  // Positive: the printed name's own team step, the first and only question.
  await expect(wizard.getByRole("heading", { level: 3, name: `New Team: ${team}` })).toBeVisible();
  await expect(stepCounter(page)).toHaveText(/^Step 1 of [0-9]+$/);
  await expect(wizard.getByRole("group", { name: "Link to existing team" })).toBeVisible();
  // Negative, read against the step above: nothing was linked for the operator.
  await expect(page.getByText(/names? (was|were) linked for you/)).toHaveCount(0);
  await expect(wizard.getByText("Ready to save", { exact: true })).toHaveCount(0);
  await expectAccessible(page, { within: wizard, label: axeLabel });
  return wizard;
}

/** The operator links the step to the team whose option name starts with `pick`, then saves. */
async function linkAndSave(page: Page, team: string, pick: string, search: string) {
  const wizard = reviewWizard(page);
  // Untick the remember-box first (the link is the claim here, not an alias).
  const remember = wizard.getByRole("checkbox", { name: `Remember “${team}” as a name for this team` });
  await remember.uncheck();
  await expect(remember).not.toBeChecked();
  const combo = wizard.getByRole("combobox", { name: "Search all teams" });
  await combo.fill(search);
  await expect(combo).toHaveValue(search);
  const escaped = pick.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("option", { name: new RegExp(`^${escaped}`) }).click();
  await expect(wizard.getByRole("heading", { level: 3, name: `New Team: ${team}` })).toBeHidden();
  await advanceToSave(page);
  await expect(wizard.getByText(`Linked to ${pick}`, { exact: true })).toBeVisible();
  await confirmSaveButton(page).click();
  await expect(page.getByText(/Saved 1 card/).first()).toBeVisible();
}

/** The committed card #1 carries `has` and not `hasNot`. */
async function expectCardTeam(page: Page, has: string, hasNot: string, axeLabel: string) {
  await expect(editCardButton(page, "1")).toBeVisible();
  await editCardButton(page, "1").click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: `Remove team ${has}`, exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: `Remove team ${hasNot}`, exact: true })).toHaveCount(0);
  await expectAccessible(page, { within: drawer, label: axeLabel });
  await page.getByRole("button", { name: "Done editing card" }).click();
  await expect(drawer).toBeHidden();
}

test(
  "Entity review — a printed team name that fits two eras is asked of the operator when the card's player has no stints, or stints on both",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aeq${T}`;
    const SET_NONE = `aen${T}`;
    const SET_BOTH = `aeb${T}`;
    const NO_STINTS = `Nos Ahq${T}`;
    const BOTH_ERAS = `Bot Ahq${T}`;
    const OLD = `Loc${T} Ath${T}`; // 1968–2024: the name is its own
    const NEW = `Ath${T}`; // 2025–present: the name is its alias
    const target = (set: string) => ({ sport: SPORT, year: "2025", manufacturer: "Topps", set, variantType: "Insert", variant: "Base" });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── PART 1: the first hand-made 2025 set, its Base checklist empty ──
    await drillToCustom(page, target(SET_NONE));
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── PART 2: the two eras, a player with a stint on each, and a player with none ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, BOTH_ERAS, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    const addTeam = page.getByRole("button", { name: "Add team" });
    const search = page.getByRole("textbox", { name: "Search teams" });
    const stintFrom = page.getByLabel(/Stint from year/);
    const stintTo = page.getByLabel(/Stint to year/);
    const addStint = page.getByRole("button", { name: "Add stint" });
    const stints = page.getByRole("list", { name: "Career history" }).getByRole("listitem");

    // The newer team, wearing the older team's full name as an alias; his 2025 stint on it.
    await addTeam.click();
    await search.fill(NEW);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const newDialog = page.getByRole("dialog", { name: `New team: ${NEW}` });
    await expect(newDialog).toBeVisible();
    await newDialog.getByLabel("New team active from (optional)").fill("2025");
    await newDialog.getByRole("textbox", { name: "New team aliases (optional)" }).fill(OLD);
    await newDialog.getByRole("button", { name: `Create team ${NEW}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${NEW}`, exact: true })).toBeVisible();
    await page.getByRole("heading", { name: "Career history" }).click(); // closes the typeahead
    await stintFrom.fill("2025");
    await stintTo.fill("2025");
    await addStint.click();
    await expect(stints).toHaveCount(1);
    await expect(stints.first()).toContainText(`${NEW} · 2025–2025`);

    // The older team (its token now finds the newer team, so the search types
    // one nothing answers to and the dialog's Name is set); his 1979–1984 stint on it.
    await addTeam.click();
    await search.fill(`Zzz${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const oldDialog = page.getByRole("dialog", { name: `New team: Zzz${T}` });
    await expect(oldDialog).toBeVisible();
    await oldDialog.getByRole("textbox", { name: "New team name" }).fill(NEW);
    await oldDialog.getByRole("textbox", { name: "New team location (optional)" }).fill(`Loc${T}`);
    await oldDialog.getByLabel("New team active from (optional)").fill("1968");
    await oldDialog.getByLabel("New team active to").fill("2024");
    // The name is already answered to (the newer team's alias): the dialog says
    // so, and the second Create confirms (the sibling spec reads this alert).
    const createOld = oldDialog.getByRole("button", { name: `Create team ${OLD}` });
    await createOld.click();
    await expect(oldDialog.getByRole("alert").filter({ hasText: /Create again to add it as its own team\./ })).toBeVisible();
    await createOld.click();
    await expect(page.getByRole("button", { name: `Remove team ${OLD}` })).toBeVisible();
    await page.getByRole("heading", { name: "Career history" }).click();
    await stintFrom.fill("1979");
    await stintTo.fill("1984");
    await addStint.click();
    await expect(stints).toHaveCount(2);
    await expect(stints.filter({ hasText: `${OLD} · 1979–1984` })).toHaveCount(1);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${BOTH_ERAS}`))).toBeVisible();

    // The player with no stints at all (option A).
    await addPlayerByHand(page, NO_STINTS, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    // Back: the set builder, on the first set's empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── PART 3 (a): no stints. Asked; the operator picks the older era ──
    await syncAndExpectTheTeamAsked(
      page,
      `1,${NO_STINTS},${OLD}`,
      OLD,
      "Entity review wizard, two-era team name asked (player with no stints)",
    );
    await linkAndSave(page, OLD, OLD, `Loc${T}`);
    await expectCardTeam(page, OLD, NEW, "Card drawer, the operator's era (no stints)");

    // ── PART 4 (b): stints on both eras. Asked; the operator picks the newer era ──
    await drillToCustom(page, target(SET_BOTH));
    await expect(empty).toBeVisible();
    await syncAndExpectTheTeamAsked(
      page,
      `1,${BOTH_ERAS},${OLD}`,
      OLD,
      "Entity review wizard, two-era team name asked (player on both eras)",
    );
    // The search types the newer team's own name; its option starts with it,
    // the older team's starts with its location.
    await linkAndSave(page, OLD, NEW, NEW);
    await expectCardTeam(page, NEW, OLD, "Card drawer, the operator's era (both eras)");
  },
);
