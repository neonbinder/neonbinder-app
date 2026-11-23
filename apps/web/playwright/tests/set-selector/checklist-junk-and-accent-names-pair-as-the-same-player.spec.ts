// NEO-643 (R1): a checklist name written with BSC's backslash for an accent, or
// with an accent the card does not carry, is the SAME name: it pairs its card
// in Match Cards at 100% with no name to choose, and a checklist-only row
// written that way is read and kept under its clean name. READ-ONLY: the spec
// leaves by Match Cards' Cancel, so nothing is saved and the walk never opens.
//
// The change: every name matcher folds accents and DELETES stray junk
// characters (`\`, soft hyphen, zero-width; `foldNameText`,
// lib/entities/normalize-name.ts), and every external name is cleansed as it
// comes in (`cleanseExternalName`, lib/entities/cleanse-name.ts): a checklist's
// "Sh\ohei Ohtani" is read as "Shohei Ohtani". No recorded BSC fixture holds a
// backslash, so the spec puts the junk in the checklist it uploads (built in
// memory from the set's capture: the same 10 rows, two of them respelled, plus
// one checklist-only row).
//
// What it proves, in the order the operator meets it:
//   MATCH CARDS: all 10 cards are Matched. #3 (checklist "Mark DeR\osa") and #5
//     ("Harold Reynólds") sit there like any exact pair: "On checklist", no %, no
//     "Numbers differ", no "Name for #n" picker (the picker opens whenever the
//     sources' names fold to different keys). Before NEO-643 the backslash was a
//     separator ("der osa"), so #3 carried the picker.
//   CHECKLIST ONLY: the row "Sh\ohei Ohtani" (#11, no BSC card) reads "Shohei
//     Ohtani" and, kept, sits on the Keeping shelf under that clean name.
//   CANCEL: Match Cards' Cancel discards the one keep; no card is saved, the
//     Tidy Up walk never opens, and the checklist is still empty.
//
// NEO-645 (D2): the entry-review wizard is gone, and a walk on this set would
// commit it. The old WIZARD half (the kept junk row reaches the catalogue's
// Shohei Ohtani, so he is not asked as a new player) is proved without the UI in
// convex/tidyNames.cleansedName.test.ts: a junk or accented printed name
// answered once reaches its cleansed twin through the `tidyNames` fan-out.
//
// FIXTURE (SET-REGISTRY.md, "Topps Stars of MLB Network", one of its readers): the
// read-only fixture, Baseball > 2024 > Topps > Topps Stars of MLB Network >
// Base, 10 BSC cards, BSC only under a SportLots pause. Every reader exits
// Cancel; nothing may commit it. Every one of the 10 cards has a row, so BSC is
// asked for no card (GUIDE, "Checklist first"); the new row #11 is checklist-only
// and costs no BSC call. The brief named the 2026 Donruss Signature Series
// insert: its sole writer COMMITS it in-pass, so a reader there sees a committed
// set or not depending on shard order, and a file covering fewer than its 14
// cards asks BSC live per card; this set has neither problem.
//
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  checklistRows,
  matchCardsDialog,
  usePastedChecklist,
  type ChecklistRow,
} from "../../support/published-checklist";
import { drillToBaseVariant, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { tidyWalk } from "../../support/tidy-walk";

const SET = "Topps Stars of MLB Network";
/** BSC's card #3 / #5, as the capture names them (the checklist respells them). */
const DEROSA = { number: "3", player: "Mark DeRosa" };
const REYNOLDS = { number: "5", player: "Harold Reynolds" };
/** The checklist's spellings: BSC's backslash in place of a letter's accent, and an added accent. */
const DEROSA_JUNK = "Mark DeR\\osa";
const REYNOLDS_ACCENT = "Harold Reynólds";
/** A checklist-only row (BSC lists 10 cards, #1-#10) naming a catalogue player BSC-style. */
const OHTANI_JUNK = "Sh\\ohei Ohtani";
const OHTANI = "Shohei Ohtani";
const OHTANI_ROW: ChecklistRow = { number: "11", player: OHTANI_JUNK, team: "No Team" };

/** One cell into CSV (quoted when it holds a comma or a quote). */
const csvCell = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

/** The capture's rows with #3 and #5 respelled, then the checklist-only row. */
function buildChecklist(): { csv: string; rows: number } {
  const capture = checklistRows(CHECKLISTS.starsOfMlbNetwork);
  const respelled = new Map([
    [DEROSA.number, { from: DEROSA.player, to: DEROSA_JUNK }],
    [REYNOLDS.number, { from: REYNOLDS.player, to: REYNOLDS_ACCENT }],
  ]);
  const rows = capture.map((row) => {
    const change = respelled.get(row.number);
    if (!change) return row;
    // The capture still names these cards as the spec expects (else the fixture moved: fail by name).
    expect(row.player, `card #${row.number} in the capture`).toBe(change.from);
    return { ...row, player: change.to };
  });
  expect(capture.some((row) => row.number === OHTANI_ROW.number), "#11 is not one of BSC's cards").toBe(false);
  const all = [...rows, OHTANI_ROW];
  const csv = ["number,player,team", ...all.map((r) => [r.number, r.player, r.team].map(csvCell).join(","))].join("\n");
  return { csv: `${csv}\n`, rows: all.length };
}

test(
  "Published checklist — a name with BSC's backslash or an extra accent pairs its card at 100%, and a junk checklist-only row is kept under its clean name",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    // The spellings really hold the junk (a lost escape would make every assert below vacuous).
    expect(DEROSA_JUNK).toContain("\\");
    expect(OHTANI_JUNK).toContain("\\");
    expect(REYNOLDS_ACCENT).not.toBe(REYNOLDS.player);
    const checklist = buildChecklist();
    const matchCards = matchCardsDialog(page);

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToBaseVariant(page, env, { set: SET });
    // R2 precondition: the read-only fixture holds no cards (nothing may commit it).
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    await usePastedChecklist(page, checklist.csv, checklist.rows);
    await syncChecklistButton(page).click();

    // BSC and the checklist are two sources (NEO-496), so Match Cards opens. One live BSC round
    // trip: our 7 s plus the seconds the screen says it is waiting on BSC.
    await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: `Match Cards for ${SET}` });
    await expectAfterMarketplace(page, matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }), {
      platform: "BuySportsCards",
      what: "Confirm unlocked",
    });

    // ── MATCH CARDS: every card paired; the respelled two like any exact pair ──
    await expect(matchCards.getByRole("heading", { name: "BSC only (0)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (1)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (0)" })).toBeVisible();
    // The Matched list opens collapsed or open depending on what else the dialog holds; settle on
    // one state first, then open it if it is shut (the user's own step). Matched EXACTLY: the
    // toggle's name gains ", N with a name conflict" when any pair's sources name it differently,
    // so this is the list-wide half of the no-picker proof (the planted break goes red here).
    const expand = matchCards.getByRole("button", { name: "Expand matched cards", exact: true });
    const collapse = matchCards.getByRole("button", { name: "Collapse matched cards", exact: true });
    await expect(expand.or(collapse)).toBeVisible();
    if (await expand.isVisible()) await expand.click();
    await expect(collapse).toBeVisible();
    await expect(matchCards.getByText("Matched (10)")).toBeVisible();
    for (const card of [DEROSA, REYNOLDS]) {
      const label = `#${card.number} ${card.player}`;
      const row = matchCards
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: `Edit name for ${label}`, exact: true }) });
      // Positive first (R2): the pair is on screen with the chip an exact number-and-name pair wears.
      await expect(row.getByText("On checklist", { exact: true }), `${label} is linked to its row`).toBeVisible();
      // 100%: no % anywhere on the row (a lower match prints it, and the chip says "Name match NN%").
      await expect(row.getByText(/[0-9]+%/)).toHaveCount(0);
      await expect(row.getByText("Numbers differ", { exact: true })).toHaveCount(0);
      // No name to choose: the checklist's spelling folds to the card's own.
      await expect(
        row.getByRole("radiogroup", { name: `Name for #${card.number}`, exact: true }),
        `${label} offers no second name`,
      ).toHaveCount(0);
      await expect(row.getByRole("group", { name: `Name conflict on #${card.number}`, exact: true })).toHaveCount(0);
    }

    // ── CHECKLIST ONLY: the junk row is read under its clean name, kept ──
    const keepOhtani = matchCards.getByRole("button", { name: new RegExp(`^Keep #11 ${OHTANI}\\b.* as checklist-only$`) });
    await expect(keepOhtani).toBeVisible();
    await expect(matchCards.getByText(/Sh\\ohei/)).toHaveCount(0);
    await keepOhtani.click();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (1)" })).toBeVisible();
    // The read-back: the kept card is named as the catalogue spells the player.
    await expect(
      matchCards.getByRole("button", { name: `Edit name for checklist row #11 ${OHTANI}`, exact: true }),
    ).toBeVisible();
    await expectAccessible(page, { within: matchCards, label: "Match Cards, junk-spelled rows paired and one kept" });

    // ── CANCEL: the one keep is discarded, nothing is saved and the walk never opens ──
    await matchCards.getByRole("button", { name: "Cancel card matching", exact: true }).click();
    await page.getByRole("button", { name: "Discard 1 pairing", exact: true }).click();
    await expect(matchCards).toBeHidden();
    await expect(page.getByText("Sync cancelled — no cards saved.")).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await expect(tidyWalk(page), "a cancelled fetch opens no Tidy Up walk").toHaveCount(0);
  },
);
