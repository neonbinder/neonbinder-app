// NEO-426 on the NEO-645 walk (R1): a sport marked "No teams in this sport" stamps No team on a
// card whose people all play it, so that card makes no Tidy Up stop. The ONE feature, as an
// operator meets it:
//   1. The sport row's Attributes panel carries the toggle; pressed on, it says so (toast) and
//      reads pressed.
//   2. A checklist-only fetch saves three cards for ONE new player of that sport: #1 and #2 with
//      a BLANK team cell (no claim), #3 with a team the checklist names. The commit saves them
//      (the player still a pending name) and the walk opens on #1, "3 cards left". #1's Team
//      tile is pink: nothing can be stamped while the name is unknown (he could play anywhere).
//   3. Adding him as a new player (his sport is the set's, the teamless one) links #1 only
//      (NEO-656: an answer links the open card) and stamps its default: #1's Team tile turns to
//      "No team on this card." by itself and #1 leaves the count ("2 cards left"). "Apply to all
//      cards printing “<player>”" links #2 and #3; #2 is stamped the same way and leaves the
//      walk without ever being shown ("1 card left").
//   4. #3 is the counter-case (invariant 8: a data claim holds a default back): its Team tile
//      stays pink with the checklist's team for the operator to answer, never "No team on this
//      card.". Answered, the walk ends "All tidy" with both walked cards fixed.
//   5. The checklist: #1 and #2 read No Team, #3 its named team; nothing is badged or counted.
//   6. The default never blocks a team: a team picked in the card editor wins, after a reload.
//      Blue is live (Jason, NEO-656: "it should read real data and display pink/blue as
//      appropriate depending on the current state of the data"): the player's career does not
//      hold that team, so #1 is now worth a check for it, and only #1.
//   7. The quick-add form is the other birth path: a card added by hand for the same player is
//      born No Team, unbadged.
//   8. Turning the flag off says the sport asks for a team again, reads not pressed, and changes
//      no card already saved (#1's career check is the only mark, as before).
// The listing-names-a-team half is `sport-no-teams-listing-team-holds-back-the-default`; BSC
// answering "no team" is `sport-no-teams-bsc-no-team-answer-stamps-no-team-once-the-person-is-added`.
//
// R2: every move of the walk is proved by the card that lands and the count ("N cards left");
// each negative (`toHaveCount(0)`) sits beside a positive.
//
// FIXTURE (SET-REGISTRY.md, the `tls` custom-set prefix): a per-attempt hand-made set
// `tls<token>` under the worker's own `E2E Test Sport <w>` › 2026 › Topps, `Insert` › `Base`
// (R7a). No marketplace id anywhere on the path, so the Sync is checklist-only (a pasted
// three-row checklist is the only source: no Match Cards, no BSC, no recording) and nothing is
// looked up: the custom sport has no Wikidata mapping, so the minted player costs no enrichment
// call (GUIDE "Enrichment fixtures").
// SOLE WRITER of that set and of the worker's custom sport's teamless flag for the length of the
// test; self-cleaning (R7): the afterEach, on a second page so a red body's screenshot stays
// whole, turns the flag off (the body already does, in step 8) and deletes the cards and the
// set's rows. Minted names are single tokens (`Teamless<token>`, `TLW<token>`, `TLC<token>`);
// not fresh-only, since every name is per attempt.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import type { Page } from "@playwright/test";
import {
  columnOption,
  columnSelection,
  customSport,
  drillToCustom,
  openAttributesPanel,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton, escapeRe } from "../../support/cards";
import { usePastedChecklist } from "../../support/published-checklist";
import { ensureSportHasTeams, openSportAttributes, pressTeamlessToggle, teamlessToggle } from "../../support/teamless-sport";
import {
  applyNameToAll,
  createPlayerOnOpenRow,
  createTeamOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  expectTidyEndScreen,
  finishTidyWalk,
  mustFixLine,
  needsYouPill,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";
const MANUFACTURER = "Topps";

/** What the afterEach must undo, recorded the line after each write lands. */
const written: {
  sport?: string;
  sportFlagged: boolean;
  leafUrl?: string;
  set?: string;
  cards: string[];
} = {
  sportFlagged: false,
  cards: [],
};

/** A checklist row is one run of text; the match stops at the next row's "#". */
function rowSays(page: Page, number: string, text: string) {
  return page.getByText(new RegExp(`#${escapeRe(number)}[^#]*${text}`));
}

/** Any badge on the card's row: pink "needs attention: …" or blue "is worth a check: …". */
function anyMark(page: Page, number: string) {
  return page.getByRole("img", {
    name: new RegExp(`^Card ${escapeRe(number)}(, .*)? (needs attention|is worth a check): `),
  });
}

/** The card's blue career check: its team is not in the player's career (live, NEO-656 B22). */
function careerMark(page: Page, number: string) {
  return page.getByRole("img", {
    name: new RegExp(`^Card ${escapeRe(number)}(, .*)? is worth a check: .*team is missing from the player's career`),
  });
}

/** Delete the selected row from its Attributes panel; the selection falls back to its parent. */
async function deleteSelectedRow(page: Page, name: string): Promise<void> {
  await openAttributesPanel(page);
  await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  const confirm = page.getByRole("dialog", { name: new RegExp(`^Delete .*"${escapeRe(name)}"\\?$`) });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Yes, delete" }).click();
  await expect(confirm).toBeHidden();
}

test.afterEach(async ({ page }, testInfo) => {
  const bodyFailed = testInfo.status !== testInfo.expectedStatus;
  const leftovers: string[] = [];
  const tidyStep = async (what: string, step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      leftovers.push(`${what}: ${String(error)}`);
    }
  };
  const tidy = await page.context().newPage();
  try {
    // The flag first: it is the one write every later spec on this worker would meet.
    if (written.sportFlagged && written.sport) {
      const sport = written.sport;
      await tidyStep("turn No teams in this sport off", async () => {
        await ensureSportHasTeams(tidy, sport);
        written.sportFlagged = false;
      });
    }
    if (written.leafUrl && written.set) {
      const { leafUrl, set } = written;
      await tidyStep("delete the set's cards and rows", async () => {
        // The cards are saved at the commit (NEO-645), and nothing is staged: no batch holds the
        // rows, so the deletes need no walk closed first (a walk left open is not in the address).
        await tidy.goto(leafUrl);
        await expect(tidy.getByRole("button", { name: "Open add card form" })).toBeVisible({ timeout: LAUNCH_GATE });
        for (const number of [...written.cards]) {
          await deleteCardButton(tidy, number).click();
          await confirmDeleteCardButton(tidy, number).click();
          await expect(editCardButton(tidy, number)).toHaveCount(0);
          written.cards = written.cards.filter((n) => n !== number);
        }
        await expect(tidy.getByText("No cards in this checklist yet.")).toBeVisible();
        await deleteSelectedRow(tidy, "Base");
        await expect(columnOption(tidy, "Inserts", "Base")).toHaveCount(0);
        await deleteSelectedRow(tidy, "Insert");
        await expect(columnOption(tidy, "Variant Types", "Insert")).toHaveCount(0);
        await deleteSelectedRow(tidy, set);
        await expect(columnOption(tidy, "Sets", set)).toHaveCount(0);
        written.leafUrl = undefined;
      });
    }
  } finally {
    await tidy.close();
  }
  if (leftovers.length === 0) return;
  // The body's own error stays the one the report shows (a throw here would replace it).
  if (bodyFailed) {
    for (const description of leftovers) testInfo.annotations.push({ type: "cleanup-failed", description });
    return;
  }
  throw new Error(`cleanup left work undone:\n${leftovers.join("\n")}`);
});

test(
  "No teams in this sport — a card whose only player plays a teamless sport is stamped No team and makes no Tidy Up stop; a team the checklist names holds the default back, and a team picked later sticks (NEO-426)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const token = env.ATTEMPT_TOKEN;
    const sport = customSport(env);
    const SET = `tls${token}`;
    const PLAYER = `Teamless${token}`;
    const TEAM = `TLW${token}`;
    const CLAIMED = `TLC${token}`;
    written.sport = sport;
    written.set = SET;
    written.sportFlagged = false;
    written.leafUrl = undefined;
    written.cards = [];

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ══ 1. THE SPORT: "No teams in this sport" on ══
    await openSportAttributes(page, sport);
    // R2 precondition: the sport starts with teams (a leftover flag fails here, by name).
    await expect(teamlessToggle(page, false)).toBeVisible();
    written.sportFlagged = true; // from the press on, the afterEach owns turning it off
    await pressTeamlessToggle(page, false);
    await expectAccessible(page, { label: "Sport attributes with No teams in this sport on" });

    // ══ 2. THE SET: a hand-made per-attempt leaf, its three-row checklist pasted ══
    await drillToCustom(page, { sport, year: YEAR, manufacturer: MANUFACTURER, set: SET, variantType: "Insert", variant: "Base" });
    const leafUrl = page.url();
    written.leafUrl = leafUrl;
    // Navigation lives in the URL: Back is the Insert type with nothing picked, Forward the leaf again.
    await page.goBack();
    await expect(columnOption(page, "Inserts", "Base")).toBeVisible();
    await expect(columnSelection(page, "Inserts", "Base")).toHaveCount(0);
    await page.goForward();
    await expect(columnSelection(page, "Inserts", "Base")).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // A BLANK team cell makes no claim (GUIDE "Checklist first"): nothing names a team for #1 or
    // #2. #3 is the SAME player with a team the data names.
    const checklist = `number,player,team\n1,${PLAYER},\n2,${PLAYER},\n3,${PLAYER},${CLAIMED}\n`;
    await usePastedChecklist(page, checklist, 3);
    await syncChecklistButton(page).click();

    // The commit saves the three cards (the player a pending name on each), and the walk opens.
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 3 cards\./).first());
    expect(opened, "three cards with an unanswered name, so the walk opened").toBe(true);
    written.cards.push("1", "2", "3");
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 3);
    const header = (number: string) => walk.getByText(`#${number} · ${PLAYER}`, { exact: true });
    const teamTile = tidyTile(page, "Team");
    const stampedLine = teamTile.getByText("No team on this card.", { exact: true });

    // ══ 3. #1: the player answered, and the default stamps No team by itself; Apply to all for #2 ══
    await expect(header("1")).toBeVisible();
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    // R2 precondition: while the name is unknown nothing is stamped, so the Team tile is pink.
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(stampedLine).toHaveCount(0);
    // The name's sport is the set's sport, the one marked teamless.
    const playerRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${PLAYER}`, exact: true });
    await expect(playerRow.getByRole("button", { name: `Sport for this name: ${sport}` })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a new player of a teamless sport" });

    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${PLAYER}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    // The Team tile answered itself: No team, nothing left to fix.
    await expect(stampedLine).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(teamTile.getByRole("button", { name: "No team on this card", exact: true })).toHaveCount(0);
    await expect(mustFixLine(page)).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    // The answer linked #1 only: #1 has nothing left and drops out; #2 and #3 still wait on the name.
    await expectCardsLeft(page, 2);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a card stamped No team by its sport" });
    // Apply to all links the two cards still waiting on him: #2, stamped too, has nothing else and
    // drops out; #3 (its claimed team) stays.
    expect(await applyNameToAll(page, "Player", PLAYER)).toBe("Linked 2 more cards.");
    await expectCardsLeft(page, 1);
    // #1 is untouched by it: still stamped, nothing pink.
    await expect(stampedLine).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);

    // ══ 4. #3: the checklist's team holds the default back; the operator answers it ══
    await saveAndNext(page);
    await expect(header("3")).toBeVisible();
    await expect(walk.getByText(/^#2 · /), "#2 was stamped, so the walk never shows it").toHaveCount(0);
    await expectCardsLeft(page, 1);
    await expect(playerRow.getByRole("button", { name: `Edit ${PLAYER}`, exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamTile.getByRole("group", { name: `Team ${CLAIMED}`, exact: true })).toBeVisible();
    await expect(stampedLine).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a card whose checklist names a team" });
    // Navigation lives in the URL: Back is #1 again, Forward #3.
    await page.goBack();
    await expect(header("1")).toBeVisible();
    await expect(header("3")).toHaveCount(0);
    await page.goForward();
    await expect(header("3")).toBeVisible();
    await expectCardSettled(page);

    expect(await createTeamOnOpenRow(page)).toBe(`Team ${CLAIMED}`);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await saveAndNext(page);
    // #1 and #3, both walked and both clear now.
    await expectTidyEndScreen(page, { fixed: 2 });
    await expectCardsLeft(page, 0);
    await finishTidyWalk(page);

    // ══ 5. THE CARDS: #1 and #2 No Team, #3 its named team; none badged or counted ══
    await expect(editCardButton(page, "1")).toBeVisible();
    await expect(rowSays(page, "1", "No Team")).toBeVisible();
    await expect(rowSays(page, "2", "No Team")).toBeVisible();
    await expect(rowSays(page, "3", CLAIMED)).toBeVisible();
    await expect(rowSays(page, "3", "No Team")).toHaveCount(0);
    for (const number of ["1", "2", "3"]) await expect(anyMark(page, number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);
    await expectAccessible(page, { label: "Checklist with cards saved No team by their sport" });

    // ══ 6. A TEAM PICKED LATER WINS, AND STICKS ══
    const cardName = page.getByRole("textbox", { name: "Card name" });
    const cardToggle = (pressed: boolean) => page.getByRole("button", { name: "No Team for this card", pressed });
    await editCardButton(page, "1").click();
    await expect(cardName).toBeVisible();
    await expect(cardToggle(true)).toBeVisible();
    await page.getByRole("button", { name: "Add team" }).click();
    const searchTeams = page.getByRole("textbox", { name: "Search teams" });
    await searchTeams.fill(TEAM);
    await expect(page.getByRole("button", { name: `New team ${TEAM}` })).toBeVisible();
    // NEO-331: Enter on the create row is dropped while rows are held from an earlier query.
    await expect(page.getByText("No matches.")).toBeVisible();
    await searchTeams.press("Enter");
    const newTeam = page.getByRole("dialog", { name: `New team: ${TEAM}` });
    await expect(newTeam).toBeVisible();
    await newTeam.getByRole("button", { name: `Create team ${TEAM}` }).click();
    await expect(newTeam).toBeHidden();
    await cardName.click();
    await expect(page.getByRole("button", { name: `Remove team ${TEAM}` })).toBeVisible();
    await expect(cardToggle(false)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();
    await expect(rowSays(page, "1", TEAM)).toBeVisible();

    // Read back from the server: a reload keeps the team on the card.
    await page.reload();
    await expect(editCardButton(page, "1")).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(rowSays(page, "1", TEAM)).toBeVisible();
    await expect(rowSays(page, "1", "No Team")).toHaveCount(0);
    // Blue is read from the data: the player's career does not hold the new team, so #1, and only
    // #1, is worth a check for it.
    await expect(careerMark(page, "1")).toBeVisible();
    for (const number of ["2", "3"]) await expect(anyMark(page, number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you");
    await editCardButton(page, "1").click();
    await expect(cardName).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove team ${TEAM}` })).toBeVisible();
    await expect(cardToggle(false)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // ══ 7. QUICK-ADD: the same player's hand-added card is born No Team ══
    await addCardViaForm(page, {
      cardNumber: "4",
      playerName: PLAYER,
      beforeSubmit: async () => {
        // The results popover opens below the field and is fixed to the viewport, so lift the form.
        await page.getByRole("heading", { name: "Add Card" }).hover();
        await page.mouse.wheel(0, 250);
        await page.getByRole("button", { name: "Add a player to the new card" }).click();
        const find = page.getByRole("textbox", { name: "Find a player for the new card" });
        await find.fill(PLAYER);
        // The player is on file now, so the picker offers him and no create.
        await page.getByRole("option", { name: new RegExp(`^Add ${escapeRe(PLAYER)}\\b`) }).click();
        await expect(page.getByRole("button", { name: `Remove player ${PLAYER}` })).toBeVisible();
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(find).toBeHidden();
      },
    });
    written.cards.push("4");
    await expect(rowSays(page, "4", "No Team")).toBeVisible();
    await expect(anyMark(page, "4")).toHaveCount(0);
    // Still only #1's career check: the new card adds nothing to the count.
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you");

    // ══ 8. FLAG OFF: the sport asks for a team again, and no existing card changes ══
    await openSportAttributes(page, sport);
    await pressTeamlessToggle(page, true);
    written.sportFlagged = false;
    await expectAccessible(page, { label: "Sport attributes with No teams in this sport off" });
    // The leaf again, by its address: clearing the flag touched no card. #1 keeps the team picked
    // in step 6 (and its career check), #2 and #4 are still No Team (unbadged, uncounted), #3 still
    // has its named team.
    await page.goto(leafUrl);
    // A full load pays the app's launch and the Clerk handshake again (LAUNCH_GATE, as the reload above).
    await expect(editCardButton(page, "1")).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(columnSelection(page, "Inserts", "Base")).toBeVisible();
    await expect(rowSays(page, "1", TEAM)).toBeVisible();
    await expect(rowSays(page, "2", "No Team")).toBeVisible();
    await expect(rowSays(page, "4", "No Team")).toBeVisible();
    await expect(anyMark(page, "2")).toHaveCount(0);
    await expect(anyMark(page, "4")).toHaveCount(0);
    await expect(rowSays(page, "3", CLAIMED)).toBeVisible();
    await expect(careerMark(page, "1")).toBeVisible();
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you");
  },
);
