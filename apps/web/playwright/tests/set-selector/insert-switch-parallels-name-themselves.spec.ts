// NEO-619 (Jason, 2026-11-19).
//
// R1 - ONE FEATURE: an insert's "Parallels name themselves" switch (the
// insert's Attributes panel, eyebrow "Titles"). While it is on, a card on one
// of the insert's parallels (its sub-variants) is titled without the insert's
// name; the insert's OWN cards still carry it. Titles are write-once: flipping
// the switch rewrites nothing, and Regenerate reads it. Off brings the
// insert's name back on the next Regenerate. Each press says so in the panel's
// status toast.
//
// R2 - what makes it fail if the feature breaks:
//   * Every title check opens the card's drawer and reads its "Card title"
//     field; a "leaves the insert out" check is always paired with the
//     parallel's own name in the same field first (positive before negative),
//     so an empty or unloaded field cannot pass for a dropped name.
//   * The toggle's state is its `aria-pressed`, asserted on each press, and the
//     toast's exact sentence proves the server took the write (it is raised
//     only after the mutation resolves).
//   * The parallel card made before the press still names the insert until it
//     is regenerated: a switch that silently rewrote stored titles fails there.
//   * The insert's own card, regenerated with the switch on, still names the
//     insert: a switch that dropped the insert from every card fails there.
//     Its title does not change, so the proof there is the drawer's "Title
//     built from" chips (the generator's inputs, a live query since NEO-535):
//     they keep the insert's level for the insert's card and drop it for a
//     parallel's while the switch is on.
//   * Planted-break proof (NEO-619): `parallelsNameThemselvesApplies` made to
//     return false on the deployment turned this spec red at STEP 3.
//
// The views: the drill lives in the URL and a pick is a push, so the spec goes
// from the parallel back to the insert with Back and checks the insert's view
// is the one showing (house rule).
//
// R3 - `tidy-up-title-names-the-insert-and-parallel` owns the Tidy Up dialog's
// name for a parallel; `card-title-uses-short-name-for-titles` owns the cut
// order and "Set name in titles". This spec owns the switch alone.
//
// R7/R7a - every write lands in ONE per-attempt hand-made set, `psn<token>`,
// under `E2E Test Sport <worker>` > 2026 > Topps (drillToCustomSet;
// SET-REGISTRY.md, Custom sets). Hand-made, so no marketplace side is
// resolvable beneath it and every wait is the 7 s budget. Under `Insert` the
// insert `psnpurple<token>` holds the parallel `psngold<token>` (moved there
// with Group Parallels, the same move the sub-variants spec makes). Minted
// names are single tokens from env.ATTEMPT_TOKEN, and neither the set's nor the
// parallel's name contains the insert's, so only the insert's own level can put
// `psnpurple<token>` in a title. The switch is turned off again before the end;
// nothing is deleted (the set is this attempt's alone).
//
// Fixture length: "2026 Topps psn<T> psnpurple<T> psngold<T> <name> #<n>" is at
// most 75 characters (ATTEMPT_TOKEN is 12 at most), so neither level's name is
// ever near the 80-character cuts, and a level's own name is never cut anyway.
//
// R9: the drill goes through drillToCustomSet; the rows are made with "+ Custom"
// and grouped as `insert-sub-variants-column-only-when-it-has-some` groups them.
// Desktop and mobile: the panel, column and drawer controls carry the same
// names at both widths; nothing branches.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addCardViaForm, editCardButton } from "../../support/cards";
import {
  addCustomEntry,
  columnOption,
  columnSelection,
  drillToCustomSet,
  openAttributesPanel,
  setBuilderReady,
} from "../../support/set-builder";

const ON_TOAST = "Parallels name themselves · Regenerate a card to retitle it";
const OFF_TOAST = "Parallels carry the insert's name again · Regenerate a card to retitle it";

test(
  "An insert's Parallels name themselves switch leaves the insert's name out of its parallels' titles, not its own cards', and Regenerate applies it either way (NEO-619)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SET = `psn${T}`;
    const INSERT = `psnpurple${T}`;
    const PARALLEL = `psngold${T}`;
    // The insert's own card, the parallel card made before the switch, and the
    // parallel card made after it.
    const INSERT_CARD = "1";
    const OLD_PARALLEL_CARD = "2";
    const NEW_PARALLEL_CARD = "3";

    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    const cardTitle = drawer.getByRole("textbox", { name: "Card title", exact: true });
    const regenerate = drawer.getByRole("button", { name: "Regenerate card title" });
    const doneEditing = page.getByRole("button", { name: "Done editing card" });
    const insertHeading = page.getByRole("heading", { name: `Attributes for ${INSERT} (Insert)`, exact: true });
    const toggle = page.getByRole("button", { name: "Parallels name themselves", exact: true });
    const toast = (text: string) => page.getByRole("status").filter({ hasText: text });
    const namesInsert = new RegExp(`\\b${INSERT}\\b`);
    const namesParallel = new RegExp(`\\b${PARALLEL}\\b`);

    const builtFrom = drawer.getByRole("list", { name: "Title built from" });
    // The chips are the generator's inputs for the card as it stands now (a
    // live query, NEO-535), so they follow the switch before any Regenerate.
    const insertChip = builtFrom.getByRole("listitem").filter({ hasText: INSERT });
    const parallelChip = builtFrom.getByRole("listitem").filter({ hasText: PARALLEL });

    /** Open a card's drawer, run `check` on it, then close it. */
    const withCard = async (cardNumber: string, check: () => Promise<void>) => {
      await editCardButton(page, cardNumber).click();
      await expect(cardTitle).toBeVisible();
      await check();
      await doneEditing.click();
      await expect(cardTitle).toBeHidden();
    };
    /**
     * Back to the insert itself (its own checklist and panel, no parallel
     * picked). The drill lives in the URL and a pick is a push, so Back undoes
     * the parallel's pick (house rule: Back steps through the views).
     */
    const backToInsert = async () => {
      await page.goBack();
      await expect(page).not.toHaveURL(/[?&]parallel=/);
      await expect(insertHeading).toBeVisible();
      await expect(columnSelection(page, "Inserts", INSERT)).toBeVisible();
      await expect(columnOption(page, "Parallels", PARALLEL)).toBeVisible();
    };
    const pickParallel = async () => {
      await columnOption(page, "Parallels", PARALLEL).click();
      await expect(page).toHaveURL(/[?&]parallel=/);
      await expect(columnSelection(page, "Parallels", PARALLEL)).toBeVisible();
      await expect(
        page.getByRole("heading", { name: `Attributes for ${PARALLEL} (Parallel)`, exact: true }),
      ).toBeVisible();
    };
    const savedTitle = drawer.getByText(/Saved Card title/).first();

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── The insert and its parallel ──
    await drillToCustomSet(page, env, { set: SET, variantType: "Insert" });
    await addCustomEntry(page, "Inserts", INSERT, { confirm: "required" });
    await addCustomEntry(page, "Inserts", PARALLEL, { confirm: "required" });
    await columnOption(page, "Inserts", INSERT).click();
    await expect(columnSelection(page, "Inserts", INSERT)).toBeVisible();
    const grouping = page.getByRole("dialog", { name: "Group Parallels" });
    await page.getByRole("button", { name: "Group Parallels" }).click();
    await expect(grouping.getByText(/Drag inserts under a parent/)).toBeVisible();
    await grouping.getByRole("checkbox", { name: `Select ${PARALLEL}` }).click();
    await grouping.getByText(`Parallels of "${INSERT}"`).click();
    await expect(grouping.getByText("1 promotion, 0 demotions")).toBeVisible();
    await grouping.getByRole("button", { name: "Save 1 change" }).click();
    await expect(grouping).toBeHidden();
    await expect(columnOption(page, "Parallels", PARALLEL)).toBeVisible();

    // ── STEP 1: a card on the insert and one on its parallel; the parallel's
    // title names the insert (the switch is off by default) ──
    await expect(insertHeading).toBeVisible();
    await addCardViaForm(page, { cardNumber: INSERT_CARD, playerName: "Ace" });
    await pickParallel();
    await addCardViaForm(page, { cardNumber: OLD_PARALLEL_CARD, playerName: "Bo" });
    await withCard(OLD_PARALLEL_CARD, async () => {
      await expect(cardTitle).toHaveValue(namesParallel);
      await expect(cardTitle).toHaveValue(namesInsert);
    });

    // ── STEP 2: the insert's panel, the switch pressed on ──
    await backToInsert();
    await openAttributesPanel(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toast(ON_TOAST)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expectAccessible(page, { label: "Insert attributes panel, Parallels name themselves on" });

    // ── STEP 5 (with the panel at hand): the insert's OWN card keeps the
    // insert's name with the switch on. Its title is unchanged, so the proof
    // is the generator's inputs (the chips name the insert's level) and the
    // title Regenerate hands back. ──
    await withCard(INSERT_CARD, async () => {
      await expect(insertChip).toBeVisible();
      await regenerate.click();
      await expect(cardTitle).toHaveValue(namesInsert);
      await expect(insertChip).toBeVisible();
    });

    // ── STEP 3: a new parallel card leaves the insert out ──
    await pickParallel();
    await addCardViaForm(page, { cardNumber: NEW_PARALLEL_CARD, playerName: "Cy" });
    await withCard(NEW_PARALLEL_CARD, async () => {
      await expect(cardTitle).toHaveValue(namesParallel);
      await expect(cardTitle).not.toHaveValue(namesInsert);
      await expect(parallelChip).toBeVisible();
      await expect(insertChip).toHaveCount(0);
    });

    // ── STEP 4: the parallel card made before the switch still names the
    // insert (titles are write-once) until Regenerate, which drops it ──
    await withCard(OLD_PARALLEL_CARD, async () => {
      await expect(parallelChip).toBeVisible();
      await expect(insertChip).toHaveCount(0);
      await expect(cardTitle).toHaveValue(namesParallel);
      await expect(cardTitle).toHaveValue(namesInsert);
      await regenerate.click();
      await expect(savedTitle).toBeVisible();
      await expect(cardTitle).toHaveValue(namesParallel);
      await expect(cardTitle).not.toHaveValue(namesInsert);
    });

    // ── STEP 6: off again; Regenerate brings the insert's name back ──
    await backToInsert();
    await openAttributesPanel(page);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(toast(OFF_TOAST)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await pickParallel();
    await withCard(OLD_PARALLEL_CARD, async () => {
      await expect(cardTitle).toHaveValue(namesParallel);
      await expect(cardTitle).not.toHaveValue(namesInsert);
      await expect(insertChip).toBeVisible();
      await regenerate.click();
      await expect(savedTitle).toBeVisible();
      await expect(cardTitle).toHaveValue(namesParallel);
      await expect(cardTitle).toHaveValue(namesInsert);
    });
  },
);
