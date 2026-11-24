// NEO-616 (R1): a Pro Set "foil × colour" checklist, uploaded once on the set, builds the
// set's parallels with their print runs. Pro Set ships one line per card per FOIL with a
// column per COLOUR, each cell that foil-and-colour's print run; NB reads each subset's
// cards once and each foil × colour as a parallel section named literally
// "<Subset> <Foil> <Colour>" (never with "/N" in it), each card carrying its own run.
//
// The file is built per attempt in Pro Set's own layout (fixtures/checklists/
// build-fixtures.mjs `buildProSetCsv`), from the real 2026 Pro Set Metal checklist: the
// first four cards of 1989 Pro Set Base (89B-1..89B-4, numbered as BSC numbers them,
// probed 2026-11-19) and the same four players' 1989 Pro Set Base Mini cards
// (89M-1..89M-4), with their real City Designations. Five sections:
//   - 1989 Pro Set Base, 1989 Pro Set Base Mini: the two card subsets.
//   - 1989 Pro Set Base Prismatic Blue: every card /5 (the file's own run), so the
//     parallel takes the run (UNIFORM). BSC lists a parallel by that very name.
//   - 1989 Pro Set Base Silver Circles RWB RWB: runs 1, 1, 3, 3 (the file has 1 on
//     every card; two are 3 here), so no run reaches 90% and the parallel shows none
//     (SPLIT), while each card keeps its own. BSC names its own "… Red, White, and Blue".
//   - 1989 Pro Set Base Mini Prismatic Gold: every card 1/1. BSC lists it by that name.
//
// The walk, as an operator meets it:
//   1. Upload on the SET: the preview lists the five sections; Save.
//   2. Insert, first visit: BSC and the stored checklist are two sources, so Reconcile
//      Inserts opens. The two sections BSC names alike ride on BSC's; the other three
//      become their own sets (Keep all, checklist sections); Save.
//   3. Group Parallels: the name-prefix suggestions put Mini AND Mini Prismatic Gold
//      under 1989 Pro Set Base, one level (Jason, 2026-11-19: Minis are plain parallels
//      of their subset), with Prismatic Blue and Silver Circles RWB RWB; Save.
//   4. Commit 1989 Pro Set Base's four cards. Each City Designation is the card's team cell as
//      printed: "Miami" links the Marlins by itself; "Cincinnati" (three clubs) and "Los Angeles
//      N" (none) are pink on the Tidy Up walk's Team tile, and the operator links the Reds and
//      the Dodgers (no alias remembered). With no name left waiting, its four parallels build.
//   5. The built cards carry their runs: every Prismatic Blue card /5; Silver Circles
//      RWB RWB's #89B-1 /1 and #89B-3 /3.
//   6. The collection Checklists drill reads the parallel's run beside its name: "/5"
//      (spoken "numbered to 5") on Prismatic Blue, nothing on the split one.
//
// FIXTURE (SET-REGISTRY.md -> "Baseball -> 2026 -> Pro Set Metal"): Baseball > 2026 >
// All Brands > Pro Set Metal (BSC files it under the brand Pro Set). SOLE WRITER of that
// set (its checklist, Inserts column, grouping and cards); FRESH-ONLY (R7a): the run-start
// reset is its cleanup (Jason, 2026-11-19), so a second run on one seed fails at the
// "Got the official checklist?" precondition by name: re-seed first.
//
// Not a hand-rolled drill by choice (R9): drillToColdManufacturer reaches the year's All
// Brands view and the set is picked there, as the other All Brands real sets are.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  columnOption,
  columnSearch,
  columnSelection,
  drillToColdManufacturer,
  expectAfterBscSync,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { editCardButton, escapeRe } from "../../support/cards";
import { matchCardsDialog, savedLine, setChecklistPanel } from "../../support/published-checklist";
import { collectorCascade } from "../../support/collection";
import {
  expectCardsLeft,
  finishTidyWalk,
  keepOpenCareerGaps,
  needsYouPill,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";
import { buildProSetCsv } from "../../fixtures/checklists/build-fixtures.mjs";
import type { Locator, Page } from "@playwright/test";

/** The set, and how the year's All Brands view names it: the set, then the brand BSC files it under. */
const SET = "Pro Set Metal";
const SET_IN_ALL_BRANDS = "Pro Set Metal Pro Set";
const BRAND = "Pro Set";

const BASE = "1989 Pro Set Base";
const MINI = "1989 Pro Set Base Mini";
/** Uniform: every card /5. */
const BLUE = "1989 Pro Set Base Prismatic Blue";
/** Split: 1, 1, 3, 3. */
const RWB = "1989 Pro Set Base Silver Circles RWB RWB";
/** Uniform 1/1, a Mini colour: lands under BASE, not under MINI. */
const MINI_GOLD = "1989 Pro Set Base Mini Prismatic Gold";
const PARALLELS = [MINI, MINI_GOLD, BLUE, RWB];

/**
 * The four cards, as the 2026 Pro Set Metal checklist prints them (number, player, City
 * Designation), and the club each designation names once tidied.
 */
const CARDS = [
  { number: "89B-1", name: "Aaron Watson", city: "Cincinnati", team: "Cincinnati Reds", rwb: 1 },
  { number: "89B-2", name: "Adam Serwinowski", city: "Los Angeles N", team: "Los Angeles Dodgers", rwb: 1 },
  { number: "89B-3", name: "Aidan West", city: "Los Angeles N", team: "Los Angeles Dodgers", rwb: 3 },
  { number: "89B-4", name: "Aiva Arquette", city: "Miami", team: "Miami Marlins", rwb: 3 },
];

const csv = buildProSetCsv({
  set: "2026 Pro Set Metal Baseball",
  cards: [
    ...CARDS.map(({ number, name, city, rwb }) => ({
      subset: BASE,
      number,
      name,
      city,
      foils: [
        { foil: "Prismatic", runs: { Blue: 5 } },
        { foil: "Silver Circles RWB", runs: { RWB: rwb } },
      ],
    })),
    ...CARDS.map(({ number, name, city }) => ({
      subset: MINI,
      number: number.replace("89B-", "89M-"),
      name,
      city,
      foils: [{ foil: "Prismatic", runs: { Gold: 1 } }],
    })),
  ],
});

/** The open card's detail dialog: its print run, then close it. */
async function expectCardPrintRun(page: Page, number: string, run: string): Promise<void> {
  await editCardButton(page, number).click();
  const detail = page.getByRole("dialog").filter({ has: page.getByRole("spinbutton", { name: "Print run" }) });
  await expect(detail.getByRole("spinbutton", { name: "Print run" })).toHaveValue(run);
  await detail.getByRole("button", { name: "Close card detail" }).click();
  await expect(detail).toBeHidden();
}

/** The walk's open card, by its face: "Card #<number>, <player>" (the team follows once one is linked). */
function cardFace(page: Page, { number, name }: { number: string; name: string }): Locator {
  return tidyWalk(page).getByRole("img", { name: new RegExp(`^Card #${escapeRe(number)}, ${escapeRe(name)}(,|$)`) });
}

/**
 * A checklist row is one run of text: "#<number> <name> <team> ...". The list's own text joins
 * every row, so the match stops at the next row's "#" (as the place-team-cells spec reads rows).
 */
function rowSays(page: Page, number: string, text: string): Locator {
  return page.getByText(new RegExp(`#${escapeRe(number)}[^#]*${escapeRe(text)}`));
}

/** A built parallel's ledger line, one string in one element (ParallelBuildPanel). */
function builtLine(page: Page, parallel: string): Locator {
  return page.getByText(new RegExp(`^${parallel} — Built 4 cards`));
}

test(
  "Set checklist — a Pro Set foil × colour CSV on the set builds its parallels with their print runs, Minis under their subset, and the collection drill shows a uniform run",
  { tag: ["@set-selector", "@parallel-grouping"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── DRILL: the set, through All Brands ──
    await drillToColdManufacturer(page, env, { sport: "Baseball", year: "2026", manufacturer: "All Brands" });
    await columnSearch(page, "Sets").fill(SET);
    await page.getByRole("listbox", { name: "Sets" }).getByRole("option", { name: SET_IN_ALL_BRANDS, exact: true }).click();
    // The set's variant types are one BSC read on first use: the marketplace rule.
    await expectAfterBscSync(page, columnOption(page, "Variant Types", "Insert"), "the set's variant types");

    // ══ 1. UPLOAD ON THE SET ══
    const panel = setChecklistPanel(page);
    // A fresh drill to a set opens its attributes panel by itself, the official checklist first.
    await expect(panel).toBeVisible();
    // R2 precondition: no checklist on the set yet (a re-run fails here, by name: re-seed first).
    await expect(panel.getByText(/^Got the official checklist\?/)).toBeVisible();
    await panel.getByLabel("Upload checklist").setInputFiles({
      name: "2026-pro-set-metal-checklist.csv",
      mimeType: "text/csv",
      buffer: csv,
    });
    const preview = page.getByRole("dialog", { name: "Checklist preview" });
    await expect(preview).toBeVisible();
    await expect(preview.getByText("5 sections", { exact: true })).toBeVisible();
    await expect(preview.getByText("20 cards", { exact: true })).toBeVisible();
    const sections = preview.getByRole("table", { name: "Sections the checklist will save" });
    const sectionRow = (name: string) =>
      sections.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });
    // The two subsets' cards, read once each though every card is on several foil lines.
    await expect(sectionRow(BASE)).toContainText("89B-1 to 89B-4");
    await expect(sectionRow(MINI)).toContainText("89M-1 to 89M-4");
    // Each foil × colour with a run is a section of its own, named literally, no "/N".
    await expect(sectionRow(BLUE)).toContainText("89B-1 to 89B-4");
    await expect(sectionRow(RWB)).toContainText("89B-1 to 89B-4");
    await expect(sectionRow(MINI_GOLD)).toContainText("89M-1 to 89M-4");
    await expect(sections.getByRole("rowheader", { name: /\/[0-9]/ })).toHaveCount(0);
    await expectAccessible(page, { within: preview, label: "Checklist preview of a Pro Set foil × colour CSV" });
    await preview.getByRole("button", { name: "Save checklist" }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByText("Checklist saved: 5 sections, 20 cards.")).toBeVisible();

    // ══ 2. INSERT, FIRST VISIT: Reconcile Inserts with BSC and the checklist ══
    await columnOption(page, "Variant Types", "Insert").click();
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });
    await expectAfterMarketplace(page, reconcile, { platform: "BuySportsCards", what: "Reconcile Inserts on the first visit" });
    // The two sections BSC names alike ride on BSC's parallels, matched by name.
    for (const name of [BLUE, MINI_GOLD]) {
      await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${name}`, exact: true })).toBeVisible();
      await expect(
        reconcile.getByRole("button", { name: `Remove checklist section ${name} from ${name}`, exact: true }),
      ).toBeVisible();
    }
    // The other three wait on the checklist side: BSC lists no plain subset, so nothing of BSC's
    // is the subset's, whatever name a foil of it shares ("… Base Lazer Red" is not "… Base").
    await reconcile.getByRole("checkbox", { name: "Show all checklist sections" }).check();
    for (const name of [BASE, MINI, RWB]) {
      await expect(
        reconcile.getByRole("button", { name: `Make its own set from checklist section: ${name}`, exact: true }),
      ).toBeVisible();
    }
    await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts with a Pro Set checklist" });
    await reconcile.getByRole("button", { name: "Keep all, checklist sections" }).click();
    await expect(reconcile.getByText("Nothing pending on the checklist")).toBeVisible();
    for (const name of [BASE, MINI, RWB]) {
      await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${name}`, exact: true })).toHaveValue(name);
    }
    await reconcile.getByRole("button", { name: /^Save 5 sets/ }).click();
    await expect(reconcile).toBeHidden();

    // ══ 3. GROUP PARALLELS: Mini and its colour go under the subset, one level ══
    for (const name of [BASE, ...PARALLELS]) await expect(columnOption(page, "Inserts", name)).toBeVisible();
    await page.getByRole("button", { name: "Group Parallels" }).click();
    const grouping = page.getByRole("dialog", { name: "Group Parallels" });
    await expect(grouping.getByText(/Drag inserts under a parent/)).toBeVisible();
    await grouping.getByRole("button", { name: /^Accept all suggestions \(4\)/ }).click();
    await expect(grouping.getByText("4 promotions, 0 demotions")).toBeVisible();
    const boxes = grouping.getByRole("region", { name: "Parallels by insert" });
    const baseBox = boxes.getByRole("group", { name: `Parallels of "${BASE}"`, exact: true });
    for (const name of PARALLELS) await expect(baseBox.getByRole("group", { name, exact: true })).toBeVisible();
    // Mini is a parallel now, never a parent: its colour sits beside it under the subset.
    await expect(boxes.getByRole("group", { name: `Parallels of "${MINI}"`, exact: true })).toHaveCount(0);
    await expectAccessible(page, { within: grouping, label: "Group Parallels with the Minis under their subset" });
    await grouping.getByRole("button", { name: /^Save 4 changes/ }).click();
    await expect(grouping).toBeHidden();
    await expect(columnOption(page, "Inserts", BASE)).toBeVisible();
    for (const name of PARALLELS) await expect(columnOption(page, "Inserts", name)).toHaveCount(0);

    // ══ 4. COMMIT THE SUBSET; ITS PARALLELS BUILD ══
    await columnOption(page, "Inserts", BASE).click();
    await expect(columnSelection(page, "Inserts", BASE)).toBeVisible();
    for (const name of PARALLELS) await expect(columnOption(page, "Parallels", name)).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await syncChecklistButton(page).click();
    // The subset is the checklist's alone (BSC lists no such insert), so nothing is asked of a
    // marketplace and nothing is matched. NEO-645: the fetch saves the four cards first, and the
    // saved line says why there was nothing to match, then that every card's team cell came from
    // the file (the City Designation, sent as the team cell as printed).
    const saved = savedLine(page, CARDS.length);
    await expect(saved).toBeVisible();
    await expect(saved).toContainText(/^Saved 4 cards\. Only your checklist was in play, so there was nothing to match\./);
    await expect(saved).toContainText("Teams from your checklist: 4 of 4 cards.");
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // A City Designation is a place, not a club's name. "Miami" is one club (the card links to the
    // Marlins; the player's career lacks them, a blue Career check). "Cincinnati" is three of NB's
    // clubs and "Los Angeles N" is none, so those two are pink on the Team tile for the operator
    // (invariant 8: the file names a team, so nothing guesses one): 4 cards need a person, 3 to fix.
    await expect(needsYouPill(page)).toHaveAccessibleName("4 need you, 3 to fix");
    expect(await settleWalkAfterCommit(page, saved), "two City Designations are unsettled, so the walk opened").toBe(true);
    await expectCardsLeft(page, 4);
    const teamTile = tidyTile(page, "Team");

    // #89B-1: "Which team: Cincinnati", the place's clubs listed with their eras. The operator links
    // today's Reds; the remember-box is left unticked (a place names many clubs), so no alias is saved.
    await expect(cardFace(page, CARDS[0])).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    const cincinnati = teamTile.getByRole("group", { name: "Team Cincinnati", exact: true });
    await expect(cincinnati.getByText("Which team: Cincinnati", { exact: true })).toBeVisible();
    const clubs = cincinnati.getByRole("list", { name: "We've got 3 teams from Cincinnati. Pick the one on this card." });
    await expect(clubs.getByRole("button", { name: /^Link to / })).toHaveCount(3);
    await expect(cincinnati.getByRole("checkbox", { name: "Remember “Cincinnati” as a name for this team" })).not.toBeChecked();
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy up asks which club a City Designation names" });
    await clubs.getByRole("button", { name: /^Link to Cincinnati Reds · 1890–present · MLB$/ }).click();
    await expect(teamTile.getByRole("button", { name: "Edit Cincinnati Reds", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await keepOpenCareerGaps(page);
    await saveAndNext(page);

    // #89B-2: "Los Angeles N" is no club's name, so the row offers the search. The operator unticks
    // the remember-box (the settled one: the held box is ticked by default once the near matches
    // land) and links the Dodgers from "Search all teams". The answer reaches #89B-3 too, which
    // prints the same designation.
    await expect(cardFace(page, CARDS[1])).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    const losAngeles = teamTile.getByRole("group", { name: "Team Los Angeles N", exact: true });
    await expect(losAngeles.getByText("“Los Angeles N” isn't linked to a team yet.", { exact: true })).toBeVisible();
    await expect(losAngeles.getByText("Printed on #89B-2, #89B-3", { exact: true })).toBeVisible();
    await expect(losAngeles.getByText("Checking for teams by that name…")).toHaveCount(0);
    const remember = losAngeles.getByRole("checkbox", {
      name: "Remember “Los Angeles N” as a name for this team",
      disabled: false,
    });
    await expect(remember).toBeChecked();
    await remember.uncheck();
    await expect(remember).not.toBeChecked();
    await losAngeles.getByRole("combobox", { name: "Search all teams" }).fill("Los Angeles Dodgers");
    await page.getByRole("option", { name: /^Los Angeles Dodgers\b.*MLB/ }).click();
    await expect(teamTile.getByRole("button", { name: "Edit Los Angeles Dodgers", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await keepOpenCareerGaps(page);
    await saveAndNext(page);

    // #89B-3 took the Dodgers from #89B-2's answer: nothing on it is pink.
    await expect(cardFace(page, CARDS[2])).toBeVisible();
    await expect(teamTile.getByRole("button", { name: "Edit Los Angeles Dodgers", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await keepOpenCareerGaps(page);
    await saveAndNext(page);

    // #89B-4: "Miami" linked the Marlins by itself; only its blue Career check stopped the card,
    // kept as is (nothing is written to the catalogue player).
    await expect(cardFace(page, CARDS[3])).toBeVisible();
    await expect(teamTile.getByRole("button", { name: "Edit Miami Marlins", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    expect(await keepOpenCareerGaps(page), "the Marlins are not in the player's career").toBe(1);
    await saveAndNext(page);
    await expectCardsLeft(page, 0);
    await finishTidyWalk(page);

    // Each card carries the club its City Designation named.
    for (const { number } of CARDS) await expect(editCardButton(page, number)).toBeVisible();
    for (const { number, team } of CARDS) await expect(rowSays(page, number, team)).toBeVisible();
    await expect(needsYouPill(page)).toHaveCount(0);

    // The save builds the subset's four parallels from its cards. The two BSC lists are each
    // a BSC card read, under the screen's "Waiting on BuySportsCards" line: the marketplace rule.
    await expectAfterMarketplace(page, page.getByRole("heading", { name: `${BASE} parallels — 4 built` }), {
      platform: "BuySportsCards",
      what: "the 1989 Pro Set Base parallels build",
    });
    // The two Minis build from the subset like any parallel of it (Jason, 2026-11-19). Mini
    // Prismatic Gold is BSC's, and BSC numbers a Mini apart from the subset's 89B-n: its cards
    // are the same players, so they pair on the name and the number only confirms (invariant 7).
    for (const name of PARALLELS) await expect(builtLine(page, name)).toBeVisible();
    // Silver Circles RWB RWB's long name leaves one title over 80 (#89B-2 Adam Serwinowski), so
    // the build ends on Card titles by itself (NEO-535). Titles are not this spec's subject.
    const titles = page.getByRole("dialog", { name: "Card titles" });
    await expect(titles).toBeVisible();
    await titles.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(titles).toBeHidden();
    await expectAccessible(page, { label: "1989 Pro Set Base saved and its parallels built" });

    // ══ 5. THE BUILT CARDS CARRY THEIR RUNS ══
    await columnOption(page, "Parallels", BLUE).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Attributes for ${BLUE}`) })).toBeVisible();
    for (const { number } of CARDS) await expect(editCardButton(page, number)).toBeVisible();
    await expectAccessible(page, { label: "A built parallel with its print-run cards" });
    for (const { number } of CARDS) await expectCardPrintRun(page, number, "5");
    // Navigation lives in the URL: Back is the subset with nothing picked under it.
    await page.goBack();
    await expect(columnSelection(page, "Inserts", BASE)).toBeVisible();
    await expect(columnOption(page, "Parallels", BLUE)).toBeVisible();
    await expect(columnSelection(page, "Parallels", BLUE)).toHaveCount(0);

    // The split parallel: no shared run, but every card keeps its own.
    await columnOption(page, "Parallels", RWB).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Attributes for ${RWB}`) })).toBeVisible();
    await expectCardPrintRun(page, "89B-1", "1");
    await expectCardPrintRun(page, "89B-3", "3");

    // ══ 6. THE COLLECTION DRILL: the uniform run beside its name, none on the split ══
    await page.goto("/collection?tab=checklists");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
    const { cascade, drill } = collectorCascade(page);
    await drill("Sports", "Baseball", "Years");
    await drill("Years", "2026", "Brands");
    await drill("Brands", BRAND, "Sets");
    await drill("Sets", SET, "Variant Types");
    await drill("Variant Types", "Insert", "Insert");
    await drill("Insert", BASE);
    // The subset's parallels, Mini among them (one level: a Mini is a parallel of its subset).
    const parallels = cascade.getByRole("listbox", { name: `${BASE} parallels` });
    await expect(parallels.getByRole("option", { name: MINI, exact: true })).toBeVisible();
    // The run sits under the name ("/5", hidden from a listener) and is spoken in the
    // option's own name instead ("…, numbered to 5"); a split parallel has no run at all.
    const blue = parallels.getByRole("option", { name: new RegExp(`^${BLUE} ?, numbered to 5$`) });
    await expect(blue).toBeVisible();
    await expect(blue.getByText("/5", { exact: true })).toBeVisible();
    await expect(parallels.getByRole("option", { name: RWB, exact: true })).toBeVisible();
    await expect(parallels.getByRole("option", { name: new RegExp(`^${RWB} ?,`) })).toHaveCount(0);
    await expect(parallels.getByRole("option", { name: new RegExp(`^${MINI_GOLD} ?, one of one$`) })).toBeVisible();
    await expectAccessible(page, { label: "Collection drill with a parallel's print run" });
  },
);
