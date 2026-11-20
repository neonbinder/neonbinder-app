// NEO-591 (R1): names first, numbers confirm (workspace CLAUDE.md rule 7), on a
// real set whose sources number every card differently. Onyx prints its 2026
// Vintage Base checklist with no card numbers at all (every row NNO); BSC numbers
// the same cards OV-<first two letters of each name> ("OV-ANFI" is Andrew
// Fischer). Before NEO-591 no row met a card; now every row pairs its card by
// name, at the lower confidence, and the operator is shown both numbers.
//
// The flow, as the operator lives it:
//   1. Open the set's Base (BSC only: the picker is cancelled, nothing mapped),
//      add the official checklist from Onyx's own PDF and tick its "Base Cards"
//      section (the PDF also holds Player and Dual Autographs): 56 rows.
//   2. Sync. BSC plus the checklist are two sources, so Match Cards opens. 55 of
//      the 56 cards line up by name ("Matched (55)", one of them a near name with a
//      name conflict). BSC calls Max Kilby "Dax Kilby" (#OV-MAKI): a different first
//      letter is no near name, so that card waits in "BSC only (1)" and its row in
//      "Checklist only (1)" for the operator (measured on the fake's recording).
//   3. #OV-ANFI Andrew Fischer, as every row: the chip reads "Checklist: NNO",
//      the pair shows 90% ONCE (names agree, numbers differ: the 0.9 factor),
//      "Numbers differ" beside it, the warning "Sources disagree on the number.
//      We picked one; check the card back.", and the "Number for #OV-ANFI"
//      picker offering #OV-ANFI (preselected: letters over none, bare: a
//      marketplace printed it) and "NNO · your checklist" (only the checklist
//      printed it). Axe on that state, and
//      the note and the picker are on screen when scrolled to (a 412 px phone on
//      e2e-mobile: one spec, no branch).
//   4. The operator takes NNO: it is checked, the card reads #NNO, and the group
//      keeps its name (the rule's pick names it).
//   5. Nothing is saved: Cancel asks to discard the one pairing, discarding says
//      "Sync cancelled — no cards saved.", the list is still empty, and the
//      checklist is removed.
//
// FIXTURE (SET-REGISTRY.md -> "Baseball -> 2026 -> Onyx", APPROVED by Jason 2026-11-18, NEO-591):
// Baseball > 2026 > All Brands > Onyx Vintage > Base, BSC only (SportLots is
// paused; the brand row "Onyx" is minted by the known-brands list, convex/knownBrands.ts,
// so the year-wide sync files the set under it, and the pinned All Brands view lists it
// whatever brand files it, R9). BSC's side is the fake's recording of Onyx Base. SOLE
// WRITER of the set, and it writes nothing: the Base picker is cancelled, a leaf's
// checklist lives in the page until it is used (never stored), and the fetch is
// cancelled and discarded. So it is NOT fresh-only: a re-run starts where this one did.
// Except after a red between the Sync and the Cancel: the fetch's batch stays open and the
// next run resumes it (its rows show twice, "row N of 2"), so reseed after such a red.
// The PDF is the committed one set-checklist-pdf-onyx-2026 reads on its hand-made set
// (its 56 Base rows are pinned by lib/checklists/checklist-onyx-pdf.test.ts).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  matchCardsDialog,
  previewRowCount,
  publishersChecklistButton,
  publishersChecklistChip,
  publishersChecklistDialog,
} from "../../support/published-checklist";
import { setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { openOneMarketplaceSetBase } from "../../support/wizard";

/** The set's NB name, as the Sets column lists it under All Brands. */
const SET = "Onyx Vintage";
const PDF = new URL("../../fixtures/checklists/2026-onyx-vintage-baseball.pdf", import.meta.url).pathname;
/** The PDF's section that is this leaf, and its rows (every one NNO). */
const SECTION = "Base Cards";
const BASE_ROWS = 56;
/** The card under the lens: BSC's number, the player both sides name. */
const CARD = { number: "OV-ANFI", player: "Andrew Fischer" } as const;
const SCOPE = `#${CARD.number}`;
/** The one card the sources name differently enough that no rule pairs it (measured on the fake's recording). */
const KILBY = { number: "OV-MAKI", bsc: "Dax Kilby", checklist: "Max Kilby" } as const;
/** Names agree, numbers differ: NUMBERS_DIFFER_FACTOR (lib/cards/pair-names-first.ts), as Match Cards prints it. */
const NUMBERS_DIFFER = "90%";
/** Match Cards' subtitle when every source lines up (NEO-496): NOT this set's, one card is left over. */
const CHECKLIST_ALL_LINED_UP = "Every card lines up across your sources. Review and confirm — no cards are saved until you do.";

test(
  "Checklist — Onyx's NNO checklist pairs every BSC card by name, shows the lowered confidence once, and lets the operator pick the number (NEO-591)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── 1. The set's Base, BSC only, and Onyx's own checklist ──
    await openOneMarketplaceSetBase(page, env, { set: SET, sport: "Baseball", year: "2026" });
    // R2 precondition: nothing fetched. This spec never saves, so a re-run meets the same state.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await publishersChecklistButton(page).click();
    const upload = publishersChecklistDialog(page);
    await expect(upload).toBeVisible();
    await upload.getByLabel("Choose a file").setInputFiles(PDF);
    // The PDF holds three sections; none is ticked until the operator says which is this leaf.
    const sections = upload.getByRole("group", { name: "Which of these belong to this set?" });
    await expect(sections).toBeVisible();
    await sections.getByRole("checkbox", { name: SECTION, exact: true }).check();
    await expect(previewRowCount(upload, BASE_ROWS)).toBeVisible();
    await upload.getByRole("button", { name: "Use this checklist" }).click();
    await expect(upload).toBeHidden();
    const chip = publishersChecklistChip(page, BASE_ROWS);
    await expect(chip).toBeVisible();

    // ── 2. Sync: the cards line up by name, but for one ──
    await syncChecklistButton(page).click();
    const matchCards = matchCardsDialog(page);
    // One BSC round trip: our 7 s plus the seconds the screen says it is waiting on BSC.
    await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: "Match Cards after the Onyx fetch" });
    await expectAfterMarketplace(page, matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }), {
      platform: "BuySportsCards",
      what: "Confirm unlocked after the Onyx fetch",
    });
    // Measured on the fake's recording of Onyx Base (56 BSC cards, 56 Base rows): 55 pair by name.
    // BSC lists Max Kilby as "Dax Kilby" (#OV-MAKI); a different first letter scores far below the
    // near-name bar (PLAYER_NAME_AUTO_LINK), so that one card and its row wait for the operator, one
    // in each column, and no number is used to force them together (rule 7: names first).
    await expect(matchCards.getByText(CHECKLIST_ALL_LINED_UP)).toHaveCount(0);
    await expect(matchCards.getByRole("heading", { name: "BSC only (1)", exact: true })).toBeVisible();
    await expect(matchCards.getByRole("radio", { name: `Select BSC card #${KILBY.number} ${KILBY.bsc}`, exact: true })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (1)", exact: true })).toBeVisible();
    await expect(matchCards.getByRole("radio", { name: new RegExp(`^Select NNO ${KILBY.checklist} · `) })).toHaveCount(1);
    // One more pair is matched by a near name whose spellings differ: the toggle says so.
    const matchedToggle = matchCards.getByRole("button", { name: `Expand matched cards, 1 with a name conflict`, exact: true });
    await expect(matchedToggle).toContainText(`Matched (${BASE_ROWS - 1})`);
    await matchedToggle.click();
    await expect(matchCards.getByRole("button", { name: "Collapse matched cards, 1 with a name conflict", exact: true })).toBeVisible();
    await expect(matchCards.getByRole("group", { name: /^Name conflict on / })).toHaveCount(1);

    // ── 3. #OV-ANFI: paired by name, numbers differ ──
    const fischer = matchCards
      .getByRole("listitem")
      .filter({ has: page.getByRole("group", { name: `Number conflict on ${SCOPE}`, exact: true }) });
    await expect(fischer.getByRole("button", { name: `Edit name for ${SCOPE} ${CARD.player}`, exact: true })).toBeVisible();
    await expect(fischer.getByText("Checklist: NNO", { exact: true })).toBeVisible();
    // The % is shown once: printed on the row, kept in the chip for a screen reader only.
    await expect(fischer.getByText(NUMBERS_DIFFER, { exact: true })).toHaveCount(1);
    await expect(fischer.getByText(`Name match ${NUMBERS_DIFFER}`, { exact: true })).toHaveCount(1);
    const note = fischer.getByText("Numbers differ", { exact: true });
    await expect(note).toBeVisible();
    await expect(
      fischer.getByText(/^⚠ Sources disagree on the number\. We picked one; check the card back\.$/), // the ⚠ is aria-hidden, still in the text
    ).toBeVisible();
    const numberFor = fischer.getByRole("radiogroup", { name: `Number for ${SCOPE}`, exact: true });
    const bscNumber = numberFor.getByRole("radio", { name: `${SCOPE} — use this number for ${SCOPE}`, exact: true });
    // The checklist's option says whose it is; BSC's stays bare.
    const noNumber = numberFor.getByRole("radio", { name: `NNO · your checklist — use this number for ${SCOPE}`, exact: true });
    await expect(numberFor.getByRole("radio")).toHaveCount(2);
    await expect(bscNumber).toBeChecked();
    await expect(noNumber).not.toBeChecked();
    // The names agree ("Andrew Fischer" on both), so the number is the only choice on the row: no name
    // picker (R2: rides on the positives above).
    await expect(fischer.getByRole("group", { name: `Name conflict on ${SCOPE}`, exact: true })).toHaveCount(0);
    // Reachable on a phone (e2e-mobile, 412 px) as on a desk: the note and both choices come on screen.
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
    await noNumber.scrollIntoViewIfNeeded();
    await expect(noNumber).toBeInViewport();
    await expect(bscNumber).toBeInViewport();
    await expectAccessible(page, { within: matchCards, label: "Match Cards, Onyx Base paired by name with a number picker" });

    // ── 4. The operator takes the checklist's NNO ──
    await noNumber.click();
    await expect(noNumber).toBeChecked();
    await expect(bscNumber).not.toBeChecked();
    await expect(fischer.getByRole("button", { name: `Edit name for #NNO ${CARD.player}`, exact: true })).toBeVisible();
    await expect(fischer.getByRole("radiogroup", { name: `Number for ${SCOPE}`, exact: true })).toBeVisible();

    // ── 5. Nothing is saved ──
    await matchCards.getByRole("button", { name: "Cancel card matching" }).click();
    await page.getByRole("button", { name: "Discard 1 pairing", exact: true }).click();
    await expect(matchCards).toBeHidden();
    await expect(page.getByText("Sync cancelled — no cards saved.")).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await page.getByRole("button", { name: "Remove the official checklist" }).click();
    await expect(chip).toBeHidden();
    await expect(publishersChecklistButton(page)).toBeVisible();
  },
);
