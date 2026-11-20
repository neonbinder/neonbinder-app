// NEO-426 (R1): "No teams in this sport" is a default, never a block. A team a BuySportsCards
// listing names wins over it: a new card whose only person has a teamless home sport, but
// whose listing names a team NeonBinder holds, saves WITH that team, is not stamped No Team,
// and nothing about the default is said. The one feature, as an operator meets it:
//   1. The worker's custom sport is marked teamless (its own row, never a shared sport).
//   2. The FIRST fetch of a real set leaves card B-1 to BSC: the uploaded publisher's
//      checklist answers the other 28 cards and has no row for B-1, so B-1's team comes
//      from its listing alone ("Arizona State Sun Devils", a team on file).
//   3. B-1's person is new. The operator moves him to the teamless sport (Baseball left
//      off his sports) and adds him; every other name is skipped.
//   4. Save says nothing about No Team: the default does not reach a card a listing gave
//      a team (invariant 8: a data claim holds a default back).
//   5. The committed card B-1 has its person and the listed team, reads no "No Team", is
//      not badged, and its card editor shows the team and "No Team for this card" off.
//      A reload reads it back from the server, where the commit's stamp is decided.
// The other half (BSC answering NO team leads to the default) is
// `sport-no-teams-bsc-no-team-answer-saves-no-team`.
//
// FIXTURE (SET-REGISTRY.md, "ONIT Athlete Arizona State Sun Devils", approved by Jason
// 2026-11-19): `Baseball › 2026 › ONIT Athlete › ONIT Athlete Arizona State Sun Devils ›
// Base`, a real set the seed's year-wide 2026 Sets sync lists. This spec is its SOLE
// WRITER and FRESH-ONLY: it commits the set's 29 cards, creates B-1's person in the
// worker's custom sport and records 26 "not a person" skips; a second run on the same
// seed fails by name at "No cards in this checklist yet." (re-seed first; CI seeds each
// pass). Its file is the set's capture with B-1's row left out
// (`2026-onit-athlete-arizona-state-sun-devils-base-one-live`), so the spec makes ONE
// live per-card BSC read (GUIDE "Checklist first"); that card-listing is recorded in the
// fake. Nothing is minted. It is also the sole writer of the worker's custom sport's
// teamless flag for its length; the body turns it off and the afterEach does so on a
// second page if the body did not (R7). A review batch a red body leaves open is
// discarded by the next run's own start (`discardResumedReviewBatch`).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import type { Page } from "@playwright/test";
import { columnOption, columnSelection, customSport, drillToBaseVariant, escapeRe, setBuilderReady } from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { CHECKLISTS, checklistRows } from "../../support/published-checklist";
import { ensureSportHasTeams, openSportAttributes, pressTeamlessToggle, teamlessToggle } from "../../support/teamless-sport";
import {
  answerPlayerAsNew,
  awaitLookupsSettled,
  confirmSaveButton,
  discardResumedReviewBatch,
  expectNothingDecided,
  expectWizardStep,
  fetchChecklistToWizard,
  personSkip,
  reviewWizard,
  skipEveryNameBut,
  STEP_SUBTITLE,
} from "../../support/wizard";

const TARGET = { year: "2026", manufacturer: "ONIT Athlete", set: "ONIT Athlete Arizona State Sun Devils" };
const FETCH = { checklist: CHECKLISTS.onitArizonaState2026OneLive, firstFetch: true };
/** The one card the uploaded file leaves to BSC. */
const LIVE_CARD = "B-1";
/** The set's own sport, the one he would be born in. */
const SET_SPORT = "Baseball";

/** What the afterEach must undo, recorded before each write is made. */
const written: { sport?: string; sportFlagged: boolean } = { sportFlagged: false };

/** A checklist row is one run of text; the match stops at the next row's "#" (and "B-1" never reads as "B-10"). */
function rowSays(page: Page, number: string, text: string) {
  return page.getByText(new RegExp(`#${escapeRe(number)}(?![0-9])[^#]*${escapeRe(text)}`));
}

test.afterEach(async ({ page }, testInfo) => {
  if (!written.sportFlagged || !written.sport) return;
  const sport = written.sport;
  const bodyFailed = testInfo.status !== testInfo.expectedStatus;
  // A page of its own, so a red body's screenshot stays whole.
  const tidy = await page.context().newPage();
  try {
    await ensureSportHasTeams(tidy, sport);
    written.sportFlagged = false;
  } catch (error) {
    // The body's own error stays the one the report shows (a throw here would replace it).
    if (!bodyFailed) throw error;
    testInfo.annotations.push({ type: "cleanup-failed", description: `turn No teams in this sport off: ${String(error)}` });
  } finally {
    await tidy.close();
  }
});

test(
  "No teams in this sport — a team the BuySportsCards listing names beats the default: the card keeps it and is not stamped No Team (NEO-426)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const sport = customSport(env);
    // B-1's person and team are read off the full capture (BSC's own answers), never typed.
    const live = checklistRows(CHECKLISTS.onitArizonaState2026Full).find((row) => row.number === LIVE_CARD);
    expect(live, `the capture has a row for ${LIVE_CARD}`).toBeDefined();
    const person = live!.player;
    const team = live!.team;
    written.sport = sport;
    written.sportFlagged = false;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ══ 1. THE SPORT: the worker's own custom sport, marked teamless ══
    await openSportAttributes(page, sport);
    // R2 precondition: the sport starts with teams (a leftover flag fails here, by name).
    await expect(teamlessToggle(page, false)).toBeVisible();
    written.sportFlagged = true; // from the press on, the afterEach owns turning it off
    await pressTeamlessToggle(page, false);
    // Navigation lives in the URL: Back is the Sports column with nothing picked, Forward the sport again.
    await page.goBack();
    await expect(columnOption(page, "Sports", SET_SPORT)).toBeVisible();
    await expect(columnSelection(page, "Sports", sport)).toHaveCount(0);
    await page.goForward();
    await expect(columnSelection(page, "Sports", sport)).toBeVisible();
    await expect(page.getByRole("heading", { name: `Attributes for ${sport} (Sport)` })).toBeVisible();

    // ══ 2. THE FIRST FETCH: 28 cards answered by the file, B-1 by its BSC listing ══
    // `fetchChecklistToWizard` asserts the set is still empty (fresh-only), then "Teams from
    // your checklist: 28 of N cards" (28 read off the file) inside Match Cards, keeping B-1.
    await fetchChecklistToWizard(page, env, TARGET, FETCH);
    await discardResumedReviewBatch(page, env, TARGET, FETCH);
    await expectNothingDecided(page);
    const wizard = reviewWizard(page);

    // ══ 3. THE NAMES: B-1's person moved to the teamless sport and added; the rest skipped ══
    await skipEveryNameBut(page, person, async () => {
      await expect(wizard.getByRole("heading", { level: 3, name: person, exact: true })).toBeVisible();
      const inSetSport = wizard.getByRole("button", { name: `Sport for this name: ${SET_SPORT}` });
      await expect(inSetSport).toBeVisible();
      await inSetSport.click();
      const chooser = wizard.getByRole("listbox", { name: "Choose a sport" });
      await expect(chooser).toBeVisible();
      await chooser.getByRole("option", { name: sport, exact: true }).click();
      await expect(chooser).toBeHidden();
      // The move re-asks his lookup in the new sport (none: a custom sport has no Wikidata mapping).
      await awaitLookupsSettled(page);
      await expect(personSkip(page)).toHaveAccessibleName(`Skip ${person} — not a person`);
      await expect(wizard.getByRole("button", { name: `Sport for this name: ${sport}` })).toBeVisible();
      // His HOME sport is the teamless one, and Baseball is not added beside it.
      const alsoSetSport = wizard.getByRole("checkbox", { name: `Also add ${SET_SPORT} to their sports` });
      await expect(alsoSetSport).toBeVisible();
      await expect(alsoSetSport).not.toBeChecked();
      await answerPlayerAsNew(page);
    });

    // ══ 4. SAVE: nothing about No Team; the listed team holds the default back ══
    await expectWizardStep(page, STEP_SUBTITLE.save);
    const saveHeading = wizard.getByRole("heading", { level: 3, name: /^Save [0-9]+ cards\?$/ });
    await expect(saveHeading).toBeVisible();
    await expect(wizard.getByText(/saves? with No Team/)).toHaveCount(0);
    await confirmSaveButton(page).click();
    await expect(wizard).toBeHidden();

    // ══ 5. THE CARD: its person, the listed team, and no No Team ══
    const card = editCardButton(page, LIVE_CARD);
    await expect(card).toBeVisible();
    await expect(rowSays(page, LIVE_CARD, team)).toBeVisible();
    await expect(rowSays(page, LIVE_CARD, "No Team")).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(LIVE_CARD)}(, .*)? needs attention: `) }),
    ).toHaveCount(0);
    await expectAccessible(page, { label: "Checklist with a listed team kept over the sport's No Team default" });

    // Read back from the server, which decides the stamp at the commit: a fresh load of the
    // set keeps the team. Drilled again rather than reloaded: with SportLots paused this Base
    // is BSC-only and reads unmapped, so its address reopens the Base picker, which the drill
    // helper cancels the way every read of such a set does.
    await drillToBaseVariant(page, env, TARGET);
    // The card list is virtualised (about ten rows drawn, and a fresh load showed B-20..B-29):
    // the card is found the way an operator finds one, by its person in "Search cards".
    await page.getByRole("searchbox", { name: "Search cards" }).fill(person);
    await expect(card).toBeVisible();
    await expect(rowSays(page, LIVE_CARD, team)).toBeVisible();
    await expect(rowSays(page, LIVE_CARD, "No Team")).toHaveCount(0);
    await card.click();
    const cardName = page.getByRole("textbox", { name: "Card name" });
    await expect(cardName).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove player ${person}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "No Team for this card", pressed: false })).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // The sport asks for teams again.
    await openSportAttributes(page, sport);
    await pressTeamlessToggle(page, true);
    written.sportFlagged = false;
  },
);
