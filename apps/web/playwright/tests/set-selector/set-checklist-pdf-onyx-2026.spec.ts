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
//      checklist's sections; Player Autographs is made its own set (Back and Forward step
//      through the pick), and its sync (the stored section, no marketplace: a checklist-only
//      fetch, so no Match Cards) saves the section's 38 cards and opens the Tidy Up walk
//      (NEO-645), every name being new in the custom sport. The Player Autographs block prints
//      "Owusu-Asiedu | Avery"; his card in the walk reads "#NNO · Avery Owusu-Asiedu" and asks
//      about the player "Avery Owusu-Asiedu" (first last, hyphenated surname whole). The
//      subject is the parse, not the names: "Save for later (Esc)" closes the walk, writing
//      nothing, and every card still needs a person.
//   3. Back to the set (a fresh drill: Back would step through the walk's cards, each an
//      address) and Remove the checklist.
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `onx`): ONE hand-made set per attempt, `onx<token>`,
// under `E2E Test Sport <w>` › 2026 › Topps (drillToCustom, up to the set: the set's own
// attributes hold its checklist). No marketplace id anywhere beneath it. The custom sport has no
// players and no Wikidata config, so every name in the section is a new player with no lookup.
// The set keeps its `Insert` › `Player Autographs` row and that row's 38 saved cards (NEO-645:
// the cards save before the walk opens; per attempt, read by no other spec); no player or team
// is written (the walk is left with Save for later). The checklist is removed.
//
// Measured locally on a worktree deployment (2026-11-17, the old wizard): Sync to wizard 2.4 s.
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
  needsYouPill,
  saveForLater,
  settleWalkAfterCommit,
  skipUntil,
  tidyCardHeader,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const FILE = "2026-onyx-vintage-baseball.pdf";
const PDF = new URL(`../../fixtures/checklists/${FILE}`, import.meta.url).pathname;
const SECTION = "Player Autographs";
/** Printed "Owusu-Asiedu" under Last Name and "Avery" under First Name, in Player Autographs. */
const PLAYER = "Avery Owusu-Asiedu";
/** Player Autographs' rows: the cards its fetch saves, and the bound on the walk past them. */
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
    // Navigation lives in the URL: Back is the Insert type with nothing picked, Forward the section's set.
    await page.goBack();
    await expect(columnOption(page, "Inserts", SECTION)).toBeVisible();
    await expect(columnSelection(page, "Inserts", SECTION)).toHaveCount(0);
    await page.goForward();
    await expect(columnSelection(page, "Inserts", SECTION)).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    await syncChecklistButton(page).click();
    // No marketplace is attached: the stored section is the only source, so no Match Cards. The
    // cards save first (NEO-645), and every name being new in the custom sport, the walk opens.
    const opened = await settleWalkAfterCommit(page, page.getByText(new RegExp(`Saved ${SECTION_ROWS} cards\\.`)).first());
    expect(opened, "every card names a player new to the custom sport, so the walk opened").toBe(true);
    await expect(tidyWalk(page)).toHaveAccessibleName(tidyUpName({ year: "2026", set, variant: SECTION }));
    // The cards come in the walk's order, not file order: skip past each (Skip writes nothing)
    // until his. Bounded by the section's rows; each skip is proved to have landed (skipCard).
    const averyRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${PLAYER}`, exact: true });
    await skipUntil(page, averyRow, { maxCards: SECTION_ROWS });
    // His card and its player name read first name first, the hyphenated surname whole; the
    // printed order (last, first) names nothing.
    await expect(tidyCardHeader(page, `#NNO · ${PLAYER}`)).toBeVisible();
    await expect(averyRow.getByRole("button", { name: /^Not a player \(checklist, team card, stadium\)( .+)?$/ })).toBeVisible();
    await expect(tidyWalk(page).getByText(/Owusu-Asiedu,? Avery/)).toHaveCount(0);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk on a card read from an Onyx PDF" });
    // The parse is the subject, not the names: leave them for later, nothing written.
    await saveForLater(page);
    // Every card's player name is unanswered (pink), so every card counted is one to fix.
    await expect(needsYouPill(page)).toHaveAccessibleName(`${SECTION_ROWS} need you, ${SECTION_ROWS} to fix`);

    // ══ 3. REMOVE: back to the set, whose panel holds the checklist ══
    // A fresh drill: Back from here steps through the walk's cards (each card shown is an address).
    await drillToCustom(page, target);
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
