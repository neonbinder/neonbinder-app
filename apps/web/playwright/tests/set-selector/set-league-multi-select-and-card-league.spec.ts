// R1 (NEO-569): a set's League is a list of NB leagues, and each card carries
// its own saved, editable league. It replaces the retired sport-level League
// feature spec (League is no longer a free-text feature on the Sport row; the
// Sport-level panel is covered by `sport-level-attributes-panel-has-no-league`).
//
// The flow, on a hand-made set `lgm<token>` under the REAL Baseball > 2024 >
// Topps (no marketplace id anywhere beneath it; R7a, SET-REGISTRY.md `lgm`):
// - the set is born with Major League Baseball (the sport's default, LINKED
//   from the catalogue, never created);
// - a row below the set (the Base checklist) shows the set's leagues as
//   inherited, takes its own list when one is added, and "Use the set's
//   leagues" gives it back;
// - a TEAMLESS card in that one-league set reads Major League Baseball;
// - "Add league" (axe with its list open) adds NCAA to the set: the set lists
//   both. Per rule A (`cardLeague.cascadeSetLeagues`) a teamless card follows
//   the set's single league only, so with two leagues it goes BLANK, and its
//   panel says why (axe on that helper line); removing the NCAA chip at the
//   end gives it Major League Baseball back;
// - a hand-added card whose team plays in NCAA reads NCAA in "Card league";
//   changing its team to one in Major League Baseball changes it;
// - a hand pick is NB data: it sticks after a reload (axe on the drawer after
//   the pick) and holds only until the card's teams change, when the card is
//   re-derived from its teams (any change of the team set does that);
// - a card with teams in two leagues (MLB + NCAA) has no league, and its panel
//   says why (axe); a pick between them holds until the teams change again;
// - Team Management: changing the league of that team moves the card's league
//   (`cardLeague.recomputeTeamCards`) because the card still follows its team.
//
// The teams are minted (single tokens, never looked up: teams are not enriched
// on creation) and each is given an EXISTING catalogue league, so the spec
// creates no league and nothing for the enrichment recording to answer. Every
// team and the set stand afterwards (no delete-team or delete-set affordance);
// the cards are deleted at the end and by the failure hook.
//
// R9: drills are `drillToCustom`; the cards go in through `addCardViaForm`, and
// their handles come from `support/cards`.
import type { Locator, Page } from "@playwright/test";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectTeamsLoaded, teamsCounter } from "../../support/players";
import { drillToCustom, openAttributesPanel, setBuilderReady, type CustomTarget } from "../../support/set-builder";

const MLB = "Major League Baseball";
const NCAA = "NCAA";
// A third Baseball league of the reference catalogue, picked by hand on a card.
const KBO = "KBO League";

/** The set row's League group in the attributes panel. */
const leagueGroup = (page: Page) =>
  page.getByRole("region", { name: "Set attributes panel" }).getByRole("group", { name: "League", exact: true });

/** The chip of a league in the group's list, by the league's full name (the chip's own text for a screen reader). */
const chipOf = (group: Locator, league: string) => group.getByRole("listitem").filter({ hasText: league });

/** What the body wrote, so the failure hook can take the cards back. */
const written: { build?: CustomTarget; cards: string[] } = { cards: [] };

// A red run must not leave its cards in the checklist. A page of its own, in
// front, so the failure's screenshot and ARIA snapshot still show the body.
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const { build, cards } = written;
  written.build = undefined;
  written.cards = [];
  if (!build || cards.length === 0) return;
  const clean = await context.newPage();
  await clean.bringToFront();
  try {
    await drillToCustom(clean, build);
    for (const card of cards) {
      const edit = editCardButton(clean, card);
      const empty = clean.getByRole("button", { name: "Open add card form" });
      // The body added the card, or died before it did: the checklist settles on one of the two.
      await expect(edit.or(empty)).toBeVisible();
      if (await edit.isVisible()) {
        await deleteCardButton(clean, card).click();
        await confirmDeleteCardButton(clean, card).click();
        await expect(edit).toBeHidden();
      }
    }
  } finally {
    await clean.close();
  }
});

test(
  "Set League is a list: a set is born with its sport's league, rows below inherit or take their own, 'Add league' adds another, a card's League follows its teams and a hand pick sticks as long as it is one of them",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const T = env.ATTEMPT_TOKEN;
    const SET = `lgm${T}`;
    const teamless = `569-${env.ATTEMPT_ID}`;
    const teamed = `570-${env.ATTEMPT_ID}`;
    const ncaaTeam = `LGN${T}`;
    const mlbTeam = `LGB${T}`;
    const ncaaTeam2 = `LGC${T}`;
    const setRow: CustomTarget = { sport: "Baseball", year: "2024", manufacturer: "Topps", set: SET };
    const build: CustomTarget = { ...setRow, variantType: "Insert", variant: "Base" };
    const drawerOf = (number: string) => page.getByRole("dialog", { name: `Card #${number}`, exact: true });
    const done = (drawer: Locator) => drawer.getByRole("button", { name: "Done editing card" });
    const removeTeam = (drawer: Locator, name: string) =>
      drawer.getByRole("button", { name: `Remove team ${name}`, exact: true });

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

    // --- A row below the set: inherited chips, its own list, and back ------------
    await drillToCustom(page, build);
    await openAttributesPanel(page);
    const row = leagueGroup(page);
    const inherited = row.getByRole("list", { name: "Leagues from above" });
    await expect(inherited).toBeVisible();
    await expect(chipOf(inherited, MLB)).toBeVisible();
    await expect(row.getByText(/^Using the set's leagues\./)).toBeVisible();
    // An inherited list's only league has no ×: taking it away would leave nothing to inherit.
    await expect(row.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    const rowAdd = row.getByRole("combobox", { name: "Add league" });
    await rowAdd.click();
    await rowAdd.fill("KBO");
    await page.getByRole("listbox", { name: "Add league suggestions" }).getByRole("option", { name: new RegExp(`^${KBO}`) }).click();
    await expect(page.getByText("Saved League").first()).toBeVisible();
    const own = row.getByRole("list", { name: "This row's leagues" });
    await expect(chipOf(own, KBO)).toBeVisible();
    await expect(chipOf(own, MLB)).toBeVisible();
    await expect(row.getByText("This insert has its own leagues instead of the set's leagues.")).toBeVisible();
    await expectAccessible(page, { label: "Base row, its own league list over the set's" });
    await row.getByRole("button", { name: "Use the set's leagues" }).click();
    await expect(page.getByText("Back to the set's leagues").first()).toBeVisible();
    await expect(inherited).toBeVisible();
    await expect(chipOf(inherited, KBO)).toHaveCount(0);
    await expect(chipOf(inherited, MLB)).toBeVisible();
    await expect(row.getByRole("button", { name: "Use the set's leagues" })).toHaveCount(0);

    // --- A TEAMLESS card in the one-league set reads the set's league ------------
    await addCardViaForm(page, { cardNumber: teamless, playerName: `LeagueNoTeam${T}` });
    written.build = build;
    written.cards.push(teamless);
    await editCardButton(page, teamless).click();
    const drawerA = drawerOf(teamless);
    await expect(drawerA).toBeVisible();
    await expect(drawerA.getByRole("combobox", { name: "Card league" })).toHaveValue(MLB);
    await done(drawerA).click();
    await expect(drawerA).toBeHidden();

    // --- Add NCAA to the set: both leagues, saved at once (axe with the list open) ---
    await drillToCustom(page, setRow);
    await openAttributesPanel(page);
    const add = leagueGroup(page).getByRole("combobox", { name: "Add league" });
    await add.click();
    const suggestions = page.getByRole("listbox", { name: "Add league suggestions" });
    // The league the set already has is not offered again; the sport's others are.
    await expect(suggestions.getByRole("option", { name: new RegExp(`^${MLB}`) })).toHaveCount(0);
    await expect(suggestions.getByRole("option", { name: new RegExp(`^${NCAA}`) })).toBeVisible();
    await expectAccessible(page, { label: "Set League row, the Add league list open" });
    await add.fill("NCAA");
    await suggestions.getByRole("option", { name: new RegExp(`^${NCAA}`) }).click();
    await expect(page.getByText("Saved League").first()).toBeVisible();
    await expect(chipOf(leagueGroup(page), NCAA)).toBeVisible();
    await expect(chipOf(leagueGroup(page), MLB)).toBeVisible();
    await expectAccessible(page, { label: "Set attributes panel, League row with two leagues" });

    // --- Rule A: with two leagues the teamless card no longer has one, and its panel says why ---
    await drillToCustom(page, build);
    await editCardButton(page, teamless).click();
    await expect(drawerA).toBeVisible();
    await expect(drawerA.getByRole("combobox", { name: "Card league" })).toHaveValue("");
    await expect(
      drawerA.getByText(/^No team, so no league\. Pick one\./),
    ).toBeVisible();
    await expectAccessible(page, { within: drawerA, label: "Card drawer, no league with the reason given" });
    await done(drawerA).click();
    await expect(drawerA).toBeHidden();

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

    /** Add a team that already exists, through the open picker. */
    async function addExistingTeam(name: string) {
      await page.getByRole("button", { name: "Add team" }).click();
      await page.getByRole("textbox", { name: "Search teams" }).fill(name);
      await page.getByRole("option", { name: new RegExp(`^Add ${name}( · .*)?$`) }).click();
      await expect(page.getByRole("button", { name: `Remove team ${name}`, exact: true })).toBeVisible();
    }

    // --- A card whose team plays in NCAA reads NCAA ------------------------------
    await addCardViaForm(page, {
      cardNumber: teamed,
      playerName: `LeagueCard${T}`,
      beforeSubmit: () => createTeam(ncaaTeam, NCAA, new RegExp(`^${NCAA}`)),
    });
    written.cards.push(teamed);

    await editCardButton(page, teamed).click();
    const drawer = drawerOf(teamed);
    await expect(drawer).toBeVisible();
    const cardLeague = drawer.getByRole("combobox", { name: "Card league" });
    await expect(removeTeam(drawer, ncaaTeam)).toBeVisible();
    await expect(cardLeague).toHaveValue(NCAA);
    await expectAccessible(page, { within: drawer, label: "Card drawer, League taken from an NCAA team" });

    // --- Change the team to one in Major League Baseball: the card's League follows -
    await removeTeam(drawer, ncaaTeam).click();
    await expect(removeTeam(drawer, ncaaTeam)).toBeHidden();
    await createTeam(mlbTeam, MLB, new RegExp(`^${MLB}$`));
    await expect(cardLeague).toHaveValue(MLB);

    // --- A hand pick (a league none of its teams plays in) sticks, and survives a reload ---
    await cardLeague.click();
    await drawer.getByRole("option", { name: new RegExp(`^${KBO}`) }).waitFor();
    if (!isMobile) {
      // The open list is placed inside the drawer, beside its field (not left at the page's corner).
      const list = page.getByRole("listbox", { name: "Card league suggestions" });
      await expect(list).toBeVisible();
      const [listBox, drawerBox] = [await list.boundingBox(), await drawer.boundingBox()];
      expect(listBox, "the open Card league list has a box").not.toBeNull();
      expect(drawerBox, "the drawer has a box").not.toBeNull();
      expect(listBox!.x).toBeGreaterThanOrEqual(drawerBox!.x);
      expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width + 1);
      expect(listBox!.y).toBeGreaterThanOrEqual(drawerBox!.y);
      expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(drawerBox!.y + drawerBox!.height + 1);
    }
    await drawer.getByRole("option", { name: new RegExp(`^${KBO}`) }).click();
    await expect(drawer.getByRole("status").filter({ hasText: "Saved League" })).toBeVisible();
    await expect(cardLeague).toHaveValue(KBO);
    await expectAccessible(page, { within: drawer, label: "Card drawer after a hand-picked league" });
    await done(drawer).click();
    await expect(drawer).toBeHidden();

    await page.reload();
    await expect(editCardButton(page, teamed)).toBeVisible();
    await editCardButton(page, teamed).click();
    await expect(drawer).toBeVisible();
    await expect(removeTeam(drawer, mlbTeam)).toBeVisible();
    await expect(cardLeague).toHaveValue(KBO);

    // --- A hand pick holds only until the card's teams change ---------------------
    // KBO is nobody's league once the team is swapped: the card is re-derived from its teams.
    await removeTeam(drawer, mlbTeam).click();
    await expect(removeTeam(drawer, mlbTeam)).toBeHidden();
    await addExistingTeam(ncaaTeam);
    await expect(cardLeague).toHaveValue(NCAA);

    // --- Teams in two leagues: no league, and the panel says why --------------------
    await addExistingTeam(mlbTeam);
    await expect(cardLeague).toHaveValue("");
    await expect(drawer.getByText(/different leagues/)).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card drawer, teams in two leagues" });
    // The admin picks the one this card counts for, and it holds ...
    await cardLeague.click();
    await drawer.getByRole("option", { name: new RegExp(`^${MLB}`) }).click();
    await expect(cardLeague).toHaveValue(MLB);
    await expect(drawer.getByRole("status").filter({ hasText: "Saved League" })).toBeVisible();
    // ... until the teams change: swap one for another team in NCAA and the card is blank again.
    await removeTeam(drawer, ncaaTeam).click();
    await expect(removeTeam(drawer, ncaaTeam)).toBeHidden();
    await createTeam(ncaaTeam2, NCAA, new RegExp(`^${NCAA}`));
    await expect(removeTeam(drawer, mlbTeam)).toBeVisible();
    await expect(cardLeague).toHaveValue("");
    await expect(drawer.getByText(/different leagues/)).toBeVisible();
    // Leave one team (the MLB one): the card follows it, and follows it again in the next step.
    await removeTeam(drawer, ncaaTeam2).click();
    await expect(removeTeam(drawer, ncaaTeam2)).toBeHidden();
    await expect(cardLeague).toHaveValue(MLB);
    await done(drawer).click();
    await expect(drawer).toBeHidden();

    // --- Team Management: the team's league changes, and the card that follows it follows ---
    await page.goto("/admin/teams");
    await expectTeamsLoaded(page, LAUNCH_GATE);
    await page.getByRole("textbox", { name: "Filter teams" }).fill(mlbTeam);
    await expect(teamsCounter(page, "1 match")).toBeVisible();
    await page.getByRole("button", { name: mlbTeam, exact: true }).click();
    // Two selects read "League" (the list's filter and the team's): the team's is the one offering "— none —".
    const teamLeague = page
      .getByRole("combobox", { name: "League", exact: true })
      .filter({ has: page.getByRole("option", { name: "— none —" }) });
    await expect(teamLeague).toBeVisible();
    await teamLeague.selectOption({ label: "NCAA (NCAA)" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${mlbTeam}`))).toBeVisible();

    await drillToCustom(page, build);
    await editCardButton(page, teamed).click();
    await expect(drawer).toBeVisible();
    await expect(removeTeam(drawer, mlbTeam)).toBeVisible();
    // The card's league was the team's old one, so it follows the team to its new one.
    await expect(cardLeague).toHaveValue(NCAA);
    await done(drawer).click();
    await expect(drawer).toBeHidden();

    // --- Remove the NCAA chip from the set: the teamless card has Major League Baseball again ---
    await drillToCustom(page, setRow);
    await openAttributesPanel(page);
    await expect(chipOf(leagueGroup(page), NCAA)).toBeVisible();
    await leagueGroup(page).getByRole("button", { name: `Remove ${NCAA}` }).click();
    await expect(page.getByText("Saved League").first()).toBeVisible();
    await expect(chipOf(leagueGroup(page), NCAA)).toHaveCount(0);
    await expect(chipOf(leagueGroup(page), MLB)).toBeVisible();
    await drillToCustom(page, build);
    await editCardButton(page, teamless).click();
    await expect(drawerA).toBeVisible();
    await expect(drawerA.getByRole("combobox", { name: "Card league" })).toHaveValue(MLB);
    await done(drawerA).click();
    await expect(drawerA).toBeHidden();

    // --- Cleanup: the cards go, so no checklist carries them ----------------------
    for (const number of [teamed, teamless]) {
      await deleteCardButton(page, number).click();
      await confirmDeleteCardButton(page, number).click();
      await expect(editCardButton(page, number)).toBeHidden();
    }
    await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
    written.cards = [];
  },
);
