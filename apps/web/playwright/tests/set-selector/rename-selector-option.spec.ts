// Origin: .maestro/flows/set-selector/rename-selector-option.yaml (Maestro suite retired in NEO-341; see git history)
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  setBuilderReady,
  drillToCustom,
  selectOrCreate,
  addCustomEntry,
  columnSelection,
  pick,
  openAttributesPanel,
} from "../../support/set-builder";
import type { Page } from "@playwright/test";

// R1: a set and a variant type are each renamed from the attributes panel's
// pencil, which opens the name field in the title's place already holding the
// name (NEO-667), and the selection follows the new name.
//
// NEO-667 (Jason, 2026-11-25): "It should open up a text area where the title
// label is before you hit edit instead of opening this tiny text area to the
// right of it. The text area should also contain the current title right away
// so that it can be inline edited easily." So the field opens holding the name,
// focused, with the caret after it: the set's rename below is an in-place edit
// (Backspace from the opening caret, then type), never a fill, so a field that
// opens empty, unfocused or with the caret anywhere but the end goes red.
//
// While the field is open the "Attributes for …" heading steps aside visually
// but stays mounted as `sr-only` for a screen reader. Playwright counts that
// 1x1 px box as visible (non-empty bounding box, no `visibility: hidden`), so
// the swap is proved by the field holding the name and the heading reading the
// right name once the field closes, never by the heading's visibility.
//
// NEO-334 (Jason, 2026-10-10): a variant type's TITLE is its kind ("Base",
// "Insert(s)", "Parallel(s)"), so a rename CAN change what a type is, and the
// server refuses that while rows sit beneath it, refuses a second "Base", and
// refuses a singular/plural twin of a sibling. None of that applies to the
// rename here: `rnmvt<token>…` and `rnmvtx<token>…` carry NO kind (kindless to
// kindless) and the type is empty, so this stays a plain relabel. The kind
// changes and their refusals are proved in variant-type-title-is-its-kind.
// Never rename this pair to a kind word. The type titled "Base" made at the end
// is only opened and cancelled, to see its tag beside the open field.

/** The panel's heading for `title`, e.g. "Attributes for X (Set)". */
const panelFor = (page: Page, title: string) =>
  page.getByRole("heading", { name: new RegExp(`^Attributes for ${title} \\(`) });

/**
 * Open the attributes panel's name field for the option it is showing, and
 * prove it opened pre-filled and focused (NEO-667).
 */
async function openRename(page: Page, from: string) {
  // NEO-569: the pencil sits in the open panel only. The set opens itself; a
  // variant type starts shut.
  await openAttributesPanel(page);
  await page.getByRole("button", { name: `Rename ${from}`, exact: true }).click();
  const field = page.getByRole("textbox", { name: `Edit name for ${from}`, exact: true });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(from);
  await expect(field).toBeFocused();
  return field;
}

test(
  "Selector rename — a set AND a variant type can each be renamed from the attributes panel, the field opening in the title's place holding the name, and the selection follows the new name (per-worker hand-made set)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    // The set's rename swaps the last three letters in place.
    const set = `rnm${T}old`;
    const renamedSet = `rnm${T}new`;
    // One long unbroken token (~100 characters): the field must wrap it rather
    // than widen the page, keeping the delete beside it on a phone (NEO-499).
    const tail = "wrap".repeat(20);
    const type = `rnmvt${T}${tail}`;
    const renamedType = `rnmvtx${T}${tail}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // A hand-made set under the real Baseball / 2024 / Topps (R7a).
    await drillToCustom(page, { sport: "Baseball", year: "2024", manufacturer: "Topps", set });
    await expect(panelFor(page, set)).toBeVisible();

    // ── THE FIELD OPENS HOLDING THE NAME, CARET AT THE END ──
    let field = await openRename(page, set);
    await expectAccessible(page, { label: "Rename field open, pre-filled (set)" });
    // Backspace from where the field put the caret: only a caret after the name
    // takes the last letters off.
    await field.press("Backspace");
    await field.press("Backspace");
    await expect(field).toHaveValue(set.slice(0, -2));

    // ── ESCAPE CANCELS: THE EDIT IS DROPPED AND THE TITLE IS BACK ──
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(panelFor(page, set)).toBeVisible();
    await expect(page.getByRole("button", { name: `Rename ${set}`, exact: true })).toBeFocused();
    // Reopened, it holds the stored name again, not what was typed.
    field = await openRename(page, set);

    // ── AN IN-PLACE EDIT, SAVED WITH ENTER ──
    for (let i = 0; i < 3; i++) await field.press("Backspace");
    await field.pressSequentially("new");
    await expect(field).toHaveValue(renamedSet);
    await field.press("Enter");
    // The field closes and the panel and the selection follow the new name.
    await expect(page.getByRole("textbox", { name: /^Edit name for / })).toHaveCount(0);
    await expect(panelFor(page, renamedSet)).toBeVisible();
    await expect(page.getByText(set, { exact: true })).toBeHidden();

    // ── A LONG VARIANT TYPE NAME: THE FIELD WRAPS IT, THE DELETE STAYS ON SCREEN ──
    await selectOrCreate(page, "Variant Types", type, { confirm: "required" });
    await expect(panelFor(page, type)).toBeVisible();
    field = await openRename(page, type);
    // ratio 1: wholly on screen, so neither the field nor the delete beside it
    // ran off a phone's right edge.
    await expect(field).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: `Delete ${type}`, exact: true })).toBeInViewport({ ratio: 1 });
    await expectAccessible(page, { label: "Rename field open, pre-filled (long variant type)" });
    await field.fill(renamedType);
    await field.press("Enter");
    await expect(panelFor(page, renamedType)).toBeVisible();
    await expect(page.getByText(type, { exact: true })).toBeHidden();
    await expectAccessible(page, { label: "Renamed variant type panel" });

    // ── THE BASE TAG AND THE DELETE STAY BESIDE THE OPEN FIELD ──
    await addCustomEntry(page, "Variant Types", "Base", { confirm: "required" });
    await columnSelection(page, "Variant Types", renamedType).click();
    await pick(page, "Variant Types", "Base");
    await expect(columnSelection(page, "Variant Types", "Base")).toBeVisible();
    await expect(panelFor(page, "Base")).toBeVisible();
    field = await openRename(page, "Base");
    await expect(page.getByTitle("Titled Base, so this type holds the set's base checklist.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Base", exact: true })).toBeVisible();
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(panelFor(page, "Base")).toBeVisible();
  },
);
