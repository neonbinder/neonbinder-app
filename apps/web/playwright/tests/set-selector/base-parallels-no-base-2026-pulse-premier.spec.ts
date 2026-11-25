// ONE FEATURE (R1, NEO-673): on a real BuySportsCards set whose Parallel type has no Base
// (2026 Pulse Premier), the operator picks Silver as the parallel the others copy from, and the
// section plans the other 12 from it.
//
// Pick and plan only (Jason, 2026-11-25: "pick + plan only: fetch, pick Silver, assert 12
// parallels and 'Build 12 parallels from Silver'; no sync/build"):
//   1. The set is reached the normal way on the fake BSC; its Parallel type lists 13 parallels.
//   2. The section asks "Which parallel do the others copy from?" and lists all 13 with nothing
//      checked. On a rerun of the same seed Silver is already the source: Change reopens the list
//      with "Silver (current)" marked and, again, nothing checked.
//   3. Silver is picked: "Copying from Silver", "12 parallels", "Build 12 parallels from Silver",
//      and Silver is not among the 12. Nothing is synced or built.
//
// FIXTURE (SET-REGISTRY.md "Baseball → 2026 → Pulse › Pulse Premier — the NEO-673 chosen-source
// fixture"; R7a): this spec is the SOLE WRITER of the set's Variant Types and Parallels column
// syncs and of the Parallel type's chosen source. Fetch or adopt: fresh, nothing is picked; on a
// rerun Silver is (it is the only pick this spec makes). Not fresh-only.
//
// R9: `drillToSet` waits for a "Base" variant type, and this set has none (that is the point of
// the spec), so the drill is its own steps up to the Sets column (the same helpers), then waits
// for the "Parallel" type instead.
import type { Page } from "@playwright/test";
import type { FlowEnv } from "../../support/env";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  columnHeading,
  columnOption,
  expectAfterBscSync,
  pick,
  pickAfterBscSync,
  setBuilderReady,
} from "../../support/set-builder";

const SPORT = "Baseball";
const YEAR = "2026";
// Under a SportLots pause the seed's year-wide 2026 Sets sync files the set under NB's known
// brand `Pulse` (convex/knownBrands.ts).
const BRAND = "Pulse";
const SET = "Pulse Premier";
const SOURCE = "Silver";
/** BSC's 13 parallels of 2026 Pulse Premier (its Parallel type's filter list, recorded on the fake). */
const PARALLELS = [
  "White",
  "Speckled Gold",
  "Speckled Blue",
  "Silver",
  "Rose Gold",
  "Red",
  "Pink",
  "Orange",
  "Gunmetal",
  "Green",
  "Gold",
  "Bronze",
  "Blue",
] as const;
const BUILT = PARALLELS.length - 1;
// BaseParallelsBuildSection: PICK_SOURCE_QUESTION, CHANGE_SOURCE_ARIA, currentOptionLabel.
const QUESTION = "Which parallel do the others copy from?";
const CHANGE = "Change the parallel the others copy from";
const current = (name: string) => `${name} (current)`;

/** Sport › Year › Pulse › Pulse Premier, leaving the Variant Types column with "Parallel" listed. */
async function drillToPulsePremier(page: Page, env: FlowEnv): Promise<void> {
  await pick(page, "Sports", SPORT, { search: false });
  await expect(columnHeading(page, "Years")).toBeVisible();
  await pick(page, "Years", YEAR);
  await expect(columnHeading(page, "Manufacturers")).toBeVisible();
  if (env.SL_PAUSED) await expect(page.getByText("Syncing Manufacturer Options")).toBeHidden();
  await pick(page, "Manufacturers", BRAND);
  await expect(columnHeading(page, "Sets")).toBeVisible();
  await pickAfterBscSync(page, "Sets", SET);
  await expect(columnHeading(page, "Variant Types")).toBeVisible();
  // The Variant Types column syncs from BSC on the set's first visit: its wait line covers it.
  await expectAfterMarketplace(page, columnOption(page, "Variant Types", "Parallel"), {
    platform: "BuySportsCards",
    what: "Variant Types row Parallel",
  });
  // Insert and Parallel, no Base: the case this spec is about.
  await expect(columnOption(page, "Variant Types", "Base")).toHaveCount(0);
}

test(
  "2026 Pulse Premier has no Base: picking Silver plans its 12 other parallels from it (NEO-673)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: the set's Parallel type, its 13 parallels synced from BSC ──
    await drillToPulsePremier(page, env);
    await pick(page, "Variant Types", "Parallel", { search: false });
    await expect(page.getByText("An error occurred. Please refresh the page.")).toBeHidden();
    await expectAfterBscSync(page, columnOption(page, "Parallels", SOURCE), `Parallels row ${SOURCE}`);
    await expect(page.getByRole("listbox", { name: "Parallels" }).getByRole("option")).toHaveCount(PARALLELS.length);

    // ── STEP 2: the list of 13, nothing checked (fresh, or reopened through Change) ──
    const firstPick = page.getByRole("region", { name: "Parallels of this set", exact: true });
    // Once a parallel is the source the heading names it: "Parallels from Silver".
    const chosen = page.getByRole("region", { name: `Parallels from ${SOURCE}`, exact: true });
    const copying = chosen.getByText(`Copying from ${SOURCE}`, { exact: true });
    // The section reads "Parallels of the base set" while its plan loads, so the settled states are
    // the first-pick question or the standing source's status line, never the heading alone.
    const firstQuestion = firstPick.getByRole("radiogroup", { name: QUESTION });
    await expect(firstQuestion.or(copying)).toBeVisible();

    const adopted = await copying.isVisible();
    const section = adopted ? chosen : firstPick;
    const picker = section.getByRole("radiogroup", { name: QUESTION });
    if (adopted) {
      // A rerun on the same seed: Silver is already the source. Change reopens the list.
      await chosen.getByRole("button", { name: CHANGE, exact: true }).click();
      await expect(picker).toBeVisible();
      await expect(picker.getByRole("radio", { name: current(SOURCE), exact: true })).toHaveAttribute(
        "aria-checked",
        "false",
      );
      await expect(picker.getByText(/\(current\)$/)).toHaveCount(1);
    } else {
      await expect(picker).toBeVisible();
      // The first-pick list carries no "(current)" marker.
      await expect(picker.getByText(/\(current\)/)).toHaveCount(0);
      await expect(picker.getByRole("radio", { name: SOURCE, exact: true })).toHaveAttribute("aria-checked", "false");
    }
    const sourceRadio = picker.getByRole("radio", { name: adopted ? current(SOURCE) : SOURCE, exact: true });
    await expect(picker.getByRole("radio")).toHaveCount(PARALLELS.length);
    for (const name of PARALLELS) {
      if (name === SOURCE) continue;
      await expect(picker.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    await expect(sourceRadio).toBeVisible();
    await expect(picker.getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Copy from…", exact: true })).toBeDisabled();
    await expectAccessible(page, { within: section, label: "2026 Pulse Premier's 13 parallels, none picked" });

    // ── STEP 3: pick Silver; the other 12 are planned from it ──
    await sourceRadio.click();
    await expect(sourceRadio).toHaveAttribute("aria-checked", "true");
    await section.getByRole("button", { name: `Copy from ${SOURCE}`, exact: true, disabled: false }).click();
    await expect(copying).toBeVisible();
    await expect(chosen.getByRole("heading", { level: 3, name: `Parallels from ${SOURCE}`, exact: true })).toBeVisible();
    await expect(firstPick).toHaveCount(0);
    await expect(picker).toHaveCount(0);
    await expect(chosen.getByRole("button", { name: `Build ${BUILT} parallels from ${SOURCE}`, exact: true })).toBeVisible();
    // The summary counts the 12 (13 in the column, less the source); nothing is built, so all empty.
    await expect(chosen.getByText(new RegExp(`^${BUILT} parallels, all empty\\. `))).toBeVisible();
    // The binder-page strip names each parallel to build in its title: the 12, and never Silver.
    const sleeves = chosen.getByTitle(/^.+ — (empty|has cards)$/);
    await expect(sleeves).toHaveCount(BUILT);
    await expect(chosen.getByTitle(new RegExp(`^${SOURCE} — `))).toHaveCount(0);
    await expect(chosen.getByTitle(/^Gold — /)).toHaveCount(1);
    // The Parallels column tags Silver as the source (its BSC pill follows the tag).
    await expect(columnOption(page, "Parallels", SOURCE)).toHaveAccessibleName(/^Silver \(source\)/);
    await expect(columnOption(page, "Parallels", "Gold")).not.toHaveAccessibleName(/\(source\)/);
    await expectAccessible(page, { within: chosen, label: "2026 Pulse Premier copying from Silver, 12 to build" });
  },
);
