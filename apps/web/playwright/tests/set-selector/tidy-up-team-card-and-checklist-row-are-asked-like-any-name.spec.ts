// ONE FEATURE (R1, NEO-645 D3, main's behaviour): a card that names no player is asked like any
// other card, and keeps the name it printed. NB answers nothing for the operator: a team card's own
// name is a pink Player row offering "Not a player (checklist, team card, stadium)", with no note,
// and the operator's "Not a player" settles it on every card that prints it (the fan-out), with no
// "Ruled out for you" note; Edit brings it back. A "Checklist" row (its subject is read as no
// person when the file is read, `parse-published-checklist.ts`) names no player but keeps
// "Checklist" as its card name, in its header and its listing title (Jason, 2026-11-23: "A name
// for the card should be required, even if not a player"); it gets no automatic No team: its Team
// tile asks, and the operator's "No team on this card" settles it. (A row that prints no subject at
// all, NB's placeholder "Card #N", and its Card name tile are
// `tidy-up-card-name-tile-asks-a-no-player-card-for-its-name-and-titles-it.spec.ts`, R3.)
//
// The operator meets it like this:
//   1. The walk opens on #1, the team card, with all five cards left: its own name is a pink
//      Player row printed on #1 and #5 (Not a player offered, no note) beside its new team name.
//      "Not a player" answers it; Edit <name> brings the question back; "Not a player" again.
//      Creating the team leaves nothing pink, and #5, the second team card, leaves the walk with
//      #1: both answers reached it (three cards left). Its title says the club once: the card's
//      name is the team's, so the team is not added again. Save & next.
//   2. Counter-fixture #2 (a person under the same team) still asks; its team arrived from #1. Skip.
//   3. #3, "Checklist", is a walk stop for its team alone: its header and title say "Checklist",
//      no Player tile, no Card name tile, a pink Team tile with "No team on this card". The
//      operator answers it; Save & next.
//   4. Counter-fixture #4 (a person with a blank team cell) asks both. Skip. The end screen is next:
//      #5 is never shown.
//   5. The end screen's tally and the pill count the two skipped cards; #5's drawer holds the team
//      and no player, #3's drawer No Team, no player, the name Checklist and a title carrying it.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `aut`/`auu` prefixes; R7a): a per-attempt sport
// `aut<token>` › 2026 › Topps › `auu<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted five-row checklist, no Match Cards, no BSC) and no name
// reaches Wikidata (the sport has no mapping). The team `Auc<token> Club` is created on the walk's
// Team tile (teams are never looked up on creation). Not fresh-only: every name carries the attempt
// token. Nothing is deleted; the sport, its rows, the five cards and the team stand, and no player
// is made.
//
// Title arithmetic (computed offline with `assessListingTitle`, ATTEMPT_TOKEN 1 and 12 characters):
// #1 "2026 Topps auu<t> Base Insert Auc<t> Club #1 aut<t>" (45-78), #3 "2026 Topps auu<t> Base
// Insert Checklist #3 aut<t>" (45-67). Both fit, so no Listing title check stops a card; the
// assertions read the name beside the number.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { anyPlayerChip, closeCardDrawer, openCardDrawer } from "../../support/also-pictured";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  createTeamOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  mustFixLine,
  needsYouPill,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  skipCard,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";
/** The unanswered row's answer; on a multi-name card it carries " <printed>", which these cards are not. */
const NOT_A_PLAYER = "Not a player (checklist, team card, stadium)";
/** The note NB once put on a name it ruled out itself (C10: gone; nothing of it may show). */
const RULED_OUT_FOR_YOU = /Ruled out for you/;

test(
  "Tidy Up — a card with no player is asked like any card and keeps its name: Not a player settles every card that prints the name, with no note, Edit brings it back, and a Checklist row keeps its name in its title while its team is the operator's",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `aut${T}`;
    const SET = `auu${T}`;
    const CLUB = `Auc${T} Club`;
    const PERSON_SAME_TEAM = `Ava Auv${T}`;
    const PERSON_NO_TEAM = `Ida Auw${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its five-row checklist (two team cards, #1 and #5) ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(
      page,
      `number,player,team\n1,${CLUB},${CLUB}\n2,${PERSON_SAME_TEAM},${CLUB}\n3,Checklist,\n4,${PERSON_NO_TEAM},\n5,${CLUB},${CLUB}\n`,
      5,
    );
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/^Saved 5 cards\./).first());
    expect(opened, "every name is new, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));

    /** Any "#<number>…" line of a card, whoever it names. */
    const cardLines = (number: string) => walk.getByText(new RegExp(`^#${number}( · .+)?$`));
    const playerTile = tidyTile(page, "Player");
    const teamTile = tidyTile(page, "Team");
    const cardNameTile = tidyTile(page, "Card name");
    /** The open card's listing title, as the Listing title tile shows it. */
    const titleLine = (text: RegExp) => tidyTile(page, "Listing title").getByText(text);
    const saveUsable = tidyFooterButton(page, "saveAndNext", { usable: true });
    const clubRow = playerTile.getByRole("group", { name: `Player ${CLUB}`, exact: true });
    const isNotAPlayer = clubRow.getByText(`${CLUB} is not a player.`, { exact: true });
    const notAPlayer = clubRow.getByRole("button", { name: NOT_A_PLAYER, exact: true });
    // C1: a not-a-player row's Edit carries the printed name.
    const edit = clubRow.getByRole("button", { name: `Edit ${CLUB}`, exact: true });

    // ── STEP 1: #1, the team card: its own name is asked, beside its new team name ──
    await expect(tidyCardHeader(page, `#1 · ${CLUB}`)).toBeVisible();
    await expectCardSettled(page);
    await expectCardsLeft(page, 5);
    await expect(cardNameTile, "a card with a name to ask about is not asked for a name").toHaveCount(0);
    await expect(notAPlayer, "the team card's name is asked like any name").toBeVisible();
    await expect(clubRow.getByText("Printed on #1, #5", { exact: true })).toBeVisible();
    await expect(isNotAPlayer).toHaveCount(0);
    await expect(clubRow.getByRole("note"), "NB ruled nothing out for the operator").toHaveCount(0);
    await expect(walk.getByText(RULED_OUT_FOR_YOU)).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(mustFixLine(page)).toBeVisible();
    await expect(saveUsable).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a team card's name asked like any name" });

    // The operator's answer, twice: Edit between them clears it and asks again, pink.
    for (const pass of ["first", "after Edit"]) {
      await notAPlayer.click();
      await expect(isNotAPlayer, `Not a player (${pass}) answered the team card's name`).toBeVisible();
      await expect(edit).toBeVisible();
      await expect(notAPlayer).toHaveCount(0);
      await expect(clubRow.getByRole("note"), "the operator said it, so no note").toHaveCount(0);
      await expect(walk.getByText(RULED_OUT_FOR_YOU)).toHaveCount(0);
      await expect(pinkTile(page, "Player")).toHaveCount(0);
      if (pass === "first") {
        await edit.click();
        await expect(notAPlayer, "Edit brought the question back").toBeVisible();
        await expect(isNotAPlayer).toHaveCount(0);
        await expect(pinkTile(page, "Player")).toHaveCount(1);
      }
    }
    expect(await createTeamOnOpenRow(page)).toBe(`Team ${CLUB}`);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(mustFixLine(page)).toHaveCount(0);
    await expect(saveUsable, "both answers given: nothing on the team card is pink").toBeVisible();
    // The fan-out: #5 prints the same name and team, so both answers settled it too. #1 and #5 are
    // out of the walk; #2, #3 and #4 are left.
    await expectCardsLeft(page, 3);
    // The card's name is its title's subject, and the team it names is not said twice.
    await expect(
      titleLine(new RegExp(`^(?:(?!${CLUB}).)*${CLUB} #1(?:(?!${CLUB}).)*$`)),
      "the team card's title says the club once, beside its number",
    ).toBeVisible();
    await saveAndNext(page);

    // ── STEP 2: counter-fixture #2, a person under the same team, still asks ──
    await expect(tidyCardHeader(page, `#2 · ${PERSON_SAME_TEAM}`)).toBeVisible();
    await expect(
      playerTile.getByRole("group", { name: `Player ${PERSON_SAME_TEAM}`, exact: true }).getByRole("button", { name: NOT_A_PLAYER, exact: true }),
      "a person's name under the same team still asks",
    ).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    // The team created on #1 reached #2: its Team tile asks nothing.
    await expect(teamTile).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await skipCard(page);

    // ── STEP 3: #3, "Checklist", keeps its name and is a walk stop for its team: no automatic No team ──
    await expect(tidyCardHeader(page, "#3 · Checklist"), "the Checklist row keeps its name").toBeVisible();
    await expectCardSettled(page);
    await expect(titleLine(/ Checklist #3( |$)/), "the card's name is in its title").toBeVisible();
    await expect(playerTile, "a Checklist row names no player").toHaveCount(0);
    await expect(cardNameTile, "a Checklist row has its name").toHaveCount(0);
    await expect(pinkTile(page, "Team"), "a Checklist row gets no automatic No team").toHaveCount(1);
    const noTeamOnCard = teamTile.getByRole("button", { name: "No team on this card", exact: true });
    await expect(noTeamOnCard).toBeVisible();
    await expect(walk.getByText(RULED_OUT_FOR_YOU)).toHaveCount(0);
    await expect(saveUsable).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a Checklist row asked for its team" });
    await noTeamOnCard.click();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(saveUsable, "the operator's No team settled the Checklist card").toBeVisible();
    await saveAndNext(page);

    // ── STEP 4: counter-fixture #4, a person with a blank team cell, asks both ──
    await expect(tidyCardHeader(page, `#4 · ${PERSON_NO_TEAM}`)).toBeVisible();
    await expect(pinkTile(page, "Team"), "a person with a blank team cell is asked for a team").toHaveCount(1);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await skipCard(page);

    // ── STEP 5: the end screen (#5 was never shown), the pill, and two cards read back ──
    await expect(walk.getByText("2 cards skipped, not ready to list", { exact: true })).toBeVisible();
    // #1 and #3 saved, #2 and #4 skipped: the walk counts the cards it passed.
    await expect(walk.getByText("2 cards fixed, 2 skipped.", { exact: true })).toBeVisible();
    await expect(cardLines("5"), "the fan-out settled #5, so the walk never showed it").toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk end screen with its tally" });
    await finishTidyWalk(page);

    await expect(needsYouPill(page)).toHaveAccessibleName("2 need you, 2 to fix");
    const fannedOut = await openCardDrawer(page, "5");
    await expect(fannedOut.getByRole("button", { name: `Remove team ${CLUB}`, exact: true }), "the team reached #5").toBeVisible();
    await expect(anyPlayerChip(fannedOut), "Not a player reached #5").toHaveCount(0);
    await closeCardDrawer(fannedOut);
    const checklistCard = await openCardDrawer(page, "3");
    await expect(checklistCard.getByRole("button", { name: "No Team for this card", pressed: true })).toBeVisible();
    await expect(checklistCard.getByRole("button", { name: /^Remove team / }), "the Checklist card holds no team").toHaveCount(0);
    await expect(anyPlayerChip(checklistCard), "the Checklist card names no player").toHaveCount(0);
    await expect(checklistCard.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue("Checklist");
    await expect(checklistCard.getByRole("textbox", { name: "Card title", exact: true })).toHaveValue(/ Checklist #3( |$)/);
    await closeCardDrawer(checklistCard);
  },
);
