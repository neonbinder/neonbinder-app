// NEO-591 (R1): a SET's official checklist reads an Onyx-style PDF: two
// Last Name / First Name column groups side by side, Title Case section headings, and no
// card numbers at all. The committed file (fixtures/checklists/2026-onyx-vintage-baseball.pdf,
// Onyx's own 2026 Vintage Baseball checklist) reads as three sections, every card NNO, with the
// title line set aside, and a section the set's sync reads names its players first name first.
//
// The walk:
//   1. Upload on the SET: the preview shows Base Cards 56, Player Autographs 38 and Dual
//      Autographs 2 (96 cards), each "NNO only", and "Skipped lines (1)", that one
//      "Above the column headings" (the title line). Save: "Checklist saved: 3 sections, 96 cards."
//   2. Name proof: the Inserts column's first visit opens Reconcile Inserts with the
//      checklist's sections; Player Autographs is made its own set, and its sync (the stored
//      section, no marketplace: a checklist-only fetch) opens the tidy-up wizard. The Player
//      Autographs block prints "Owusu-Asiedu | Avery"; the wizard's step for him reads
//      "Avery Owusu-Asiedu" (first last, hyphenated surname whole). Cancel, Discard: nothing
//      is saved.
//   3. Back to the set and Remove the checklist.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `onx`): ONE hand-made set per attempt, `onx<token>`,
// under `E2E Test Sport <w>` › 2026 › Topps (drillToCustom, up to the set: the set's own
// attributes hold its checklist). No marketplace id anywhere beneath it. The custom sport has no
// players and no Wikidata config, so every name in the section is a new player with no lookup.
// The set keeps its `Insert` › `Player Autographs` row (per attempt, read by no other spec); the
// checklist is removed and no card is saved.
//
// Measured locally on a worktree deployment (2026-11-17): Sync to wizard 2.4 s; the walk past
// the section's 21 team steps to the first player 7.2 s (each step within 7 s).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  columnOption,
  columnSelection,
  customSport,
  drillToCustom,
  openAttributesPanel,
  selectOrCreate,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { setChecklistPanel } from "../../support/published-checklist";
import {
  cancelAndDiscard,
  expectStepLeft,
  personSkip,
  readStep,
  reviewWizard,
  tidyUpName,
  walkToPlayerRow,
} from "../../support/wizard";

const FILE = "2026-onyx-vintage-baseball.pdf";
const PDF = new URL(`../../fixtures/checklists/${FILE}`, import.meta.url).pathname;
const SECTION = "Player Autographs";
/** Printed "Owusu-Asiedu" under Last Name and "Avery" under First Name, in Player Autographs. */
const PLAYER = "Avery Owusu-Asiedu";
/** Player Autographs' rows: the bound on the walk past its players. */
const SECTION_ROWS = 38;

test(
  "Set checklist — an Onyx PDF with side-by-side Last/First columns reads as three NNO sections and names its players first name first (NEO-591)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const set = `onx${env.ATTEMPT_TOKEN}`;
    const target = { sport: customSport(env), year: "2026", manufacturer: "Topps", set };

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToCustom(page, target);

    // ══ 1. UPLOAD ON THE SET ══
    await openAttributesPanel(page);
    const panel = setChecklistPanel(page);
    await expect(panel).toBeVisible();
    // R2 precondition: a fresh per-attempt set holds no checklist yet.
    await expect(panel.getByText(/^Got the official checklist\?/)).toBeVisible();
    await panel.getByLabel("Upload checklist").setInputFiles(PDF);

    const preview = page.getByRole("dialog", { name: "Checklist preview" });
    await expect(preview).toBeVisible();
    await expect(preview.getByText("3 sections", { exact: true })).toBeVisible();
    await expect(preview.getByText("96 cards", { exact: true })).toBeVisible();
    const sections = preview.getByRole("table", { name: "Sections the checklist will save" });
    // The Title Case headings, each with its count; Onyx prints no card numbers.
    for (const [name, cards] of [
      ["Base Cards", 56],
      [SECTION, 38],
      ["Dual Autographs", 2],
    ] as const) {
      const row = sections.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
      await expect(row.getByRole("cell")).toHaveText([String(cards), "NNO only"]);
    }
    await expect(sections.getByRole("rowheader")).toHaveCount(3);
    // The title line above the first header row is read and set aside, said by reason, and it is
    // the ONLY line skipped: no card row (Dual Autographs' two included) is lost, and the file
    // repeats no header row ("Column headings again" would list it).
    await expect(preview.getByRole("heading", { level: 3, name: "Skipped lines (1)", exact: true })).toBeVisible();
    await expect(preview.getByText(/^Above the column headings \(1\)$/)).toBeVisible();
    await expect(preview.getByText(/^Column headings again/)).toHaveCount(0);
    await expectAccessible(page, { within: preview, label: "Checklist preview of an Onyx PDF" });

    await preview.getByRole("button", { name: "Save checklist" }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByText("Checklist saved: 3 sections, 96 cards.")).toBeVisible();
    await expect(panel.getByText(FILE, { exact: true })).toBeVisible();
    await expect(panel.getByText(/^3 sections, 96 cards\. Saved .*\. Syncs in this set read its sections\.$/)).toBeVisible();

    // ══ 2. NAME PROOF: a section the set's sync reads ══
    await selectOrCreate(page, "Variant Types", "Insert", { via: "list" });
    // A hand-made set with a stored checklist: the Inserts column's first visit offers its
    // sections (Base Cards is the base's, so only the other two are listed).
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });
    await expect(reconcile).toBeVisible();
    await reconcile.getByRole("button", { name: `Make its own set from checklist section: ${SECTION}` }).click();
    await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${SECTION}` })).toHaveValue(SECTION);
    await reconcile.getByRole("button", { name: "Save 1 sets" }).click();
    await expect(reconcile).toBeHidden();
    await columnOption(page, "Inserts", SECTION).click();
    await expect(columnSelection(page, "Inserts", SECTION)).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    await syncChecklistButton(page).click();
    // No marketplace is attached: the stored section is the only source, so no Match Cards, and
    // every name is new in the custom sport, so the wizard opens.
    await expect(reviewWizard(page)).toBeVisible();
    await expect(reviewWizard(page)).toHaveAccessibleName(tidyUpName({ year: "2026", set, variant: SECTION }));
    await walkToPlayerRow(page);
    // The players come in batch order, not file order: skip past each (nothing is saved) until the
    // one this proof reads. Bounded by the section's rows; each skip is proved to have landed.
    const avery = reviewWizard(page).getByRole("heading", { level: 3, name: PLAYER, exact: true });
    for (let i = 0; i < SECTION_ROWS; i++) {
      await expect(personSkip(page)).toBeVisible();
      if (await avery.isVisible()) break;
      const { x } = await readStep(page);
      await personSkip(page).click();
      await expectStepLeft(page, x);
    }
    await expect(avery).toBeVisible();
    await expect(reviewWizard(page).getByRole("button", { name: `Skip ${PLAYER} — not a person` })).toBeVisible();
    await expect(reviewWizard(page).getByRole("heading", { level: 3, name: "Owusu-Asiedu Avery" })).toHaveCount(0);
    await cancelAndDiscard(page);
    await expect(reviewWizard(page)).toBeHidden();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ══ 3. REMOVE: Back to the set, whose panel holds the checklist ══
    // Navigation lives in the URL: Back steps from the section's set to the Insert type, then
    // to the set with nothing picked under it.
    await page.goBack();
    await expect(columnOption(page, "Inserts", SECTION)).toBeVisible();
    await expect(columnSelection(page, "Inserts", SECTION)).toHaveCount(0);
    await page.goBack();
    await expect(columnOption(page, "Variant Types", "Insert")).toBeVisible();
    await expect(columnSelection(page, "Variant Types", "Insert")).toHaveCount(0);
    await openAttributesPanel(page);
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Remove checklist" }).click();
    const removeConfirm = page.getByRole("dialog", { name: "Remove this set's checklist?" });
    await expect(removeConfirm).toBeVisible();
    await removeConfirm.getByRole("button", { name: "Yes, remove it" }).click();
    await expect(removeConfirm).toBeHidden();
    await expect(page.getByText("Checklist removed.")).toBeVisible();
    await expect(panel.getByText(/^Got the official checklist\?/)).toBeVisible();
  },
);
