// NEO-490 (R1), NEO-591 (names first): a publisher's checklist whose card
// numbers match NONE of the marketplace's still reaches its cards, by player
// name (workspace CLAUDE.md rule 7: names first, numbers confirm). Panini numbers its
// 2026 Donruss "Retro 1997 Donruss Signature Series Autographs" 1-17 and BSC
// numbers the same 14 cards SIG-AM..SIG-RL, so no number meets another. The
// publisher's checklist is Panini's own (fixtures/checklists, SET-REGISTRY.md):
// BSC names a team on none of these cards, so every team on screen comes from
// the checklist.
//
// BSC and an uploaded checklist are two sources (NEO-496, D10/NQ1), so every fetch
// below opens Match Cards with Keep controls, as two marketplaces always did: a
// card or row left in a column is discarded unless kept. NEO-645: Match Cards'
// Confirm SAVES the cards, and the per-card Tidy Up walk opens afterwards on the
// cards that need a person. Three parts, in the order the operator would meet them:
//   PHASE A, 13 rows against 14 cards (Mike Lowell's row is left out). The
//     fetch pairs the 13 names and applies their teams ("Teams from your
//     checklist: 13 of 14 cards" while the dialog is open); Mike Lowell's card
//     has no row and is "BSC only (1)". Every pair's numbers differ (Panini's
//     digits, BSC's SIG-xx letters), so Frank Thomas's row shows the lowered
//     90% once, the "Numbers differ" note, and the "Number for #SIG-FT" picker
//     with BSC's letters preselected (letters over digits). One pair
//     is unlinked by the Unlink inside its "Checklist #n" chip (the row returns
//     to "Checklist only", the card waits on the keep shelf) and linked again by
//     the buttons, which moves the pair back into Matched (NEO-591); Lowell is
//     kept. Nothing is saved: Cancel, Discard ("Sync cancelled — no cards saved.").
//   PHASE A2, one name is misspelled (14 rows, row 11 reads "Rhett Lowdr").
//     The fetch pairs all 14, Lowder by a near name: its chip reads the names'
//     score lowered by the numbers-differ factor (0.9), computed by the
//     product's own pairing core, not typed here; every source lines up and
//     "Teams from your checklist: 14 of 14 cards" shows. The two spellings are one
//     name picker on the row ("Name for #SIG-RL": BSC's preselected, the checklist's "· your
//     checklist"), counted on the Matched toggle; a name over 120 is refused where it is
//     typed. The operator unlinks that pair and makes it again by the buttons (one Matched
//     row again, no %, the same picker), and Confirms with the picker untouched: the 14
//     cards are SAVED, with the checklist's teams.
//   THE WALK (NEO-645), on the saved cards. "Numbers didn't match: BSC SIG-xx,
//     Checklist n" is a purple NOTE on the Listing title tile of every card it shows,
//     never a stop: a card left with nothing to fix saves with Save & next while the
//     note is up. A preselect is no answer, so #SIG-RL carries the two spellings as a
//     "Sources disagree" item; "Rhett Lowder" is already an NB player and "Rhett Lowdr"
//     is not, so NB went with Lowder (blue "To check", "Went with “Rhett Lowder”,
//     they're already in your binder.", the checklist's spelling a press away).
//     Panini writes "Oakland A's" for Jacob Wilson; NB holds no club of that name (the
//     checklist's claim is never rewritten, rule 8), so #SIG-JW's Team tile is pink,
//     and the operator links it to the club the checklist means, Oakland Athletics
//     (1968-2024), with the remember-box OFF so no alias is saved. No other card's
//     Team tile is pink: every name pair brought its team. Frank Thomas is two players
//     on file; the Hall of Famer is linked for you, said in a purple note when his
//     card is on the walk. The save reads back: numbers stay SIG-xx, #SIG-BW is
//     Kansas City Royals, #SIG-JW is Oakland Athletics.
//   PHASE C (NEO-496 plan decision 4), the SET's own checklist in Panini's
//     spreadsheet layout (an xlsx with the credit line above the header, built
//     in memory): Map Base Set links Base and Base Rated Prospects; Parallels'
//     first visit rides "Base Red" and "Base Rated Prospects Red" on BSC's bare
//     "Red"; Sync Inserts pairs "Donruss Ballpark Stars Signatures" with BSC's
//     "Donruss Ballparks Stars Signatures" (near name); Unleashed's fetch leaves
//     BSC's two football cards (SG-CO, SG-TB) unkept, keeps the file's two
//     checklist-only rows with Keep all, and commits the file's 22 (its walk is
//     left with Save for later, writing nothing);
//     the same checklist as a CSV replaces it with Unleashed's 20 cards unchanged;
//     Remove.
//
// FIXTURE (SET-REGISTRY.md -> "Baseball -> 2026 -> Donruss"): Baseball > 2026 >
// All Brands > Donruss (filed under the year's Donruss brand: since NEO-527 the
// known-brands list mints it; it sat under Unknown before) > Insert > Retro 1997
// Donruss Signature Series Autographs, BSC only (SportLots is paused), and, in
// PHASE C, the set's Base, Parallel and Insert types (approved by Jason
// 2026-11-11, Q8/N4). SOLE WRITER of the set; FRESH-ONLY (it commits in PHASE A2
// and C), so a re-run fails at "No cards in this checklist yet." by name:
// re-seed first. In PHASES A-A2 every player and
// club but Oakland A's is on the catalogue, so no player is minted; the walk writes only the
// club link, an autograph format where a card asks for one, and "seen" marks (Save & next).
// PHASE C leaves Unleashed's walk with Save for later, so it mints nothing either.
//
// Not a hand-rolled drill by choice (R9): the helpers drill a Base or a brand's
// set; this set is an INSERT reached through the pinned All Brands view like the
// other one-marketplace real sets, which lists it whatever brand files it.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import type { Locator, Page } from "@playwright/test";
import { expectAfterMarketplace, expectStepWithSportLots } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  checklistFacts,
  checklistRows,
  type ChecklistRow,
  nearNamePair,
  publishersChecklistButton,
  publishersChecklistChip,
  removeSetChecklistUnderAllBrands,
  usePublishersChecklist,
} from "../../support/published-checklist";
import {
  columnHeading,
  columnOption,
  columnSearch,
  drillToColdManufacturer,
  columnSelection,
  INSERT_FETCH,
  openAttributesPanel,
  setBuilderReady,
  syncChecklistButton,
  VARIANT_TYPES_SYNC,
} from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { buildDonrussCsv, buildDonrussXlsx } from "../../fixtures/checklists/build-fixtures.mjs";
import {
  answerPinkAutographTile,
  expectCardSettled,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  skipCard,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const INSERT = "Retro 1997 Donruss Signature Series Autographs";
const SET = "Donruss";
const UNLEASHED = "Unleashed";
/** Panini's name for the insert BSC lists as "Donruss Ballparks Stars Signatures" (the near miss). */
const BALLPARK = "Donruss Ballpark Stars Signatures";
const BALLPARK_BSC = "Donruss Ballparks Stars Signatures";
/**
 * PHASE C's whole-set checklist, in Panini's spreadsheet layout (fixtures/checklists/build-fixtures.mjs),
 * cut down from Panini's published 2026 Donruss sheet to the sections this spec reads: the Base and
 * its Rated Prospects (both the base, Map Base Set), their Red runs (BSC's one bare "Red" parallel),
 * Ballpark Stars Signatures (the near-miss insert) and Unleashed's 20 cards plus two rows BSC does not
 * list (21, 22); BSC lists 22, two of them (SG-CO, SG-TB) football cards the file does not.
 */
const DONRUSS = {
  credit: "Spreadsheet made available by Panini America.",
  sections: [
    {
      name: "Base",
      rows: [
        { number: "1", player: "Ken Griffey Jr.", team: "Seattle Mariners" },
        { number: "2", player: "Johnny Bench", team: "Cincinnati Reds" },
        { number: "3", player: "Chase DeLauter", team: "Cleveland Guardians" },
      ],
    },
    {
      name: "Base Rated Prospects",
      rows: [
        { number: "101", player: "Konnor Griffin", team: "Pittsburgh Pirates" },
        { number: "102", player: "Andrew Fischer", team: "Milwaukee Brewers" },
        { number: "103", player: "Mike Sirota", team: "Los Angeles Dodgers" },
      ],
    },
    {
      name: "Base Red",
      rows: [
        { number: "1", player: "Ken Griffey Jr.", team: "Seattle Mariners", seq: "250" },
        { number: "2", player: "Johnny Bench", team: "Cincinnati Reds", seq: "250" },
        { number: "3", player: "Chase DeLauter", team: "Cleveland Guardians", seq: "250" },
      ],
    },
    {
      name: "Base Rated Prospects Red",
      rows: [
        { number: "101", player: "Konnor Griffin", team: "Pittsburgh Pirates", seq: "250" },
        { number: "102", player: "Andrew Fischer", team: "Milwaukee Brewers", seq: "250" },
        { number: "103", player: "Mike Sirota", team: "Los Angeles Dodgers", seq: "250" },
      ],
    },
    {
      name: BALLPARK,
      rows: [
        { number: "1", player: "Paige Bueckers", team: "Texas Rangers" },
        { number: "2", player: "VJ Edgecombe", team: "Philadelphia Phillies" },
        { number: "3", player: "Angel Reese", team: "Chicago Cubs" },
        { number: "4", player: "Caitlin Clark", team: "Chicago Cubs" },
        { number: "5", player: "Azzi Fudd", team: "Washington Nationals" },
      ],
    },
    {
      name: UNLEASHED,
      rows: [
        { number: "1", player: "Bobby Witt Jr.", team: "Kansas City Royals" },
        { number: "2", player: "Andrew Painter", team: "Philadelphia Phillies" },
        { number: "3", player: "Bubba Chandler", team: "Pittsburgh Pirates" },
        { number: "4", player: "Dylan Crews", team: "Washington Nationals" },
        { number: "5", player: "Eli Willits", team: "Washington Nationals" },
        { number: "6", player: "Luke Keaschall", team: "Minnesota Twins" },
        { number: "7", player: "Spencer Jones", team: "New York Yankees" },
        { number: "8", player: "Bryce Eldridge", team: "San Francisco Giants" },
        { number: "9", player: "Aaron Judge", team: "New York Yankees" },
        { number: "10", player: "Travis Bazzana", team: "Cleveland Guardians" },
        { number: "11", player: "Jacob Misiorowski", team: "Milwaukee Brewers" },
        { number: "12", player: "Jacob Wilson", team: "Oakland A's" },
        { number: "13", player: "Charlie Condon", team: "Colorado Rockies" },
        { number: "14", player: "Paul Skenes", team: "Pittsburgh Pirates" },
        { number: "15", player: "Jackson Chourio", team: "Milwaukee Brewers" },
        { number: "16", player: "Colt Emerson", team: "Seattle Mariners" },
        { number: "17", player: "Trey Yesavage", team: "Toronto Blue Jays" },
        { number: "18", player: "Chase DeLauter", team: "Cleveland Guardians" },
        { number: "19", player: "Matt Shaw", team: "Chicago Cubs" },
        { number: "20", player: "Nick Kurtz", team: "Oakland A's" },
        // Two rows BSC does not list: checklist-only cards, kept with "Keep all" (C4).
        { number: "21", player: "Roman Anthony", team: "Boston Red Sox" },
        { number: "22", player: "Kristian Campbell", team: "Boston Red Sox" },
      ],
    },
  ],
};
const DONRUSS_CARDS = DONRUSS.sections.reduce((n, s) => n + s.rows.length, 0);
/** Unleashed's rows in the file: the cards its fetch saves (its two checklist-only rows kept with Keep all,
 * BSC's two football cards left unkept). */
const UNLEASHED_ROWS = DONRUSS.sections.find((s) => s.name === UNLEASHED)?.rows.length ?? 0;
/** Match Cards' subtitle when a column holds anything (NEO-496). */
const CHECKLIST_SOURCES_SUBTITLE =
  "No cards save until you confirm. Anything left below gets tossed. Keep it to save it.";
/** Match Cards' subtitle when every source lines up (NEO-496). */
const CHECKLIST_ALL_LINED_UP = "Every card lines up across your sources. Review and confirm — no cards are saved until you do.";
const CLUB = "Oakland A's";
/**
 * BSC's number for one of Panini's rows: "SIG-" and the initials of the player's first two names
 * (Frank Thomas is SIG-FT, Bobby Witt Jr. SIG-BW), the 14 numbers BSC lists for this insert.
 */
const bscNumber = (row: ChecklistRow) =>
  `SIG-${row.player.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()}`;
/** The files matched against BSC's 14 cards by the product's own matcher (support/published-checklist.ts). */
const AGAINST_BSC = { cardsOf: CHECKLISTS.signatureSeries2026, cardNumber: bscNumber };
const WITHOUT_LOWELL = checklistFacts(CHECKLISTS.signatureSeries2026WithoutLowell, AGAINST_BSC);
const WHOLE = checklistFacts(CHECKLISTS.signatureSeries2026, AGAINST_BSC);
const MIXED = checklistFacts(CHECKLISTS.signatureSeries2026MisspelledLowder, AGAINST_BSC);
/** "Rhett Lowdr" (#11) against BSC's #SIG-RL Rhett Lowder, as the pairing core scores them: a near name, numbers differ. */
const LOWDER = nearNamePair({ number: "SIG-RL", player: "Rhett Lowder" }, { number: "11", player: "Rhett Lowdr" });
/** The % Match Cards prints for a pair (CardPairingModal: `Math.round(confidence * 100)`). */
const percent = (confidence: number) => `${Math.round(confidence * 100)}%`;
/**
 * NEO-591: Lowder's Matched row offers ONE name picker for the two spellings: BSC's "Rhett Lowder"
 * bare and preselected, the checklist's "Rhett Lowdr" marked "· your checklist". Untouched.
 */
async function expectLowderNames(lowder: Locator): Promise<void> {
  const group = lowder.getByRole("group", { name: "Name conflict on #SIG-RL", exact: true });
  await expect(
    group.getByText(/^⚠ Potential names for this card — pick the right one before it is listed\.$/),
  ).toBeVisible();
  const names = group.getByRole("radiogroup", { name: "Name for #SIG-RL", exact: true });
  await expect(names.getByRole("radio")).toHaveCount(2);
  await expect(names.getByRole("radio", { name: "Rhett Lowder — use this name for #SIG-RL", exact: true })).toBeChecked();
  await expect(
    names.getByRole("radio", { name: "Rhett Lowdr · your checklist — use this name for #SIG-RL", exact: true }),
  ).not.toBeChecked();
}

/** One character past the 120 a card or player name may carry (`MAX_PLAYER_NAME_LENGTH`). */
const OVER_LONG_NAME = `Rhett ${"Lowder".repeat(20)}x`.slice(0, 121);

test(
  "Published checklist — rows whose numbers match no card pair to the cards by player name, and the card's own player settles the club",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const matchCards = page.getByRole("dialog", { name: /^Match Cards/ });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── DRILL: the insert, through All Brands ──
    // The year, the Sets and the Variant Types are warm or sync from BSC on first use; the helper pays
    // those waits. Under paused SportLots the Insert column fills straight from BSC (no reconcile).
    await openDonrussSet(page, env);
    await expectStepWithSportLots(page, columnOption(page, "Variant Types", "Insert"), env, {
      liveMs: VARIANT_TYPES_SYNC,
      what: "Variant Types row Insert",
    });
    await columnOption(page, "Variant Types", "Insert").click();
    await expectStepWithSportLots(page, columnHeading(page, "Inserts"), env, {
      liveMs: INSERT_FETCH,
      what: "the Inserts column opening",
    });
    await columnSearch(page, "Inserts").fill("Retro 1997");
    await columnOption(page, "Inserts", INSERT).click();
    // R2 precondition: nothing is fetched yet (a re-run fails here, by name: re-seed first).
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ══ PHASE A: 13 rows against 14 cards ══
    // The file's own arithmetic, from the product's matcher, not typed here: every row pairs its card
    // by name and answers its team; Lowell's card has no row.
    expect(WITHOUT_LOWELL.paired).toBe(WITHOUT_LOWELL.rows);
    expect(WITHOUT_LOWELL.matched).toBe(WITHOUT_LOWELL.rows);
    expect(WITHOUT_LOWELL.cards).toBe(WITHOUT_LOWELL.rows + 1);
    await usePublishersChecklist(page, CHECKLISTS.signatureSeries2026WithoutLowell);
    await syncChecklistButton(page).click();

    // NEO-496 (D10, NQ1): BSC and the checklist are two sources, so Match Cards opens with Keep
    // controls like two marketplaces (before NEO-496 a one-marketplace dialog was "solo": no Keep,
    // every card saved). One live BSC round trip (measured 2026-11-11: about 1.3 s press to dialog):
    // our 7 s plus the seconds the screen says it is waiting on BSC.
    await expectAfterMarketplace(page, matchCards, {
      platform: "BuySportsCards",
      what: "Match Cards after the fetch of the Signature Series insert",
    });
    await expect(matchCards.getByText(CHECKLIST_SOURCES_SUBTITLE)).toBeVisible();
    // Confirm is usable once the batch has streamed in whole and the teams have landed.
    await expect(matchCards.getByRole("button", { name: "Confirm card matches", disabled: false })).toBeVisible();
    // The 13 name pairs come pre-linked; Mike Lowell's card has no row, so it is BSC's alone and is
    // discarded unless kept; no row is left over.
    const lowellKeep = matchCards.getByRole("button", { name: "Keep #SIG-ML Mike Lowell as BSC-only" });
    await expect(matchCards.getByRole("heading", { name: "BSC only (1)" })).toBeVisible();
    await expect(lowellKeep).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (0)" })).toBeVisible();
    // The pairs were applied: their teams are the checklist's, said while the dialog is open.
    await expect(
      page.getByText(new RegExp(`Teams from your checklist: ${WITHOUT_LOWELL.matched} of ${WITHOUT_LOWELL.cards} cards`)).first(),
    ).toBeVisible();
    // The 13 name pairs sit in the collapsed Matched list, each with its "Checklist #n" chip. Every
    // pair names its player as BSC does, so the toggle counts no name conflict (NEO-591).
    await matchCards.getByRole("button", { name: "Expand matched cards", exact: true }).click();
    await expect(matchCards.getByText(`Matched (${WITHOUT_LOWELL.paired})`)).toBeVisible();
    // NEO-591: Frank Thomas paired by name while the numbers differ (#1 against #SIG-FT): matched at
    // the lowered confidence, shown ONCE (the chip keeps it for a screen reader only), with the
    // state-only note and the picker offering both numbers, BSC's letters preselected.
    const thomas = matchCards
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: "Edit name for #SIG-FT Frank Thomas", exact: true }) });
    await expect(thomas.getByText("90%", { exact: true })).toHaveCount(1);
    await expect(thomas.getByText("Name match 90%", { exact: true })).toHaveCount(1);
    await expect(thomas.getByText("Numbers differ", { exact: true })).toBeVisible();
    await expect(thomas.getByRole("group", { name: "Number conflict on #SIG-FT", exact: true })).toBeVisible();
    await expect(
      thomas.getByText(/^⚠ Sources disagree on the number\. We picked one; check the card back\.$/), // the ⚠ is aria-hidden, still in the text
    ).toBeVisible();
    const thomasNumber = thomas.getByRole("radiogroup", { name: "Number for #SIG-FT", exact: true });
    await expect(thomasNumber.getByRole("radio")).toHaveCount(2);
    await expect(thomasNumber.getByRole("radio", { name: "#SIG-FT — use this number for #SIG-FT", exact: true })).toBeChecked();
    // Panini's #1 is the checklist's alone, so its option says so; BSC's stays bare.
    await expect(
      thomasNumber.getByRole("radio", { name: "#1 · your checklist — use this number for #SIG-FT", exact: true }),
    ).not.toBeChecked();
    const thomasUnlink = matchCards.getByRole("button", { name: /^Unlink card #SIG-FT Frank Thomas from checklist row / });
    await expect(thomasUnlink).toBeVisible();
    // The Unlink sits inside the chip; on a phone (e2e-mobile, 412 px) it must still be reachable on screen.
    await thomasUnlink.scrollIntoViewIfNeeded();
    await expect(thomasUnlink).toBeInViewport();
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog, checklist name pairs linked" });

    // Unlink one pair: its row returns to "Checklist only" and the card, BSC's alone now, waits on the
    // keep shelf; the row is linked to it again by buttons, and the pair moves back into Matched
    // (NEO-591: a hand link sits in Matched like the server's pair, never on the shelf).
    await thomasUnlink.click();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (1)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (1)" })).toBeVisible();
    await expect(matchCards.getByText(`Matched (${WITHOUT_LOWELL.paired - 1})`)).toBeVisible();
    const pickRow = matchCards.getByRole("radio", { name: /^Select #1 Frank Thomas/ });
    await expect(pickRow).toHaveAttribute("aria-checked", "false");
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog, one checklist row unlinked" });
    await pickRow.click();
    await expect(pickRow).toHaveAttribute("aria-checked", "true");
    await matchCards.getByRole("button", { name: "Link selected checklist row to #SIG-FT Frank Thomas" }).click();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (0)" })).toBeVisible();
    await expect(matchCards.getByText(`Matched (${WITHOUT_LOWELL.paired})`)).toBeVisible();
    await expect(matchCards.getByRole("button", { name: /^Unlink card #SIG-FT Frank Thomas from checklist row / })).toBeVisible();
    // Keep Mike Lowell's card: the keep shelf holds it.
    await lowellKeep.click();
    await expect(matchCards.getByRole("heading", { name: "BSC only (0)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (1)" })).toBeVisible();

    // NEO-645: Confirm would SAVE these cards now, so PHASE A leaves without saving: Cancel asks
    // to throw the links and the keep away (NEO-220), and Discard writes nothing.
    await matchCards.getByRole("button", { name: "Cancel card matching", exact: true }).click();
    const discard = page.getByRole("button", { name: /^Discard [0-9]+ pairings?$/ });
    await expect(discard).toBeVisible();
    await discard.click();
    await expect(matchCards).toBeHidden();
    await expect(page.getByText("Sync cancelled — no cards saved.")).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ══ PHASE A2: 14 rows, one misspelled, against 14 cards ══
    // The fetch pairs 13 names exactly and "Rhett Lowdr" to Rhett Lowder's card by a near name
    // (NEO-496), all 14 applied; the near pair's % is the names' score times the numbers-differ
    // factor, as the product's pairing core computes it (`nearNamePair` throws if it is not a near pair).
    expect(MIXED.paired).toBe(MIXED.cards);
    expect(MIXED.matched).toBe(MIXED.cards);
    expect(LOWDER.numbersAgree).toBe(false);
    await page.getByRole("button", { name: "Remove the official checklist" }).click();
    await expect(publishersChecklistChip(page, WITHOUT_LOWELL.rows)).toBeHidden();
    await expect(publishersChecklistButton(page)).toBeVisible();
    await usePublishersChecklist(page, CHECKLISTS.signatureSeries2026MisspelledLowder);
    await syncChecklistButton(page).click();
    await expectAfterMarketplace(page, matchCards, {
      platform: "BuySportsCards",
      what: "Match Cards after the fetch of the misspelled Signature Series checklist",
    });
    await expect(matchCards.getByRole("button", { name: "Confirm card matches", disabled: false })).toBeVisible();
    await expect(matchCards.getByText(CHECKLIST_ALL_LINED_UP)).toBeVisible();
    await expect(matchCards.getByText(`Matched (${MIXED.cards})`)).toBeVisible();
    // Every row paired (the near name too), so every card took its team from the file.
    await expect(page.getByText(new RegExp(`Teams from your checklist: ${MIXED.matched} of ${MIXED.cards} cards`)).first()).toBeVisible();
    // Nothing is left in a column, so Matched opens expanded; its toggle counts the one name
    // difference (NEO-591: a marketplace-against-checklist spelling is a name conflict like any other).
    await expect(
      matchCards.getByRole("button", { name: "Collapse matched cards, 1 with a name conflict", exact: true }),
    ).toBeVisible();
    const lowder = matchCards.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Edit name for #SIG-RL Rhett Lowder" }) });
    await expect(lowder.getByText("Checklist: #11", { exact: true })).toBeVisible();
    // One %, read out once: the row prints it, the chip keeps the words for a screen reader.
    await expect(lowder.getByText(percent(LOWDER.confidence), { exact: true })).toHaveCount(1);
    await expect(lowder.getByText(`Name match ${percent(LOWDER.confidence)}`, { exact: true })).toHaveCount(1);
    await expect(lowder.getByText("Numbers differ", { exact: true })).toBeVisible();
    // NEO-591: the two spellings are ONE name picker: BSC's bare and preselected, the checklist's
    // marked as the operator's own.
    await expectLowderNames(lowder);
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog, a near-name pair" });

    // NEO-606: a card name past 120 characters is refused where it was typed. The editor stays
    // open with the text, the field is invalid, and the refusal is an alert on its own field
    // well (the error pink misses 4.5:1 on the row's tile); axe reads it in both modes while it
    // shows. Escape abandons the edit, the dialog stays, and the card keeps its name.
    await lowder.getByRole("button", { name: "Edit name for #SIG-RL Rhett Lowder" }).click();
    const lowderName = matchCards.getByRole("textbox", { name: "Edit name for #SIG-RL", exact: true });
    await lowderName.fill(OVER_LONG_NAME);
    await lowderName.press("Enter");
    const nameRefusal = matchCards.getByRole("alert").filter({ hasText: "Card names are limited to" });
    await expect(nameRefusal).toHaveText("Card names are limited to 120 characters — shorten it to save.");
    await expect(lowderName).toHaveValue(OVER_LONG_NAME);
    await expect(lowderName).toHaveAttribute("aria-invalid", "true");
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog, a card name over 120 refused" });
    await lowderName.press("Escape");
    await expect(lowderName).toBeHidden();
    await expect(nameRefusal).toHaveCount(0);
    await expect(matchCards.getByRole("button", { name: "Edit name for #SIG-RL Rhett Lowder" })).toBeVisible();

    // The operator undoes the near pair and makes it again with the buttons: the card goes to the keep
    // shelf, the row to "Checklist only"; linked again, both leave their lists for one Matched row
    // (NEO-591), which carries the chip's Unlink and no % (a hand link is not scored).
    await lowder.getByRole("button", { name: /^Unlink card #SIG-RL Rhett Lowder from checklist row / }).click();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (1)" })).toBeVisible();
    const leftoverRows = matchCards.getByRole("list", { name: "Leftover checklist rows" }).getByRole("listitem");
    await expect(leftoverRows).toHaveCount(1);
    await expect(leftoverRows).toContainText("#11 Rhett Lowdr");
    await matchCards.getByRole("radio", { name: /^Select #11 Rhett Lowdr/ }).click();
    await matchCards.getByRole("button", { name: /^Link selected checklist row to #SIG-RL/ }).click();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
    await expect(leftoverRows).toHaveCount(0);
    await expect(matchCards.getByText(`Matched (${MIXED.cards})`)).toBeVisible();
    await expect(lowder.getByRole("button", { name: /^Unlink card #SIG-RL Rhett Lowder from checklist row #11 Rhett Lowdr\b/ })).toBeVisible();
    await expect(lowder.getByText(/%$/)).toHaveCount(0);
    // The hand link offers the same picker, BSC's spelling preselected again.
    await expectLowderNames(lowder);
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog, every card lined up" });

    // NEO-645: Confirm SAVES the 14 cards (the picker untouched), with the file's teams said on the
    // line they land with; the walk then opens on the cards that need a person.
    await matchCards.getByRole("button", { name: "Confirm card matches" }).click();
    await expect(matchCards).toBeHidden();
    const saved = page
      .getByText(new RegExp(`Saved ${MIXED.cards} cards\\. .*Teams from your checklist: ${MIXED.matched} of ${MIXED.cards} cards`))
      .first();
    expect(await settleWalkAfterCommit(page, saved), "Oakland A's is no club on file, so the walk opens").toBe(true);

    // ══ THE WALK: the numbers are a note, the club is linked, the spelling NB chose is shown ══
    const walk = tidyWalk(page);
    // The file's number for each card, by the card's BSC number (Rhett Lowdr's row is #11 too).
    const fileNumber = new Map(checklistRows(CHECKLISTS.signatureSeries2026MisspelledLowder).map((r) => [bscNumber(r), r.number]));
    const seen: string[] = [];
    let savedWithTheNote = 0;
    // The walk's order is (ready, number), not fixed: visit every card it shows, bounded by the set's size.
    for (let i = 0; i <= MIXED.cards; i++) {
      const done = tidyFooterButton(page, "done");
      await expect(tidyTile(page, "More about this card").or(done).first()).toBeVisible();
      if (await done.isVisible()) break;
      await expectCardSettled(page);
      const identity = await tidyCardIdentity(page).allTextContents();
      const number = /^#(\S+)/.exec(identity[0] ?? "")?.[1] ?? "";
      expect(fileNumber.has(number), `the open card is one of the 14 (${identity.join(" | ")})`).toBe(true);
      seen.push(number);

      // Rule 7: names paired these cards while the numbers differ. The walk says so as a purple note
      // on the Listing title tile, each source's number by its label; the card keeps BSC's letters.
      const numbersNote = tidyTile(page, "Listing title").getByRole("note").filter({ hasText: /^Numbers didn't match: / });
      await expect(numbersNote).toHaveText(`Numbers didn't match: BSC ${number}, Checklist ${fileNumber.get(number)}`);
      if (seen.length === 1) await expectAccessible(page, { within: walk, label: "Tidy Up walk, a card with a numbers-didn't-match note" });

      const disagree = tidyTile(page, "Sources disagree");
      if (number === "SIG-RL") {
        // The untouched picker is no answer: both spellings ride on the card. NB knows Rhett Lowder
        // and not "Rhett Lowdr", so it went with Lowder and asks only for a check (blue, not pink).
        await expect(disagree).toHaveAccessibleDescription(/To check/);
        const says = disagree.getByRole("list", { name: "What each source says: Player name", exact: true });
        await expect(says.getByRole("listitem")).toHaveCount(2);
        await expect(says.getByRole("listitem").filter({ hasText: /^BSC/ })).toContainText("Rhett Lowder");
        await expect(says.getByRole("listitem").filter({ hasText: /^Checklist/ })).toContainText("Rhett Lowdr");
        await expect(disagree.getByRole("status")).toHaveText("Went with “Rhett Lowder”, they're already in your binder.");
        // The checklist's spelling is one press away (the button is named by its visible text).
        await expect(disagree.getByRole("button", { name: "Use “Rhett Lowdr” instead", exact: true })).toBeVisible();
        await expect(pinkTile(page, "Sources disagree")).toHaveCount(0);
        await expectAccessible(page, { within: walk, label: "Tidy Up walk, NB's pick between two spellings" });
      } else {
        // Every other card's names agree across the sources.
        await expect(disagree).toHaveCount(0);
      }

      if (number === "SIG-JW") {
        await linkClubOnTheWalk(page);
      } else {
        // Every name pair brought its team from the file: no other Team tile asks.
        await expect(pinkTile(page, "Team")).toHaveCount(0);
      }

      if (number === "SIG-FT") {
        // Two Frank Thomases on file: the Hall of Famer was linked without asking, and the tile says why.
        await expect(tidyTile(page, "Player").getByRole("note").filter({ hasText: /^Linked for you/ })).toHaveText(
          "Linked for you: none of the others on file played that year, but this one is in the Hall of Fame",
        );
      }

      // An autograph insert: a card that asks how it is signed gets an answer (the old wizard's
      // required step). Then a card with nothing pink saves; the numbers note never holds it.
      await answerPinkAutographTile(page);
      const save = tidyFooterButton(page, "saveAndNext", { usable: true });
      await expect(save.or(mustFixLine(page)).first()).toBeVisible();
      if (await save.isVisible()) {
        await expect(numbersNote).toBeVisible();
        await saveAndNext(page);
        savedWithTheNote++;
      } else {
        await skipCard(page);
      }
    }
    await expect(tidyFooterButton(page, "done"), "the walk ended within the set's 14 cards").toBeVisible();
    // R2: the two cards the walk must ask about were on it, and the note held no card back.
    expect(seen, "the walk showed #SIG-RL (two spellings) and #SIG-JW (an unknown club)").toEqual(
      expect.arrayContaining(["SIG-RL", "SIG-JW"]),
    );
    expect(savedWithTheNote, "a card saved with Save & next while its numbers note was up").toBeGreaterThan(0);
    test.info().annotations.push({ type: "walk", description: `cards on the walk: ${seen.join(", ")}; saved with the note: ${savedWithTheNote}` });
    await finishTidyWalk(page);

    // ── READ BACK: the saved cards ──
    // Card numbers stay the marketplace's (a name pairing never rewrites one), found by number the way
    // a collector would. The sub-line is the team's full name; the player search narrows to one card.
    await expect(page.getByRole("button", { name: /^Edit card SIG-/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit card [0-9]+(, .*)?$/ })).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "Search cards" });
    await search.fill("SIG-BW");
    await expect(editCardButton(page, "SIG-BW")).toBeVisible();
    await expect(page.getByText(/^Kansas City Royals( · .*)?$/)).toBeVisible();
    await search.fill("SIG-JW");
    await expect(editCardButton(page, "SIG-JW")).toBeVisible();
    await expect(page.getByText(/^Oakland Athletics( · .*)?$/)).toBeVisible();
    await expectAccessible(page, { label: "Signature Series checklist, saved by player name" });
    // ══ PHASE C: the set's own checklist, in Panini's spreadsheet ══
    // NEO-496 (plan decision 4). Uploaded on the SET once PHASE A2 has committed, so the Inserts
    // column above was filled by BSC alone, and every sync from here on reads the file too.
    // Back would step into the walk's own history now (each card it showed is an address), so the
    // set is reached by a fresh drill; C6 below proves Back through the drill.
    await openDonrussSet(page, env);
    await openAttributesPanel(page);
    const panel = page.getByRole("region", { name: "Official checklist" });
    await expect(panel.getByText(/^Got the official checklist\?/)).toBeVisible();
    await panel.getByLabel("Upload checklist").setInputFiles({
      name: "2026-donruss-baseball-checklist.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buildDonrussXlsx(DONRUSS),
    });
    const preview = page.getByRole("dialog", { name: "Checklist preview" });
    await expect(preview).toBeVisible();
    await expect(preview.getByText(`${DONRUSS.sections.length} sections`, { exact: true })).toBeVisible();
    await expect(preview.getByText(`${DONRUSS_CARDS} cards`, { exact: true })).toBeVisible();
    // Panini's credit line sits above the header: read and set aside, said by reason.
    await expect(preview.getByText(/^Above the column headings \(1\)$/)).toBeVisible();
    await expectAccessible(page, { within: preview, label: "Checklist preview of a Donruss spreadsheet" });
    // R7: from the save on, the set holds this run's checklist. A red body leaves it there, and the
    // next run would start with one (PHASE C's precondition fails by name), so the `finally`
    // removes it.
    let checklistOnSet = true;
    try {
      await preview.getByRole("button", { name: "Save checklist" }).click();
      await expect(preview).toBeHidden();
      await expect(panel.getByText("2026-donruss-baseball-checklist.xlsx", { exact: true })).toBeVisible();

      // ── C1. Map Base Set: the checklist's Base and Base Rated Prospects are both the base ──
      await columnOption(page, "Variant Types", "Base").click();
      const picker = page.getByRole("dialog", { name: "Select Base Set" });
      await expect(picker).toBeVisible();
      await expectAfterMarketplace(page, picker.getByRole("option", { name: /^BSC base candidate: / }).first(), {
        platform: "BuySportsCards",
        what: "the Donruss base picker's BSC candidates",
      });
      const checklistBase = picker.getByRole("listbox", { name: "Checklist base" });
      // Exact names: "Base" is a prefix of every other section's name here.
      await expect(checklistBase.getByRole("option", { name: "Checklist base section: Base", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(
        checklistBase.getByRole("option", { name: "Checklist base section: Base Rated Prospects", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      // Their Red runs are parallels of the base, never the base itself.
      await expect(checklistBase.getByRole("option", { name: /^Checklist base section: .* Red$/ })).toHaveCount(0);
      // It is a multi-select the operator can work, on a phone too: take Base Rated Prospects off and
      // put it back, and both are selected again.
      const ratedProspects = checklistBase.getByRole("option", { name: "Checklist base section: Base Rated Prospects", exact: true });
      await ratedProspects.scrollIntoViewIfNeeded();
      await expect(ratedProspects).toBeInViewport();
      await ratedProspects.click();
      await expect(ratedProspects).toHaveAttribute("aria-selected", "false");
      await expect(checklistBase.getByRole("option", { name: "Checklist base section: Base", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await ratedProspects.click();
      await expect(ratedProspects).toHaveAttribute("aria-selected", "true");
      await expectAccessible(page, { within: picker, label: "Select Base Set with two checklist base sections" });
      await picker.getByRole("button", { name: "Confirm Base Set" }).click();
      await expect(picker).toBeHidden();

      // ── C2. Parallels, first visit: the Base's Red runs ride on BSC's bare "Red" ──
      await columnSelection(page, "Variant Types", "Base").click();
      await columnOption(page, "Variant Types", "Parallel").click();
      const reconcileParallels = page.getByRole("dialog", { name: "Reconcile Parallels" });
      await expectAfterMarketplace(page, reconcileParallels, { platform: "BuySportsCards", what: "Reconcile Parallels on the first visit" });
      await expect(reconcileParallels.getByRole("textbox", { name: "NeonBinder set name for Red" })).toBeVisible();
      await expect(reconcileParallels.getByRole("button", { name: "Remove checklist section Base Red from Red" })).toBeVisible();
      await expect(
        reconcileParallels.getByRole("button", { name: "Remove checklist section Base Rated Prospects Red from Red" }),
      ).toBeVisible();
      // NEO-496: the set has no SportLots link (filed under All Brands from BSC), so SportLots is
      // skipped, not paused: its column says it wasn't asked, in place of a search box and a
      // "Nothing pending" that would claim an answer nobody got. UNMEASURED live: whether the
      // Donruss set gains a SportLots link with SportLots back is not known, so the live run
      // asserts nothing here. R2: BSC's own column, searchable, is the positive half.
      if (env.SL_PAUSED) {
        await expect(reconcileParallels.getByText(`SportLots wasn't asked: ${SET} has no SportLots link.`, { exact: true })).toBeVisible();
        await expect(reconcileParallels.getByRole("textbox", { name: "Filter BSC items" })).toBeVisible();
        await expect(reconcileParallels.getByRole("textbox", { name: "Search SportLots items" })).toHaveCount(0);
        await expect(reconcileParallels.getByText("Nothing pending on SportLots")).toHaveCount(0);
      }
      // The subtitle's "N pending" jumps to the pending work: the Pending heading side by side, and on
      // a phone, where the columns stack, the first column holding anything. BSC's other parallels
      // are pending here, and BSC is the first column, so its label is where the jump lands.
      await reconcileParallels.getByRole("button", { name: /^[1-9][0-9]* pending, go to Pending$/ }).click();
      await expect(reconcileParallels.getByRole("heading", { name: /^Pending \([1-9][0-9]*\)$/ })).toBeInViewport();
      await expect(reconcileParallels.getByText(/^BSC \([1-9][0-9]*\)$/)).toBeInViewport();
      await expectAccessible(page, { within: reconcileParallels, label: "Reconcile Parallels with the Base's checklist runs" });
      await reconcileParallels.getByRole("button", { name: /^Save [0-9]+ sets$/ }).click();
      await expect(reconcileParallels).toBeHidden();

      // ── C3. Sync Inserts: a near-miss section name still finds its insert ──
      await columnSelection(page, "Variant Types", "Parallel").click();
      await columnOption(page, "Variant Types", "Insert").click();
      await expect(columnHeading(page, "Inserts")).toBeVisible();
      await page.getByRole("button", { name: "Sync Inserts" }).click();
      const reconcileInserts = page.getByRole("dialog", { name: "Reconcile Inserts" });
      await expectAfterMarketplace(page, reconcileInserts, { platform: "BuySportsCards", what: "Reconcile Inserts on Sync Inserts" });
      // Panini's "Donruss Ballpark Stars Signatures" is BSC's "Donruss Ballparks Stars Signatures".
      await expect(
        reconcileInserts.getByRole("button", {
          name: `Remove checklist section ${BALLPARK} from ${BALLPARK_BSC}`,
        }),
      ).toBeVisible();
      await expect(reconcileInserts.getByRole("button", { name: `Remove checklist section ${UNLEASHED} from ${UNLEASHED}` })).toBeVisible();
      await expect(reconcileInserts.getByText("Nothing pending on the checklist")).toBeVisible();
      await expectAccessible(page, { within: reconcileInserts, label: "Reconcile Inserts with a near-miss checklist section" });
      await reconcileInserts.getByRole("button", { name: /^Save [0-9]+ sets$/ }).click();
      await expect(reconcileInserts).toBeHidden();

      // ── C4. Unleashed: BSC lists two football cards the checklist does not ──
      await columnSearch(page, "Inserts").fill(UNLEASHED);
      await columnOption(page, "Inserts", UNLEASHED).click();
      await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
      await syncChecklistButton(page).click();
      await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: "Match Cards for Unleashed" });
      await expect(matchCards.getByRole("button", { name: "Confirm card matches", disabled: false })).toBeVisible();
      await expect(matchCards.getByRole("heading", { name: "BSC only (2)" })).toBeVisible();
      await expect(matchCards.getByRole("button", { name: "Keep #SG-CO Chris Olave as BSC-only" })).toBeVisible();
      await expect(matchCards.getByRole("button", { name: "Keep #SG-TB Treylon Burks as BSC-only" })).toBeVisible();
      // The file's rows 21 and 22 have no BSC card: two checklist-only rows, each with its own Keep.
      await expect(matchCards.getByRole("heading", { name: "Checklist only (2)" })).toBeVisible();
      const keepAnthony = matchCards.getByRole("button", { name: /^Keep #21 Roman Anthony.* as checklist-only$/ });
      await expect(keepAnthony).toBeVisible();
      await expect(matchCards.getByRole("button", { name: /^Keep #22 Kristian Campbell.* as checklist-only$/ })).toBeVisible();
      await expect(matchCards.getByRole("heading", { name: "Keeping (0)" })).toBeVisible();
      await expectAccessible(page, { within: matchCards, label: "Match Cards for Unleashed, BSC-only and checklist-only cards" });
      // Phone width (e2e-mobile, 412 px) too: a row's Keep and the column's Keep all are on screen.
      await keepAnthony.scrollIntoViewIfNeeded();
      await expect(keepAnthony).toBeInViewport();
      const keepAllRows = matchCards.getByRole("button", { name: "Keep all checklist-only cards" });
      await keepAllRows.scrollIntoViewIfNeeded();
      await expect(keepAllRows).toBeInViewport();
      // Keep all keeps both rows; BSC's two football cards stay unkept.
      await keepAllRows.click();
      await expect(matchCards.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
      await expect(matchCards.getByRole("heading", { name: "Keeping (2)" })).toBeVisible();
      await expect(matchCards.getByRole("heading", { name: "BSC only (2)" })).toBeVisible();
      await expectAccessible(page, { within: matchCards, label: "Match Cards for Unleashed, two checklist rows kept" });
      // Left unkept: confirming discards the football cards and saves the kept rows.
      await matchCards.getByRole("button", { name: "Confirm card matches" }).click();
      await expect(matchCards).toBeHidden();
      // NEO-645: Confirm SAVES the 20 paired cards and the 2 kept rows (22); neither football card is
      // among them. A card that needs a person opens the walk; Save for later closes it writing
      // nothing, so no player or team is minted.
      const savedUnleashed = page.getByText(new RegExp(`Saved ${UNLEASHED_ROWS} cards\\.`)).first();
      if (await settleWalkAfterCommit(page, savedUnleashed)) await saveForLater(page);
      await expect(editCardButton(page, "1")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Edit card SG-(CO|TB)(, .*)?$/ })).toHaveCount(0);
      // The two kept rows are cards of their own, found by number the way a collector would.
      for (const [number, player] of [["21", "Roman Anthony"], ["22", "Kristian Campbell"]] as const) {
        await search.fill(player);
        await expect(page.getByRole("button", { name: `Edit card ${number}, ${player}` })).toBeVisible();
      }
      await search.fill("");

      // ── C5. Replace with the same checklist as a plain CSV: nothing changes ──
      // To the set by a fresh drill: an opened walk left an address of its own behind Unleashed's.
      await openDonrussSet(page, env);
      await openAttributesPanel(page);
      await panel.getByLabel("Replace checklist").setInputFiles({
        name: "2026-donruss-baseball-checklist.csv",
        mimeType: "text/csv",
        buffer: buildDonrussCsv(DONRUSS),
      });
      await expect(preview).toBeVisible();
      await expect(preview.getByText(`${DONRUSS.sections.length} sections`, { exact: true })).toBeVisible();
      await expect(preview.getByText(`${DONRUSS_CARDS} cards`, { exact: true })).toBeVisible();
      await preview.getByRole("button", { name: "Save checklist" }).click();
      await expect(preview).toBeHidden();
      await expect(panel.getByText("2026-donruss-baseball-checklist.csv", { exact: true })).toBeVisible();
      await expect(panel.getByText(new RegExp(`^${DONRUSS.sections.length} sections, ${DONRUSS_CARDS} cards\\. Saved `))).toBeVisible();
      // Nothing changed for the cards it gave: Unleashed still holds the 20 it committed, and neither
      // football card. (Sync Inserts after the replace opens no Reconcile: every section is already
      // linked, so there is nothing to reconcile.)
      await columnOption(page, "Variant Types", "Insert").click();
      await expect(columnHeading(page, "Inserts")).toBeVisible();
      await columnSearch(page, "Inserts").fill(UNLEASHED);
      await columnOption(page, "Inserts", UNLEASHED).click();
      await expect(page.getByRole("heading", { name: `Cards (${UNLEASHED_ROWS})` })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Edit card SG-(CO|TB)(, .*)?$/ })).toHaveCount(0);

      // ── C6. Remove the set's checklist (self-cleaning: the next run starts with none) ──
      // Back through the two picks above: the Insert type, then the set.
      await page.goBack();
      await expect(columnSelection(page, "Variant Types", "Insert")).toBeVisible();
      await page.goBack();
      await expect(columnOption(page, "Variant Types", "Insert")).toBeVisible();
      await openAttributesPanel(page);
      await panel.getByRole("button", { name: "Remove checklist" }).click();
      const removeConfirm = page.getByRole("dialog", { name: "Remove this set's checklist?" });
      await expect(removeConfirm).toBeVisible();
      await removeConfirm.getByRole("button", { name: "Yes, remove it" }).click();
      await expect(removeConfirm).toBeHidden();
      await expect(page.getByText("Checklist removed.")).toBeVisible();
      checklistOnSet = false;
      await expect(panel.getByText(/^Got the official checklist\?/)).toBeVisible();
    } finally {
      if (checklistOnSet) {
        try {
          await removeSetChecklistUnderAllBrands(page, env, { year: "2026", set: SET });
        } catch (error) {
          // The body's own error stays the one the report shows.
          test.info().annotations.push({ type: "cleanup", description: `set checklist not removed: ${String(error)}` });
        }
      }
    }
  },
);

/**
 * Baseball > 2026 > All Brands > the Donruss set, by a drill from wherever the page is. The view
 * reads each set's name, then its brand ("Donruss Donruss"); a bare "Donruss" text would also match
 * the brand of "Donruss Elite" and the rest, so the option is matched whole.
 *
 * Contract: ENTRY signed in, anywhere. EXIT the set is picked and its Variant Types are listed (or
 * still syncing from BSC: the caller waits on the row it needs).
 */
async function openDonrussSet(page: Page, env: Parameters<typeof drillToColdManufacturer>[1]): Promise<void> {
  await drillToColdManufacturer(page, env, { sport: "Baseball", year: "2026", manufacturer: "All Brands" });
  await expect(page.getByRole("listbox", { name: "Sets" })).toBeVisible();
  await columnSearch(page, "Sets").fill("Donruss");
  await page
    .getByRole("listbox", { name: "Sets" })
    .getByRole("option", { name: /^Donruss \S+$/ })
    .click();
}

/**
 * #SIG-JW's pink Team tile on the walk, answered as an operator who knows the club: the "Oakland
 * A's" row is linked to the 1968-2024 Oakland Athletics (the club the checklist names; the 2025-on
 * "Athletics" row is not) from "Search all teams", with the remember-box unticked so no alias is
 * saved. The link saves as it is made (J1).
 *
 * Contract: ENTRY a settled card whose Team tile asks about "Oakland A's". EXIT the row reads linked
 * (the club's name and a Change), and the Team tile is no longer pink.
 */
async function linkClubOnTheWalk(page: Page): Promise<void> {
  await expect(pinkTile(page, "Team"), "the club no one has on file holds the Team tile").toHaveCount(1);
  const row = tidyTile(page, "Team").getByRole("group", { name: `Team ${CLUB}`, exact: true });
  await expect(row.getByText(`“${CLUB}” isn't linked to a team yet.`)).toBeVisible();
  await expect(row.getByText("Checking for teams by that name…")).toHaveCount(0);
  // NEO-591: the box is held (aria-disabled) until the row's near matches land, then settles ticked,
  // since "Oakland A's" is no place. Untick the SETTLED box: unticking the held one would be undone
  // by the default afterwards.
  const remember = row.getByRole("checkbox", { name: `Remember “${CLUB}” as a name for this team`, disabled: false });
  await expect(remember).toBeChecked();
  await remember.uncheck();
  await expect(remember).not.toBeChecked();
  await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, a club the checklist names that NB has not" });
  await row.getByRole("combobox", { name: "Search all teams" }).click();
  // Empty and focused, the combobox lists the row's near matches by label: the era is in the name.
  await page.getByRole("option", { name: /^Oakland Athletics .*1968.2024/ }).click();
  await expect(row.getByText("Oakland Athletics", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Change team( .+)?$/ })).toBeVisible();
  await expect(row.getByRole("checkbox")).toHaveCount(0);
  await expect(pinkTile(page, "Team")).toHaveCount(0);
}
