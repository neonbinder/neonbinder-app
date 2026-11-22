// R1 - ONE feature (NEO-330, on the NEO-645 walk): a hand-added card linked to a catalogue player
// whose career has NO stint covering the set's year is asked for its team on the walk's Team tile
// with the player's WHOLE career offered and NOTHING preselected: "No 2024 team on file. Here's the
// whole career, so pick the one on the card." The fallback is a list to choose from, never an
// answer (before NEO-330 it arrived preselected and one Enter wrote a whole career onto a one-team
// card). Save & next stays held until the operator picks a team and saves it; the card then holds
// that team.
//
// The flow: quick-add card #851 with the catalogue's George Brett and no team, so it is badged "no
// team on this card yet" at once (no marketplace ref, nothing to wait for) and the pill reads "1
// needs you". The pill opens the walk on it: the Team tile is pink, its career chip "Kansas City
// Royals · George Brett 1973–1993" is NOT pressed (a chip is pressed only when a stint covers the
// set's year; then it would read "· George Brett played here"), there is no Save team, and Save &
// next is held. The chip pressed is a choice, not a write: Save team appears, the tile stays pink
// and Save & next stays held. Save team writes it: the tile shows the plain "Team Kansas City
// Royals" row, Save & next reaches the end screen. Back returns to the card with its team; Save for
// later closes the walk. The row prints the team, the badge and the pill are gone, and the drawer
// (the stored card) holds exactly that team.
//
// R2 - every move has its positive and its negative: unpressed chip beside no pressed chip and no
// Save team; pressed chip beside the still-pink tile and held Save & next; the saved row beside
// the tile no longer pink; the row's team beside the badge and pill gone.
//
// R3 - not here: "Other team…" search picks (`tidy-up-team-tile-other-team-links-existing-teams-…`),
// a career chip PRESELECTED by a covering stint (`checklist-prospect-and-place-team-cells-…`), the
// Q1-A fill at the commit (`tidy-up-team-fill-writes-the-one-career-team-with-a-note`), Skip / Esc /
// Enter (`tidy-up-walk-one-card-at-a-time`). The listing's era chips ("The listing names …") need a
// BSC team hint, written only on a marketplace-linked card: unit-tested.
//
// Desktop and mobile - the walk is full-screen on a phone with the same controls and names; nothing
// branches. axe (light and dark) on the Team tile with the career offered and nothing picked, and
// with the chip picked.
//
// FIXTURE - the reference catalogue: exactly one Baseball `players` row "George Brett" with one
// stint, Kansas City Royals 1973-1993, and one Baseball team "Kansas City Royals" (so the chip's
// label is the bare name). Both are only READ: the quick-add and the tile write the CARD alone.
//
// R7/R7a - WRITES go to a PER-ATTEMPT hand-made set `mtf<token>` under the REAL Baseball > 2024 >
// Topps (SET-REGISTRY.md, prefix `mtf`), `Insert` > `Base`, no marketplace id on any row. The real
// sport is load-bearing (the quick-add PlayerPicker searches it, where the catalogue's rows live),
// and the real 2024 year is what makes "No 2024 team on file" the fallback. Per attempt because the
// pill count and the walk are exact. The card is deleted at the end; the set stands.
//
// MINTED NAMES are single tokens: the set `mtf<token>` and the card name `TeamFixer<token>` (a
// different word, so the title generator never drops one as a repeat of the other).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, setBuilderReady } from "../../support/set-builder";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import { expectDrawerTeams } from "../../support/also-pictured";
import { tidyUpName } from "../../support/wizard";
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
  tidyWalk,
} from "../../support/tidy-walk";

const PLAYER = "George Brett";
const TEAM = "Kansas City Royals";
const NUMBER = "851";

test(
  "Tidy Up Team tile — with no stint in the set's year the player's whole career is offered with nothing picked, and the team the operator picks lands on the card",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `mtf${env.ATTEMPT_TOKEN}`;
    const cardNameText = `TeamFixer${env.ATTEMPT_TOKEN}`;
    const drill = {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    } as const;
    const noTeamMark = page.getByRole("img", {
      name: new RegExp(`^Card ${NUMBER}(, .*)? needs attention: no team on this card yet$`),
    });
    const walk = tidyWalk(page);
    const team = tidyTile(page, "Team");
    // The career chips' list is labelled by its heading (the copy's apostrophe is matched loosely).
    const career = team.getByRole("list", {
      name: /^No 2024 team on file\. Here.s the whole career, so pick the one on the card\.$/,
    });
    // Not preselected, so the chip carries the player's years with the team, not "played here".
    const chip = (pressed: boolean) =>
      career.getByRole("button", { name: new RegExp(`^${TEAM} · ${PLAYER} 1973.1993$`), pressed });
    const saveTeam = team.getByRole("button", { name: /^Save teams?$/ });
    const savedRow = team.getByRole("group", { name: `Team ${TEAM}`, exact: true });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: the hand-made set's Insert > Base checklist (R9), and the card by hand ──
    await drillToCustom(page, drill);
    await addCardViaForm(page, {
      cardNumber: NUMBER,
      playerName: PLAYER,
      cardName: cardNameText,
      beforeSubmit: async () => {
        // The catalogue's George Brett, picked in the form's PlayerPicker. The Team row stays EMPTY:
        // that is the card this spec is about.
        await page.getByRole("button", { name: "Add a player to the new card" }).click();
        const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
        await findPlayer.fill(PLAYER);
        // Full match, so another player whose name merely contains "Brett" cannot answer.
        await page.getByRole("option", { name: `Add ${PLAYER}`, exact: true }).click();
        await expect(page.getByRole("button", { name: `Remove player ${PLAYER}` })).toBeVisible();
        // Close the player popover before Submit (focusing a field commits nothing).
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(findPlayer).toBeHidden();
      },
    });
    // R2 precondition: badged at once (no marketplace ref, no lookup to wait for), and the pill
    // counts it alone (its name is its visible text, so the exact name is the exact count).
    await expect(editCardButton(page, NUMBER)).toBeVisible();
    await expect(noTeamMark).toBeVisible();
    await expect(needsYouPill(page)).toHaveText("1 needs you");

    // ── STEP 2: the walk opens on this card, its Team tile pink ──
    await openTidyWalk(page, { title: tidyUpName({ year: "2024", set }) });
    // The header names the LINKED player (not the card name), so the link is on the card.
    await expect(tidyCardHeader(page, `#${NUMBER} · ${PLAYER}`)).toBeVisible();
    await expectCardsLeft(page, 1);
    await expect(team).toHaveAccessibleDescription("To fix");

    // ── STEP 3: THE CLAIM: the whole career offered, NOTHING picked, Save & next held ──
    // The list renders only once the suggestion query has answered, so it gates the reads below.
    await expect(chip(false)).toBeVisible();
    await expect(career.getByRole("button", { pressed: true })).toHaveCount(0);
    // Nothing chosen, nothing to save: Save team appears only with the first pressed chip.
    await expect(saveTeam).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toBeVisible();
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile, whole career offered with nothing picked" });

    // ── STEP 4: the operator picks the career team: a choice, not a write ──
    await chip(false).click();
    await expect(chip(true)).toBeVisible();
    await expect(saveTeam).toHaveText("Save team");
    await expect(team).toHaveAccessibleDescription("To fix");
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile, career team picked and not saved yet" });

    // ── STEP 5: Save team writes it; Save & next is usable and reaches the end ──
    await saveTeam.click();
    await expect(savedRow).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(career).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await saveAndNext(page);
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await expectCardsLeft(page, 0);

    // Back: the browser's Back steps to the card, which shows the team it saved and asks nothing.
    await page.goBack();
    await expect(tidyCardHeader(page, `#${NUMBER} · ${PLAYER}`)).toBeVisible();
    await expect(savedRow).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await saveForLater(page);

    // ── STEP 6: the row prints the team; the badge and the pill are gone ──
    // The sub-line is a query-rendered read of the stored team ids, not a draft echo.
    await expect(page.getByText(TEAM, { exact: true })).toBeVisible();
    await expect(noTeamMark).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);
    await expect(editCardButton(page, NUMBER)).toBeVisible();

    // A fresh drill reads the stored card: exactly the one team the operator picked.
    await drillToCustom(page, drill);
    await expectDrawerTeams(page, NUMBER, [TEAM]);

    // ── CLEANUP (R7): delete this attempt's card ──
    await deleteCardButton(page, NUMBER).click();
    await confirmDeleteCardButton(page, NUMBER).click();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await expect(page.getByText(cardNameText, { exact: true })).toHaveCount(0);
  },
);
