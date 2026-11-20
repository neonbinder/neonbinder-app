/**
 * Entity-review wizard helpers the checklist-wizard specs share. Origins:
 * .maestro/flows/set-selector/util-fetch-real-set-checklist-to-wizard.yaml,
 * util-discard-resumed-review-batch.yaml, util-wizard-walk-to-player-row.yaml,
 * util-wizard-walk-to-player-row-creating-teams.yaml and (NEO-335) util-wizard-
 * advance-to-save.yaml, util-wizard-read-back-decision.yaml (Maestro suite
 * retired in NEO-341; see git history).
 *
 * The wizard since NEO-335 ("Tidy up <year> <set> <variant>" since NEO-497,
 * `TIDY_UP_NAME`): names -> teams -> titles ->
 * save. Since NEO-467 its header shows a progress bar ("Wizard progress",
 * `aria-valuetext` = the step's subtitle, `aria-valuenow` = a rounded percent,
 * 100 on Save), not an exact "Step x of y": a spec says where the wizard is by
 * the subtitle (`expectWizardStep`), and that a name row was decided by that
 * row's own skip control going away (`readNameStep` / `expectNameStepLeft`),
 * never by a number. Past the names come a
 * "Cards with no team" step and a "Card titles" step (each only when needed,
 * each with a footer "Next (Enter)" and NO Confirm & Save), then "Ready to
 * save", the only step with Confirm & Save. Since NEO-345 an "Autographed
 * cards" step sits between teams and titles when a card the save will create
 * carries BSC's AU tag on a part with no autograph format; its answer is
 * REQUIRED (Next stays aria-disabled until one is picked), so `advanceToSave`
 * answers it. The post-save attention walker
 * wears the same title and progress bar; tell them apart by the walker's
 * "Skip for now, card <number>" or by this wizard's footer.
 *
 * `util-wizard-career-form-into-view.yaml` (NEO-335) has NO Playwright
 * counterpart on purpose: it only dragged the body so Maestro's tap would not
 * land on the footer over a clipped form. Playwright's click scrolls the
 * target into view and refuses to click through an overlapping control (it
 * waits, then fails by name), so the clipped-form failure cannot pass
 * silently here and a spec simply clicks the field.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./fixtures";
import type { FlowEnv } from "./env";
import { expectAfterMarketplace, expectStepWithSportLots } from "./marketplace-wait";
import { CHECKLISTS, confirmChecklistMatchCards, usePublishersChecklist, type ChecklistName, type ChecklistRow } from "./published-checklist";
import {
  columnHeading,
  columnOption,
  columnSearch,
  DRILL_DEFAULTS,
  drillToBaseVariant,
  drillToColdManufacturer,
  escapeRe,
  syncChecklistButton,
  VARIANT_TYPES_SYNC,
  type DrillTarget,
} from "./set-builder";

/**
 * A live marketplace fetch, or a whole batch's lookups (the flows' 120 s / 180 s). `FETCH` is the
 * ceiling a step that also drives a LIVE SportLots round trip keeps (`expectStepWithSportLots`);
 * BuySportsCards alone is the fake and takes the standard 7 s (NEO-552).
 */
const FETCH = 120_000;
export const LOOKUPS = 180_000;

/**
 * NEO-497 — the name every tidy-up dialog (the pre-save wizard and the
 * post-save attention walker) starts with. The title goes on to name the set
 * it tidies, "Tidy up 2024 Topps Chrome" for its Base variant type (`tidyUpName`),
 * and reads "Tidy up this set" only while the set's names are still loading.
 * Find the dialog or its heading by this; assert the full name with
 * `tidyUpName`.
 */
export const TIDY_UP_NAME = /^Tidy up /;

/**
 * NEO-497 — a tidy-up dialog's full name for the checklist at
 * `<year> / <set> / <variant>`: the year row, the SET row (never the
 * manufacturer) and the checklist's own row, in that order. `variant` is the
 * words the title shows, taken exactly: a parallel under an insert reads
 * "<insert> <parallel>" (the insert's name first, unless the parallel's own
 * name already starts with it), so the caller passes that whole text; this
 * helper does not re-derive the rule, so it cannot agree with a broken one.
 *
 * The checklist of a set's Base variant type (the `variantType` row whose
 * title is "Base" or "Bases", NEO-334) does not name it (Jason, 2026-11-11):
 * leave `variant` out for it ("Tidy up 2024 Topps Chrome"). Any other row
 * keeps its name whole, including an insert-level row that is itself called
 * "Base", such as Insert > Base: "Tidy up 2024 Topps Base" (NEO-616). The
 * helper cannot see which row the spec drilled to, so a `variant` that reads
 * as a Base type ("Base"/"Bases", case-folded) throws unless the caller says
 * it is such an insert row with `insertRow: true`. A Base type's expectation
 * so cannot quietly bring the word back, and the helper never strips a word
 * itself.
 */
export function tidyUpName({
  year,
  set,
  variant,
  insertRow = false,
}: {
  year: string;
  set: string;
  variant?: string;
  /** The checklist row is an insert-level row (under Insert or Parallel), not a variant type. */
  insertRow?: boolean;
}): string {
  const word = variant?.trim().replace(/\s+/g, " ").toLowerCase();
  if (!insertRow && (word === "base" || word === "bases")) {
    throw new Error(
      'tidyUpName: a Base variant type\'s checklist title leaves the variant out (NEO-497); leave `variant` out for it, ' +
        "or pass `insertRow: true` for an insert row named Base (NEO-616)",
    );
  }
  return variant === undefined ? `Tidy up ${year} ${set}` : `Tidy up ${year} ${set} ${variant}`;
}

/**
 * The open pre-save wizard, by its dialog name (`TIDY_UP_NAME`; "Tidy up this
 * set" from NEO-335 to NEO-497, "Confirm New Players & Teams" before that).
 * Contract: a locator, nothing waited for. The post-save attention walker
 * shares this name.
 */
export function reviewWizard(page: Page): Locator {
  return page.getByRole("dialog", { name: TIDY_UP_NAME });
}

/**
 * NEO-467: the header's progress bar, `role="progressbar"` named "Wizard
 * progress". Its `aria-valuetext` is the step's subtitle and its
 * `aria-valuenow` a rounded percent (100 on Save); it only ever moves forward.
 * There is no exact count ("Step x of y") anywhere. Contract: a locator,
 * nothing waited for. The post-save attention walker wears the same header,
 * so scope a walker check to the walker's own dialog.
 */
export function wizardProgress(page: Page): Locator {
  return reviewWizard(page).getByRole("progressbar", { name: "Wizard progress" });
}

/**
 * The wizard's step subtitles (`STEP_SUBTITLE` in entity-review-steps.ts).
 * Every name step of one kind shares its subtitle, so a subtitle says WHICH
 * KIND of step is up, never which row: a row is told by its own name
 * (`readNameStep`). NEO-478's `checklist` step ("Checklist says otherwise")
 * comes BEFORE the names and is not in `POST_NAME_ORDER`.
 */
export const STEP_SUBTITLE = {
  league: "New league",
  team: "New team",
  player: "New player",
  pick: "Which player is this?",
  checklist: "Checklist disagreements",
  career: "Career check",
  teams: "Cards with no team",
  autograph: "Autographed cards",
  titles: "Card titles",
  save: "Ready to save",
} as const;

/** The steps after the names, in the order the wizard walks them. */
const POST_NAME_ORDER: readonly string[] = [
  STEP_SUBTITLE.career,
  STEP_SUBTITLE.teams,
  STEP_SUBTITLE.autograph,
  STEP_SUBTITLE.titles,
  STEP_SUBTITLE.save,
];

/** Any name-step subtitle. */
const NAME_STEP_SUBTITLE = new RegExp(
  `^(${[STEP_SUBTITLE.league, STEP_SUBTITLE.team, STEP_SUBTITLE.player, STEP_SUBTITLE.pick]
    .map(escapeRe)
    .join("|")})$`,
);

/** A presented name row's skip control, any kind (its accessible name names the row). */
const NAME_ROW_SKIP = /^Skip .* — (not a person|not a team|this team has no league)$/;

/**
 * Assert the wizard is on the step whose subtitle is `subtitle` (a string is
 * matched whole), read off the progress bar's `aria-valuetext`. Contract: a
 * 7 s web-first assert; it also proves the progress bar is there.
 */
export async function expectWizardStep(page: Page, subtitle: string | RegExp): Promise<void> {
  await expect(wizardProgress(page), `the wizard is on its "${String(subtitle)}" step`).toHaveAttribute(
    "aria-valuetext",
    subtitle,
  );
}

/**
 * `{ subtitle, percent }` read off the progress bar. Contract: waits (7 s) for
 * it to be visible, then reads both at that instant. Read it only once the
 * step you mean is asserted, so the numbers belong to that step. A percent may
 * only be held not to go down across a change; never pin its value.
 */
export async function readProgress(page: Page): Promise<{ subtitle: string; percent: number }> {
  const bar = wizardProgress(page);
  await expect(bar).toBeVisible();
  const subtitle = (await bar.getAttribute("aria-valuetext")) ?? "";
  const percent = Number(await bar.getAttribute("aria-valuenow"));
  expect(Number.isFinite(percent), "the wizard's progress bar carries a numeric aria-valuenow").toBe(true);
  return { subtitle, percent };
}

/**
 * NEO-467: the header carries no exact count. No "Step x of y" anywhere in the
 * dialog and no growth line ("2 more steps: ...", "1 fewer step: ..."), with
 * the progress bar as the positive under those negatives (GUIDE R2).
 */
export async function expectNoStepCount(page: Page): Promise<void> {
  const wizard = reviewWizard(page);
  await expect(wizardProgress(page)).toBeVisible();
  await expect(wizard.getByText(/Step [0-9]+ of [0-9]+/)).toHaveCount(0);
  await expect(wizard.getByText(/[0-9]+ (more|fewer) steps?:/)).toHaveCount(0);
}

/**
 * The names' "Decided (N)" history summary (its count is a node of its own).
 * The product renders it on the name steps and on Save from the first decision
 * on, never on the teams / autograph / titles steps. Contract: a locator.
 */
export function decidedSummary(page: Page): Locator {
  return reviewWizard(page).getByText(/^Decided \([0-9]+\)$/);
}

/**
 * A batch with nothing decided yet (what "Step 1 of N" used to say): the
 * header is on a name step and there is no "Decided (N)" history. The subtitle
 * is the positive under the negative.
 */
export async function expectNothingDecided(page: Page): Promise<void> {
  await expectWizardStep(page, NAME_STEP_SUBTITLE);
  await expect(decidedSummary(page)).toHaveCount(0);
}

/**
 * N of the "Decided (N)" history at this instant, 0 when there is none yet. A
 * count of DECISIONS, not of steps (NEO-467 removed the step count): a spec
 * proves one press recorded exactly one decision by reading it before and
 * asserting `Decided (N+1)` after. Read it only on a settled name step (a row
 * presented, its lookups drained), so nothing else moves it. Contract: waits
 * (7 s) for a name step, then reads once.
 */
export async function readDecidedCount(page: Page): Promise<number> {
  await expectWizardStep(page, NAME_STEP_SUBTITLE);
  const summary = decidedSummary(page);
  if (!(await summary.isVisible())) return 0;
  const match = ((await summary.textContent()) ?? "").match(/^Decided \(([0-9]+)\)$/);
  expect(match, "the Decided history reads Decided (N)").toBeTruthy();
  return Number(match![1]);
}

/**
 * Assert the "Decided (N)" history reads exactly `n` decisions (no history at
 * all for 0), on a name step. Pair with `readDecidedCount`. Contract: a 7 s
 * web-first assert (a decision is our own mutation answering, R5).
 */
export async function expectDecidedCount(page: Page, n: number): Promise<void> {
  if (n === 0) {
    await expectWizardStep(page, NAME_STEP_SUBTITLE);
    await expect(decidedSummary(page), "no name is decided yet").toHaveCount(0);
    return;
  }
  await expect(decidedSummary(page), `exactly ${n} names are decided`).toHaveText(`Decided (${n})`);
}

/**
 * The presented name step's skip control, whatever its kind ("Skip <name> —
 * not a person", "... — not a team", "... — this team has no league"). One
 * row is presented at a time, and its skip names it. Contract: a locator.
 */
export function nameStepSkip(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: NAME_ROW_SKIP });
}

/**
 * The presented name row's identity: its skip control's accessible name. Name
 * steps of a kind share a subtitle, so this, not the header, says which row is
 * up. Contract: waits (7 s) for a row to be presented, returns the name.
 */
export async function readNameStep(page: Page): Promise<string> {
  const skip = nameStepSkip(page);
  await expect(skip, "a name step is presented").toBeVisible();
  return (await skip.getAttribute("aria-label")) ?? "";
}

/** Any presented name row's skip OTHER than `row` (a `readNameStep` value). */
function otherNameRow(page: Page, row: string): Locator {
  return reviewWizard(page).getByRole("button", {
    name: new RegExp(`^(?!${escapeRe(row)}$)Skip .* — (not a person|not a team|this team has no league)$`),
  });
}

/**
 * Wait until the wizard has left the name row whose skip is `row` (from
 * `readNameStep`): that row's own control is gone, and the wizard stands on
 * something else: a DIFFERENT row, the names-done footer ("Next (Enter)" /
 * Confirm & Save), or the footer's "still looking up" while the next row's
 * lookup runs. The row's skip stays on screen (held) while its decision is in
 * flight, so its going away is the decision landing. Contract: 7 s each.
 */
export async function expectNameStepLeft(page: Page, row: string): Promise<void> {
  const wizard = reviewWizard(page);
  await expect(wizard.getByRole("button", { name: row, exact: true }), `the wizard is still on "${row}"`).toBeHidden();
  await expect(
    otherNameRow(page, row)
      .or(nextStepButton(page))
      .or(confirmSaveButton(page))
      .or(wizard.getByText(/still looking up/))
      .first(),
    `the wizard moved on from "${row}" to another step`,
  ).toBeVisible();
}

/**
 * Wait until a Next on the post-name step `from` (a subtitle, from
 * `readProgress`) has landed: the progress bar names a step that comes AFTER
 * it in the wizard's order (teams, autograph, titles, save). A positive
 * assert, so a Next that did nothing, or went backwards, fails here by name.
 * Contract: a 7 s web-first assert (Next is a client-side step change).
 */
export async function expectPostNameStepLeft(page: Page, from: string): Promise<void> {
  const at = POST_NAME_ORDER.indexOf(from);
  expect(at, `"${from}" is a step after the names`).toBeGreaterThanOrEqual(0);
  const later = POST_NAME_ORDER.slice(at + 1);
  expect(later.length, `"${from}" is not the last step`).toBeGreaterThan(0);
  await expectWizardStep(page, new RegExp(`^(${later.map(escapeRe).join("|")})$`));
}

/** The footer's forward button on the teams / autograph / titles steps. */
export function nextStepButton(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: "Next (Enter)", exact: true });
}

/**
 * `nextStepButton`, usable: not aria-disabled. A post-name step can hold Next
 * while it settles (NEO-574's career step says "Checking careers…") and then
 * drop out with no gap, straight onto the next step or Save, so a press waits
 * for THIS, never for a Next that is merely on screen (a held Next is clicked
 * after it has gone). The autograph step holds it until a tile is picked.
 */
function usableNextButton(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: "Next (Enter)", exact: true, disabled: false });
}

/**
 * Wait until the post-name walk holds still: a usable Next, the Save step's
 * Confirm & Save, or the autograph tiles (whose Next stays held until a tile is
 * picked). `first()`: a caller that answered the autograph step arrives with
 * its tiles AND a usable Next up. Contract: 7 s; reads nothing.
 */
async function expectPostNameStepSettled(page: Page): Promise<void> {
  await expect(
    usableNextButton(page).or(confirmSaveButton(page)).or(autographChoices(page)).first(),
    "the wizard shows a usable Next, the Save step or the autograph tiles",
  ).toBeVisible();
}

/** The Save step's commit button. */
export function confirmSaveButton(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: /Confirm & Save/ });
}

/**
 * NEO-345: the wizard's "Autographed cards" step. ALL of this copy is
 * placeholder wording that Jason will replace; it lives here, once, so the
 * specs do not each restate it. The step's subtitle (pinned in the header).
 */
export const AUTOGRAPH_STEP_SUBTITLE = "Autographed cards"; // mirrors STEP_SUBTITLE.autograph

/** What the step says when its held Next is pressed with nothing picked (placeholder). */
export const AUTOGRAPH_BLOCKED_HINT = "Pick how they're signed first"; // mirrors AUTOGRAPH_NEXT_BLOCKED

/** The step's two answers, as the tiles read ("On card" / "Sticker"; placeholder). */
export type AutographChoice = "On card" | "Sticker";

/**
 * The step's radio group, named by its question ("14 of these cards are
 * autographed. How are they signed?", "1 of these cards is autographed. How
 * is it signed?"). Contract: a locator, nothing waited for; a count is NOT
 * pinned here (the caller knows its fixture).
 */
export function autographChoices(page: Page): Locator {
  return reviewWizard(page).getByRole("radiogroup", {
    name: /^[0-9]+ of these cards? (is|are) autographed\. How (is it|are they) signed\?$/,
  });
}

/** One tile of `autographChoices`, by its visible name. */
export function autographChoice(page: Page, choice: AutographChoice): Locator {
  return autographChoices(page).getByRole("radio", { name: choice, exact: true });
}

/**
 * NEO-478: the step that shows where the operator's published checklist and the
 * marketplace disagree about a card (a player's name, a team). Contract: a
 * locator on its heading, nothing waited for.
 */
export function checklistDisagreementHeading(page: Page): Locator {
  return reviewWizard(page).getByRole("heading", { level: 3, name: "Checklist says otherwise" });
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One disagreement's choices on that step: a radio group per card named
 * "Disagreement on #<number>" (the radios repeat on every card, so the group
 * scopes them). The number must not be a prefix of another ("#6" and "#60").
 */
export function disagreementOn(page: Page, number: string): Locator {
  return reviewWizard(page).getByRole("radiogroup", { name: new RegExp(`^Disagreement on #${escapeRegExp(number)}(?![0-9A-Za-z])`) });
}

/**
 * The "Checklist says otherwise" step comes FIRST in the walk, before any name
 * step (answering it hides the review rows for names no card carries any more),
 * so a wizard opened by a fetch that had a disagreement shows it at once. The
 * bulk links ("Add remaining players as new", "Skip remaining names") are
 * hidden while it is on screen, and Next stays blocked until every group has a
 * side picked.
 *
 * Contract: ENTRY the wizard is open. EXIT the step's heading is showing,
 * nothing on it decided. A wizard that does not open on it fails here, by
 * name: the caller is the spec whose FEATURE is that step.
 */
export async function expectChecklistDisagreementFirst(page: Page): Promise<void> {
  const wizard = reviewWizard(page);
  await expect(checklistDisagreementHeading(page), "the wizard opens on its Checklist says otherwise step").toBeVisible();
  await expect(wizard.getByText("Checklist disagreements", { exact: true })).toBeVisible();
  await expect(wizard.getByRole("button", { name: /Skip remaining names/ })).toHaveCount(0);
  await expect(wizard.getByRole("button", { name: /Add remaining players as new/ })).toHaveCount(0);
}

/**
 * Pick a side in one disagreement's radio group and prove it took (checked).
 */
export async function pickDisagreementSide(
  page: Page,
  number: string,
  side: "Keep the marketplace's" | "Use the checklist's",
): Promise<void> {
  const radio = disagreementOn(page, number).getByRole("radio", { name: side, exact: true });
  await radio.click();
  await expect(radio).toBeChecked();
}

/**
 * The step's bulk answer (shown with two or more cards): one press sets every
 * card's own radio, and each card can then be changed on its own. Contract:
 * ENTRY the "Checklist says otherwise" step is open with two or more cards.
 * EXIT every card's radio on that side is checked; nothing is pressed after it.
 */
export async function pickSideForAllCards(
  page: Page,
  side: "Keep the marketplace's" | "Use the checklist's",
  numbers: readonly string[],
): Promise<void> {
  const group = reviewWizard(page).getByRole("group", { name: "Same answer for every card:" });
  await group.getByRole("button", { name: `${side} on all`, exact: true }).click();
  for (const number of numbers) {
    await expect(disagreementOn(page, number).getByRole("radio", { name: side, exact: true })).toBeChecked();
  }
}

/** The status the blocked Next shows while a card on the step has no side picked. */
export function pickASideFirst(page: Page): Locator {
  return reviewWizard(page).getByText("Pick a side on every card first — then Next.").first();
}

/**
 * Pick `choice` on the open "Autographed cards" step and prove it took.
 * Contract: ENTRY the step is on screen. EXIT the tile is checked (so the
 * footer's Next is released); nothing is pressed after it.
 */
export async function answerAutographStep(page: Page, choice: AutographChoice = "On card"): Promise<void> {
  const tile = autographChoice(page, choice);
  await tile.click();
  await expect(tile).toBeChecked();
}

/**
 * Press Next through the steps before "Autographed cards" (a teamless-card
 * step, say) until its radio group is up. Answers nothing.
 *
 * Contract: ENTRY every name is decided (the names-done footer is up). EXIT
 * the step is showing. A wizard that never offers the step fails here, by
 * name: the caller is the spec whose FEATURE is that step. A runaway guard of
 * 3 (only the career and teams steps can sit before it).
 */
export async function walkToAutographStep(page: Page): Promise<void> {
  const group = autographChoices(page);
  const next = usableNextButton(page);
  for (let i = 0; i < 3; i++) {
    await expectPostNameStepSettled(page);
    if (await group.isVisible()) break;
    await expect(next, "the wizard offers Next on its way to the Autographed cards step").toBeVisible();
    const { subtitle } = await readProgress(page);
    await next.click();
    await expectPostNameStepLeft(page, subtitle);
  }
  await expect(group, "the wizard reached its Autographed cards step").toBeVisible();
}

/**
 * NEO-574: the "Career check" step's subtitle (`STEP_SUBTITLE.career`). The
 * step's own heading reads the same, so a bare `getByText` of it resolves to
 * two elements on that step; scope or take `.first()`, or read the progress bar
 * (`expectWizardStep`, `readProgress`), which names it once.
 */
export const CAREER_STEP_SUBTITLE = STEP_SUBTITLE.career;

/**
 * NEO-574: one line of the "Career check" step, a radio group named
 * "<player> on <team>" (`careerLineLabel`), holding "Keep as is", "Add
 * to career", "Wrong player" and "Fix card’s team". Contract: a locator,
 * nothing waited for; exact, so "Ann on Reds" never answers for "Ann on Reds II".
 */
export function careerLine(page: Page, player: string, team: string): Locator {
  return reviewWizard(page).getByRole("radiogroup", { name: `${player} on ${team}`, exact: true });
}

/** Any post-name step's subtitle, optionally without the ones in `except`. */
function postNameSubtitles(except: readonly string[] = []): RegExp {
  return new RegExp(`^(${POST_NAME_ORDER.filter((t) => !except.includes(t)).map(escapeRe).join("|")})$`);
}

/**
 * NEO-574: press Next past the "Career check" step when it comes (every line
 * left on "Keep as is", which writes nothing), and stop on the step after it.
 * For a spec that asserts what the LATER steps hold (the teams step's lines,
 * or that there is no teams step) and whose fixture's known players may or may
 * not have the card's team on file: the branch waits for a settled post-name
 * step first (the progress bar names one), and ends on a positive assert of a
 * step that is not the career check, so a negative assert after it is about a
 * live step (R2).
 *
 * Contract: ENTRY every name is decided. EXIT a post-name step other than the
 * career check is up (the progress bar's subtitle names it).
 */
export async function passCareerCheck(page: Page): Promise<void> {
  await expectWizardStep(page, postNameSubtitles());
  // A career step still checking may yet drop out on its own: read the subtitle
  // once the walk holds still.
  await expectPostNameStepSettled(page);
  const { subtitle } = await readProgress(page);
  if (subtitle === CAREER_STEP_SUBTITLE) {
    await usableNextButton(page).click();
    await expectPostNameStepLeft(page, subtitle);
  }
  await expectWizardStep(page, postNameSubtitles([CAREER_STEP_SUBTITLE]));
}

/**
 * Press Next past the "Career check" (NEO-574) and "Cards with no team" steps
 * when they come, leaving every line on its default ("Keep as is", "Leave for
 * later"), and stop on the first step after them (autograph, titles or Save).
 * For a spec whose feature is a LATER step (the titles step) and which reads
 * where it is from the subtitle; a spec that only needs Save calls
 * `advanceToSave`.
 *
 * Contract: ENTRY every name is decided (the names-done footer is up). EXIT the
 * subtitle is neither "Career check" nor "Cards with no team"; each press is
 * proved to have moved the wizard on (`expectPostNameStepLeft`). A runaway
 * guard of 3 (two such steps).
 */
export async function passCareerAndTeamsSteps(page: Page): Promise<void> {
  const skipped: readonly string[] = [CAREER_STEP_SUBTITLE, STEP_SUBTITLE.teams];
  for (let i = 0; i < 3; i++) {
    await expectWizardStep(page, postNameSubtitles());
    await expectPostNameStepSettled(page);
    const { subtitle } = await readProgress(page);
    if (!skipped.includes(subtitle)) return;
    await usableNextButton(page).click();
    await expectPostNameStepLeft(page, subtitle);
  }
  await expectWizardStep(page, postNameSubtitles(skipped));
}

/**
 * util-fetch-real-set-checklist-to-wizard.yaml: drill to a real set's Base
 * checklist (2024 Topps Stars of MLB Network by default, a 10-card set the
 * seed maps and leaves empty; NEO-475, it was Topps Big League's 310 cards),
 * fetch it from the marketplaces, confirm the card pairing when both
 * marketplaces answered, and land in the entity-review wizard.
 *
 * Contract: EXIT the tidy-up dialog is open, named for the set it fetched
 * ("Tidy up 2024 Topps Stars of MLB Network" by default, NEO-497) and
 * axe-clean, every row undecided (callers assert that themselves,
 * `expectNothingDecided`). With a checklist (the default set always has one), the checklist is a source of
 * its own (NEO-496, NQ1), so Match Cards opens on both branches and is
 * confirmed keeping every marketplace card (`confirmChecklistMatchCards`); the
 * pairing session is then PARKED behind the wizard ("Back to Match Cards" is
 * offered). With no checklist: live, the two marketplaces pair the same way;
 * with SportLots paused it is the one-marketplace solo path and there is no
 * parked session. NEO-475: on the default set the live branch is UNMEASURED
 * (retargeted while SportLots was paused, so neither the seed's SportLots base
 * mapping nor this Match Cards pairing has run on it); the first live run must
 * check both.
 *
 * `firstFetch` (a set's sole writer, which commits it): the precondition of a
 * FIRST fetch, asserted before the upload. A committed set re-syncs instead and
 * a re-sync raises no review, so a local re-run on an already-committed seed
 * fails here, by name: re-seed first.
 */
export async function fetchChecklistToWizard(
  page: Page,
  env: FlowEnv,
  target: DrillTarget = {},
  {
    checklist = target.set === undefined ? CHECKLISTS.starsOfMlbNetwork : undefined,
    firstFetch = false,
  }: { checklist?: ChecklistName; firstFetch?: boolean } = {},
): Promise<void> {
  const drilled = { set: "Topps Stars of MLB Network", ...target };
  await drillToBaseVariant(page, env, drilled);
  if (firstFetch) await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  // NEO-478/482/489: the publisher's checklist is uploaded before the fetch. The default
  // set's file answers every card (each row says "No Team": the hosts and the show card
  // have none), so BSC is asked for nothing per card and none of its cards reaches "Cards
  // with no team". A caller naming another file gets that file; one targeting another set
  // and naming none fetches live.
  const facts = checklist === undefined ? undefined : await usePublishersChecklist(page, checklist);
  await syncChecklistButton(page).click();

  const confirmMatches = page.getByRole("button", { name: "Confirm card matches" });
  if (facts !== undefined) {
    // NEO-496 (D10, NQ1): BSC plus the checklist are two sources, so Match Cards opens even with
    // SportLots paused. The teams line is asserted while it is open (the only time before the save).
    await confirmChecklistMatchCards(page, { facts, what: "the fetch of the Base checklist" });
  } else if (!env.SL_PAUSED) {
    await expect(page.getByText(/Match Cards/).first()).toBeVisible({ timeout: FETCH });
    // The button reads "Loading…" (aria-disabled) while cards still stream in;
    // wait for the usable one (the flow's "^Confirm$" text).
    const ready = page.getByRole("button", { name: "Confirm card matches", disabled: false });
    await expect(ready).toBeVisible({ timeout: FETCH });
    await ready.click();
  } else {
    // One marketplace answered: the solo path keeps its cards without pairing. The
    // fetch is one live BSC round trip: 7 s of our own time plus the seconds the
    // screen says it is waiting on BSC (NEO-487), never a flat ceiling.
    await expectAfterMarketplace(page, page.getByText(/Kept all [0-9]+ cards? from BSC/), {
      platform: "BuySportsCards",
      what: "the solo fetch's kept-cards line",
    });
    await expect(page.getByText(/Match Cards/)).toBeHidden();
    await expect(confirmMatches).toBeHidden();
  }
  // Live, the wizard opens after the pairing's Confirm (a live SportLots + BSC round trip's
  // aftermath); paused, it opens once the solo fetch has landed above, our own work: measured
  // 1.3 s at most on the #487 merge-group run (GUIDE), so the standard 7 s.
  await expectStepWithSportLots(page, reviewWizard(page), env, { liveMs: FETCH, what: "the tidy-up dialog opening", statusLine: false });
  // NEO-497: the dialog names the checklist it is tidying, read off the NB rows
  // this drill picked (the year and the set; `drillToBaseVariant` opened the
  // Base variant type, whose checklist title leaves the variant out).
  await expect(reviewWizard(page)).toHaveAccessibleName(
    tidyUpName({
      year: drilled.year ?? DRILL_DEFAULTS.year,
      set: drilled.set ?? DRILL_DEFAULTS.set,
    }),
  );
  // The helper's product is this screen, so it checks it (GUIDE "Accessibility checks").
  await expectAccessible(page, { within: reviewWizard(page), label: "entity-review wizard" });
}

/** `openOneMarketplaceSetBase`'s ancestors when the caller names none. */
const ONE_MARKETPLACE_DEFAULTS = { sport: "Hockey", year: "1995", manufacturer: "All Brands" } as const;

export interface OneMarketplaceSet {
  /** The set's NB name, as the Sets column lists it. */
  set: string;
  /** Ancestors; default Hockey / 1995 / the pinned "All Brands" view. */
  sport?: string;
  year?: string;
  manufacturer?: string;
  /**
   * NEO-478/482: a captured publisher's checklist to upload before the Sync
   * (`CHECKLISTS` in support/published-checklist.ts). Omitted, the fetch asks
   * BSC for every card itself.
   */
  checklist?: ChecklistName;
  /**
   * NEO-574: rows appended to `checklist` that the marketplace has no card for
   * (`usePublishersChecklist`'s `extraRows`). Match Cards then KEEPS them all, so
   * they reach the wizard as cards the checklist alone names.
   */
  extraRows?: readonly ChecklistRow[];
}

/**
 * util-open-one-marketplace-set-base.yaml (NEO-330): drill to a REAL set that
 * carries ONE marketplace (BuySportsCards), select it, open `Base`, and CANCEL
 * the base picker so exactly one side stays attached. Nothing is fetched. The
 * Base stays unmapped on SportLots ("Map Base Set" is on screen) and the
 * checklist section is below it. A flow that has committed the set calls this
 * again for a fresh load of its checklist (the picker re-opens on a committed
 * set too: only the SportLots slot counts as a mapping, and cancelling never
 * writes one).
 */
export async function openOneMarketplaceSetBase(
  page: Page,
  env: FlowEnv,
  { set, sport = ONE_MARKETPLACE_DEFAULTS.sport, year = ONE_MARKETPLACE_DEFAULTS.year, manufacturer = ONE_MARKETPLACE_DEFAULTS.manufacturer }: OneMarketplaceSet,
): Promise<void> {
  await drillToColdManufacturer(page, env, { sport, year, manufacturer });

  // The drill's own "Syncing Sets" gate can report done while the year-wide
  // BSC phase is still storing, so the rows can still be one marketplace round
  // trip away (the util's 15 s, an R5 marketplace exception).
  await expectStepWithSportLots(page, page.getByRole("listbox", { name: "Sets" }), env, { liveMs: 15_000, what: "the Sets list" });
  await columnSearch(page, "Sets").fill(set);
  await columnOption(page, "Sets", set).click();
  // Selecting the set fires its cold, BSC-only variant-type sync.
  await expect(columnHeading(page, "Variant Types")).toBeVisible({ timeout: 20_000 });
  await expectStepWithSportLots(page, columnOption(page, "Variant Types", "Base"), env, {
    liveMs: VARIANT_TYPES_SYNC,
    what: "Variant Types row Base",
  });

  // An unmapped Base (`baseHasMapping` counts the SportLots slot only) opens the picker.
  await columnOption(page, "Variant Types", "Base").click();
  const picker = page.getByRole("dialog", { name: "Select Base Set" });
  await expect(picker).toBeVisible();
  // The confirm reads "Loading…" until the picker's SportLots + BSC round trip lands (live: the
  // old 60 s; paused it is BSC's candidates alone, under the picker's wait line).
  await expectStepWithSportLots(page, picker.getByRole("button", { name: "Confirm Base Set" }), env, {
    liveMs: 60_000,
    what: "the Base picker's candidates",
  });
  // R2 precondition: BSC really answers for this set, so the fetch is a real one-marketplace fetch.
  await expect(picker.getByRole("option", { name: /^BSC base candidate: / }).first()).toBeVisible();
  const slCandidates = picker.getByRole("option", { name: /^SportLots base candidate: / });
  if (!env.SL_PAUSED) {
    // Live, the year's SportLots catalogue is OFFERED (offering is not attaching) and declined.
    await expect(slCandidates.first()).toBeVisible();
  } else {
    await expect(picker.getByText(/^SportLots wasn't asked: /)).toBeVisible();
    await expect(slCandidates).toHaveCount(0);
  }
  await expectAccessible(page, { within: picker, label: "Select Base Set picker, one marketplace offers a base" });

  // Cancelling writes nothing and is what keeps exactly one marketplace attached.
  await picker.getByRole("button", { name: "Cancel" }).click();
  const cancelled = page.getByText(/Base mapping cancelled/);
  await expect(cancelled).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(cancelled).toBeHidden();
  // Positive proof that Cancel left the row UNMAPPED: a Base that had picked up
  // a SportLots mapping would offer "Re-map Base" instead.
  await expect(page.getByRole("button", { name: "Map Base Set" })).toBeVisible();
}

/**
 * util-fetch-one-marketplace-set-checklist-to-wizard.yaml (NEO-330): the
 * one-marketplace twin of `fetchChecklistToWizard`. Opens the set's Base
 * (`openOneMarketplaceSetBase`), syncs the never-fetched checklist and lands
 * in the entity-review wizard with nothing decided. There is
 * no parked pairing session behind it ("Back to Match Cards" is not offered)
 * unless a checklist was uploaded: then BSC and the checklist are two sources
 * (NEO-496, NQ1), Match Cards opens and is confirmed keeping every BSC card
 * (`confirmChecklistMatchCards`), and that session is parked behind the wizard.
 * The caller owns the exit: Cancel -> Discard for a reader, Confirm & Save
 * (after `advanceToSave`) for the set's sole writer (SET-REGISTRY.md).
 *
 * Contract: ENTRY the set is registered one-marketplace and never fetched.
 * EXIT the tidy-up dialog is open, named for the set ("Tidy up 1995 <set>"
 * by default, NEO-497; the Base variant type's title leaves the variant out), and
 * axe-clean. NEO-335: a
 * one-sided fetch with unknown names (every current caller) opens on a name
 * step; one whose only open question is teams or titles opens the same dialog
 * straight onto "Cards with no team" / "Card titles", so the title gate holds
 * for both shapes.
 */
export async function fetchOneMarketplaceSetChecklistToWizard(
  page: Page,
  env: FlowEnv,
  target: OneMarketplaceSet,
): Promise<void> {
  await openOneMarketplaceSetBase(page, env, target);

  // The precondition for a FIRST fetch (a committed set re-syncs instead, and a
  // re-sync raises no review). A local re-run against an already-committed
  // preview fails here, by name, which is correct: re-seed first.
  await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  const facts =
    target.checklist === undefined
      ? undefined
      : await usePublishersChecklist(page, target.checklist, target.extraRows ? { extraRows: target.extraRows } : {});
  await syncChecklistButton(page).click();

  if (facts !== undefined) {
    // NEO-496 (D10, NQ1): BSC plus the uploaded checklist are two sources, so Match Cards opens.
    // One live BSC round trip, waited on inside with `expectAfterMarketplace` (NEO-487). The
    // picker above already proved exactly one marketplace is attached.
    await confirmChecklistMatchCards(page, {
      facts,
      what: `the fetch of ${target.set}`,
      keepChecklistOnly: target.extraRows?.length,
    });
  } else {
    // One live BSC round trip, waited on with `expectAfterMarketplace` (NEO-487).
    // `soloKeptMessage` prints only on the NEO-255
    // branch, once the streamed batch has arrived in full, and names the one side
    // it asked: both the sync point and the proof that one marketplace was attached.
    await expectAfterMarketplace(page, page.getByText(/Kept all [0-9]+ cards? from BSC/), {
      platform: "BuySportsCards",
      what: "the solo fetch's kept-cards line",
    });
  }

  // Every fetched name the deployment does not hold is queued, each behind a
  // lookup (measured 3.3 s at most on the #487 merge-group run (GUIDE), so the standard 7 s: the
  // fetch has landed above, this is our own queueing). Gated on the wizard's title,
  // which names the set since NEO-497.
  await expect(reviewWizard(page)).toBeVisible();
  await expect(reviewWizard(page)).toHaveAccessibleName(
    tidyUpName({ year: target.year ?? ONE_MARKETPLACE_DEFAULTS.year, set: target.set }),
  );
  await expectAccessible(page, { within: reviewWizard(page), label: "entity-review wizard" });
}

/** Cancel out of the wizard and discard its decisions (the flows' ending). */
export async function cancelAndDiscard(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel (Esc)" }).click();
  await expect(page.getByText(/Discard [0-9]+ decisions?/)).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByText("Fetch cancelled — no cards saved.")).toBeVisible();
}

/**
 * NEO-556: Cancel out of a wizard with NO decision on it. There is nothing to discard, so the
 * product asks nothing and says the fetch is cancelled at once (`cancelAndDiscard` waits for
 * the "Discard N decisions?" question, which a batch with no decision never raises).
 */
export async function cancelUndecided(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel (Esc)" }).click();
  await expect(page.getByText("Fetch cancelled — no cards saved.")).toBeVisible();
  await expect(reviewWizard(page)).toBeHidden();
}

/**
 * util-discard-resumed-review-batch.yaml: a batch an earlier flow left behind
 * opens with decisions already on it (its "Decided (k)" history is up); throw
 * it away and fetch again so this flow starts with nothing decided.
 *
 * Contract: ENTRY the wizard is open. EXIT a batch is on screen with nothing
 * expired; a resumed one has been discarded and re-fetched (via
 * `fetchChecklistToWizard`, with the same `target` and `options` the caller
 * fetched with; the default set and its file when none are given). Not a
 * licence to ignore a dirty batch: the caller still asserts
 * `expectNothingDecided` itself right after.
 */
export async function discardResumedReviewBatch(
  page: Page,
  env: FlowEnv,
  target: DrillTarget = {},
  options: { checklist?: ChecklistName; firstFetch?: boolean } = {},
): Promise<void> {
  // Settled into one state first (the header is up), then branch on it.
  await expect(wizardProgress(page)).toBeVisible();
  if (await decidedSummary(page).isVisible()) {
    await page.getByRole("button", { name: "Cancel (Esc)" }).click();
    await expect(page.getByText(/Discard [0-9]+ decisions?/)).toBeVisible();
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByText("Fetch cancelled — no cards saved.")).toBeVisible({ timeout: 30_000 });
    await fetchChecklistToWizard(page, env, target, options);
  }
  // A fresh batch opens with nothing decided, but its own lookups start
  // settling rows at once: what must hold here is that a batch is on screen
  // with nothing expired (an expired batch has an empty subtitle).
  await expect(wizardProgress(page)).toHaveAttribute("aria-valuetext", /\S/);
}

/**
 * The decided-names history of the open wizard, opened. The product collapses
 * it once more than five names are decided (a batch's lookups settle dozens of
 * rows on their own), so a row decided a moment ago is in the DOM but hidden.
 * Opening it is the user's own step; the hard assert after it is the proof.
 */
export async function openDecidedList(page: Page): Promise<Locator> {
  const wizard = reviewWizard(page);
  const names = wizard.getByRole("list", { name: "Decided names" });
  const summary = decidedSummary(page);
  await expect(summary).toBeVisible();
  if (!(await names.isVisible())) await summary.click();
  await expect(names).toBeVisible();
  return names;
}

/** The "not a person" skip: its presence means the wizard is on a player row. */
export function personSkip(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: /^Skip .* — not a person$/ });
}

/** The presented New Team / New League step's primary action, in any state (held, enabled). */
export function addAsNewStep(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: /^Add as New (Team|League)$/ });
}

/**
 * The presented New Player step's create button, in either of its two shapes
 * (NEO-424, rule E(2)): "Add as New Player" when nothing on file answers to the
 * name, and "Add as New Player anyway" when exactly one player in some other
 * sport does (the step then leads with "Link to <name> (<sport>)" and demotes
 * creating). A spec whose intent is to CREATE the player takes this, the way
 * `answerStepAsNew` already does for teams and leagues. Contract: a locator,
 * nothing waited for. A spec that asserts the step's identity (the pick step's
 * "Create new" lands on exactly "Add as New Player") keeps the exact name.
 */
export function addAsNewPlayerButton(page: Page): Locator {
  return reviewWizard(page).getByRole("button", { name: /^Add as New Player( anyway)?$/ });
}

/**
 * Answer the presented New Player step as a CREATE and return once the wizard
 * has moved off the row (NEO-424). The caller's intent is "this player is
 * new"; the helper owns the step's two shapes:
 *  - "Add as New Player": one press records the create.
 *  - "Add as New Player anyway" (a suggested player leads with "Link to ..."):
 *    on a row the batch inserted READY with no lookup, that press only OPENS
 *    the plain New Player step and records nothing, so the helper then waits
 *    for that step's own "Add as New Player" primary and presses it. On a row
 *    whose lookup already ran, the press records the create and the walk moves
 *    on (the row's own skip goes), which is checked first so the NEXT row's
 *    primary is never mistaken for the plain step: the plain step counts only
 *    while this row's skip is still beside it.
 * A catalogue refresh that turns a fixture name into a suggestion therefore
 * changes nothing for the specs that create.
 *
 * Contract: ENTRY a player row is presented with a create button on screen
 * (waited for, 7 s). EXIT the wizard has left that row (`expectNameStepLeft`),
 * i.e. its decision was recorded.
 */
export async function answerPlayerAsNew(page: Page): Promise<void> {
  const wizard = reviewWizard(page);
  const button = addAsNewPlayerButton(page);
  await expect(button).toBeVisible();
  const demoted = /anyway$/.test(((await button.textContent()) ?? "").trim());
  const row = await readNameStep(page);
  await button.click();
  if (demoted) {
    // The plain step of THIS row: its primary with this row's skip beside it.
    const thisRow = page.getByRole("button", { name: row, exact: true });
    const plain = wizard.filter({ has: thisRow }).getByRole("button", { name: "Add as New Player", exact: true });
    const moved = otherNameRow(page, row)
      .or(nextStepButton(page))
      .or(confirmSaveButton(page))
      .or(wizard.getByText(/still looking up/));
    await expect(plain.or(moved).first()).toBeVisible();
    // Not a poll (GUIDE "Idioms": settle into ONE state, then branch). The wait
    // above returns once the app is in one of two states, and neither changes
    // on its own afterwards:
    //  - the plain step of THIS row: the "anyway" press recorded nothing, so it
    //    stays up until it is pressed (it cannot turn into `moved` by itself);
    //  - `moved`: the press recorded the create and the walk left the row, so
    //    this row's skip is gone and `plain`, scoped to a wizard that still has
    //    it, can never match again.
    // The product opens the plain step only from a row inserted READY with no
    // lookup (`preselectAwaitingLookup` in EntityReviewWizard.tsx); a row whose
    // lookup already ran records the create on the first press and never shows
    // it, so `plain` cannot be read true for a row that is about to move on.
    // `isVisible` therefore reads the settled state, and `expectNameStepLeft`
    // below is the hard assert of either path.
    if (await plain.isVisible()) await plain.click();
  }
  await expectNameStepLeft(page, row);
}

/**
 * The presented New Team / New League step's heading ("New League: Pacific
 * League"). Its accessible name is the step's identity: it goes away exactly
 * when the step does.
 */
export function newStepHeading(page: Page): Locator {
  return reviewWizard(page).getByRole("heading", { level: 3, name: /^New (Team|League): / });
}

/**
 * util-wizard-answer-step-as-new.yaml (NEO-331): answer the wizard's
 * presented New Team / New League step as a create, and return once the
 * wizard has moved off it.
 *
 * A league cannot be added without a level and none is pre-pressed (its
 * primary stays aria-disabled until one is), so a league step first gets
 * `level` (default "Other", what the step pre-pressed before NEO-331; a
 * drain claims nothing), checked before the primary is pressed. A team step
 * is one tap. The league's Wikidata lookup is not waited for: the step says
 * "Add it now", and the lookup fills the fields nobody touched when it lands.
 *
 * It ends by waiting for the step's heading to go. Until the decision write
 * returns, the step just answered stays on screen with its primary
 * aria-disabled, so a caller looping on "a primary is visible" would read the
 * OLD step, press a level on it, and leave the next league with none pressed
 * (CI run 38195356897: a 180 s wait on a held "Add as New League").
 */
export async function answerStepAsNew(
  page: Page,
  { level = "Other" }: { level?: "Major" | "Minor" | "College" | "International" | "Independent" | "Other" } = {},
): Promise<void> {
  const wizard = reviewWizard(page);
  const heading = newStepHeading(page);
  await expect(heading).toBeVisible();
  const step = ((await heading.textContent()) ?? "").trim();
  const isLeague = step.startsWith("New League: ");
  // When the name already exists (another spec, or the batch itself, created
  // it earlier in the run) the step leads with "Link to <name>" and offers
  // "Add as New Team anyway"; the util taps "Add as New" either way.
  const primary = wizard.getByRole("button", {
    name: isLeague ? /^Add as New League( anyway)?$/ : /^Add as New Team( anyway)?$/,
  });
  if (isLeague) {
    const radio = wizard.getByRole("radio", { name: level, exact: true });
    await radio.click();
    await expect(radio, `Level "${level}" is not pressed on "${step}"`).toBeChecked();
  }
  // No lookup holds the primary: only a missing level (pressed above), a
  // draft error, or a decision write in flight, so it is a UX budget, not a
  // lookup wait.
  await expect(primary, `"${step}": its Add as New is still held`).toBeEnabled();
  await primary.click();
  await expect(
    wizard.getByRole("heading", { level: 3, name: step, exact: true }),
    `"${step}" is still on screen after Add as New`,
  ).toBeHidden();
}

/**
 * Wait for the batch's name lookups to land: the footer's "N still looking up —
 * wait or skip" is gone. A row whose lookup is pending is not presented (a
 * pending team is never a step), so until this returns the walk can have no
 * step, no Back and no skip to offer. The lookups run in a deployment-wide
 * pool shared with every other shard, so under load the wait is real: the
 * batch-lookups ceiling (`LOOKUPS`), the same one `walkToPlayerRow` waits at.
 *
 * Contract: ENTRY the wizard is open. EXIT no "still looking up" line is on
 * screen. A negative alone passes on a dead page (GUIDE R2), so the caller
 * follows it with the positive assert for where it expects to be.
 */
export async function awaitLookupsSettled(page: Page): Promise<void> {
  await expect(reviewWizard(page).getByText(/still looking up/)).toBeHidden({ timeout: LOOKUPS });
}

/**
 * NEO-426: decide every name in the batch, one row at a time, for a spec about
 * ONE person on a real set whose other names it does not care about: that
 * person's row is handed to `decide`, every other row is skipped as not a
 * person. The rows come in the wizard's own order (a row waiting on its card's
 * live BSC lookup is presented late), so the walk is by the presented row's
 * name, never by position.
 *
 * Every row must be a person: a team, league or any other step fails by name
 * (a skipped team would rule a real team "not a team" for the set). Each skip
 * is proved landed (`expectNameStepLeft`) before the next row is read.
 *
 * Contract: ENTRY the wizard is open on the names. `decide` is called with the
 * person's row presented and lookups drained, and must leave that row
 * (`answerPlayerAsNew` does). EXIT every name is decided: the names-done footer
 * (`Next (Enter)` or Confirm & Save) is up, and `person`'s row was presented
 * and handed to `decide` exactly once. `maxRows` is a runaway guard.
 */
export async function skipEveryNameBut(
  page: Page,
  person: string,
  decide: () => Promise<void>,
  { maxRows = 40 }: { maxRows?: number } = {},
): Promise<void> {
  const own = `Skip ${person} — not a person`;
  const namesDone = nextStepButton(page).or(confirmSaveButton(page));
  let decided = 0;
  for (let i = 0; i < maxRows; i++) {
    await awaitLookupsSettled(page);
    await expect(nameStepSkip(page).or(namesDone).first()).toBeVisible();
    if (!(await nameStepSkip(page).isVisible())) break;
    const row = await readNameStep(page);
    await expect(personSkip(page), `"${row}" is not a person's row`).toBeVisible();
    if (row === own) {
      await decide();
      decided++;
    } else {
      await personSkip(page).click();
      await expectNameStepLeft(page, row);
    }
  }
  await expect(namesDone.first(), `names still waiting after ${maxRows} rows`).toBeVisible();
  expect(decided, `${person}'s row was presented and decided once`).toBe(1);
}

/**
 * util-wizard-walk-to-player-row(-creating-teams).yaml: move the wizard past
 * every team/league step to the first player row. `creatingTeams: false`
 * skips each team/league step (a skip creates nothing); `true` adds each as
 * new instead.
 *
 * `readyToCreate: true` (READY_TO_CREATE, NEO-335) is for a caller that must
 * CREATE the player it lands on. A skipped staged career-team step says "that
 * is not a team", so the player it was staged for then holds its create (the
 * footer reads "<team> still needs a team decision, or untick it." and
 * `Add as New Player` is aria-disabled); the batch-order walk can reach such
 * a player at any time. This walks past each held player as a SKIP (creates
 * nothing; never by unticking the chip) until it stands on a player whose
 * create is live. A caller that needs a plain UNKNOWN name to act on (a link
 * to an existing player) takes it too; skip callers leave it off.
 *
 * It passes a preselected player the same way (NEO-424): a name with one
 * namesake on file, even in another sport, is inserted READY with no lookup,
 * its primary reads "Link to <name> (<sport>)" and it offers no career editor,
 * so there is nothing to create on it. A real-name fixture can gain such a row
 * from seeded data at any time. A skip can land on a team step or a pool wait,
 * so each one re-runs the pass over the team/league steps.
 *
 * And it passes a same-name PICK step (NEO-332, NEO-475): that row is inserted
 * READY, so it is usually the first settled player and the wizard PINS it
 * ahead of lower-numbered rows whose lookups land a moment later; it offers no
 * career editor and its create is "Create new", not "Add as New Player".
 *
 * Contract: ENTRY the wizard is open on a name step. EXIT a player row is
 * presented (its "Skip ... - not a person" is up), lookups drained, and with
 * `readyToCreate` its create is not held and it is neither a preselect nor a
 * pick step.
 */
export async function walkToPlayerRow(
  page: Page,
  { creatingTeams = false, readyToCreate = false }: { creatingTeams?: boolean; readyToCreate?: boolean } = {},
): Promise<void> {
  const wizard = reviewWizard(page);
  const person = personSkip(page);
  // A step's skip stays aria-disabled while that row's live lookup is in
  // flight, so only the usable one counts (the lookups' 180 s budget).
  const stepSkip = wizard.getByRole("button", {
    name: /^Skip .* — (not a team|this team has no league)$/,
    disabled: false,
  });

  // A pass over the team/league steps, ending on a player row.
  const passTeamSteps = async (): Promise<void> => {
    await awaitLookupsSettled(page);
    for (let i = 0; i < 200; i++) {
      await expect(person.or(stepSkip)).toBeVisible({ timeout: LOOKUPS });
      if (await person.isVisible()) break;
      // The step's own skip names it, so its going away means the step moved on.
      const name = (await stepSkip.first().getAttribute("aria-label")) ?? "";
      if (creatingTeams) {
        await answerStepAsNew(page);
      } else {
        await stepSkip.first().click();
      }
      await expect(wizard.getByRole("button", { name, exact: true })).toBeHidden();
    }
    await expect(person).toBeVisible({ timeout: 30_000 });
  };

  // Twice, because the lookups of the rows behind the team/league steps settle
  // only once the earlier steps are decided.
  for (let pass = 0; pass < 2; pass++) {
    await passTeamSteps();
  }

  if (readyToCreate) {
    // The footer line that explains a held create (one node; the chip's own
    // "needs a team decision" lives in the body and is not matched).
    const held = wizard.getByText(/team decisions?, or untick (it|them)\./);
    // Anchored on the trailing "(<sport>)": a plain exact match reads "Link to
    // <name>" and a pick-step row "Link to <name>, ...".
    const preselected = wizard.getByRole("button", { name: /^Link to .+ \([^)]+\)$/ });
    // A same-name PICK step (NEO-332) is inserted READY, so it is often the
    // first settled player the wizard pins; it offers no career editor and its
    // create is "Create new", not "Add as New Player": walk past it too.
    const pickStep = wizard.getByRole("heading", { level: 3, name: /^Which .+ is this\?$/ });
    // `times` is a runaway guard: a batch whose every remaining player is held,
    // preselected or a pick step runs out of players and fails the visibility
    // assert below.
    for (let i = 0; i < 20; i++) {
      await expect(person).toBeVisible();
      if (!(await held.isVisible()) && !(await preselected.isVisible()) && !(await pickStep.isVisible())) break;
      // Wait for THIS skip to land before looking again: until the decision
      // round-trips the row is still up, and a second pass would skip the
      // player after it too. The row's own skip going is the decision landing.
      const row = await readNameStep(page);
      await person.click();
      await expectNameStepLeft(page, row);
      await passTeamSteps();
    }
    await expect(person).toBeVisible();
    await expect(held, "the player the walk stopped on still holds its create").toBeHidden();
    await expect(preselected, "the player the walk stopped on is a preselect, with nothing to create").toBeHidden();
    await expect(pickStep, "the player the walk stopped on is a same-name pick step, with no career editor").toBeHidden();
  }
}

/**
 * util-wizard-advance-to-save.yaml (NEO-335): from "every name decided" walk
 * the career / teams / autograph / titles steps to the Save step, and answer
 * nothing on them that the product does not REQUIRE.
 *
 * Contract:
 * - ENTRY the wizard is open and every name is decided: its footer shows
 *   "Next (Enter)" or "Confirm & Save". (Waited for here, 7 s.)
 * - Presses Next until the Save step is up; each press is proved to have MOVED
 *   the wizard to a LATER post-name step (`expectPostNameStepLeft`, read off
 *   the progress bar's subtitle), so a Next that does nothing fails by name.
 *   Next leaves every line on its default (a pre-filled
 *   team, else "Leave for later"; every title kept; NEO-574: every "Career
 *   check" line on "Keep as is", which writes nothing) - the same answers the old
 *   final step's Confirm & Save saved. A spec whose FEATURE is the career,
 *   teams or titles step drives that step itself and does not call this.
 * - NEO-345: the "Autographed cards" step (new AU cards on a part with no
 *   autograph format) is the one step whose answer is REQUIRED - its Next is
 *   aria-disabled until a tile is picked - so this picks "On card" there
 *   (`answerAutographStep`). A caller that must not decide it for the part
 *   (the spec whose feature is that step) calls `walkToAutographStep` and
 *   answers it itself BEFORE this.
 * - EXIT the Save step: subtitle "Ready to save" (the progress bar's
 *   `aria-valuetext`, at 100) and Confirm & Save on screen,
 *   nothing pressed. The caller asserts its own "Save N cards?" and owns the
 *   commit.
 *
 * - A step may hold Next aria-disabled while it settles (NEO-574's career step
 *   says "Checking careers…") and then drop straight to Save; each turn waits
 *   for a usable Next, the Save step or the autograph tiles, so that jump is a
 *   normal exit, never a click on a Next that has gone.
 *
 * All 7 s: Next is a client-side step change. The loop is a runaway guard of 5
 * (at most four screens sit between the names and Save: career, teams,
 * autograph, titles; NEO-574 added the career step, first of them, and a
 * gap-only re-sync now opens the wizard straight onto it).
 */
export async function advanceToSave(page: Page): Promise<void> {
  const wizard = reviewWizard(page);
  const next = usableNextButton(page);
  const save = confirmSaveButton(page);
  const autograph = autographChoices(page);
  for (let i = 0; i < 5; i++) {
    await expectPostNameStepSettled(page);
    if (await save.isVisible()) break;
    if (await autograph.isVisible()) await answerAutographStep(page);
    await expect(next).toBeVisible();
    const { subtitle } = await readProgress(page);
    await next.click();
    await expectPostNameStepLeft(page, subtitle);
  }
  await expect(save).toBeVisible();
  // The subtitle is pinned in the header with the footer, not body content.
  await expect(wizard.getByText(STEP_SUBTITLE.save, { exact: true })).toBeVisible();
  await expectWizardStep(page, STEP_SUBTITLE.save);
  await expect(wizardProgress(page), "the Save step ends the progress bar").toHaveAttribute("aria-valuenow", "100");
}

/**
 * util-wizard-read-back-decision.yaml (NEO-335): read the decision just made
 * back off its own row, then (optionally) walk on.
 *
 * Why not the "Decided (N)" list: it is in batch order, collapsed past five
 * entries, and a row decided a moment ago may not be in view. The footer's
 * Back presents the MOST RECENT decision read-only, in a group named
 * "Decision for <name>" reading "Already decided: <decision>" - the only such
 * group on screen while it is up.
 *
 * Contract:
 * - ENTRY a decision was just made on a name step; the walk has moved to the
 *   next name step or, if that was the last name, to the first post-name step.
 *   Either footer offers a Back, so this takes "Back to previous decision" or
 *   "Back to previous step".
 *   The caller WAITS for the walk to have moved before calling this
 *   (`answerPlayerAsNew`'s `expectNameStepLeft`, or the live step's group/heading
 *   `toBeHidden()` after a raw Link click); Back pressed while the decision is
 *   in flight presents the decision before that row.
 * - `decision` the decision line, matched exactly when a string ("Skipped",
 *   "Added as new", "Linked to Shohei Ohtani") or by the regex given.
 * - `of` (optional) the row's name: the panel must be `Decision for <of>`, so
 *   the read-back proves whose decision it is, not only what it was.
 * - `resume: true` presses the panel's "Next", handing the walk back its own
 *   rule: EXIT the panel is gone and a name step is presented again (its skip
 *   control is up) or, when every name is decided, the names-done footer
 *   ("Next (Enter)" / Confirm & Save). Callers that leave the wizard next
 *   (Cancel -> Discard) omit it; EXIT is then the panel, still up.
 * - The Maestro util's conditional drag to bring Next above the footer has no
 *   Playwright counterpart: click() scrolls the body itself.
 */
export async function readBackDecision(
  page: Page,
  decision: string | RegExp,
  { resume = false, of }: { resume?: boolean; of?: string } = {},
): Promise<Locator> {
  const wizard = reviewWizard(page);
  await wizard.getByRole("button", { name: /^Back to previous (decision|step)$/ }).click();
  const panel = wizard.getByRole("group", { name: /^Decision for / });
  await expect(
    panel.getByText(decision, typeof decision === "string" ? { exact: true } : undefined),
  ).toBeVisible();
  // `of` pins WHOSE decision this is (the group is named for the row's name).
  if (of !== undefined) await expect(panel).toHaveAccessibleName(`Decision for ${of}`);

  if (resume) {
    await panel.getByRole("button", { name: "Next", exact: true }).click();
    await expect(wizard.getByText(/^Already decided:/)).toHaveCount(0);
    // The positive half (a negative alone passes on a dead page): a name step
    // is presented again, or every name is decided and the names-done footer
    // is up.
    await expect(
      wizard
        .getByRole("button", { name: /^Skip .* — (not a person|not a team|this team has no league)$/ })
        .or(nextStepButton(page))
        .or(confirmSaveButton(page))
        .first(),
    ).toBeVisible();
  }
  return panel;
}
