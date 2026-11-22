// ONE FEATURE (R1, NEO-645 decisions 24 and 40): rows that explain themselves never ask. A card
// whose printed player name IS its printed team (a team card) is answered "Not a player" by NB,
// with a purple note saying why, and changeable; a checklist's "Checklist" row keeps "Checklist"
// as the card's name with No Team, and is never a walk stop.
//
// The operator meets it like this:
//   1. The walk opens on #1, the team card: three cards are left (#1, #2, #4; #3, the
//      "Checklist" card, is never one). #1 is in the walk only for its new team name: its
//      Player tile is not pink and says "<name> is not a player." with the note "Ruled out for
//      you: this card prints the same name as its team", and a Change player.
//   2. Creating the team on #1 leaves nothing pink on it: Save & next is usable, so the
//      auto-answer made no Player stop (two cards left).
//   3. "Change player" brings the name back, pink, the note gone (Save & next held, three left).
//      "Not a player" by hand answers it again, with no "Ruled out for you" note (the operator
//      said it, not NB), and Save & next moves on.
//   4. Counter-fixtures, so the rules can fail (R2): #2 prints the same team under a person's
//      name, and its Player tile asks (pink); #4 is a person with a BLANK team cell, and its Team
//      tile asks (pink). Skip, Skip: the walk lands on #4 straight from #2, never on #3.
//   5. The end screen tallies "1 card fixed, 2 skipped." beside "2 cards skipped, not ready to
//      list"; Done.
//   6. Read back: #3's drawer holds the card name "Checklist", No Team pressed, no player and no
//      team; the checklist's pill counts the two skipped cards.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `aut`/`auu` prefixes; R7a): a per-attempt sport
// `aut<token>` › 2026 › Topps › `auu<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted four-row checklist, no Match Cards, no BSC) and no name
// reaches Wikidata. The team `Auc<token> Club` is created on the walk's Team tile (teams are never
// looked up on creation). Not fresh-only: every name carries the attempt token. Nothing is
// deleted; the sport, its rows, the four cards and the team stand, and no player is made.
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
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";
/** The purple note on a name NB ruled out itself (tidy/parts/copy.ts `NOT_A_PLAYER_SAME_AS_TEAM_NOTE`). */
const SAME_AS_TEAM_NOTE = "Ruled out for you: this card prints the same name as its team";
/** The unanswered row's answer; on a multi-name card it carries " <printed>", which these cards are not. */
const NOT_A_PLAYER = "Not a player (checklist, team card, stadium)";

test(
  "Tidy Up — a team card's own name is answered Not a player for you, with a note and changeable, and a Checklist row keeps its name with No Team; neither is a walk stop",
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

    // ── FIXTURE: the hand-made leaf and its four-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(
      page,
      `number,player,team\n1,${CLUB},${CLUB}\n2,${PERSON_SAME_TEAM},${CLUB}\n3,Checklist,\n4,${PERSON_NO_TEAM},\n`,
      4,
    );
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 4 cards\./).first());
    expect(opened, "a new team name and two people, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));

    /** Any "#<number>…" line of a card, whoever it names. */
    const cardLines = (number: string) => walk.getByText(new RegExp(`^#${number}( · .+)?$`));
    const playerTile = tidyTile(page, "Player");
    const clubRow = playerTile.getByRole("group", { name: `Player ${CLUB}`, exact: true });
    const ruledOut = clubRow.getByText(`${CLUB} is not a player.`, { exact: true });
    const note = clubRow.getByRole("note");
    const change = clubRow.getByRole("button", { name: "Change player", exact: true });
    const notAPlayer = clubRow.getByRole("button", { name: NOT_A_PLAYER, exact: true });
    const saveUsable = tidyFooterButton(page, "saveAndNext", { usable: true });

    // ── STEP 1: #1, the team card, is in the walk only for its team name ──
    await expect(cardLines("1").first()).toBeVisible();
    await expectCardSettled(page);
    // #1, #2 and #4: the Checklist card #3 is not counted.
    await expectCardsLeft(page, 3);
    await expect(ruledOut).toBeVisible();
    await expect(note).toHaveText(SAME_AS_TEAM_NOTE);
    await expect(change).toBeVisible();
    await expect(notAPlayer).toHaveCount(0);
    await expect(pinkTile(page, "Player"), "the team card's own name makes no Player stop").toHaveCount(0);
    await expect(pinkTile(page, "Team"), "the new team name is what #1 is in the walk for").toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a team card's name ruled out for you" });

    // ── STEP 2: with its team created, #1 has nothing to fix ──
    expect(await createTeamOnOpenRow(page)).toBe(`Team ${CLUB}`);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(saveUsable, "nothing on the team card is pink: no Player stop").toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expectCardsLeft(page, 2);

    // ── STEP 3: Change brings the name back, pink; a by-hand answer carries no note ──
    await change.click();
    await expect(notAPlayer).toBeVisible();
    await expect(ruledOut).toHaveCount(0);
    await expect(note).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(mustFixLine(page)).toBeVisible();
    await expect(saveUsable).toHaveCount(0);
    await expectCardsLeft(page, 3);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, the team card's name changed back" });
    await notAPlayer.click();
    await expect(ruledOut).toBeVisible();
    await expect(change).toBeVisible();
    await expect(note, "the operator answered it, so NB does not say it ruled it out").toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await saveAndNext(page);

    // ── STEP 4: the counter-fixtures ask; #3 is never shown ──
    await expect(walk.getByText(`#2 · ${PERSON_SAME_TEAM}`, { exact: true })).toBeVisible();
    await expect(pinkTile(page, "Player"), "a person's name under the same team still asks").toHaveCount(1);
    await expect(
      playerTile.getByRole("group", { name: `Player ${PERSON_SAME_TEAM}`, exact: true }).getByRole("button", { name: NOT_A_PLAYER, exact: true }),
    ).toBeVisible();
    // The team created on #1 reached #2: its Team tile asks nothing.
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await skipCard(page);
    await expect(walk.getByText(`#4 · ${PERSON_NO_TEAM}`, { exact: true })).toBeVisible();
    await expect(cardLines("3"), "the Checklist card is never a walk stop").toHaveCount(0);
    await expect(pinkTile(page, "Team"), "a person with a blank team cell is asked for a team").toHaveCount(1);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await skipCard(page);

    // ── STEP 5: the end screen's tally ──
    await expect(walk.getByText("2 cards skipped, not ready to list", { exact: true })).toBeVisible();
    await expect(walk.getByText("1 card fixed, 2 skipped.", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk end screen with its tally" });
    await finishTidyWalk(page);

    // ── STEP 6: read back the Checklist card, and the pill ──
    await expect(needsYouPill(page)).toHaveAccessibleName("2 need you, 2 to fix");
    const drawer = await openCardDrawer(page, "3");
    await expect(drawer.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue("Checklist");
    await expect(drawer.getByRole("button", { name: "No Team for this card", pressed: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: /^Remove team / }), "the Checklist card holds no team").toHaveCount(0);
    await expect(anyPlayerChip(drawer), "the Checklist card names no player").toHaveCount(0);
    await closeCardDrawer(drawer);
  },
);
