// R1 - ONE feature (NEO-330, on the NEO-645 walk): a hand-added card linked to a catalogue player
// whose career has NO stint covering the set's year, across two or more teams, is asked for its
// team on the walk's Team tile with the player's WHOLE career offered and NOTHING preselected: "No
// 2024 team on file. Here's the whole career, so pick the one on the card." The fallback is a list
// to choose from, never an answer (before NEO-330 it arrived preselected and one Enter wrote a whole
// career onto a one-team card). Save & next stays held until the operator picks a team and saves
// it; the card then holds that team.
//
// THE ONE-TEAM LEGEND RULE IS THE EXCEPTION (NEO-335 Phase 2, `oneTeamCareerInLeague`,
// convex/lib/teamFill.ts): a retired player with ONE career team in the set's league IS
// preselected ("Suggested from career history.", "<team> · <player> played here"), because a
// legends insert prints that team. So the claim needs a multi-team career, and a second card is the
// positive control: the catalogue's one-team George Brett on the same set IS preselected. Without
// the control, a tile that never preselected anything would pass this spec.
//
// The flow: quick-add card #851 with the catalogue's Ozzie Smith and #852 with George Brett, both
// with no team, so both are badged "no team on this card yet" at once (no marketplace ref, nothing
// to wait for) and the pill reads "2 need you, 2 to fix". The pill opens the walk on #851: the Team
// tile is pink, its career chips "San Diego Padres · 1978–1981" and "St. Louis Cardinals · 1982–1996"
// are NOT pressed (one player's years carry no name prefix; a preselected chip would read "· Ozzie
// Smith played here" instead),
// there is no Save team button (a click on a team saves it), and Save & next is held. Clicking a chip
// writes it: the tile shows the plain "Team St. Louis Cardinals" row and Save & next moves to #852,
// where Brett's one team is PRESELECTED under "Suggested from career history."; clicking it saves it
// and Save & next reaches
// the end screen. Back returns to #852 with its team; Save for later closes the walk. The rows print
// the teams, the badges and the pill are gone, and the drawer (the stored card) holds exactly the
// team each card was given.
//
// R2 - every move has its positive and its negative: chips with no aria-current beside no Save team;
// the saved row beside the tile no longer pink; the legend's preselected chip (aria-current) beside
// the multi-team card's none; the row's
// team beside the badge and pill gone.
//
// R3 - not here: "Other team…" search picks (`tidy-up-team-tile-other-team-links-existing-teams-…`),
// a career chip PRESELECTED by a covering stint (`checklist-prospect-and-place-team-cells-…`), the
// Q1-A fill at the commit (`tidy-up-team-fill-writes-the-one-career-team-with-a-note`), Skip / Esc /
// Enter (`tidy-up-walk-one-card-at-a-time`). The listing's era chips ("The listing names …") need a
// BSC team hint, written only on a marketplace-linked card: unit-tested.
//
// Desktop and mobile - the walk is full-screen on a phone with the same controls and names; nothing
// branches. axe (light and dark) on the Team tile with the career offered and nothing picked, with
// the chip picked, and with the legend's chip preselected.
//
// FIXTURE - the reference catalogue (read-only probe of the seeded deployment, 2026-11-22): exactly
// one Baseball `players` row "Ozzie Smith" with two stints, San Diego Padres 1978-1981 and St. Louis
// Cardinals 1982-1996 (both MLB), and exactly one "George Brett" with one stint, Kansas City Royals
// 1973-1993 (MLB). Retired careers, so their stints do not move. All are only READ: the quick-adds
// and the tiles write the CARDS alone.
//
// R7/R7a - WRITES go to a PER-ATTEMPT hand-made set `mtf<token>` under the REAL Baseball > 2024 >
// Topps (SET-REGISTRY.md, prefix `mtf`), `Insert` > `Base`, no marketplace id on any row. The real
// sport is load-bearing (the quick-add PlayerPicker searches it, where the catalogue's rows live;
// its league, MLB, is what the set's league list starts with, which the legend rule reads), and the
// real 2024 year is what makes "No 2024 team on file" the fallback. Per attempt because the pill
// count and the walk are exact. Both cards are deleted at the end; the set stands.
//
// MINTED NAMES are single tokens: the set `mtf<token>` and the card names `TeamFixer<token>` and
// `LegendCheck<token>` (different words from the set, so the title generator never drops one as a
// repeat of the other).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, setBuilderReady } from "../../support/set-builder";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import { expectDrawerTeams } from "../../support/also-pictured";
import {
  expectCardsLeft,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  saveForLater,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

/** The multi-team retired player: no stint covers 2024, so nothing is preselected. */
const PLAYER = "Ozzie Smith";
const TEAM = "St. Louis Cardinals";
const OTHER_TEAM = "San Diego Padres";
const NUMBER = "851";
/** The positive control: a one-team legend in the set's league IS preselected. */
const LEGEND = { player: "George Brett", team: "Kansas City Royals", number: "852" } as const;

test(
  "Tidy Up Team tile — with no stint in the set's year the player's whole career is offered with nothing picked, and the team the operator picks lands on the card",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `mtf${env.ATTEMPT_TOKEN}`;
    const cardNameText = `TeamFixer${env.ATTEMPT_TOKEN}`;
    const legendNameText = `LegendCheck${env.ATTEMPT_TOKEN}`;
    const drill = {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    } as const;
    const noTeamMark = (number: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${number}(, .*)? needs attention: no team on this card yet$`) });
    const walk = tidyWalk(page);
    const team = tidyTile(page, "Team");
    // The career chips' list is labelled by its heading (the copy's apostrophe is matched loosely).
    const career = team.getByRole("list", {
      name: /^No 2024 team on file\. Here.s the whole career, so pick the one on the card\.$/,
    });
    // Not preselected, so each chip carries the player's years with the team, not "played here". One
    // player on the card, so the years stand alone, with no name in front (NEO-639 chip copy).
    const chip = career.getByRole("button", { name: `${TEAM} · 1982–1996`, exact: true });
    const otherChip = career.getByRole("button", { name: `${OTHER_TEAM} · 1978–1981`, exact: true });
    // A click on a team saves it: there is no Save team button at all.
    const saveTeam = team.getByRole("button", { name: /^Save teams?$/ });
    const savedRow = team.getByRole("group", { name: `Team ${TEAM}`, exact: true });
    // The walk's Career tile. Neither catalogue player's card may carry a Career check here: Save &
    // next ADDS an open gap's stint from the set's year (NEO-645 C8), which would write a 2024 stint
    // onto a read-only catalogue player. Asserted absent before each Save & next, so a check that
    // appears fails here by name instead of writing.
    const careerCheck = tidyTile(page, "Career");

    /** Quick-add a card linked to a catalogue player, with its Team row left EMPTY. */
    const addCatalogueCard = (number: string, player: string, cardName: string) =>
      addCardViaForm(page, {
        cardNumber: number,
        playerName: player,
        cardName,
        beforeSubmit: async () => {
          await page.getByRole("button", { name: "Add a player to the new card" }).click();
          const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
          await findPlayer.fill(player);
          // Full match, so another player whose name merely contains it cannot answer.
          await page.getByRole("option", { name: `Add ${player}`, exact: true }).click();
          await expect(page.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
          // Close the player popover before Submit (focusing a field commits nothing).
          await page.getByRole("textbox", { name: "Card name", exact: true }).click();
          await expect(findPlayer).toBeHidden();
        },
      });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: the hand-made set's Insert > Base checklist (R9), and the two cards by hand ──
    await drillToCustom(page, drill);
    await addCatalogueCard(NUMBER, PLAYER, cardNameText);
    await addCatalogueCard(LEGEND.number, LEGEND.player, legendNameText);
    // R2 precondition: both badged at once (no marketplace ref, no lookup to wait for), and the
    // pill counts the two alone (its name is its visible text, so the exact name is the exact count).
    await expect(editCardButton(page, NUMBER)).toBeVisible();
    await expect(noTeamMark(NUMBER)).toBeVisible();
    await expect(noTeamMark(LEGEND.number)).toBeVisible();
    await expect(needsYouPill(page)).toHaveText("2 need you, 2 to fix");

    // ── STEP 2: the walk opens on #851, its Team tile pink ──
    await openTidyWalk(page, { title: tidyUpName({ year: "2024", set }) });
    // The header names the LINKED player (not the card name), so the link is on the card.
    await expect(tidyCardHeader(page, `#${NUMBER} · ${PLAYER}`)).toBeVisible();
    await expectCardsLeft(page, 2);
    await expect(team).toHaveAccessibleDescription("To fix");

    // ── STEP 3: THE CLAIM: the whole career offered, NOTHING picked, Save & next held ──
    // The list renders only once the suggestion query has answered, so it gates the reads below.
    await expect(chip).toBeVisible();
    await expect(chip).not.toHaveAttribute("aria-current", "true");
    await expect(otherChip).not.toHaveAttribute("aria-current", "true");
    // Nothing preselected, nothing written: a click on a chip is what saves.
    await expect(saveTeam).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toBeVisible();
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile, whole career offered with nothing picked" });

    // ── STEP 4: the operator clicks one career team: that saves it, with no Save team step ──
    // ── STEP 5: Save & next is usable and moves to the legend's card ──
    await chip.click();
    await expect(savedRow).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(career).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expect(careerCheck, "no Career check on the catalogue player's card for Save & next to write").toHaveCount(0);
    await saveAndNext(page);

    // ── STEP 6 (POSITIVE CONTROL): the one-team legend IS preselected; a click saves it ──
    await expect(tidyCardHeader(page, `#${LEGEND.number} · ${LEGEND.player}`)).toBeVisible();
    await expectCardsLeft(page, 1);
    const suggested = team.getByRole("list", { name: "Suggested from career history.", exact: true });
    const legendChip = suggested.getByRole("button", { name: `${LEGEND.team} · ${LEGEND.player} played here`, exact: true });
    await expect(legendChip, "a one-team legend in the set's league is preselected").toHaveAttribute("aria-current", "true");
    // A preselect is not a write: the tile is still pink until the chip is clicked.
    await expect(team).toHaveAccessibleDescription("To fix");
    await expect(career).toHaveCount(0);
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile, a one-team legend preselected" });
    await legendChip.click();
    await expect(team.getByRole("group", { name: `Team ${LEGEND.team}`, exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(careerCheck, "no Career check on the legend's card for Save & next to write").toHaveCount(0);
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await expectCardsLeft(page, 0);

    // Back: the browser's Back steps to the last card, which shows the team it saved and asks nothing.
    await page.goBack();
    await expect(tidyCardHeader(page, `#${LEGEND.number} · ${LEGEND.player}`)).toBeVisible();
    await expect(team.getByRole("group", { name: `Team ${LEGEND.team}`, exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await saveForLater(page);

    // ── STEP 7: the rows print the teams; the badges and the pill are gone ──
    // The sub-line is a query-rendered read of the stored team ids, not a draft echo.
    await expect(page.getByText(TEAM, { exact: true })).toBeVisible();
    await expect(page.getByText(LEGEND.team, { exact: true })).toBeVisible();
    await expect(noTeamMark(NUMBER)).toHaveCount(0);
    await expect(noTeamMark(LEGEND.number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);
    await expect(editCardButton(page, NUMBER)).toBeVisible();

    // A fresh drill reads the stored cards: exactly the one team each was given. Each card is
    // deleted once it is read (CLEANUP, R7): the drawer helper leaves the card search on its number,
    // so the next card's read searches again before its delete.
    await drillToCustom(page, drill);
    for (const [number, teams] of [[NUMBER, [TEAM]], [LEGEND.number, [LEGEND.team]]] as const) {
      await expectDrawerTeams(page, number, [...teams]);
      await deleteCardButton(page, number).click();
      await confirmDeleteCardButton(page, number).click();
      await expect(editCardButton(page, number)).toHaveCount(0);
    }
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await expect(page.getByText(cardNameText, { exact: true })).toHaveCount(0);
  },
);
