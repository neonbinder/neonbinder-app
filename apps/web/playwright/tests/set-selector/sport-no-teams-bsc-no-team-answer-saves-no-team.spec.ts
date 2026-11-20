// NEO-426 (R1): when BuySportsCards ANSWERS that a card has no team, and the card's
// only person is new and has a sport marked "No teams in this sport" as their home
// sport, the card takes No Team by default: the wizard asks nothing about its team
// and its Save step says why. The one feature, as an operator meets it:
//   1. The worker's custom sport is marked teamless (its own row, never a shared sport).
//   2. The fetch of a real set leaves card 1 to BSC: the uploaded publisher's checklist
//      answers every other card ("No Team", the hosts have none) and has no row for card
//      1, so BSC is asked about card 1 alone, and answers that it names no team.
//   3. Card 1's person, Lauren Shehadi, is new to NeonBinder. On her New Player step the
//      sport control says what it is for ("Sport for this name:"), and the operator moves
//      her to the teamless sport, Baseball left off her sports; she is added as new.
//   4. The names lead straight to Save, never through "Cards with no team", and the Save
//      step names her, says she saves with No Team and which sport has no teams.
//   5. A reader: Cancel, then Discard. Nothing is written to the set.
// The default needs BOTH halves: had BSC's lookup failed (a cooldown, an unrecorded
// read), or had she stayed in Baseball, card 1 would wait on "Cards with no team"
// (invariant 8: no answer, no default). The listed-team half (a team on the listing
// beats the default) is `sport-no-teams-listed-team-beats-the-default`; the pasted
// checklist path and the quick-add path are `sport-no-teams-saves-cards-no-team`.
//
// FIXTURE (SET-REGISTRY.md, "Topps Stars of MLB Network"): the shared READ-ONLY wizard
// fixture, `Baseball › 2024 › Topps › Topps Stars of MLB Network › Base`, a reader like
// the three others: it ends Cancel → Discard and NEVER commits (a commit would make its
// names known and the wizard would open on nothing). Its file is the set's capture with
// card 1's row left out (`2024-topps-stars-of-mlb-network-base-shehadi-live`), so the
// spec makes ONE live per-card BSC read (GUIDE "Checklist first"); that card-listing is
// recorded in the fake. Shehadi is a recorded Baseball no-match, so her lookup is a
// fixture hit; moved to the custom sport she costs none (no Wikidata mapping).
// SOLE WRITER of the worker's custom sport's teamless flag for the length of the test
// (as `sport-no-teams-saves-cards-no-team` is for its own); the body turns it off and
// the afterEach does so on a second page if the body did not (R7). Re-runnable: nothing
// is minted and nothing is committed.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { columnOption, columnSelection, customSport, escapeRe, setBuilderReady } from "../../support/set-builder";
import { CHECKLISTS } from "../../support/published-checklist";
import { ensureSportHasTeams, openSportAttributes, pressTeamlessToggle, teamlessToggle } from "../../support/teamless-sport";
import {
  answerPlayerAsNew,
  awaitLookupsSettled,
  cancelAndDiscard,
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

/** Card 1's person: the one card the uploaded file leaves to BSC. */
const PERSON = "Lauren Shehadi";
/** The set's own sport, the one she would be born in. */
const SET_SPORT = "Baseball";
const FETCH = { checklist: CHECKLISTS.starsOfMlbNetworkShehadiLive };

/** What the afterEach must undo, recorded before each write is made. */
const written: { sport?: string; sportFlagged: boolean } = { sportFlagged: false };

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
  "No teams in this sport — a BuySportsCards answer of no team for a new person of a teamless sport saves the card No Team without asking (NEO-426)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const sport = customSport(env);
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

    // ══ 2. THE FETCH: every card answered by the file but card 1, which BSC answers ══
    // `fetchChecklistToWizard` asserts "Teams from your checklist: 9 of N cards" (9 read off
    // the file) inside Match Cards: card 1 is the one card the checklist did not answer.
    await fetchChecklistToWizard(page, env, {}, FETCH);
    // A batch another reader on this account left behind is thrown away first (its
    // decisions are not this spec's), then fetched again with this spec's file.
    await discardResumedReviewBatch(page, env, {}, FETCH);
    await expectNothingDecided(page);
    const wizard = reviewWizard(page);

    // ══ 3. THE NAMES: she is moved to the teamless sport and added; the rest are skipped ══
    await skipEveryNameBut(page, PERSON, async () => {
      await expect(wizard.getByRole("heading", { level: 3, name: PERSON, exact: true })).toBeVisible();
      const inSetSport = wizard.getByRole("button", { name: `Sport for this name: ${SET_SPORT}` });
      await expect(inSetSport).toBeVisible();
      // NEO-426 (C3): a teamless sport exists and the set's sport is not one, so the
      // control's visible label says what it is for.
      await expect(inSetSport).toContainText("Sport for this name:");
      await inSetSport.click();
      const chooser = wizard.getByRole("listbox", { name: "Choose a sport" });
      await expect(chooser).toBeVisible();
      await chooser.getByRole("option", { name: sport, exact: true }).click();
      await expect(chooser).toBeHidden();
      // The move re-asks her lookup in the new sport (none: a custom sport has no Wikidata mapping).
      await awaitLookupsSettled(page);
      await expect(personSkip(page)).toHaveAccessibleName(`Skip ${PERSON} — not a person`);
      await expect(wizard.getByRole("button", { name: `Sport for this name: ${sport}` })).toBeVisible();
      // Her HOME sport is the teamless one, and Baseball is not added beside it.
      const alsoSetSport = wizard.getByRole("checkbox", { name: `Also add ${SET_SPORT} to their sports` });
      await expect(alsoSetSport).toBeVisible();
      await expect(alsoSetSport).not.toBeChecked();
      await expectAccessible(page, { within: wizard, label: "New player step moved to a teamless sport" });
      await answerPlayerAsNew(page);
    });

    // ══ 4. SAVE: no "Cards with no team" step, and the note names her and the sport ══
    // The names lead straight to Save: card 1 was never put to the operator.
    await expectWizardStep(page, STEP_SUBTITLE.save);
    await expect(confirmSaveButton(page)).toBeVisible();
    await expect(wizard.getByRole("heading", { level: 3, name: /^Save [0-9]+ cards\?$/ })).toBeVisible();
    // One card takes the default (the other nine are the checklist's own No Team), so the
    // note is the one-card form, naming her and the sport that has no teams.
    await expect(
      wizard.getByText(new RegExp(`^${escapeRe(PERSON)} saves with No Team\\. ${escapeRe(sport)} has no teams\\. `)),
    ).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Save step after BSC answered no team for a teamless sport's person" });

    // ══ 5. A READER'S EXIT: Cancel → Discard, and nothing was written ══
    await cancelAndDiscard(page);
    await expect(wizard).toBeHidden();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // The sport asks for teams again.
    await openSportAttributes(page, sport);
    await pressTeamlessToggle(page, true);
    written.sportFlagged = false;
  },
);
