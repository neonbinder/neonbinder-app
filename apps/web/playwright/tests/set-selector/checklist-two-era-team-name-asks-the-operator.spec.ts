// ONE FEATURE (NEO-602): when the card's player cannot say which of two eras a
// printed team name means, the review ASKS the operator; nothing links it, and
// the card gets only the team the operator picks. The step is "Which team",
// not "New Team": it shows the card and its player (with the stints we know)
// that raised it, and offers both existing teams as one-click links, with the
// search and the New Team form kept below as the fallback.
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

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sync the open (empty) checklist from one pasted row, and prove the review
 * ASKS about `team`: its own team step ("Which team", both existing teams
 * offered, the card and its player shown), nothing linked, not on Save.
 * `stint` is the player's stint text on the step, or null for a player with
 * none (the step then says nothing is on file).
 */
async function syncAndExpectTheTeamAsked(
  page: Page,
  row: string,
  team: string,
  /** The newer team, the one that holds `team` only as an alias. */
  newer: string,
  player: string,
  stint: string | null,
  axeLabel: string,
) {
  const facts = await usePastedChecklist(page, `number,player,team\n${row}`, 1);
  expect(facts.rows).toBe(1);
  await syncChecklistButton(page).click();
  const wizard = reviewWizard(page);
  await expect(wizard).toBeVisible();
  // Positive: the printed name's own step, the first and only question. Two
  // rows answer to the name, so it is a choice and not a new team.
  await expect(wizard.getByRole("heading", { level: 3, name: `Which team: ${team}` })).toBeVisible();
  await expect(wizard.getByRole("heading", { level: 3, name: /^New Team: / })).toHaveCount(0);
  await expect(stepCounter(page)).toHaveText(/^Step 1 of [0-9]+$/);
  // Both existing teams, each by name and era, newest first.
  const candidates = wizard.getByRole("list", { name: "Teams already filed under this name" });
  const offered = candidates.getByRole("button");
  await expect(offered).toHaveCount(2);
  await expect(offered.nth(0)).toHaveAccessibleName(new RegExp(`^Link to ${escapeRe(newer)} . 2025.present`));
  await expect(offered.nth(1)).toHaveAccessibleName(new RegExp(`^Link to ${escapeRe(team)} . 1968.2024`));
  // The card that raised it and its player, with the stints we know.
  const cards = wizard.getByRole("list", { name: "Cards that print this team name" });
  await expect(cards).toContainText("#1");
  await expect(cards).toContainText(player);
  if (stint) await expect(cards).toContainText(stint);
  else await expect(cards).toContainText("Nothing on file yet");
  await expect(wizard.getByRole("group", { name: "Link to existing team" })).toBeVisible();
  // Negative, read against the step above: nothing was linked for the operator.
  await expect(page.getByText(/names? (was|were) linked for you/)).toHaveCount(0);
  await expect(wizard.getByText("Ready to save", { exact: true })).toHaveCount(0);
  await expectAccessible(page, { within: wizard, label: axeLabel });
  return wizard;
}

/** Unticks "Remember …", so the link is the claim and no alias is saved. */
async function untickRemember(page: Page, team: string) {
  const remember = reviewWizard(page).getByRole("checkbox", {
    name: `Remember “${team}” as a name for this team`,
  });
  await remember.uncheck();
  await expect(remember).not.toBeChecked();
}

/** From the answered step to the saved card. */
async function saveTheLink(page: Page, team: string, pick: string) {
  const wizard = reviewWizard(page);
  await expect(wizard.getByRole("heading", { level: 3, name: `Which team: ${team}` })).toBeHidden();
  await advanceToSave(page);
  await expect(wizard.getByText(`Linked to ${pick}`, { exact: true })).toBeVisible();
  await confirmSaveButton(page).click();
  await expect(page.getByText(/Saved 1 card/).first()).toBeVisible();
}

/** The operator links by the one-click choice: the button for the team whose label starts `label`. */
async function linkByChoice(page: Page, team: string, label: RegExp, pick: string) {
  await untickRemember(page, team);
  await reviewWizard(page).getByRole("button", { name: label }).click();
  await saveTheLink(page, team, pick);
}

/** The operator links by the fallback search, typing `search` and picking the option starting `pick`. */
async function linkBySearch(page: Page, team: string, pick: string, search: string) {
  const wizard = reviewWizard(page);
  await untickRemember(page, team);
  const combo = wizard.getByRole("combobox", { name: "Search all teams" });
  await combo.fill(search);
  await expect(combo).toHaveValue(search);
  await page.getByRole("option", { name: new RegExp(`^${escapeRe(pick)}`) }).click();
  await saveTheLink(page, team, pick);
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
      NEW,
      NO_STINTS,
      null,
      "Entity review wizard, two-era team name asked (player with no stints)",
    );
    // No player has played for either, so no reason is claimed.
    await expect(reviewWizard(page).getByText("Players on these cards don't settle which team.")).toHaveCount(0);
    // The one-click choice: the older team.
    await linkByChoice(page, OLD, new RegExp(`^Link to ${escapeRe(OLD)} . 1968.2024`), OLD);
    await expectCardTeam(page, OLD, NEW, "Card drawer, the operator's era (no stints)");

    // ── PART 4 (b): stints on both eras. Asked; the operator picks the newer era ──
    await drillToCustom(page, target(SET_BOTH));
    await expect(empty).toBeVisible();
    await syncAndExpectTheTeamAsked(
      page,
      `1,${BOTH_ERAS},${OLD}`,
      OLD,
      NEW,
      BOTH_ERAS,
      // His 1979–1984 stint on the older team, as the step prints a span.
      "1979–84",
      "Entity review wizard, two-era team name asked (player on both eras)",
    );
    // Stints on both teams: the players do not settle it, and the step says so.
    await expect(reviewWizard(page).getByText("Players on these cards don't settle which team.")).toBeVisible();
    // The fallback search: it types the newer team's own name; its option
    // starts with it, the older team's starts with its location.
    await linkBySearch(page, OLD, NEW, NEW);
    await expectCardTeam(page, NEW, OLD, "Card drawer, the operator's era (both eras)");
  },
);
