// ONE FEATURE (NEO-602, the Orioles fix): when a printed team name fits two
// eras, a card whose player has NO stint on either abstains, so long as the
// cards that do speak point at the era the set's year covers. The name links
// silently: no team step and no "linked for you" decision for it, and every
// card carries the current era. The wizard still opens, on NEO-574's Career
// check alone, because the silent card's player has no career on file: that
// step lists him on the CURRENT era (the team his card got), the line opening
// on "Add to career" with that era staged (NEO-591), and answered "Keep as is"
// it writes nothing.
//
// The Orioles shape, minted: `Bal<token> Ori<token>` (1954–present) is the
// current era and holds the printed name as its own; `Mil<token> Bre<token>`
// (1901–1902) is the past era and answers to the same name as an alias. A 2025
// set prints `Bal<token> Ori<token>` on two cards: #1's player has a stint on
// the current era (a voter), #2's player has no stints at all (a recent trade
// whose stints lag). The voter's era is the year's own pick, so the silent card
// abstains (lib/teams/team-era.ts `pickCardTeam`, rule 3) and nothing is asked.
// Against the year the silent card would send the name to the operator (unit
// tests); the sibling specs cover the asked shapes
// (checklist-two-era-team-name-asks-the-operator) and the player's era against
// the year (checklist-team-name-on-two-eras-follows-the-player).
//
// Why the past era holds the name as an ALIAS and not as its own name: no card
// surface prints a team's era (the drawer's chip and the row's sub-line print
// the full name only; see checklist-wizard-past-era-team-link-commits), so two
// rows of one full name could not be told apart on the committed card. With
// different own names the drawer proves WHICH era the cards carry. The rule's
// players step reads eras and stints only, never how the name was reached.
//
// Fixtures through the UI (GUIDE "Fixtures come from the UI"), all in this
// attempt's private sport `aeo<token>` (SET-REGISTRY "Custom sets"), year
// 2025, brand Topps, ONE set `aeu<token>` with Insert > Base, no marketplace
// ids. Both players and both teams are made in Player Management: a minted
// player in a sport with no `sportConfig.wikidata` makes no lookup, and teams
// are never looked up on creation. The cards come from a pasted two-row
// publisher's checklist, fetched with the checklist as its only source
// (NEO-496 D10). Every name carries the attempt token, so the spec re-runs on
// the same seed.
//
// Back (house rule): the set builder -> Players is a navigation; Back returns
// to the set builder with the drill and the empty checklist restored.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded } from "../../support/players";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  advanceToSave,
  CAREER_STEP_SUBTITLE,
  careerLine,
  confirmSaveButton,
  reviewWizard,
  stepCounter,
  tidyUpName,
} from "../../support/wizard";

test(
  "Entity review — a printed team name that fits two eras links silently to the year's era when the only players with stints played there, and a card whose player has none abstains",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aeo${T}`;
    const SET = `aeu${T}`;
    const VOTER = `Cur Aho${T}`; // a stint on the current era
    const SILENT = `Sil Aho${T}`; // no stints at all
    const CURRENT = `Bal${T} Ori${T}`; // 1954–present: the name is its own
    const PAST = `Mil${T} Bre${T}`; // 1901–1902: the name is its alias

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── PART 1: the hand-made 2025 set, its Base checklist empty ──
    await drillToCustom(page, { sport: SPORT, year: "2025", manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── PART 2: the two eras, a player with a stint on the current one, a player with none ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, VOTER, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    const addTeam = page.getByRole("button", { name: "Add team" });
    const search = page.getByRole("textbox", { name: "Search teams" });

    // The past era, wearing the current era's full name as an alias (no row holds it yet).
    await addTeam.click();
    await search.fill(`Bre${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const pastDialog = page.getByRole("dialog", { name: `New team: Bre${T}` });
    await expect(pastDialog).toBeVisible();
    await pastDialog.getByRole("textbox", { name: "New team location (optional)" }).fill(`Mil${T}`);
    await pastDialog.getByLabel("New team active from (optional)").fill("1901");
    await pastDialog.getByLabel("New team active to").fill("1902");
    await pastDialog.getByRole("textbox", { name: "New team aliases (optional)" }).fill(CURRENT);
    await pastDialog.getByRole("button", { name: `Create team ${PAST}` }).click();
    const pastChip = page.getByRole("button", { name: `Remove team ${PAST}`, exact: true });
    await expect(pastChip).toBeVisible();
    // A pick, not a stint: no player has a stint on the past era.
    await pastChip.click();
    await expect(pastChip).toBeHidden();

    // The current era. Its tokens now find the past era (by its alias), so the
    // search types one nothing answers to and the dialog's Name is set
    // (admin-teams-two-eras). The name is already answered to, so the dialog
    // says which team holds it and the second Create confirms.
    await addTeam.click();
    await search.fill(`Zzz${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const currentDialog = page.getByRole("dialog", { name: `New team: Zzz${T}` });
    await expect(currentDialog).toBeVisible();
    await currentDialog.getByRole("textbox", { name: "New team name" }).fill(`Ori${T}`);
    await currentDialog.getByRole("textbox", { name: "New team location (optional)" }).fill(`Bal${T}`);
    await currentDialog.getByLabel("New team active from (optional)").fill("1954");
    const createCurrent = currentDialog.getByRole("button", { name: `Create team ${CURRENT}` });
    await createCurrent.click();
    await expect(
      currentDialog.getByRole("alert").filter({ hasText: `${PAST} · 1901–1902 already answers to this name as an alias.` }),
    ).toBeVisible();
    await createCurrent.click();
    await expect(page.getByRole("button", { name: `Remove team ${CURRENT}`, exact: true })).toBeVisible();

    // The voter's stint on the current era, 2023–2025, saved.
    await page.getByRole("heading", { name: "Career history" }).click(); // closes the typeahead
    await page.getByLabel(/Stint from year/).fill("2023");
    await page.getByLabel(/Stint to year/).fill("2025");
    await page.getByRole("button", { name: "Add stint" }).click();
    const stints = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(stints).toHaveCount(1);
    await expect(stints.first()).toContainText(`${CURRENT} · 2023–2025`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${VOTER}`))).toBeVisible();

    // The silent player: no stints at all.
    await addPlayerByHand(page, SILENT, SPORT);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    // Back: the set builder, on the same empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── PART 3: two cards print the name; no team is asked, only the Career check opens ──
    const facts = await usePastedChecklist(page, `number,player,team\n1,${VOTER},${CURRENT}\n2,${SILENT},${CURRENT}`, 2);
    expect(facts.rows).toBe(2);
    await syncChecklistButton(page).click();
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAccessibleName(tidyUpName({ year: "2025", set: SET }));
    // Positive: the wizard opens straight on the Career check (nothing decided
    // before it, so x is 1), and its one line is the silent card's player on the
    // CURRENT era: the team the name linked to, by its own name.
    await expect(wizard.getByRole("heading", { level: 3, name: `${CAREER_STEP_SUBTITLE} · 1 to look at` })).toBeVisible();
    await expect(stepCounter(page)).toHaveText(/^Step 1 of [0-9]+$/);
    const line = careerLine(page, SILENT, CURRENT);
    await expect(line).toBeVisible();
    // NEO-591: the line OPENS on "Add to career" with the card's team staged, and
    // that team is the CURRENT era: a past set (2025) stages a closed stint.
    await expect(line.getByRole("radio", { name: "Add to career" })).toBeChecked();
    await expect(
      wizard.getByRole("list", { name: `Stints to add for ${SILENT}` }).getByRole("listitem"),
    ).toHaveText(new RegExp(`^${escapeRe(`${CURRENT} (2025–2025)`)}`));
    const lines = wizard.getByRole("list", { name: `${CAREER_STEP_SUBTITLE} · 1 to look at` });
    // One line: the staged stint is a list item too, nested in the line's, so
    // count the items that hold a line's answers.
    await expect(lines.getByRole("listitem").filter({ has: page.getByRole("radiogroup") })).toHaveCount(1);
    await expect(lines).toContainText("No career on file yet.");
    await expect(lines).toContainText("Cards #2");
    // Negatives, read against that step: the voter (his stint covers the team)
    // and the past era are on no line, and the printed name was neither asked
    // nor offered as a decision.
    await expect(careerLine(page, VOTER, CURRENT)).toHaveCount(0);
    await expect(careerLine(page, SILENT, PAST)).toHaveCount(0);
    await expect(wizard.getByRole("heading", { level: 3, name: /^(Which team|New Team): / })).toHaveCount(0);
    await expect(page.getByText(/names? (was|were) linked for you/)).toHaveCount(0);
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Career check after a silent two-era link" });

    // Every line answered "Keep as is" (advanceToSave's sweep), then the save.
    await advanceToSave(page);
    await expect(wizard.getByText("Save 2 cards?", { exact: true })).toBeVisible();
    await confirmSaveButton(page).click();
    await expect(page.getByText(/^Saved 2 cards\./).first()).toBeVisible();
    await expect(editCardButton(page, "1")).toBeVisible();
    await expect(editCardButton(page, "2")).toBeVisible();
    await expect(wizard).toBeHidden();
    await expectAccessible(page, { label: "Set builder, two-era team name saved" });

    // ── PART 4: both cards carry the current era, the silent card included ──
    const drawer = page.getByRole("dialog");
    for (const number of ["1", "2"]) {
      await editCardButton(page, number).click();
      await expect(drawer.getByRole("button", { name: `Remove team ${CURRENT}`, exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: `Remove team ${PAST}`, exact: true })).toHaveCount(0);
      if (number === "2") await expectAccessible(page, { within: drawer, label: "Card drawer, the silent card on the year's era" });
      await page.getByRole("button", { name: "Done editing card" }).click();
      await expect(drawer).toBeHidden();
    }
  },
);
