// NEO-426 (R1): a sport marked "No teams in this sport" saves its players' new
// cards as No team without asking. The ONE feature, as an operator meets it:
//   1. The sport row's Attributes panel carries the toggle; pressed on, it says
//      so (toast) and reads pressed.
//   2. A checklist fetch whose one card's only player is a NEW player of that
//      sport, with nothing naming a team (a BLANK team cell: no claim), asks
//      nothing about the card's team: the wizard goes from the name straight to
//      Save, never through "Cards with no team".
//   3. The Save step says why: it names the person, says the card saves with
//      No Team because the sport has none, and points at the card editor.
//   4. The committed card reads No Team, is not badged and is not counted in the
//      header's need-you pill.
//   5. The default never blocks a team: a team picked in the card editor wins,
//      and it is still there after a reload.
//   6. The quick-add form is the other birth path: a card added by hand for the
//      same player is born No Team too.
//
// FIXTURE (SET-REGISTRY.md, the `tls` custom-set prefix): a per-attempt hand-made
// set `tls<token>` under the worker's own `E2E Test Sport <w>` › 2026 › Topps,
// `Insert` › `Base` (R7a). No marketplace id anywhere on the path, so the Sync
// is checklist-only (a pasted one-row checklist is the only source: no BSC, no
// recording) and nothing is looked up: the custom sport has no Wikidata mapping,
// so the minted player costs no enrichment call (GUIDE "Enrichment fixtures").
// SOLE WRITER of that set and of the worker's custom sport's teamless flag for
// the length of the test; self-cleaning (R7): the afterEach, on a second page so
// a red body's screenshot stays whole, turns the flag off and deletes the cards
// and the set's rows. Minted names are single tokens (`Teamless<token>`,
// `TLW<token>`); not fresh-only, since every name is per attempt.
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
import {
  answerPlayerAsNew,
  awaitLookupsSettled,
  confirmSaveButton,
  expectNothingDecided,
  expectWizardStep,
  personSkip,
  reviewWizard,
  STEP_SUBTITLE,
  tidyUpName,
  wizardProgress,
} from "../../support/wizard";

const YEAR = "2026";
const MANUFACTURER = "Topps";
const TOGGLE_TEXT = "No teams in this sport";
// The toasts are held to their claims, not their full sentences, so the wording can settle.
const MARKED = /^Marked — .*save with No Team/;
const CLEARED = /^Cleared — .*ask for a team again/;

/** What the afterEach must undo, recorded the line after each write lands. */
const written: {
  sport?: string;
  sportFlagged: boolean;
  leafUrl?: string;
  set?: string;
  /**
   * The checklist pasted for a fetch under review (Sync pressed, not yet saved): the review's batch
   * refuses the rows' deletes until it is cancelled.
   */
  reviewOf?: string;
  cards: string[];
} = {
  sportFlagged: false,
  cards: [],
};

/** The sport row's toggle, scoped to its Attributes cell. */
function teamlessToggle(page: Page) {
  return page
    .getByLabel(`Set feature ${TOGGLE_TEXT}`)
    .getByRole("button", { name: TOGGLE_TEXT, exact: true });
}

/** A checklist row is one run of text; the match stops at the next row's "#". */
function rowSays(page: Page, number: string, text: string) {
  return page.getByText(new RegExp(`#${escapeRe(number)}[^#]*${text}`));
}

function noTeamBadge(page: Page, number: string) {
  return page.getByRole("img", {
    name: new RegExp(`^Card ${escapeRe(number)}(, .*)? needs attention: no team on this card yet$`),
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
        await drillToCustom(tidy, { sport });
        await openAttributesPanel(tidy);
        const toggle = teamlessToggle(tidy);
        await expect(toggle).toBeVisible();
        // A fresh page holds no write in flight, so the attribute is the stored flag.
        if ((await toggle.getAttribute("aria-pressed")) === "true") {
          await toggle.click();
          await expect(tidy.getByText(CLEARED).first()).toBeVisible();
        }
        await expect(tidy.getByLabel(`Set feature ${TOGGLE_TEXT}`).getByRole("button", { name: TOGGLE_TEXT, pressed: false })).toBeVisible();
        written.sportFlagged = false;
      });
    }
    if (written.leafUrl && written.set) {
      const { leafUrl, set } = written;
      await tidyStep("delete the set's cards and rows", async () => {
        await tidy.goto(leafUrl);
        await expect(tidy.getByRole("button", { name: "Open add card form" })).toBeVisible({ timeout: LAUNCH_GATE });
        if (written.reviewOf) {
          // A review in progress refuses the deletes ("finish or cancel it first"). A pasted
          // checklist lives on the page that pasted it, so paste it again: the fetch then resumes
          // the same batch (one per set and account), and Cancel ends it, discarding any decision.
          await usePastedChecklist(tidy, written.reviewOf, 1);
          await syncChecklistButton(tidy).click();
          await expect(wizardProgress(tidy)).toBeVisible();
          // A batch with decisions asks before it discards them; one with none just closes.
          await reviewWizard(tidy).getByRole("button", { name: "Cancel (Esc)" }).click();
          const discard = tidy.getByRole("button", { name: "Discard", exact: true });
          const cancelled = tidy.getByText("Fetch cancelled — no cards saved.");
          await expect(discard.or(cancelled).first()).toBeVisible();
          if (await discard.isVisible()) await discard.click();
          await expect(cancelled).toBeVisible();
          await expect(reviewWizard(tidy)).toBeHidden();
          written.reviewOf = undefined;
        }
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
  "No teams in this sport — a new card whose only player plays a teamless sport saves as No team without asking, the Save step says so, and a team picked later sticks (NEO-426)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const token = env.ATTEMPT_TOKEN;
    const sport = customSport(env);
    const SET = `tls${token}`;
    const PLAYER = `Teamless${token}`;
    const TEAM = `TLW${token}`;
    written.sport = sport;
    written.set = SET;
    written.sportFlagged = false;
    written.leafUrl = undefined;
    written.reviewOf = undefined;
    written.cards = [];

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ══ 1. THE SPORT: "No teams in this sport" on ══
    await drillToCustom(page, { sport });
    await expect(page.getByRole("heading", { name: `Attributes for ${sport} (Sport)` })).toBeVisible();
    await openAttributesPanel(page);
    const cell = page.getByLabel(`Set feature ${TOGGLE_TEXT}`);
    const toggle = (pressed: boolean) => cell.getByRole("button", { name: TOGGLE_TEXT, exact: true, pressed });
    // R2 precondition: the sport starts with teams (a leftover flag fails here, by name).
    await expect(toggle(false)).toBeVisible();
    written.sportFlagged = true; // from the press on, the afterEach owns turning it off
    await toggle(false).click();
    await expect(page.getByText(MARKED).first()).toBeVisible();
    await expect(toggle(true)).toBeVisible();
    await expectAccessible(page, { label: "Sport attributes with No teams in this sport on" });

    // ══ 2. THE SET: a hand-made per-attempt leaf, its one-row checklist pasted ══
    await drillToCustom(page, { sport, year: YEAR, manufacturer: MANUFACTURER, set: SET, variantType: "Insert", variant: "Base" });
    written.leafUrl = page.url();
    // Navigation lives in the URL: Back is the Insert type with nothing picked, Forward the leaf again.
    await page.goBack();
    await expect(columnOption(page, "Inserts", "Base")).toBeVisible();
    await expect(columnSelection(page, "Inserts", "Base")).toHaveCount(0);
    await page.goForward();
    await expect(columnSelection(page, "Inserts", "Base")).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // A BLANK team cell makes no claim (GUIDE "Checklist first"): nothing names a team.
    const checklist = `number,player,team\n1,${PLAYER},\n`;
    await usePastedChecklist(page, checklist, 1);
    written.reviewOf = checklist; // from the press on, a batch may hold the rows until it is saved
    await syncChecklistButton(page).click();

    // ══ 3. THE WIZARD: the new player, then straight to Save ══
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await awaitLookupsSettled(page);
    await expectNothingDecided(page);
    await expectWizardStep(page, STEP_SUBTITLE.player);
    await expect(personSkip(page)).toHaveAccessibleName(`Skip ${PLAYER} — not a person`);
    // The name's sport is the set's sport, the one marked teamless.
    await expect(wizard.getByRole("button", { name: `Sport for this name: ${sport}` })).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "New player step in a teamless sport" });
    await answerPlayerAsNew(page);

    // No "Cards with no team" step: the names lead straight to Save.
    await expect(confirmSaveButton(page)).toBeVisible();
    await expectWizardStep(page, STEP_SUBTITLE.save);
    await expect(wizard.getByRole("heading", { name: "Save 1 card?" })).toBeVisible();
    // The note names the person the default stamped, and what it does for his card.
    await expect(wizard.getByText(new RegExp(`^${escapeRe(PLAYER)} saves with No Team\\. `))).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Save step with the teamless-sport note" });
    await confirmSaveButton(page).click();
    await expect(wizard).toBeHidden();
    written.reviewOf = undefined;
    written.cards.push("1");

    // ══ 4. THE CARD: No Team, not badged, not counted ══
    await expect(editCardButton(page, "1")).toBeVisible();
    await expect(rowSays(page, "1", "No Team")).toBeVisible();
    await expect(noTeamBadge(page, "1")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^[0-9]+ needs? you$/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Checklist with a card saved No team by its sport" });

    // ══ 5. A TEAM PICKED LATER WINS, AND STICKS ══
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
    await editCardButton(page, "1").click();
    await expect(cardName).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove team ${TEAM}` })).toBeVisible();
    await expect(cardToggle(false)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // ══ 6. QUICK-ADD: the same player's hand-added card is born No Team ══
    await addCardViaForm(page, {
      cardNumber: "2",
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
    written.cards.push("2");
    await expect(rowSays(page, "2", "No Team")).toBeVisible();
    await expect(noTeamBadge(page, "2")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^[0-9]+ needs? you$/ })).toHaveCount(0);
  },
);
