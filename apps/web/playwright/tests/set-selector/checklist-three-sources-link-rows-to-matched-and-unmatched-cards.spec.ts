// NEO-490 (R1): WRITTEN, PAUSED UNTIL SPORTLOTS RESUMES. With both marketplaces
// and a publisher's checklist in the mix, Match Cards is a three-source screen:
// BSC only, SportLots only and "Checklist only" side by side, and a checklist row
// can be linked onto an unmatched card, which moves with it into Matched (NEO-591:
// a hand link is a Matched row, never a shelf entry); a broken pair's BSC half keeps
// its chip on the Keeping shelf; and the chip's Unlink, the one undo, sends the card
// back to its column and the row back to "Checklist only".
//
// WHY IT IS PAUSED, and how: SportLots is paused everywhere the suite runs today
// (PAUSED_PLATFORMS=sportlots, GUIDE -> "Operator switches"). Paused, this set's
// fetch has two sources, BSC and the checklist (NEO-496), not the three this spec
// is about; the two-source screen is proved by set-checklist-pdf-topps-chrome-2026
// and checklist-published-numbers-differ-pairs-by-player, which own their sets. The suite's way of sitting out is a branch on `env.SL_PAUSED`, never
// a skip: the paused branch below proves what the pause shows on this set and
// returns; the live branch is the flow, and it returns by itself the day the
// variable is unset. The live branch has NOT been run (it cannot be: nothing may
// contact SportLots). It is written against the code and its unit-tested names
// (CardPairingModal.checklist.test.tsx), and the first live run is its test.
// Switch-on: with the SportLots resume steps (SET-REGISTRY.md -> "SportLots pause",
// NEO-339's parked PR) done, run this spec once live on its own deployment.
//
// FIXTURE: the seed's 2024 Topps Chrome > Insert > Future Stars (20 cards, BSC +
// SportLots ids), READ-ONLY like checklist-pairing-dialog-cancel: the flow only ever
// cancels, so the seller specs' anchor is untouched. The publisher's checklist is
// Future Stars as a publisher would number it, 101-119 (fixtures/checklists): its
// numbers match neither side's, so each row pairs its card by player name (NEO-591:
// names first, at the lower confidence because the numbers differ) and is applied
// by the fetch; Brayan Rocchio's card (FS-20) has no row. The counts below come from
// the product's own matcher (support/published-checklist.ts `checklistFacts`).
// RE-DERIVE ON THE FIRST LIVE RUN (SportLots paused): the live branch was written
// before names-first; its pair names, column counts and budgets are the code's
// reading, never a live run's. Re-measure and re-read them the day it first runs.
//
// NOT COVERED (open, see the report): the "Teams from your checklist" line after
// Confirm. It is said on the line the save lands with, and a save would write to the
// shared anchor, so it needs a set this spec is the sole writer of.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  columnHeading,
  columnOption,
  columnSearch,
  drillToSet,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import {
  CHECKLISTS,
  checklistFacts,
  publishersChecklistButton,
  publishersChecklistChip,
  usePublishersChecklist,
} from "../../support/published-checklist";

/** The publisher's 19 rows matched against the 20 Future Stars cards (the capture's FS-n numbers). */
const WHOLE = checklistFacts(CHECKLISTS.futureStars2024PublisherNumbering, { cardsOf: CHECKLISTS.futureStars2024 });
/**
 * The checklist column's heading: how many rows still wait for a card or a Keep. NEO-496 renamed it
 * from "Your checklist (N to link)" / "(all linked!)" to "Checklist only (N)", in the words of the
 * "BSC only (N)" column beside it (CardPairingModal `checklistColumnHeading`).
 */
const yourChecklist = (unlinked: number) => `Checklist only (${unlinked})`;

test(
  "Checklist — with both marketplaces, Match Cards is three columns and a checklist row links to an unmatched card, keeps a broken pair's BSC half, and returns when its link is undone",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── Drill to the pre-synced 2024 Topps Chrome > Insert > Future Stars (read-only).
    await drillToSet(page, env);
    await pick(page, "Variant Types", "Insert", { search: false });
    await expect(columnHeading(page, "Inserts")).toBeVisible({ timeout: 20_000 });
    await expect(columnSearch(page, "Inserts")).toBeVisible({ timeout: 60_000 });
    await columnSearch(page, "Inserts").fill("Future Stars");
    const futureStars = columnOption(page, "Inserts", "Future Stars");
    await expect(futureStars).toBeVisible({ timeout: 15_000 });
    await futureStars.click();

    if (env.SL_PAUSED) {
      // PAUSED BRANCH. Nothing is synced (a one-marketplace sync would commit onto the shared anchor).
      // The cards are BSC-only with no SportLots ref and the operator is told why, so the three-source
      // screen has nothing to show.
      await expect(page.getByText(/#FS-[0-9]/).first()).toBeVisible();
      await expect(page.getByText("BSC only", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("SL", { exact: true })).toBeHidden();
      await expect(page.getByText("SportLots is on pause.")).toBeVisible();
      await expect(page.getByRole("dialog", { name: /^Match Cards/ })).toBeHidden();
      await expectAccessible(page, { label: "Future Stars checklist, SportLots on pause (three-source checklist spec)" });
      return;
    }

    // LIVE BRANCH. The set may already hold the seed's own checklist chip (20 rows); the new file replaces
    // it. Either state is fine (chip on screen, or the add button), and the next hard assert needs the
    // button back.
    // Re-derive on the first live run (SportLots paused): every row pairs a card by name; one card has none.
    expect(WHOLE.paired).toBe(WHOLE.rows);
    expect(WHOLE.cards).toBe(WHOLE.rows + 1);
    const seedChip = publishersChecklistChip(page, WHOLE.cards);
    await expect(publishersChecklistButton(page).or(seedChip).first()).toBeVisible();
    if (await seedChip.isVisible()) {
      await page.getByRole("button", { name: "Remove the official checklist" }).click();
    }
    await expect(publishersChecklistButton(page)).toBeVisible();
    await usePublishersChecklist(page, CHECKLISTS.futureStars2024PublisherNumbering);

    // ── Sync opens Match Cards instead of committing. A live BSC + SportLots round trip: the budget the
    // sibling spec uses for the same set (unmeasured here; measure it on the first live run and replace it
    // with the measured time plus 7 s).
    await syncChecklistButton(page).click();
    const dialog = page.getByRole("dialog", { name: /^Match Cards/ });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByRole("button", { name: "Confirm card matches", disabled: false })).toBeVisible({ timeout: 90_000 });

    // The 19 name pairs are linked on the matched pairs (names first, NEO-591; re-derive on the first
    // live run): the checklist column reads "Checklist only (0)" and Brayan Rocchio's card has no row.
    await expect(dialog.getByRole("heading", { name: yourChecklist(WHOLE.rows - WHOLE.paired) })).toBeVisible();
    // Each server pair carries its row in a chip whose Unlink names both.
    await expect(dialog.getByRole("button", { name: /^Unlink card #FS-1 .* from checklist row #101 / })).toBeVisible();

    // ── STEP 1: pull #FS-2's row off its card (the chip's Unlink: a BSC + SportLots pair stays in
    // Matched, its row returns to the list) and break the pair, so a BSC-only card (#FS-2), a
    // SportLots-only card and an unlinked row (#102) are all on screen: three columns.
    await dialog.getByRole("button", { name: /^Unlink card #FS-2 .* from checklist row #102 / }).click();
    await expect(dialog.getByRole("radio", { name: /^Select #102 Gunnar Henderson/ })).toBeVisible();
    await dialog.getByRole("button", { name: /^Unlink #FS-2 / }).click();
    await expect(dialog.getByRole("heading", { name: "BSC only (1)", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "SportLots only (1)", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: yourChecklist(1) })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Filter checklist rows" })).toBeVisible();

    // ── STEP 2: link the row onto the unmatched BSC card: both leave their lists for one Matched row
    // (NEO-591), nothing goes on the keep shelf, and the status region says where they went.
    await dialog.getByRole("radio", { name: /^Select #102 Gunnar Henderson/ }).click();
    await dialog.getByRole("button", { name: /^Link selected checklist row to #FS-2 / }).click();
    await expect(dialog.getByRole("heading", { name: "BSC only (0)", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: yourChecklist(0) })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Keeping (0)" })).toBeVisible();
    await expect(
      dialog.getByRole("status").filter({ hasText: /^Linked checklist row 102 to #FS-2 / }),
    ).toHaveText(/^Linked checklist row 102 to #FS-2 .+\. Moved to Matched\. Every checklist row is linked or kept\.$/);
    // Matched is left as it was (a link does not force it open): open it to read the new row.
    const expandMatched = dialog.getByRole("button", { name: /^Expand matched cards/ });
    const collapseMatched = dialog.getByRole("button", { name: /^Collapse matched cards/ });
    await expect(expandMatched.or(collapseMatched)).toBeVisible();
    if (await expandMatched.isVisible()) await expandMatched.click();
    const fs2Unlink = dialog.getByRole("button", { name: /^Unlink card #FS-2 .* from checklist row #102 / });
    await expect(fs2Unlink).toBeVisible();

    // ── STEP 3: break a linked pair. #FS-1's pair carries row #101; Unlink splits it: the BSC half keeps
    // its chip and is kept (a linked card is always saved), drawn on the Keeping shelf like a Matched
    // row, while the SportLots half waits in its column.
    await dialog.getByRole("button", { name: /^Unlink #FS-1 / }).click();
    await expect(dialog.getByRole("heading", { name: "Keeping (1)" })).toBeVisible();
    const keptHalf = dialog
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /^Remove #FS-1 .* from save list$/ }) });
    await expect(keptHalf.getByRole("button", { name: /^Edit name for #FS-1 / })).toBeVisible();
    await expect(keptHalf.getByText("Checklist: #101", { exact: true })).toBeVisible();
    await expect(keptHalf.getByRole("button", { name: /^Unlink card #FS-1 .* from checklist row #101 / })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "SportLots only (2)", exact: true })).toBeVisible();

    // ── STEP 5 (axe) on the three-column layout, light and dark (expectAccessible runs both).
    await expectAccessible(page, { within: dialog, label: "Match Cards dialog, three sources side by side" });

    // ── STEP 4: undo the hand link on #FS-2 with its chip's Unlink: the card goes back to BSC only and
    // the row to "Checklist only", and focus lands on the returned card.
    await fs2Unlink.click();
    await expect(dialog.getByRole("heading", { name: "BSC only (1)", exact: true })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: yourChecklist(1) })).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /^Select #102 Gunnar Henderson/ })).toBeVisible();
    await expect(
      dialog.getByRole("status").filter({ hasText: /^Unlinked from #FS-2 / }),
    ).toHaveText(/^Unlinked from #FS-2 .+\. Moved back to BSC only and Checklist only\.$/);
    await expect(dialog.getByRole("radio", { name: /^Select BSC card #FS-2 / })).toBeFocused();
    await expect(dialog.getByRole("heading", { name: "Keeping (1)" })).toBeVisible();

    // ── END: nothing is saved. Cancel asks to discard (the session has edits), and discarding writes nothing.
    await dialog.getByRole("button", { name: "Cancel card matching" }).click();
    await page.getByRole("button", { name: /^Discard [0-9]+ pairings?$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Sync cancelled — no cards saved.")).toBeVisible();
  },
);
