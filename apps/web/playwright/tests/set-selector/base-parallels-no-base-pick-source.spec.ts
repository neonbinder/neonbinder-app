// ONE FEATURE (R1, NEO-673): a set with a Parallel variant type and no Base asks which of its
// parallels the others copy from; the picked one saves its own checklist like an insert, and the
// rest are built from it, with their own names in their titles.
//
// The operator meets it like this:
//   1. A Parallel type with Silver, Gold and Blue, and no Base. The "Parallels of the base set"
//      section asks "Which parallel do the others copy from?", with nothing picked.
//   2. Silver is picked. The section says "Copying from Silver", and Silver has no cards yet.
//   3. Silver's own row offers Sync (not "Can't build yet"); a two-row checklist is saved and tidied.
//   4. Gold's row offers "Build from Silver". Back returns to Silver's checklist.
//   5. "Build 2 parallels from Silver" builds Gold and Blue; Silver is not in the run. Gold's card
//      title names Gold, never Silver (Silver's own title names Silver, so the absence means it).
//   6. Change reopens the same list in child order with nothing checked; Gold is picked and the
//      build now reads from Gold.
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
// BaseParallelsBuildSection: PICK_SOURCE_QUESTION, CHANGE_SOURCE_ARIA.
const QUESTION = "Which parallel do the others copy from?";
const CHANGE = "Change the parallel the others copy from";

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

    // With no source the heading falls back to "the base set".
    const section = page.getByRole("region", { name: "Parallels of the base set" });
    const picker = section.getByRole("radiogroup", { name: QUESTION });
    await expect(picker).toBeVisible();
    for (const name of [SILVER, GOLD, BLUE]) {
      await expect(picker.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "false");
    }
    // Nothing is preselected, so the pick button names no parallel and is held.
    await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
    const copyFromNothing = section.getByRole("button", { name: "Copy from…", exact: true });
    await expect(copyFromNothing).toBeDisabled();
    await expect(section.getByRole("button", { name: /^Build .* from / })).toHaveCount(0);
    await expectAccessible(page, { within: section, label: "Parallels of a set with no Base, asking which one the others copy from" });

    // ── STEP 2: pick Silver ──
    await picker.getByRole("radio", { name: SILVER, exact: true }).click();
    await expect(picker.getByRole("radio", { name: SILVER, exact: true })).toHaveAttribute("aria-checked", "true");
    await section.getByRole("button", { name: `Copy from ${SILVER}`, exact: true, disabled: false }).click();
    // The section's status line says what the others copy from; focus lands on Change.
    const copying = (name: string) => section.getByText(`Copying from ${name}`, { exact: true });
    const changeButton = section.getByRole("button", { name: CHANGE, exact: true });
    await expect(copying(SILVER)).toBeVisible();
    await expect(changeButton).toBeFocused();
    await expect(picker).toHaveCount(0);
    // Silver is the source, so it is left off the build: two parallels, and Silver is still empty.
    await expect(section.getByText(`${SILVER} has no cards yet — save its checklist first.`)).toBeVisible();
    await expect(section.getByRole("button", { name: `Build 2 parallels from ${SILVER}`, exact: true })).toBeDisabled();
    await expectAccessible(page, { within: section, label: "Parallels of the base set, copying from the picked parallel" });

    // ── STEP 3: Silver saves its own checklist, like an insert ──
    await columnOption(page, "Parallels", SILVER).click();
    await expect(columnSelection(page, "Parallels", SILVER)).toBeVisible();
    // Silver reads "Loading…" until the plan answers; then its Sync slot is an ordinary Sync.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${PLAYERS[0]},\n2,${PLAYERS[1]},\n`, 2);
    await expect(syncChecklistButton(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Can't build yet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Build|Rebuild) from / })).toHaveCount(0);
    await syncChecklistButton(page).click();

    const saved = page.getByText(/Saved 2 cards\./).first();
    const opened = await settleWalkAfterCommit(page, saved, { opens: true });
    expect(opened, "two new names and no teams: the walk opens").toBe(true);
    // Any pink card on the source holds the build (NEO-661): answer every one.
    await tidyForTheParallelBuild(page);
    await expect(editCardButton(page, "1")).toBeVisible();
    await expect(editCardButton(page, "2")).toBeVisible();

    // Silver's own card title names Silver: the positive under step 5's absence (R2).
    const drawer = page.getByRole("dialog");
    await editCardButton(page, "1").click();
    await expect(drawer.getByRole("textbox", { name: "Card title", exact: true })).toHaveValue(new RegExp(`\\b${SILVER}\\b`));
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toHaveCount(0);

    // ── STEP 4: Gold offers "Build from Silver"; Back returns to Silver ──
    // A picked row folds the column to its card; the card reopens it.
    await columnSelection(page, "Parallels", SILVER).click();
    await columnOption(page, "Parallels", GOLD).click();
    await expect(columnSelection(page, "Parallels", GOLD)).toBeVisible();
    await expect(page.getByRole("button", { name: `Build from ${SILVER}`, exact: true })).toBeVisible();
    await page.goBack();
    await expect(columnSelection(page, "Parallels", SILVER)).toBeVisible();
    await expect(columnSelection(page, "Parallels", GOLD)).toHaveCount(0);
    await expect(editCardButton(page, "2")).toBeVisible();

    // ── STEP 5: build the other two from Silver, from the Parallel type with no row open ──
    // A finished run's ledger belongs to the row it started from (NEO-496), and the section's run
    // starts from the type, so the spec presses it where the operator reads the result: the type
    // itself, reopened through the drill (R9).
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Parallel" });
    await expect(columnOption(page, "Parallels", SILVER)).toBeVisible();
    await expect(copying(SILVER)).toBeVisible();
    await expect(section.getByText(`${SILVER} has no cards yet — save its checklist first.`)).toHaveCount(0);
    await section.getByRole("button", { name: `Build 2 parallels from ${SILVER}`, exact: true, disabled: false }).click();
    const ledger = page.getByRole("region", { name: `${SILVER} parallels — 2 built` });
    await expect(ledger.getByRole("heading", { name: `${SILVER} parallels — 2 built`, exact: true })).toBeVisible();
    for (const name of [GOLD, BLUE]) {
      await expect(ledger.getByRole("listitem").filter({ hasText: new RegExp(`^${name} — Built 2 cards`) })).toBeVisible();
    }
    await expect(ledger.getByRole("listitem").filter({ hasText: new RegExp(`^${SILVER} — `) })).toHaveCount(0);
    await expectAccessible(page, { label: "Two parallels built from the picked parallel" });

    // Gold holds both copies, and its title names Gold, not Silver.
    await columnOption(page, "Parallels", GOLD).click();
    await expect(columnSelection(page, "Parallels", GOLD)).toBeVisible();
    await expect(editCardButton(page, "2")).toBeVisible();
    await editCardButton(page, "1").click();
    const title = drawer.getByRole("textbox", { name: "Card title", exact: true });
    await expect(title).toHaveValue(new RegExp(`\\b${GOLD}\\b`));
    await expect(title).not.toHaveValue(new RegExp(escapeRe(SILVER), "i"));
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toHaveCount(0);

    // ── STEP 6: Change reopens the same list, in child order, with nothing checked; Gold becomes the source ──
    await changeButton.click();
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("radio")).toHaveText([SILVER, GOLD, BLUE]);
    await expect(picker.getByRole("radio", { name: SILVER, exact: true })).toBeFocused();
    await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Copy from…", exact: true })).toBeDisabled();
    await expect(
      section.getByRole("button", { name: "Cancel changing the parallel the others copy from", exact: true }),
    ).toBeVisible();
    await picker.getByRole("radio", { name: GOLD, exact: true }).click();
    const copyFromGold = section.getByRole("button", { name: `Copy from ${GOLD}`, exact: true, disabled: false });
    await expect(copyFromGold).toBeVisible();
    await expectAccessible(page, { within: section, label: "Changing the parallel the others copy from" });
    await copyFromGold.click();
    await expect(copying(GOLD)).toBeVisible();
    await expect(picker).toHaveCount(0);
    await expect(section.getByRole("button", { name: `Build 2 parallels from ${GOLD}`, exact: true })).toBeVisible();
    await expect(copying(SILVER)).toHaveCount(0);
  },
);
