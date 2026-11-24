// R1 - ONE feature (NEO-639 on the NEO-645 walk): the Tidy Up walk's Team tile PRESELECTS a
// teamless card's career team only when the player's career gives exactly that one team for the
// set's season, and never against the set's own answer. One rule, three cases:
//   1. a player with ONE team in the window (the set year and the year before): that chip is
//      preselected ("<team>, suggested · <player> played here") under "Suggested from career history.";
//   2. a player with TWO teams that season (a tie no rule breaks): neither chip is pressed, each
//      shows the player's years with the team (no name before them on a one-player card, NEO-645
//      C8), under "From the career. More than one team that
//      season, so pick the one on the card.";
//   3. after the SET is saved as No Team (the "Mark N teamless cards No Team" offer is declined, so
//      the cards stay teamless): the one-team player's chip is offered with his years and NOT
//      pressed, under "From the player's other cards. This set says No Team, so pick one only if
//      it's on the card." (#961 holds the team by then), and once the operator saves that team "Apply to all" is still offered to the
//      player's other teamless card (main's wizard, NEO-645 C8): the set's No Team holds back
//      what NB guesses, never what the operator answers.
// Replaces the retired attention walker's `checklist-missing-team-fixer-preselects-one-set-year-
// team` (deleted in the NEO-639 merge); the walker's tie-focus check went with the walker (the
// walk moves focus by its own rule, `useAnswered`, covered by its unit tests).
//
// R2 - every negative beside a positive: claim 1's preselected chip (", suggested" in its name) beside the tile
// still pink (a preselect is not a write) and no Save team; claim 2's preselected count 0 beside both
// chips visible with their years, and no Save team; claim 3's unpressed chip beside its list
// heading, and "Apply to the other <player> card" (#964, same player, teamless) beside the saved
// team row, as #961's save offered #963 and #964 before the No Team.
//
// R3 - not here: the whole-career fallback when no stint covers the year
// (`tidy-up-team-tile-offers-the-whole-career-unpicked-…`), Apply to all's writes and counts
// (`tidy-up-team-apply-to-all-…`), the commit's Q1-A fill (`tidy-up-team-fill-writes-…`), the No
// Team run itself (`set-no-team…`). Chip and heading precedence is unit-tested (TeamFillChips,
// copy.ts careerHeading).
//
// Desktop and mobile: the walk is full-screen on a phone with the same names; nothing branches.
// axe (light and dark) on the Team tile in each of the three states.
//
// FIXTURE (SET-REGISTRY.md, prefix `mtp-`; R7a): the worker's custom sport (`customSport(env)`, no
// Wikidata config, so the minted players are never looked up) › 2026 › Topps › a per-attempt
// hand-made set `mtp-<worker>-<attempt>` › Insert › Base, no marketplace id anywhere. On
// /admin/players two minted players with careers at three minted teams:
//   SOLO `Mtps<token>`  one stint, `MTA<token>X` 2025-2027 (the only team in [2025, 2026])
//   TIE  `Mtpt<token>`  `MTB<token>X` 2025-2027 and `MTC<token>X` 2026-2026 (two in 2026)
// Four quick-added teamless cards linked to them in the form's PlayerPicker: #961 SOLO, #962 TIE,
// #963 SOLO, #964 SOLO (quick-add never fills a team, so each is pink "no team on this card yet").
// No card name beyond the player's own (NEO-656 J5, blue is live): with a minted card name the title
// "2026 Topps mtp-… Base Mtpcard… Mtps… #961" has no room for the minted team, so a saved team turns
// the card blue "listing title was cut short" and no Save & next clears it. Without one the title
// keeps the team on every worker and token length (assessListingTitle, computed offline).
// The walk visits them in number order. All four are DELETED at the end; the set (left at No Team),
// its rows, the players and the teams stand. Per attempt because the pill and the walk are exact.
// Names are single tokens ending in a letter, so no attempt's token prefixes another's. Not
// fresh-only.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { customSport, drillToCustom, setBuilderReady } from "../../support/set-builder";
import {
  addCardViaForm,
  cardAttentionMark,
  confirmDeleteCardButton,
  deleteCardButton,
  editCardButton,
  escapeRe,
} from "../../support/cards";
import { addCareerStint, addPlayerByHand, createTeamInCareerEditor, expectPlayersLoaded } from "../../support/players";
import {
  expectCardsLeft,
  needsYouPill,
  openTidyWalk,
  saveAndNext,
  saveForLater,
  skipCard,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
} from "../../support/tidy-walk";

const YEAR = "2026";

test(
  "Tidy Up Team tile — a player's one team that season is preselected; a tie, or a set saved as No Team, preselects nothing and shows his years",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = customSport(env);
    const SET = `mtp-${env.WORKER_INDEX}-${env.ATTEMPT_ID}`;
    const target = { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET } as const;
    const base = { ...target, variantType: "Insert", variant: "Base" } as const;
    const SOLO = `Mtps${T}`;
    const TIE = `Mtpt${T}`;
    const TEAM_A = `MTA${T}X`;
    const TEAM_B = `MTB${T}X`;
    const TEAM_C = `MTC${T}X`;
    const CARDS = [
      { number: "961", player: SOLO },
      { number: "962", player: TIE },
      { number: "963", player: SOLO },
      { number: "964", player: SOLO },
    ] as const;
    const empty = page.getByText("No cards in this checklist yet.");

    const team = tidyTile(page, "Team");
    // The career chips' list is labelled by the line over it (TeamFillChips, copy.ts careerHeading).
    const careerList = (heading: RegExp) => team.getByRole("list", { name: heading });
    const SUGGESTED = /^Suggested from career history\.$/;
    const TIED = /^From the career\. More than one team that season, so pick the one on the card\.$/;
    // #961 holds TEAM_A by then, so the offer's source is the player's other cards, not his career.
    const SET_SAYS_NO_TEAM = /^From the player.s other cards\. This set says No Team, so pick one only if it.s on the card\.$/;
    // A chip is a button that saves its team; preselected it reads "<team>, suggested · <player> played here",
    // otherwise "<team> · <years>" (one player on the card, so no name before the years; NEO-645 C8).
    const chip = (teamName: string, suffix: string) =>
      team.getByRole("button", { name: `${teamName} · ${suffix}`, exact: true });
    const suggestedChip = (teamName: string, suffix: string) =>
      team.getByRole("button", { name: `${teamName}, suggested · ${suffix}`, exact: true });
    const anySuggested = team.getByRole("button", { name: /, suggested/ });
    const saveTeam = team.getByRole("button", { name: /^Save teams?$/ });
    const savedTeamRow = (teamName: string) => team.getByRole("group", { name: `Team ${teamName}`, exact: true });
    const applyToAll = team.getByRole("button", {
      name: new RegExp(`^Apply to (all [0-9]+ other|the other) ${escapeRe(SOLO)} cards?$`),
    });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made set's Insert > Base, empty (R9; this also makes the custom sport) ──
    await drillToCustom(page, base);
    await expect(empty).toBeVisible();

    // ── FIXTURE: two players with careers, on the product's admin screen ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, SOLO, SPORT);
    await createTeamInCareerEditor(page, { search: TEAM_A });
    await addCareerStint(page, { search: TEAM_A, full: TEAM_A, from: "2025", to: "2027" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(SOLO)}`))).toBeVisible();
    await addPlayerByHand(page, TIE, SPORT);
    await createTeamInCareerEditor(page, { search: TEAM_B });
    await createTeamInCareerEditor(page, { search: TEAM_C });
    await addCareerStint(page, { search: TEAM_B, full: TEAM_B, from: "2025", to: "2027" });
    await addCareerStint(page, { search: TEAM_C, full: TEAM_C, from: "2026", to: "2026" });
    await expect(page.getByRole("list", { name: "Career history" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${escapeRe(TIE)}`))).toBeVisible();

    // Back returns to the set builder with the drill restored (the navigation lives in the URL).
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── FIXTURE: four quick-added cards, each linked to its player, NO team ──
    for (const card of CARDS) {
      await addCardViaForm(page, {
        cardNumber: card.number,
        playerName: card.player,
        beforeSubmit: async () => {
          await page.getByRole("button", { name: "Add a player to the new card" }).click();
          const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
          await findPlayer.fill(card.player);
          await page.getByRole("option", { name: `Add ${card.player}`, exact: true }).click();
          await expect(page.getByRole("button", { name: `Remove player ${card.player}` })).toBeVisible();
          // Close the player popover before Submit.
          await page.getByRole("textbox", { name: "Card name", exact: true }).click();
          await expect(findPlayer).toBeHidden();
        },
      });
    }
    for (const card of CARDS) {
      await expect(cardAttentionMark(page, card.number, "no team on this card yet")).toBeVisible();
    }
    await expect(needsYouPill(page)).toHaveText("4 need you, 4 to fix");

    // ── STEP 1: #961, ONE team in the window: its chip is PRESSED ──
    await openTidyWalk(page, { title: tidyUpName({ year: YEAR, set: SET }) });
    await expectCardsLeft(page, 4);
    await expect(tidyCardHeader(page, `#961 · ${SOLO}`)).toBeVisible();
    await expect(team).toHaveAccessibleDescription("To fix");
    const suggested = careerList(SUGGESTED);
    await expect(suggestedChip(TEAM_A, `${SOLO} played here`)).toBeVisible();
    await expect(suggested.getByRole("button")).toHaveCount(1);
    // A preselect is a choice, not a write: there is no Save team, and the tile is still pink.
    await expect(saveTeam).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile, the one set-year team preselected" });

    // Clicked, it saves, and offers itself to SOLO's other teamless cards (#963, #964): the counterpart of step 3.
    await suggestedChip(TEAM_A, `${SOLO} played here`).click();
    await expect(savedTeamRow(TEAM_A).getByRole("button", { name: `Edit ${TEAM_A}`, exact: true })).toBeVisible();
    await expect(suggested).toHaveCount(0);
    await expect(applyToAll).toHaveText(`Apply to all 2 other ${SOLO} cards`);
    await saveAndNext(page);

    // ── STEP 2: #962, a TIE in the window: NOTHING pressed, each chip shows his years ──
    await expect(tidyCardHeader(page, `#962 · ${TIE}`)).toBeVisible();
    await expect(team).toHaveAccessibleDescription("To fix");
    const tied = careerList(TIED);
    await expect(chip(TEAM_B, "2025–2027")).toBeVisible();
    await expect(chip(TEAM_C, "2026")).toBeVisible();
    await expect(tied.getByRole("button")).toHaveCount(2);
    await expect(anySuggested).toHaveCount(0);
    await expect(saveTeam).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile, a set-year tie with nothing picked" });

    // Back: the browser's Back steps to #961, which shows the team it saved and asks nothing.
    await page.goBack();
    await expect(tidyCardHeader(page, `#961 · ${SOLO}`)).toBeVisible();
    await expect(savedTeamRow(TEAM_A)).toBeVisible();
    await expect(team).not.toHaveAccessibleDescription("To fix");
    await saveForLater(page);

    // ── STEP 3: the SET says No Team; the offer to mark the cards already here is declined ──
    await drillToCustom(page, target);
    const panel = page.getByRole("region", { name: "Set attributes panel" });
    await expect(panel.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    const edit = panel.getByRole("button", { name: "Edit attributes" });
    const hide = panel.getByRole("button", { name: "Hide attributes" });
    await expect(edit.or(hide)).toBeVisible();
    if (await edit.isVisible()) await edit.click();
    await expect(hide).toBeVisible();
    const noTeamToggle = (pressed: boolean) => panel.getByRole("button", { name: "No Team for new cards here", pressed });
    await noTeamToggle(false).click();
    const confirm = page.getByRole("dialog", { name: "Set this set to No Team?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Yes, set No Team" }).click();
    await expect(page.getByText("No Team applied to the checklists under this set")).toBeVisible();
    await expect(noTeamToggle(true)).toBeVisible();
    // The offer is real (the three teamless cards) and is left alone: the cards stay teamless.
    await expect(page.getByRole("button", { name: "Mark 3 teamless cards No Team" })).toBeVisible();

    await drillToCustom(page, base);
    for (const number of ["962", "963", "964"]) {
      await expect(cardAttentionMark(page, number, "no team on this card yet")).toBeVisible();
    }
    await expect(editCardButton(page, "961")).toBeVisible();
    await expect(cardAttentionMark(page, "961")).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveText("3 need you, 3 to fix");

    // ── STEP 4: #963 under No Team: the one-team chip is OFFERED, NOT pressed, with his years ──
    await openTidyWalk(page, { title: tidyUpName({ year: YEAR, set: SET }) });
    await expectCardsLeft(page, 3);
    await expect(tidyCardHeader(page, `#962 · ${TIE}`)).toBeVisible();
    await skipCard(page);
    await expect(tidyCardHeader(page, `#963 · ${SOLO}`)).toBeVisible();
    await expect(team).toHaveAccessibleDescription("To fix");
    const underNoTeam = careerList(SET_SAYS_NO_TEAM);
    await expect(chip(TEAM_A, "2025–2027")).toBeVisible();
    await expect(underNoTeam.getByRole("button")).toHaveCount(1);
    await expect(anySuggested).toHaveCount(0);
    await expect(saveTeam).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile under a No Team set, nothing picked" });

    // The operator clicks the chip, which saves it: the team lands, and the No Team set still offers
    // the operator's answer to #964 (SOLO, teamless), the one card left on his line (NEO-645 C8).
    // It is not pressed, so #964 stays teamless.
    await chip(TEAM_A, "2025–2027").click();
    await expect(savedTeamRow(TEAM_A).getByRole("button", { name: `Edit ${TEAM_A}`, exact: true })).toBeVisible();
    await expect(team).not.toHaveAccessibleDescription("To fix");
    await expect(applyToAll).toHaveText(`Apply to the other ${SOLO} card`);
    await expectAccessible(page, { within: team, label: "Tidy Up Team tile under a No Team set, team saved" });
    await saveForLater(page);
    await expect(cardAttentionMark(page, "964", "no team on this card yet")).toBeVisible();

    // ── CLEANUP (R7): delete this attempt's four cards ──
    for (const card of CARDS) {
      await deleteCardButton(page, card.number).click();
      await confirmDeleteCardButton(page, card.number).click();
      await expect(editCardButton(page, card.number)).toHaveCount(0);
    }
    await expect(empty).toBeVisible();
  },
);
