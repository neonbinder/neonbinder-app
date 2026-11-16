// R1 (NEO-569): a set's League is a list of NB leagues, and each card carries
// its own saved, editable league. It replaces the retired sport-level League
// feature spec (League is no longer a free-text feature on the Sport row).
//
// The flow, on a hand-made set `lgm<token>` under the REAL Baseball > 2024 >
// Topps (no marketplace id anywhere beneath it; R7a, SET-REGISTRY.md `lgm`):
// - the set is born with Major League Baseball (the sport's default, LINKED
//   from the catalogue, never created);
// - "Add league" offers the sport's other leagues and adds NCAA: the set now
//   lists both, saved at once ("Saved League");
// - a hand-added card whose team plays in NCAA reads NCAA in its "Card league"
//   select; changing its team to one in Major League Baseball changes it;
// - an explicit pick in "Card league" (a third league) is NB data and sticks
//   after a reload;
// - the NCAA chip is removed from the set.
// axe (light and dark) on the set's League row with both chips and on the
// card drawer with its league.
//
// The two teams are minted (single tokens, never looked up: teams are not
// enriched on creation) and each is given an EXISTING catalogue league, so the
// spec creates no league and nothing for the enrichment recording to answer.
// Every team and the set stand afterwards (no delete-team or delete-set
// affordance); the card is deleted at the end and by the failure hook.
//
// R9: drills are `drillToCustom`; the card goes in through
// `addCardViaForm`, and its handles come from `support/cards`.
import type { Locator, Page } from "@playwright/test";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, openAttributesPanel, setBuilderReady, type CustomTarget } from "../../support/set-builder";

const MLB = "Major League Baseball";
const NCAA = "NCAA";
// A third Baseball league of the reference catalogue, picked by hand on the card.
const KBO = "KBO League";

/** The set row's League group in the attributes panel. */
const leagueGroup = (page: Page) =>
  page.getByRole("region", { name: "Set attributes panel" }).getByRole("group", { name: "League", exact: true });

/** The chip of a league in the group's list, by the league's full name (the chip's own text for a screen reader). */
const chipOf = (group: Locator, league: string) => group.getByRole("listitem").filter({ hasText: league });

/** What the body wrote, so the failure hook can take the card back. */
const written: { build?: CustomTarget; card?: string } = {};

// A red run must not leave its card in the checklist. A page of its own, in
// front, so the failure's screenshot and ARIA snapshot still show the body.
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const { build, card } = written;
  written.build = undefined;
  written.card = undefined;
  if (!build || !card) return;
  const clean = await context.newPage();
  await clean.bringToFront();
  try {
    await drillToCustom(clean, build);
    const edit = editCardButton(clean, card);
    const empty = clean.getByRole("button", { name: "Open add card form" });
    // The body added the card, or died before it did: the checklist settles on one of the two.
    await expect(edit.or(empty)).toBeVisible();
    if (await edit.isVisible()) {
      await deleteCardButton(clean, card).click();
      await confirmDeleteCardButton(clean, card).click();
      await expect(edit).toBeHidden();
    }
  } finally {
    await clean.close();
  }
});

test(
  "Set League is a list: a set is born with its sport's league, 'Add league' adds another, a card's League follows its team and a hand pick sticks, and a chip is removed",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SET = `lgm${T}`;
    const number = `569-${env.ATTEMPT_ID}`;
    const ncaaTeam = `LGN${T}`;
    const mlbTeam = `LGB${T}`;
    const setRow: CustomTarget = { sport: "Baseball", year: "2024", manufacturer: "Topps", set: SET };
    const build: CustomTarget = { ...setRow, variantType: "Insert", variant: "Base" };

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // --- The set is born with the sport's league --------------------------------
    await drillToCustom(page, setRow);
    await expect(page.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    await openAttributesPanel(page);
    const league = leagueGroup(page);
    // League is gone from the Sport/Year/Manufacturer free-text rows: the panel has no "Value for League" any more.
    await expect(league).toBeVisible();
    await expect(page.getByLabel("Value for League")).toHaveCount(0);
    await expect(chipOf(league, MLB)).toBeVisible();
    await expect(league.getByRole("button", { name: `Remove ${MLB}` })).toBeVisible();

    // --- Add NCAA: both leagues, saved at once ---------------------------------
    const add = league.getByRole("combobox", { name: "Add league" });
    await add.click();
    const suggestions = page.getByRole("listbox", { name: "Add league suggestions" });
    // The league the set already has is not offered again; the sport's others are.
    await expect(suggestions.getByRole("option", { name: new RegExp(`^${MLB}`) })).toHaveCount(0);
    await add.fill("NCAA");
    await suggestions.getByRole("option", { name: new RegExp(`^${NCAA}`) }).click();
    await expect(page.getByText("Saved League").first()).toBeVisible();
    await expect(chipOf(league, NCAA)).toBeVisible();
    await expect(chipOf(league, MLB)).toBeVisible();
    await expectAccessible(page, { label: "Set attributes panel, League row with two leagues" });

    // --- A card whose team plays in NCAA reads NCAA ----------------------------
    await drillToCustom(page, build);

    /** Create team `name` in the open picker's New Team dialog, in an EXISTING catalogue league. */
    async function createTeam(name: string, leagueName: string, leagueOption: RegExp) {
      await page.getByRole("button", { name: "Add team" }).click();
      await page.getByRole("textbox", { name: "Search teams" }).fill(name);
      await page.getByRole("button", { name: `New team ${name}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `New team: ${name}` });
      await expect(dialog.getByRole("textbox", { name: "New team name" })).toHaveValue(name);
      const leagueField = dialog.getByRole("combobox", { name: "League" });
      await leagueField.fill(leagueName);
      await dialog.getByRole("option", { name: leagueOption }).click();
      await expect(leagueField).toHaveValue(leagueName);
      await dialog.getByRole("button", { name: `Create team ${name}` }).click();
      await expect(page.getByRole("button", { name: `Remove team ${name}`, exact: true })).toBeVisible();
    }

    await addCardViaForm(page, {
      cardNumber: number,
      playerName: `LeagueCard${T}`,
      beforeSubmit: () => createTeam(ncaaTeam, NCAA, new RegExp(`^${NCAA}`)),
    });
    written.build = build;
    written.card = number;

    await editCardButton(page, number).click();
    const drawer = page.getByRole("dialog", { name: `Card #${number}`, exact: true });
    await expect(drawer).toBeVisible();
    const cardLeague = drawer.getByRole("combobox", { name: "Card league" });
    await expect(drawer.getByRole("button", { name: `Remove team ${ncaaTeam}`, exact: true })).toBeVisible();
    await expect(cardLeague).toHaveValue(NCAA);
    await expectAccessible(page, { within: drawer, label: "Card drawer, League taken from an NCAA team" });

    // --- Change the team to one in Major League Baseball: the card's League follows -
    await drawer.getByRole("button", { name: `Remove team ${ncaaTeam}`, exact: true }).click();
    await expect(drawer.getByRole("button", { name: `Remove team ${ncaaTeam}`, exact: true })).toBeHidden();
    await createTeam(mlbTeam, MLB, new RegExp(`^${MLB}$`));
    await expect(cardLeague).toHaveValue(MLB);

    // --- A hand pick sticks (a league none of its teams plays in), and survives a reload ---
    await cardLeague.click();
    await drawer.getByRole("option", { name: new RegExp(`^${KBO}`) }).click();
    await expect(drawer.getByRole("status").filter({ hasText: "Saved League" })).toBeVisible();
    await expect(cardLeague).toHaveValue(KBO);
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    await page.reload();
    await expect(editCardButton(page, number)).toBeVisible();
    await editCardButton(page, number).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: `Remove team ${mlbTeam}`, exact: true })).toBeVisible();
    await expect(drawer.getByRole("combobox", { name: "Card league" })).toHaveValue(KBO);
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();

    // --- Cleanup: the card goes, so no checklist carries it ---------------------
    await deleteCardButton(page, number).click();
    await confirmDeleteCardButton(page, number).click();
    await expect(editCardButton(page, number)).toBeHidden();
    await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
    written.card = undefined;

    // --- Remove the NCAA chip from the set --------------------------------------
    await drillToCustom(page, setRow);
    await openAttributesPanel(page);
    await expect(chipOf(leagueGroup(page), NCAA)).toBeVisible();
    await leagueGroup(page).getByRole("button", { name: `Remove ${NCAA}` }).click();
    await expect(page.getByText("Saved League").first()).toBeVisible();
    await expect(chipOf(leagueGroup(page), NCAA)).toHaveCount(0);
    await expect(chipOf(leagueGroup(page), MLB)).toBeVisible();
  },
);
