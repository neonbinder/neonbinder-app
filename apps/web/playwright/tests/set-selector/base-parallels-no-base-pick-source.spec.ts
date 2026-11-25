// ONE FEATURE (R1, NEO-673): a set with a Parallel variant type and no Base asks which of its
// parallels the others copy from; the picked one saves its own checklist like an insert, and the
// rest are built from it, with their own names in their titles.
//
// The operator meets it like this:
//   1. A Parallel type with Silver, Gold and Blue, and no Base. The "Parallels of this set"
//      section asks "Which parallel do the others copy from?", with nothing picked and no
//      "(current)" marker.
//   2. Silver is picked. The section is retitled for its source, says "Copying from Silver", tags
//      Silver "source" in the Parallels column, and Silver has no cards yet.
//   3. Silver's own row offers Sync (not "Can't build yet"); a two-row checklist is saved and tidied.
//   4. Change while Silver holds cards and Blue none: the list marks "Silver (current)" without
//      checking it, and picking Blue says "Blue has no cards yet." above "Copy from Blue". Cancel
//      keeps Silver.
//   5. Gold's row offers "Build from Silver". Back returns to Silver's checklist.
//   6. "Build 2 parallels from Silver", pressed with Silver's row open, builds Gold and Blue, and
//      the ledger shows there; Silver is not in the run. Gold's card
//      title names Gold, never Silver (Silver's own title names Silver, so the absence means it).
//   7. Change to Gold (it has cards, so no empty-pick line): the build now reads from Gold. Silver's
//      row offers "Rebuild from Gold" (it holds cards); Gold's own row offers Sync and no build.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `bns`/`bnt` prefixes; R7a): a per-attempt sport
// `bns<token>` › 2026 › Topps › `bnt<token>` › Parallel › Silver, Gold, Blue, all hand-made with no
// marketplace id. Silver's Sync is checklist-only (two pasted rows with blank team cells), and a
// hand-made sport has no Wikidata mapping, so nothing is looked up. Not fresh-only. Nothing is
// deleted; the sport, its rows, the cards, their copies and the two minted players stand.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { editCardButton } from "../../support/cards";
import {
  addCustomEntry,
  columnOption,
  columnSelection,
  drillToCustom,
  escapeRe,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { settleWalkAfterCommit, tidyForTheParallelBuild } from "../../support/tidy-walk";

const YEAR = "2026";
const SILVER = "Silver";
const GOLD = "Gold";
const BLUE = "Blue";
// BaseParallelsBuildSection: PICK_SOURCE_QUESTION, CHANGE_SOURCE_ARIA, CANCEL_CHANGE_ARIA,
// currentOptionLabel, pickedEmptyText.
const QUESTION = "Which parallel do the others copy from?";
const CHANGE = "Change the parallel the others copy from";
const CANCEL_CHANGE = "Cancel changing the parallel the others copy from";
const current = (name: string) => `${name} (current)`;
const pickedEmpty = (name: string) => `${name} has no cards yet.`;
/** The section's heading once a parallel is the source. */
const chosenHeading = (name: string) => `Parallels from ${name}`;
/** A Parallels-column row's name when it is the source: a "(source)" tag after its own name. */
const sourceTagged = (name: string) => `${name} (source)`;
/** The row's own build button, in either wording ("Build from X" / "Rebuild from X"). */
const ROW_BUILD = /^(Build|Rebuild) from /;

test(
  "A set with no Base asks which parallel the others copy from; the pick saves its own checklist and the others build from it (NEO-673)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `bns${T}`;
    const SET = `bnt${T}`;
    const PLAYERS = [`Rookie Bnp${T}`, `Rookie Bnq${T}`];

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: a Parallel type with three parallels and no Base (R9: drillToCustom) ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Parallel" });
    for (const name of [SILVER, GOLD, BLUE]) {
      await addCustomEntry(page, "Parallels", name, { confirm: "required" });
      await expect(columnOption(page, "Parallels", name)).toBeVisible();
    }

    // With no Base and no source yet the heading names the set itself.
    const firstPick = page.getByRole("region", { name: "Parallels of this set", exact: true });
    const firstPicker = firstPick.getByRole("radiogroup", { name: QUESTION });
    await expect(firstPicker).toBeVisible();
    // The first-pick list is plain names: no "(current)" marker on any of them.
    await expect(firstPicker.getByRole("radio")).toHaveText([SILVER, GOLD, BLUE]);
    for (const name of [SILVER, GOLD, BLUE]) {
      await expect(firstPicker.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "false");
    }
    // Nothing is preselected, so the pick button names no parallel and is held.
    await expect(firstPicker.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(firstPick.getByRole("button", { name: "Copy from…", exact: true })).toBeDisabled();
    await expect(firstPick.getByRole("button", { name: /^Build .* from / })).toHaveCount(0);
    // No parallel is the source yet, so none carries the column's "source" tag.
    await expect(columnOption(page, "Parallels", SILVER)).toHaveAccessibleName(SILVER);
    await expectAccessible(page, { within: firstPick, label: "Parallels of a set with no Base, asking which one the others copy from" });

    // ── STEP 2: pick Silver ──
    await firstPicker.getByRole("radio", { name: SILVER, exact: true }).click();
    await expect(firstPicker.getByRole("radio", { name: SILVER, exact: true })).toHaveAttribute("aria-checked", "true");
    await firstPick.getByRole("button", { name: `Copy from ${SILVER}`, exact: true, disabled: false }).click();
    // Once a parallel is the source the heading names it ("Parallels from Silver"; the set has no
    // base); the region is found by that heading whichever parallel it names.
    const section = page.getByRole("region", { name: /^Parallels from .+$/ });
    const picker = section.getByRole("radiogroup", { name: QUESTION });
    await expect(section.getByRole("heading", { level: 3, name: chosenHeading(SILVER), exact: true })).toBeVisible();
    await expect(firstPick).toHaveCount(0);
    // The section's status line says what the others copy from; focus lands on Change.
    const copying = (name: string) => section.getByText(`Copying from ${name}`, { exact: true });
    const changeButton = section.getByRole("button", { name: CHANGE, exact: true });
    await expect(copying(SILVER)).toBeVisible();
    await expect(changeButton).toBeFocused();
    await expect(picker).toHaveCount(0);
    // The Parallels column tags the source; the others carry no tag.
    await expect(columnOption(page, "Parallels", SILVER)).toHaveAccessibleName(sourceTagged(SILVER));
    await expect(columnOption(page, "Parallels", GOLD)).toHaveAccessibleName(GOLD);
    // Silver is the source, so it is left off the build: two parallels, and Silver is still empty.
    await expect(section.getByText(`${SILVER} has no cards yet — save its checklist first.`)).toBeVisible();
    await expect(section.getByRole("button", { name: `Build 2 parallels from ${SILVER}`, exact: true })).toBeDisabled();
    await expectAccessible(page, { label: "Parallels of a set with no Base, copying from the picked parallel" });

    // ── STEP 3: Silver saves its own checklist, like an insert ──
    await columnOption(page, "Parallels", SILVER).click();
    await expect(columnSelection(page, "Parallels", SILVER)).toBeVisible();
    // Silver reads "Loading…" until the plan answers; then its Sync slot is an ordinary Sync.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${PLAYERS[0]},\n2,${PLAYERS[1]},\n`, 2);
    await expect(syncChecklistButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Can't build yet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: ROW_BUILD })).toHaveCount(0);
    await syncChecklistButton(page).click();

    const saved = page.getByText(/Saved 2 cards\./).first();
    const opened = await settleWalkAfterCommit(page, saved, { opens: true });
    expect(opened, "two new names and no teams: the walk opens").toBe(true);
    // Any pink card on the source holds the build (NEO-661): answer every one.
    await tidyForTheParallelBuild(page);
    await expect(editCardButton(page, "1")).toBeVisible();
    await expect(editCardButton(page, "2")).toBeVisible();

    // Silver's own card title names Silver: the positive under step 6's absence (R2).
    const drawer = page.getByRole("dialog");
    await editCardButton(page, "1").click();
    await expect(drawer.getByRole("textbox", { name: "Card title", exact: true })).toHaveValue(new RegExp(`\\b${SILVER}\\b`));
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toHaveCount(0);

    // ── STEP 4: Change while Silver holds cards and Blue none: "(current)" and the empty-pick line ──
    // The section stays on screen under the type while Silver's row is open.
    await expect(section.getByText(`${SILVER} has no cards yet — save its checklist first.`)).toHaveCount(0);
    await changeButton.click();
    await expect(picker).toBeVisible();
    // The standing pick is marked, never checked; the list keeps child order.
    await expect(picker.getByRole("radio")).toHaveText([current(SILVER), GOLD, BLUE]);
    await expect(picker.getByRole("radio", { name: current(SILVER), exact: true })).toHaveAttribute("aria-checked", "false");
    await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Copy from…", exact: true })).toBeDisabled();
    await picker.getByRole("radio", { name: BLUE, exact: true }).click();
    // Blue has nothing for the others to copy: the line says so above the (still offered) button.
    await expect(section.getByText(pickedEmpty(BLUE), { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: `Copy from ${BLUE}`, exact: true, disabled: false })).toBeVisible();
    await expectAccessible(page, { within: section, label: "Changing to a parallel with no cards while the source has some" });
    await section.getByRole("button", { name: CANCEL_CHANGE, exact: true }).click();
    await expect(copying(SILVER)).toBeVisible();
    await expect(picker).toHaveCount(0);
    await expect(section.getByText(pickedEmpty(BLUE), { exact: true })).toHaveCount(0);

    // ── STEP 5: Gold offers "Build from Silver"; Back returns to Silver ──
    // A picked row folds the column to its card; the card reopens it.
    await columnSelection(page, "Parallels", SILVER).click();
    await columnOption(page, "Parallels", GOLD).click();
    await expect(columnSelection(page, "Parallels", GOLD)).toBeVisible();
    await expect(page.getByRole("button", { name: `Build from ${SILVER}`, exact: true })).toBeVisible();
    await page.goBack();
    await expect(columnSelection(page, "Parallels", SILVER)).toBeVisible();
    await expect(columnSelection(page, "Parallels", GOLD)).toHaveCount(0);
    await expect(editCardButton(page, "2")).toBeVisible();

    // ── STEP 6: build the other two from Silver, pressed with Silver's row open ──
    // The section hosts the run's ledger while a row of its type is open (NEO-673: the run starts
    // from the type, and pressing it from Silver's row no longer hides its ledger).
    await expect(copying(SILVER)).toBeVisible();
    await section.getByRole("button", { name: `Build 2 parallels from ${SILVER}`, exact: true, disabled: false }).click();
    const ledger = page.getByRole("region", { name: `${SILVER} parallels — 2 built` });
    await expect(ledger.getByRole("heading", { name: `${SILVER} parallels — 2 built`, exact: true })).toBeVisible();
    for (const name of [GOLD, BLUE]) {
      await expect(ledger.getByRole("listitem").filter({ hasText: new RegExp(`^${name} — Built 2 cards`) })).toBeVisible();
    }
    await expect(ledger.getByRole("listitem").filter({ hasText: new RegExp(`^${SILVER} — `) })).toHaveCount(0);
    await expectAccessible(page, { label: "Two parallels built from the picked parallel" });

    // Gold holds both copies, and its title names Gold, not Silver.
    await columnSelection(page, "Parallels", SILVER).click();
    await columnOption(page, "Parallels", GOLD).click();
    await expect(columnSelection(page, "Parallels", GOLD)).toBeVisible();
    await expect(editCardButton(page, "2")).toBeVisible();
    await editCardButton(page, "1").click();
    const title = drawer.getByRole("textbox", { name: "Card title", exact: true });
    await expect(title).toHaveValue(new RegExp(`\\b${GOLD}\\b`));
    await expect(title).not.toHaveValue(new RegExp(escapeRe(SILVER), "i"));
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toHaveCount(0);

    // ── STEP 7: Change to Gold; the rows' roles follow the new source ──
    await changeButton.click();
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("radio")).toHaveText([current(SILVER), GOLD, BLUE]);
    await expect(picker.getByRole("radio", { name: current(SILVER), exact: true })).toBeFocused();
    await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Copy from…", exact: true })).toBeDisabled();
    await expect(section.getByRole("button", { name: CANCEL_CHANGE, exact: true })).toBeVisible();
    await picker.getByRole("radio", { name: GOLD, exact: true }).click();
    const copyFromGold = section.getByRole("button", { name: `Copy from ${GOLD}`, exact: true, disabled: false });
    await expect(copyFromGold).toBeVisible();
    // Gold holds cards, so there is no empty-pick line (paired with the button above, R2).
    await expect(section.getByText(pickedEmpty(GOLD), { exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: section, label: "Changing the parallel the others copy from" });
    await copyFromGold.click();
    await expect(copying(GOLD)).toBeVisible();
    await expect(section.getByRole("heading", { level: 3, name: chosenHeading(GOLD), exact: true })).toBeVisible();
    await expect(picker).toHaveCount(0);
    await expect(section.getByRole("button", { name: `Build 2 parallels from ${GOLD}`, exact: true })).toBeVisible();
    await expect(copying(SILVER)).toHaveCount(0);

    // Gold's row is open and is now the source: an ordinary Sync, no build from anything.
    await expect(columnSelection(page, "Parallels", GOLD)).toBeVisible();
    await expect(syncChecklistButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: ROW_BUILD })).toHaveCount(0);
    // Silver is an ordinary parallel of Gold now; it holds cards, so its button rebuilds.
    await columnSelection(page, "Parallels", GOLD).click();
    await expect(columnOption(page, "Parallels", GOLD)).toHaveAccessibleName(sourceTagged(GOLD));
    await expect(columnOption(page, "Parallels", SILVER)).toHaveAccessibleName(SILVER);
    await columnOption(page, "Parallels", SILVER).click();
    await expect(columnSelection(page, "Parallels", SILVER)).toBeVisible();
    await expect(page.getByRole("button", { name: `Rebuild from ${GOLD}`, exact: true })).toBeVisible();
    await expectAccessible(page, { label: "The old source, now a parallel of the new one" });
    // Back returns to Gold, the source, with its Sync.
    await page.goBack();
    await expect(columnSelection(page, "Parallels", GOLD)).toBeVisible();
    await expect(syncChecklistButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: ROW_BUILD })).toHaveCount(0);
  },
);
