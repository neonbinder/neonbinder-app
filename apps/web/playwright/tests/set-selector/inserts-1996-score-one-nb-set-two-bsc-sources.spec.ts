// Origin: .maestro/flows/set-selector/inserts-1996-score-one-nb-set-two-bsc-sources.yaml (Maestro suite retired in NEO-341; see git history)
// Sole writer of the 1996 Score Dugout Collection Artists Proofs insert; fresh-only.
//
// NEO-535: the "Card titles" step is also proved in the SportLots-PAUSED branch, which
// has no marketplace pairing and no 220-card merge. There ONE BSC insert (Series 1,
// 110 cards, a captured publisher's checklist uploaded first) is renamed to a name
// long enough that every title has to leave something out (NEO-609: a whole team, the
// number or a first name sends a card to the step), so the wizard opens its "Card
// titles" step and its "Set name in titles" box, and the box and per-card edits are
// proved there, then read back off the stored cards. NEO-618 / NEO-637: the box reaches every
// title that left something out (a team or a number, not only a first name), i.e. every
// title that shows the "Left out to fit" line, and a title the operator wrote too: one that
// shows the line keeps its words with the new set name in place of the old, one that does
// not is left as typed, and one that shows the line without the set name in it is rebuilt
// (the box says so). Escape in the box takes the whole edit back.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  columnOption,
  columnSearch,
  drillToSet,
  escapeRe,
  expectAfterBscSync,
  openAttributesPanel,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { CHECKLISTS, settleChecklistFetch, usePublishersChecklist } from "../../support/published-checklist";
import {
  addAsNewPlayerButton,
  advanceToSave,
  answerPlayerAsNew,
  answerStepAsNew,
  awaitLookupsSettled,
  confirmSaveButton,
  LOOKUPS,
  newStepHeading,
  expectDecidedCount,
  expectNameStepLeft,
  expectPostNameStepLeft,
  expectWizardStep,
  nextStepButton,
  passCareerAndTeamsSteps,
  readNameStep,
  reviewWizard,
  STEP_SUBTITLE,
  tidyUpName,
  wizardProgress,
} from "../../support/wizard";
import { expectNoOverCapLook, expectOverCapLook } from "../../support/theme";
import type { Page } from "@playwright/test";

const SERIES_1 = "Dugout Collection Artist's Proofs Series 1";
const SERIES_2 = "Dugout Collection Artist's Proofs Series 2";
const MERGED = "Dugout Collection Artists Proofs";
const FETCH = 120_000;

/**
 * Wait for "Add remaining players as new" to have FINISHED, never for its busy label to be
 * gone. The press paints "Adding players…" a render later, and the walk is a few writes, so a
 * `toBeHidden` on that label can pass before it ever shows (the trace of a red mobile run: the
 * check ran 85 ms after the tap, the label painted after it, and the walk moved the wizard on
 * under the next click). The finished walk has two positive signs: the link reads "(0)" (a team
 * or league name is still undecided), or every name is decided and the footer offers Next /
 * Confirm & Save. The steps still showing before it read "(N)" with N above zero.
 */
async function expectBulkWalkDone(page: Page): Promise<void> {
  const wizard = reviewWizard(page);
  await expect(
    wizard
      .getByRole("button", { name: /^Add remaining players as new \(0\)$/ })
      .or(nextStepButton(page))
      .or(confirmSaveButton(page)),
  ).toBeVisible({ timeout: 240_000 });
}

// ── The SportLots-paused branch's fixture (NEO-535, NEO-609) ──
// Series 1's NB row is renamed to LONG_INSERT. The title arithmetic is exact because
// the name is a fixed string (no minted token), computed with the title builder
// (`assessListingTitle`) over the captured checklist. The description "1996 Score
// <name>" is 67 characters, and the row's type name ("Insert") is a quiet cut, so
// every one of the 110 titles has to give up a whole team, the number or a first name
// (NEO-609, the Tidy Up line): all 110 are on the step, which draws the first 50 in
// card order and counts the rest ("And 60 more, saved as generated."). The cards the
// spec reads sit among those 50:
//   #2  Rich Becker      loses the team and the number, keeps his full name; the box
//                        (NEO-618: any Tidy Up cut, not only a first name) brings both
//                        back, the team whole
//   #6  Jim Thome        fits at exactly 80 and loses ONLY the team; the box brings it
//                        back whole (NEO-618; before it, the box left this card alone)
//   #8  Don Mattingly    loses the team and "Don" (hand-edited in the step)
//   #12 Darren Daulton   loses the team and "Darren"; the box brings the name back and
//                        the team fits as its nickname (NEO-606), the sport kept
// and #76 Todd Hollandsworth, past the 50 drawn, runs over 80 after every cut (81): the
// step counts it as still running long until the box makes it fit.
// NEO-637, the titles the operator writes (computed the same way):
//   #3  Ryan Klesko      typed BEFORE the box, holding the set name: "Klesko #3" after the
//                        description, 77, so it still leaves out "Ryan" and the team (the
//                        line shows); every box edit swaps the set name inside it and keeps
//                        "Klesko #3"
//   #5  Barry Larkin     typed AFTER the box, with every word back (team before the number):
//                        no line, so the next box edit leaves it exactly as typed
//   #8  Don Mattingly    OWN_TITLE, typed after the box: the line shows (the team) and neither
//                        the box text nor the description is in it, so the next box edit
//                        rebuilds it and the box says "1 title you wrote was rebuilt."
// The second box edit is NEXT_BOX, a shorter prefix of SHORT_BOX, so #5's text (which holds
// SHORT_BOX) still reads as naming the set: it shows no line before or after.
const SERIES_1_CARDS = 110;
/** The step draws this many title rows (`TITLE_ROWS_SHOWN`) and counts the rest. */
const TITLE_ROWS_SHOWN = 50;
const LONG_INSERT = "Dugout Collection Artists Proofs Hologram Foil Series II";
const LONG_DESCRIPTION = `1996 Score ${LONG_INSERT}`;
// The box text the operator types: the description without the filler words.
const SHORT_BOX = "1996 Score Dugout Collection Artists Proofs";
/** #12 under the box: the first name back, the team by its nickname (NEO-606), the sport kept. */
const DAULTON_BOXED = `${SHORT_BOX} Darren Daulton #12 Phillies Baseball`;
/** #76 under the box (saved as generated, past the 50 drawn): it fits, the team by its nickname. */
const HOLLANDSWORTH_BOXED = `${SHORT_BOX} Todd Hollandsworth #76 Dodgers`;
/** #2 before the box: the full name kept, the team and the number left out (80 is the cap). */
const BECKER_BUILT = `${LONG_DESCRIPTION} Rich Becker`;
/** #2 under the box (NEO-618): the number and the whole team back; the sport does not fit (83). */
const BECKER_BOXED = `${SHORT_BOX} Rich Becker #2 Minnesota Twins`;
/** #6 before the box: it fits at exactly 80 with only its team left out. */
const THOME_BUILT = `${LONG_DESCRIPTION} Jim Thome #6`;
/** #6 under the box (NEO-618): the team back whole; the sport does not fit (83). */
const THOME_BOXED = `${SHORT_BOX} Jim Thome #6 Cleveland Indians`;
// What the operator types over #8's generated title: first past the cap, then their own.
const OVER_TITLE = `${LONG_DESCRIPTION} Don Mattingly #8 New York Yankees`;
const OWN_TITLE = "1996 Score Artists Proofs Don Mattingly #8 My Own Title";
/** NEO-637 — the second box edit: SHORT_BOX trimmed again (28 characters). */
const NEXT_BOX = "1996 Score Dugout Collection";
/** NEO-637 — #3 as the operator types it before the box: the set name kept, "Ryan" and the team out. */
const KLESKO_OWN = (setName: string) => `${setName} Klesko #3`;
/** NEO-637 — #5 as the operator types it after the box: every word, the team before the number. */
const LARKIN_OWN = `${SHORT_BOX} Barry Larkin Cincinnati Reds #5`;
/** #8 rebuilt under NEXT_BOX: the generated title, everything back, the sport too. */
const MATTINGLY_NEXT = `${NEXT_BOX} Don Mattingly #8 New York Yankees Baseball`;
/** #12 under NEXT_BOX (untouched, it follows the box): the team whole, the sport kept. */
const DAULTON_NEXT = `${NEXT_BOX} Darren Daulton #12 Philadelphia Phillies Baseball`;
/** NEO-637 — the box's lead, pinned here (one spec pins it). */
const SHORT_LEAD =
  "Set name hogging the title? Trim it here and every title that left something out gets it, ones you wrote included.";

async function openScoreInserts(page: Page, env: Parameters<typeof drillToSet>[1]) {
  await drillToSet(page, env, { year: "1996", manufacturer: "Score", set: "Score", createManufacturer: true });
  await pick(page, "Variant Types", "Insert", { search: false });
}

/**
 * NEO-535, the SportLots-paused branch: the "Card titles" step and "Set name in
 * titles", proved on ONE BSC insert (Series 1) with nothing but BSC attached.
 *
 * Contract: ENTRY the Inserts column is open on the 1996 Score variant type with both
 * BSC series listed under their own names (the caller asserted that). EXIT the set is
 * committed (110 cards) and its stored titles read back; the insert row stays renamed
 * to LONG_INSERT and carries SHORT_BOX as its "Set name in titles". Fresh-only.
 */
async function cardTitlesWithOnlyBscAttached(page: Page, env: Parameters<typeof drillToSet>[1]) {
  const wizard = reviewWizard(page);
  const next = nextStepButton(page);
  const confirmSave = confirmSaveButton(page);

  // ── P1. Rename Series 1 so its titles cannot fit ──
  // The fetch reads the row's BSC id from its slot, never its name (product invariant 4),
  // so the rename cannot change what is fetched.
  await columnOption(page, "Inserts", SERIES_1).click();
  await expect(page.getByRole("heading", { name: `Attributes for ${SERIES_1}` })).toBeVisible();
  // NEO-569: the pencil sits in the open panel only, and an insert row starts it shut.
  await openAttributesPanel(page);
  await page.getByRole("button", { name: `Rename ${SERIES_1}` }).click();
  const edit = page.getByRole("textbox", { name: `Edit name for ${SERIES_1}` });
  await edit.fill(LONG_INSERT);
  await edit.press("Enter");
  // The panel header renders the CURRENTLY SELECTED row: the rename landed on the row we mean.
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
  // The arithmetic the fixture rests on (a drift in these strings is a spec bug, caught here).
  expect(LONG_DESCRIPTION, "the description is 67 characters").toHaveLength(67);
  expect(SHORT_BOX, "the box text is 43 characters").toHaveLength(43);
  expect([BECKER_BUILT.length, THOME_BUILT.length, BECKER_BOXED.length, THOME_BOXED.length]).toEqual([79, 80, 74, 74]);
  // NEO-637: every title the operator writes fits, and NEXT_BOX is a prefix of SHORT_BOX.
  expect([KLESKO_OWN(LONG_DESCRIPTION).length, LARKIN_OWN.length, MATTINGLY_NEXT.length, DAULTON_NEXT.length]).toEqual([
    77, 75, 71, 78,
  ]);
  expect(SHORT_BOX.startsWith(`${NEXT_BOX} `), "NEXT_BOX trims SHORT_BOX").toBe(true);

  // ── P2. Fetch with the publisher's checklist uploaded first, BSC alone ──
  const facts = await usePublishersChecklist(page, CHECKLISTS.dugoutArtistsProofs1996Series1);
  expect(facts.rows, "the captured file holds every one of Series 1's cards").toBe(SERIES_1_CARDS);
  await syncChecklistButton(page).click();
  // NEO-496 (D10): a publisher's checklist is a source, so one marketplace and the file are two.
  // NEO-640: the file is BSC's own 110 cards, each paired by its number at 100%, so Match Cards is
  // skipped: the helper asserts the progress line, then the wizard with the kept line and
  // "Teams from your checklist" in front of it (one live BSC round trip: our 7 s plus BSC's). The
  // Save step below still counts all 110 cards ("Save 110 cards?").
  await settleChecklistFetch(page, env, { facts, what: "the solo fetch of Series 1", lands: "review" });

  // ── P3. Names first: the few the catalogue lacks are created as new ──
  // The queue behind the lookups is the batch-lookups ceiling `walkToPlayerRow` waits at (LOOKUPS).
  await expect(wizard).toBeVisible({ timeout: 60_000 });
  await expect(wizard).toHaveAccessibleName(tidyUpName({ year: "1996", set: "Score", variant: LONG_INSERT }));
  await awaitLookupsSettled(page);
  const addNew = addAsNewPlayerButton(page);
  const addRemaining = wizard.getByRole("button", { name: /Add remaining players as new/ });
  for (let i = 0; i < 250; i++) {
    await expect(next.or(confirmSave).or(addNew).or(newStepHeading(page))).toBeVisible({ timeout: LOOKUPS });
    if ((await next.isVisible()) || (await confirmSave.isVisible())) break;
    if (await addNew.isVisible()) {
      await answerPlayerAsNew(page);
      if (await addRemaining.isVisible()) {
        await addRemaining.click();
        await expectBulkWalkDone(page);
      }
    } else {
      await answerStepAsNew(page);
    }
  }
  await expect(next.or(confirmSave)).toBeVisible();

  // ── P4. THE CARD TITLES STEP ──
  // Which post-name steps come first: the career check (NEO-574) when a known player's career
  // does not show a card's team for 1996, teams only when a card would save teamless (every
  // card here carries the checklist's team, so normally not); the walk answers every career
  // line "Keep as is" (NEO-591: the default adds the team) and leaves the teams lines on
  // "Leave for later".
  await passCareerAndTeamsSteps(page);
  await expect(wizard.getByText("Card titles", { exact: true })).toBeVisible();
  await expect(
    wizard.getByRole("heading", {
      name: "These titles had to leave something out or still run long. Check what went, then keep 'em or make 'em yours.",
      exact: true,
    }),
  ).toBeVisible();

  const box = wizard.getByRole("textbox", { name: "Set name in titles", exact: true });
  const title = (number: number) => wizard.getByRole("textbox", { name: new RegExp(`^Title for #${number} `) });
  // The box opens on the set's whole description (no type name), and shows how much of the 80 it is.
  await expect(box).toHaveValue(LONG_DESCRIPTION);
  await expect(box).toHaveAccessibleDescription(/\b67\/80\b/);
  // #12 lost "Darren" and its team, whole (it does not fit even as "Phillies").
  await expect(title(12)).toHaveValue(`${LONG_DESCRIPTION} Daulton #12`);
  await expect(title(12)).toHaveAccessibleDescription(/Left out to fit: .*Darren/);
  await expect(title(12)).toHaveAccessibleDescription(/Left out to fit: .*Philadelphia Phillies/);
  // #2 kept its full name and gave up its team and number: a Tidy Up cut puts it here too.
  await expect(title(2)).toHaveValue(BECKER_BUILT);
  await expect(title(2)).toHaveAccessibleDescription(/Left out to fit: Minnesota Twins, #2/);
  // #6 fits at exactly 80 and gave up its team alone (nothing after it: no comma).
  await expect(title(6)).toHaveValue(THOME_BUILT);
  await expect(title(6)).toHaveAccessibleDescription(/Left out to fit: Cleveland Indians(?!,)/);
  // Every one of the 110 had to leave something out: 50 are drawn and the rest counted.
  const titles = wizard.getByRole("textbox", { name: /^Title for #/ });
  await expect(titles).toHaveCount(TITLE_ROWS_SHOWN);
  await expect(wizard.getByText(`And ${SERIES_1_CARDS - TITLE_ROWS_SHOWN} more, saved as generated.`, { exact: true })).toBeVisible();
  await expectAccessible(page, { within: wizard, label: "Card titles step, every title left something out (SportLots paused)" });
  // NEO-637: the box's lead says which titles it reaches, the operator's own among them.
  await expect(wizard.getByText(SHORT_LEAD, { exact: true })).toBeVisible();
  await expect(box).toHaveAccessibleDescription(new RegExp(escapeRe(SHORT_LEAD)));

  // ── P4b (NEO-637). A title typed by hand BEFORE the box, holding the set name ──
  // #3 keeps the description and the number and drops "Ryan" (the team is out too), so the
  // yellow line still shows under the operator's own text.
  const useGenerated = (number: number) =>
    wizard.getByRole("button", { name: new RegExp(`^Use generated title for #${number} `) });
  await expect(title(3)).toHaveValue(`${LONG_DESCRIPTION} Ryan Klesko`);
  await title(3).fill(KLESKO_OWN(LONG_DESCRIPTION));
  await title(3).press("Enter");
  await expect(useGenerated(3)).toBeVisible();
  await expect(title(3)).toHaveValue(KLESKO_OWN(LONG_DESCRIPTION));
  await expect(title(3)).toHaveAccessibleDescription(/Left out to fit: .*Ryan/);

  // NEO-606: a box typed past 80 is refused in place, on the wizard's own surface: the box is
  // invalid, the refusal is an alert, and no title takes it. Axe reads it in both modes while
  // it shows.
  const overBox = `${LONG_DESCRIPTION} Hologram Foil Extra`;
  expect(overBox).toHaveLength(87);
  await box.fill(overBox);
  await box.press("Enter");
  const boxRefusal = wizard.getByRole("alert").filter({ hasText: "Set name in titles tops out" });
  await expect(boxRefusal).toHaveText("Set name in titles tops out at 80 characters.");
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(title(12)).toHaveValue(`${LONG_DESCRIPTION} Daulton #12`);
  // A refused box is no set name: the operator's own title is not touched either.
  await expect(title(3)).toHaveValue(KLESKO_OWN(LONG_DESCRIPTION));
  await expectAccessible(page, { within: wizard, label: "Card titles step, Set name in titles over 80 refused" });

  // ── P5. Trim the box: every title that left something out takes it (NEO-618) ──
  await box.fill(SHORT_BOX);
  // Enter settles the box in place; its status is read at the settle. It counts every
  // title, the ones past the 50 drawn too: #76, over 80 after every cut, fits now.
  await box.press("Enter");
  await expect(wizard.getByText("Every title fits now.")).toBeVisible();
  await expect(boxRefusal).toHaveCount(0);
  await expect(box).not.toHaveAttribute("aria-invalid", "true");
  await expect(box).toHaveAccessibleDescription(/\b43\/80\b/);
  // #12 has its first name back, opening with the box text verbatim, and its team fits as
  // the nickname, where it would not fit whole (NEO-606): nothing is reported left out.
  await expect(title(12)).toHaveValue(DAULTON_BOXED);
  await expect(title(12)).not.toHaveAccessibleDescription(/Left out to fit/);
  // NEO-618: #2 fit with its full name and lost its team and number, and #6 fit and lost
  // only its team. A title that left anything out takes the box (NEO-637: the line shows
  // under it): both open with the box text and get back everything they left out.
  await expect(title(2)).toHaveValue(BECKER_BOXED);
  await expect(title(2)).not.toHaveAccessibleDescription(/Left out to fit/);
  await expect(title(6)).toHaveValue(THOME_BOXED);
  await expect(title(6)).not.toHaveAccessibleDescription(/Left out to fit/);
  // NEO-637: #3's own title showed the line, so it took the box too, as a swap: the old set
  // name inside it is now the box text, and "Klesko #3" is kept as typed (still the
  // operator's: "Use generated title" is offered, and nothing was rebuilt).
  await expect(title(3)).toHaveValue(KLESKO_OWN(SHORT_BOX));
  await expect(title(3)).toHaveAccessibleDescription(/Left out to fit: .*Ryan/);
  await expect(useGenerated(3)).toBeVisible();
  await expect(box).toHaveAccessibleDescription(/Every title fits now\./);
  await expect(box).not.toHaveAccessibleDescription(/rebuilt/);
  // The list itself never moved under the edit.
  await expect(titles).toHaveCount(TITLE_ROWS_SHOWN);
  await expectAccessible(page, { within: wizard, label: "Card titles step, every title fits (SportLots paused)" });

  // ── P6. A title typed by hand wins on its card ──
  // Typed past 80 first: the whole box says it is over, invalid to a screen reader and the
  // error pink on its edge and on its note (the row's own status line, NEO-606).
  const row8 = wizard.getByRole("listitem").filter({ has: page.getByRole("textbox", { name: /^Title for #8 / }) });
  const note8 = row8.getByRole("status");
  await title(8).fill(OVER_TITLE);
  await expect(note8).toHaveText("Too long to list as-is.");
  await expect(title(8)).toHaveAttribute("aria-invalid", "true");
  await expectOverCapLook(title(8), note8);
  await expectAccessible(page, { within: wizard, label: "Card titles step, a title typed past 80 (SportLots paused)" });
  // Their own title, which fits: the error lets go (not invalid, no pink, the emptied
  // status line hides itself and leaves the accessibility tree), and Enter keeps it.
  await title(8).fill(OWN_TITLE);
  await expect(title(8)).not.toHaveAttribute("aria-invalid", "true");
  await expect(note8).toHaveCount(0);
  await expectNoOverCapLook(title(8));
  await title(8).press("Enter");
  await expect(wizard.getByRole("button", { name: /^Use generated title for #8 / })).toBeVisible();
  await expect(title(8)).toHaveValue(OWN_TITLE);
  // The box did not take #12's edit away: a hand edit is per card.
  await expect(title(12)).toHaveValue(DAULTON_BOXED);
  // NEO-637: #5's own title holds every word (the box text, the full name, the team, the
  // number), so no line shows under it.
  await title(5).fill(LARKIN_OWN);
  await title(5).press("Enter");
  await expect(useGenerated(5)).toBeVisible();
  await expect(title(5)).toHaveValue(LARKIN_OWN);
  await expect(title(5)).not.toHaveAccessibleDescription(/Left out to fit/);
  // #8's own title shows the line (its team, and the set words it no longer says).
  await expect(title(8)).toHaveAccessibleDescription(/Left out to fit: .*New York Yankees/);

  // ── P6b (NEO-637). Trim the box again: who takes it, and Escape takes it all back ──
  // Escape's undo point is the box's text when it takes focus (SHORT_BOX). The operator
  // trims the way a person does, one Backspace at a time from the end (" Artists Proofs",
  // 15 characters), so every title is held to the rule at every keystroke, not only at
  // the last text.
  const trimmed = SHORT_BOX.slice(NEXT_BOX.length);
  expect(trimmed).toBe(" Artists Proofs");
  await box.focus();
  await box.press("End");
  for (let i = 0; i < trimmed.length; i++) await box.press("Backspace");
  await expect(box).toHaveValue(NEXT_BOX);
  await box.press("Enter");
  // A title the builder made follows the box: #12 (it left something out before any box).
  await expect(title(12)).toHaveValue(DAULTON_NEXT);
  // #3's own title showed the line: the set name inside it is swapped again, "Klesko #3" kept.
  await expect(title(3)).toHaveValue(KLESKO_OWN(NEXT_BOX));
  await expect(useGenerated(3)).toBeVisible();
  // #5's own title showed no line: it is left exactly as typed, and is still the operator's.
  await expect(title(5)).toHaveValue(LARKIN_OWN);
  await expect(useGenerated(5)).toBeVisible();
  await expect(title(5)).not.toHaveAccessibleDescription(/Left out to fit/);
  // #8's own title showed the line but held no set name to swap: it is rebuilt from the
  // box (no longer the operator's), and the box's status says one of theirs was.
  await expect(title(8)).toHaveValue(MATTINGLY_NEXT);
  await expect(useGenerated(8)).toHaveCount(0);
  await expect(box).toHaveAccessibleDescription(/Every title fits now\. 1 title you wrote was rebuilt\./);
  await expect(wizard.getByText("1 title you wrote was rebuilt.")).toBeVisible();
  await expect(titles).toHaveCount(TITLE_ROWS_SHOWN);
  await expectAccessible(page, { within: wizard, label: "Card titles step, the box trimmed again, one title you wrote rebuilt" });
  // Escape in the box takes the whole edit back: the box text, the swapped set name in
  // #3, #8's own words, and #12's title from SHORT_BOX. #5 never moved.
  await box.press("Escape");
  await expect(box).toHaveValue(SHORT_BOX);
  await expect(title(3)).toHaveValue(KLESKO_OWN(SHORT_BOX));
  await expect(title(8)).toHaveValue(OWN_TITLE);
  await expect(useGenerated(8)).toBeVisible();
  await expect(title(12)).toHaveValue(DAULTON_BOXED);
  await expect(title(5)).toHaveValue(LARKIN_OWN);
  // Settled again, nothing of theirs stands rebuilt.
  await box.press("Enter");
  await expect(box).toHaveAccessibleDescription(/\b43\/80\b/);
  await expect(box).toHaveAccessibleDescription(/Every title fits now\./);
  await expect(box).not.toHaveAccessibleDescription(/rebuilt/);

  // ── P7. Save: the Save step is a later step, and Enter on it commits ──
  await expectWizardStep(page, STEP_SUBTITLE.titles);
  await next.click();
  await expect(wizard.getByText("Ready to save", { exact: true })).toBeVisible();
  // NEO-467: the Save step is a later step than Card titles, the end of the bar.
  await expectPostNameStepLeft(page, STEP_SUBTITLE.titles);
  await expect(wizardProgress(page), "the Save step fills the progress bar").toHaveAttribute("aria-valuenow", "100");
  await expect(wizard.getByText(new RegExp(`Save ${SERIES_1_CARDS} cards?\\?`))).toBeVisible();
  await expect(confirmSave).toBeVisible();
  await confirmSave.press("Enter");
  await expect(page.getByText(new RegExp(`Saved ${SERIES_1_CARDS} cards`))).toBeVisible();
  await expect(wizard).toBeHidden();

  // ── P8. The stored cards carry the chosen titles ──
  await openScoreInserts(page, env);
  await columnSearch(page, "Inserts").fill("Artist");
  await expect(columnOption(page, "Inserts", LONG_INSERT)).toBeVisible();
  // Series 2 was never touched: BSC's own name, no card fetched.
  await expect(columnOption(page, "Inserts", SERIES_2)).toBeVisible();
  await columnOption(page, "Inserts", LONG_INSERT).click();
  const cardTitle = page.getByRole("textbox", { name: "Card title" });
  // The checklist opens at its end; its search brings a card's row up.
  const openCard = async (number: number) => {
    await page.getByRole("searchbox", { name: "Search cards" }).fill(String(number));
    await page.getByRole("button", { name: new RegExp(`^Edit card ${number}, `) }).click();
    await expect(cardTitle).toBeVisible();
  };
  const closeCard = async () => {
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardTitle).toBeHidden();
  };
  // #12: the box text opens it (the listed title the operator kept), and the stored title is
  // exactly what the step showed, its team by the nickname (NEO-606).
  await openCard(12);
  await expect(cardTitle).toHaveValue(DAULTON_BOXED);
  await closeCard();
  // #8: the title the operator typed (rebuilt by the second box edit, given back by Escape).
  await openCard(8);
  await expect(cardTitle).toHaveValue(OWN_TITLE);
  await closeCard();
  // NEO-637: #3, the operator's own words with the box text as its set name, as the step
  // showed; #5, the operator's own title, exactly as typed.
  await openCard(3);
  await expect(cardTitle).toHaveValue(KLESKO_OWN(SHORT_BOX));
  await closeCard();
  await openCard(5);
  await expect(cardTitle).toHaveValue(LARKIN_OWN);
  await closeCard();
  // #2 and #6 (NEO-618): they fit but left a team (and #2 its number) out, so the commit
  // built them from the box too, as the step showed.
  await openCard(2);
  await expect(cardTitle).toHaveValue(BECKER_BOXED);
  await expectAccessible(page, { label: "Card detail drawer, a fitting title the box rebuilt (SportLots paused)" });
  await closeCard();
  await openCard(6);
  await expect(cardTitle).toHaveValue(THOME_BOXED);
  await closeCard();
  // #76, past the 50 drawn, was saved as generated: with the box, as the step counted it.
  await openCard(76);
  await expect(cardTitle).toHaveValue(HOLLANDSWORTH_BOXED);
  await closeCard();
  // The box text sits on the insert row itself (its attributes panel), for the cards that come next.
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
  const editAttributes = page.getByRole("button", { name: "Edit attributes" });
  const hideAttributes = page.getByRole("button", { name: "Hide attributes" });
  // The panel remembers whether it was left open, so open it only if needed.
  await expect(editAttributes.or(hideAttributes)).toBeVisible();
  if (await editAttributes.isVisible()) await editAttributes.click();
  await expect(hideAttributes).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Value for Set name in titles" })).toHaveValue(SHORT_BOX);

  // The drill lives in the URL: Back undoes the pick of the renamed row, and the Inserts column
  // is open again with the row still listed (NEO-224).
  await page.goBack();
  await expect(columnSearch(page, "Inserts")).toBeVisible();
  await expect(columnOption(page, "Inserts", LONG_INSERT)).toBeVisible();
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeHidden();
}

test(
  "Inserts — ONE NeonBinder set maps to TWO BSC sets and one SportLots set, and a re-sync keeps NeonBinder's own card name (1996 Score, NEO-137 + NEO-203)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const id = env.ATTEMPT_ID;
    // NEO-535: the NB211 marker plus a filler tail, so the description alone
    // ("1996 Score <renamed>", 99+ characters on every runner) is over 80 and
    // EVERY card's title is still over the cap after every cut (the builder
    // never cuts a description word): the "Card titles" step is certain.
    const renamed = `${MERGED} NB211-${id} Hologram Foil Rainbow Refractor Edition`;
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });
    const pairing = page.getByRole("dialog", { name: /Match Cards/ });
    const confirmMatches = page.getByRole("button", { name: "Confirm card matches", disabled: false });
    const wizard = reviewWizard(page);
    const saveSets = reconcile.getByRole("button", { name: /^Save [0-9]+ sets$/ });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openScoreInserts(page, env);

    if (env.SL_PAUSED) {
      // Only BSC answers: the two BSC sets stay separate and nothing reconciles.
      await expect(page.getByRole("heading", { name: "Inserts", exact: true })).toBeVisible();
      await expect(reconcile).toBeHidden();
      await columnSearch(page, "Inserts").fill("Artist");
      // The first visit syncs from BSC (sign-in included): our 7 s plus the time BSC is measured to take.
      await expectAfterBscSync(page, columnOption(page, "Inserts", SERIES_1), `Inserts row ${SERIES_1}`);
      await expect(columnOption(page, "Inserts", SERIES_2)).toBeVisible();
      await expect(columnOption(page, "Inserts", SERIES_1).getByText("BSC", { exact: true })).toBeVisible();
      await expect(page.getByText("SL", { exact: true })).toBeHidden();
      await expectAccessible(page, { label: "Score inserts, BSC-only (SportLots paused)" });
      // NEO-535: the Card titles step, with SportLots out of the picture.
      await cardTitlesWithOnlyBscAttached(page, env);
      return;
    }

    // ── 1. The first sync opens the reconcile: merge the two BSC series into one NB set ──
    // The first visit syncs from BSC: our 7 s plus the time BSC is measured to take, never a flat ceiling.
    await expectAfterMarketplace(page, reconcile, { platform: "BuySportsCards", what: "the Inserts reconcile" });
    await expect(reconcile.getByText(/Ready \([0-9]+/)).toBeVisible();
    await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts dialog" });

    await reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill("Artist");
    await expect(reconcile.getByText(/Ready \(1 of [0-9]+\)/)).toBeVisible();
    await expect(reconcile.getByText(/Pending \([0-9]+/)).toBeVisible();
    const setName = reconcile.getByRole("textbox", { name: `NeonBinder set name for ${SERIES_2}` });
    await expect(setName).toBeVisible();

    await reconcile.getByRole("textbox", { name: "Filter BSC items" }).fill("Artist");
    await expect(reconcile.getByText(/BSC \(1 of [0-9]+\)/)).toBeVisible();
    await reconcile.getByText(SERIES_1, { exact: true }).click();
    await reconcile.getByLabel(`Add ${SERIES_1} to this set, ${SERIES_2}`, { exact: true }).click();
    await expect(reconcile.getByText(/BSC \(0 of [0-9]+\)/)).toBeVisible();

    // Name the merged set (no apostrophe, so no marketplace name is quoted back).
    await setName.fill(MERGED);
    await setName.press("Enter");
    await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${MERGED}` })).toBeVisible();

    await saveSets.click();
    await expect(reconcile).toBeHidden();

    // ── 2. Re-open: one NB set holds both BSC sets ──
    await openScoreInserts(page, env);
    await columnSearch(page, "Inserts").fill("Artist");
    await expect(columnOption(page, "Inserts", MERGED)).toBeVisible();
    await expect(page.getByText(/Artist's Proofs Series [12]/)).toBeHidden();
    await columnOption(page, "Inserts", MERGED).click();

    // NEO-496: the sources live inside the attributes panel, closed below the set.
    await openAttributesPanel(page);
    const multiSource = page.getByRole("heading", { name: "Multi-source sets" });
    await expect(multiSource).toBeVisible();
    await expect(page.getByText(SERIES_1).first()).toBeVisible();
    await expect(page.getByText(SERIES_2).first()).toBeVisible();
    await expect(page.getByText(/PRIMARY/)).toBeHidden();
    await expectAccessible(page, { label: "Multi-source insert set" });

    // ── 3b. Rename the NB set to its NB211 marker BEFORE any card is fetched ──
    // NEO-335 Phase 2 / NEO-535: a card under an insert row carries the
    // INSERT's name in its title's description, which is never cut, so this
    // long name leaves every card over 80 after every cut and the wizard's
    // "Card titles" step (and its "Set name in titles" box) comes up on every
    // run (STEP 4b). The card fetches read the row's marketplace ids from its
    // slots, never its name (product invariant 4), so the rename cannot change
    // what STEP 3 fetches. STEP 6 keeps its claim: a row renamed away from its
    // marketplace label survives a forced "Sync Inserts".
    await page.getByRole("button", { name: `Rename ${MERGED}` }).click();
    const edit = page.getByRole("textbox", { name: `Edit name for ${MERGED}` });
    await edit.fill(renamed);
    await edit.press("Enter");
    // Hard precondition: the panel header renders the CURRENTLY SELECTED row, so
    // this proves the rename landed on the row we mean.
    await expect(page.getByRole("heading", { name: `Attributes for ${renamed}` })).toBeVisible();

    // ── 3. Fetch the checklist: both BSC sets + SportLots pair into one ──
    await syncChecklistButton(page).click();
    await expect(pairing).toBeVisible({ timeout: FETCH });
    await expect(confirmMatches).toBeVisible({ timeout: FETCH });
    await expect(pairing.getByText(new RegExp(`Match Cards — ${MERGED}`))).toBeVisible();
    await expect(pairing.getByText(/Unlink/).first()).toBeVisible();
    await expect(pairing.getByText(/BSC only/)).toBeHidden();
    await expect(pairing.getByText(/SportLots only/)).toBeHidden();
    await expect(pairing.getByText(/Nothing kept/)).toBeHidden();
    await expect(pairing.getByText(/220 cards will be saved/)).toBeVisible();
    await expectAccessible(page, { within: pairing, label: "Match Cards dialog (two BSC sources + SportLots)" });
    await confirmMatches.click();
    await expect(pairing).toBeHidden({ timeout: 60_000 });

    // ── 4. Entity review: decide one row, back out of the discard, then add the rest ──
    await expect(wizard).toBeVisible({ timeout: FETCH });
    await expect(wizard.getByText(/still looking up/)).toBeHidden({ timeout: 180_000 });
    await expectAccessible(page, { within: wizard, label: "Tidy-up wizard" });
    // NEO-331: a New League step's primary is held until a Level is pressed
    // (none is pre-pressed), so read which kind settled first. "Other" claims
    // nothing (the batch is discarded or bulk-added anyway).
    const anyAddAsNew = wizard.getByRole("button", { name: /^Add as New (Player|Team|League)( anyway)?$/ });
    await expect(anyAddAsNew.first()).toBeVisible({ timeout: 30_000 });
    const firstKind = (await anyAddAsNew.first().textContent()) ?? "";
    // The presented row, by its own skip ("Skip <name> — not a ..."): NEO-467's
    // header has no step count, so the row's own control says it was decided.
    const firstRow = await readNameStep(page);
    if (/League/.test(firstKind)) {
      await wizard.getByRole("radio", { name: "Other", exact: true }).click();
    }
    if (/Player/.test(firstKind)) {
      // NEO-424: a player step may lead with a suggested link; creating is the intent.
      await answerPlayerAsNew(page);
    } else {
      await wizard
        .getByRole("button", { name: /^Add as New (Team|League)( anyway)?$/, disabled: false })
        .first()
        .click({ timeout: 30_000 });
    }
    // ONE decision: the wizard left that row, and the names' history reads
    // "Decided (1)" (NEO-467 took the "Step 2 of …" count away; the same claim,
    // as strict, as the old "1 of N reviewed").
    await expectNameStepLeft(page, firstRow);
    await expectDecidedCount(page, 1);
    await wizard.getByRole("button", { name: "Cancel (Esc)" }).click();
    await expect(page.getByText(/Discard 1 decision/)).toBeVisible();
    await expect(page.getByText(/The same names come back the next time you sync this set/)).toBeVisible();
    await expectAccessible(page, {
      within: page.getByRole("dialog", { name: /Discard 1 decision/ }),
      label: "Discard decisions confirm",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(wizard).toBeVisible();
    // Backing out of the discard kept the decision: still one decided, and the
    // wizard did not return to that row.
    await expectDecidedCount(page, 1);
    await expect(wizard.getByRole("button", { name: firstRow, exact: true })).toBeHidden();

    await wizard.getByRole("button", { name: /Add remaining players as new/ }).click();
    // Deciding a team step in the middle of the walk would race the bulk's own writes
    // (Convex OCC), and a user watches the walk finish before touching the next step.
    await expectBulkWalkDone(page);
    const confirmSave = confirmSaveButton(page);
    // The names-done footer (NEO-335): "Next (Enter)" on a teams / titles step,
    // else Confirm & Save. Neither renders while a name is undecided.
    const next = wizard.getByRole("button", { name: "Next (Enter)", exact: true });
    const stepHeading = wizard.getByRole("heading", { name: /^New (Team|League): / });
    for (let i = 0; i < 250; i++) {
      await expect(next.or(confirmSave).or(stepHeading)).toBeVisible({ timeout: 240_000 });
      if ((await next.isVisible()) || (await confirmSave.isVisible())) break;
      // R10 loop rule: act on the step, then wait for ITS heading to go before
      // looking for the next one (NEO-331: a league step gets its Level first).
      const step = (await stepHeading.textContent()) ?? "";
      await answerStepAsNew(page);
      await expect(wizard.getByRole("heading", { name: step, exact: true })).toBeHidden();
    }
    await expect(next.or(confirmSave)).toBeVisible();

    // ── 4b. THE CARD TITLES STEP, AND THE SET'S "SET NAME IN TITLES" (NEO-335, NEO-535) ──
    // STEP 3b's long insert name leaves every card's title over 80 after every
    // cut, so the "Card titles" step is certain; a run where it does not come up
    // fails at its subtitle below, by name. The box opens prefilled with the
    // builder's own whole description; untouched and over 80 it sits out. The
    // operator replaces it: every over-cap title then opens with the box text,
    // verbatim, it rides the commit as the batch's `listingShortName`, and STEP
    // 5 reads it back off a stored card. ONE alphanumeric token per attempt.
    const short = `DCAP${env.ATTEMPT_TOKEN}`;
    // Which post-name steps come first: the career check (NEO-574) when a known
    // player's career does not show a card's team for 1996, the teams step only when
    // a card would save teamless (this fetch names its teams, so usually not).
    // Neither is this spec's business: Next leaves every line on its default.
    await passCareerAndTeamsSteps(page);
    await expect(wizard.getByText("Card titles", { exact: true })).toBeVisible();
    const shortName = wizard.getByRole("textbox", { name: "Set name in titles", exact: true });
    // The prefill: the builder's whole description, year, maker and the insert
    // first (a parallel name the leaf's features carry would follow it).
    await expect(shortName).toHaveValue(new RegExp(`^1996 Score ${escapeRe(renamed)}`));
    await expect(wizard.getByText("Over 80, so it's sitting out. Trim it and your titles pick it up.")).toBeVisible();
    await shortName.clear();
    await shortName.fill(short);
    // Enter settles the box in place; its status is read at the settle. The
    // proof the box reached EVERY title: the line is computed from the same
    // assessment as the list, over every new card.
    await shortName.press("Enter");
    await expect(wizard.getByText("Every title fits now.")).toBeVisible();
    await expect(shortName).toHaveValue(short);
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Card titles step" });
    await expectWizardStep(page, STEP_SUBTITLE.titles);
    await next.click();
    await expect(wizard.getByText("Ready to save", { exact: true })).toBeVisible();
    // NEO-467: the Save step is a later step than Card titles, the end of the bar.
    await expectPostNameStepLeft(page, STEP_SUBTITLE.titles);
    await expect(wizardProgress(page), "the Save step fills the progress bar").toHaveAttribute("aria-valuenow", "100");
    // Focus follows the Save step, and the label says "(Enter)": Enter committing IS the feature.
    await expect(confirmSave).toBeVisible();
    await confirmSave.press("Enter");
    await expect(page.getByText(/Saved 220 cards/)).toBeVisible({ timeout: FETCH });
    await expectAccessible(page, { label: "Saved 1996 Score insert checklist" });

    // ── 5. NeonBinder's own card name survives a re-sync (NEO-203) ──
    await expect(page.getByText("BSC source", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Edit card / }).first().click();
    const cardName = page.getByRole("textbox", { name: "Card name" });
    await expect(cardName).toBeVisible();
    await expectAccessible(page, { label: "Card detail drawer" });
    // STEP 4b's box text OPENS this STORED card's title, verbatim with nothing
    // prepended (the title the commit wrote, not a preview: nothing here has
    // regenerated it).
    await expect(page.getByRole("textbox", { name: "Card title" })).toHaveValue(new RegExp(`^${short} `));
    await cardName.pressSequentially(`NB203-${id}`);
    await cardName.press("Enter");
    await expect(page.getByText(/Saved Card name/)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();
    await expect(page.getByText(new RegExp(`NB203-${id}`)).first()).toBeVisible();

    await syncChecklistButton(page).click();
    await expect(pairing).toBeVisible({ timeout: FETCH });
    await expect(confirmMatches).toBeVisible({ timeout: FETCH });
    await expect(pairing.getByText(/220 cards will be saved/)).toBeVisible();
    await confirmMatches.click();

    const review = page.getByRole("dialog", { name: new RegExp(`Review Changes — ${MERGED}`) });
    await expect(review).toBeVisible();
    await expect(review.getByText(/Content changes \(1\)/)).toBeVisible();
    await expect(review.getByText("Card name", { exact: true }).first()).toBeVisible();
    await expect(review.getByText(new RegExp(`NB203-${id}`)).first()).toBeVisible();
    await expect(review.getByText(/ 0 new .*unchanged/)).toBeVisible();
    await expectAccessible(page, { within: review, label: "Review Changes dialog" });
    await expect(review.getByText(/no longer listed upstream/)).toBeHidden();
    await review.getByRole("button", { name: "Apply selected changes" }).click();
    // NEO-335: the wizard has no NAMES to ask about here, but it can still open
    // TEAMS-ONLY (same title, straight onto its teams step) when a card would
    // save with no team. Whether any is in that state is the marketplaces'
    // business, so both shapes are accepted and the save is asserted after
    // either. The two never coexist: the sync cleared the previous "Saved 220
    // cards." banner when it started, and the wizard stays open until its commit
    // writes the next one.
    const saved = page.getByText(/Saved 220 cards/);
    await expect(wizard.or(saved).first()).toBeVisible({ timeout: FETCH });
    if (await wizard.isVisible()) {
      // The precondition, by name: no names to decide, and a post-name step is
      // the sitting's first.
      await expect(wizard.getByRole("button", { name: /Skip remaining names/ })).toBeHidden();
      // NEO-467: the sitting's first step, read off the progress bar's value text.
      // NEO-574: "Career check" too (any one of these is the post-name step being up).
      await expectWizardStep(
        page,
        new RegExp(`^(${STEP_SUBTITLE.career}|${STEP_SUBTITLE.teams}|${STEP_SUBTITLE.titles})$`),
      );
      // Teams are not this spec's business: Next leaves every line on its default.
      await advanceToSave(page);
      await expect(wizard.getByText(/Save [0-9]+ cards?\?/)).toBeVisible();
      await confirmSaveButton(page).click();
    }
    await expect(saved).toBeVisible({ timeout: FETCH });
    await expect(page.getByText(new RegExp(`NB203-${id}`)).first()).toBeVisible();

    // ── 6. The set is still renamed (STEP 3b), re-sync the column: the name check offers suggestions ──
    // The panel header renders the CURRENTLY SELECTED row, so this proves the row
    // still carries OUR name after a card fetch, a commit and a re-sync.
    await expect(page.getByRole("heading", { name: `Attributes for ${renamed}` })).toBeVisible();

    await page.getByRole("button", { name: "Sync Inserts" }).click();
    await expect(reconcile).toBeVisible({ timeout: 240_000 });
    await reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill(`NB211-${id}`);
    await expect(reconcile.getByText(/Ready \(1 of [0-9]+\)/)).toBeVisible();
    await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${renamed}` })).toBeVisible();
    await saveSets.click();
    await expect(reconcile).toBeHidden();

    // ── 7. The renamed set keeps its name; upstream spellings are only suggestions ──
    await openScoreInserts(page, env);
    await columnSearch(page, "Inserts").fill("Artist");
    await expect(columnOption(page, "Inserts", renamed)).toBeVisible();
    await expect(page.getByText(/Artist.s Proofs Series [12]/)).toBeHidden();

    await page.getByRole("button", { name: /names? to check — review suggestions/ }).click();
    const nameCheck = page.getByRole("dialog", { name: "Name Check — Inserts" });
    await expect(nameCheck).toBeVisible();
    await expect(nameCheck.getByText(/SportLots calls it "Dugout Collection Artists Proofs"/)).toBeVisible();
    await expect(nameCheck.getByText(/BSC calls it "Dugout Collection Artist.s Proofs Series [12]"/)).toBeVisible();
    await expectAccessible(page, { within: nameCheck, label: "Name Check dialog" });
    const keep = (side: string) =>
      nameCheck.getByRole("button", {
        name: new RegExp(`^Keep mine — keep "${renamed}"; stop suggesting ${side}'s ".*"$`),
      });
    await keep("BSC").click();
    await keep("SportLots").click();
    await expect(nameCheck.getByText("0 to take · 2 to keep")).toBeVisible();
    await nameCheck.getByRole("button", { name: "Apply decisions" }).click();
    await expect(page.getByText("2 declined")).toBeVisible();

    await expect(columnOption(page, "Inserts", renamed)).toBeVisible();
    await columnOption(page, "Inserts", renamed).click();

    // ── 8. Both BSC sources are still attached; detaching one asks first ──
    await openAttributesPanel(page);
    await expect(multiSource).toBeVisible();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 1/).first()).toBeVisible();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 2/).first()).toBeVisible();
    await page.getByRole("button", { name: /^Remove Dugout Collection Artist.s Proofs Series 1$/ }).click();
    await expect(
      page.getByText(/110 cards were fetched from it; their BSC link will be dropped/),
    ).toBeVisible();
    await expectAccessible(page, { label: "Detach BSC source confirm" });
    await page.getByRole("button", { name: /^Cancel detach Dugout Collection Artist.s Proofs Series 1$/ }).click();
    await expect(page.getByText(/were fetched from it/)).toBeHidden();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 1/).first()).toBeVisible();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 2/).first()).toBeVisible();
  },
);
