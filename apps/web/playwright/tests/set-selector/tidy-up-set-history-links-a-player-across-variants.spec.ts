// ONE FEATURE (NEO-424 set history, on the NEO-645 Tidy Up walk): a name already linked on a SAVED
// card of a set links, at the commit, to that same player when another variant of the set is
// fetched, whatever sport he is filed under, with no stop; the walk's Player tile shows him linked
// with no note (NEO-656 J1: nothing records why NeonBinder linked a name, so no "Linked for you"),
// and the row's "Edit <name>" re-asks it (an exact namesake then leads, main's rule). Around it, the rules that
// share the gate: one namesake in another sport is a suggestion (E2), the Hall of Famer among
// namesakes is linked (D), a historic club is linked from the stint of the player on the card (2b),
// a club held in several eras is never linked from set history (NEO-602), and a year on, the prior
// year's edition suggests the same player (E1).
//
// Renamed from checklist-wizard-set-history-links-across-variants (NEO-645): the pre-save wizard,
// its Decided list and Confirm & Save are gone. A fetch SAVES the cards (through Match Cards' Confirm,
// or first thing when every card paired at 100% and Match Cards sat out, NEO-640), then the walk
// opens on the cards that need a person, and every tile answer saves at once (J1). The links are
// read where the walk shows them (the tiles) and, where it does not (a link with nothing else to
// ask makes no stop), in the card drawer and on the player page.
//
// Phases 0-5 are inside Baseball -> 2010 -> Topps -> Topps; 6 and 7 add the 2009 edition:
//   0. FIXTURE, from the UI: a FOOTBALL player "Michael Brantley" on /admin/players (E2's case).
//   1. Team Bonus: its one unknown name, STAR, is moved to Football on his Player tile and added as
//      a new player ("Also add Baseball to their sports" left unticked). Save for later.
//   2. Silk Collection (rule A, cross-sport, and E2): STAR arrives linked, his Player row reads
//      answered with no note (J1) (his card is in the walk for its live blue career check: the
//      card's team is in no stint of a player on file with no stints). "Edit STAR"
//      reopens the row. Its sport is still Football (his phase-1 answer), so STAR himself is the
//      one exact namesake there, and main's rule holds: an exact namesake is the stronger, live
//      answer, so "Link to STAR" leads and the set-history suggestion and its reason give way;
//      pressed, the row reads answered (phase 5 proves no second player). Brantley's row shows E2: "Link to
//      Michael Brantley (Football)", "Add as new player anyway" and the reason line; left alone.
//   3. Peak Performance: Bob Gibson and Joe Morgan (two Baseball namesakes each, none active in 2010) link to
//      the Hall of Famer; the Washington Senators, Philadelphia Athletics and St. Louis Browns link
//      from Walter Johnson's, Jimmie Foxx's and George Sisler's stints (NEO-490 rule 2b). Neither
//      makes a walk stop, so they are read back: the drawers of PP-4, PP-21 and PP-22 carry the
//      clubs, and the 1943 Joe Morgan's page lists the card while the other Joe Morgan's does not.
//   4. Turkey Red: TR92's Browns link from Sisler's stint again. NEO-602 (Jason, 2026-11-19): a
//      name several eras answer to is the players' (or the operator's), never set history's: where
//      the walk shows the Browns, no "Linked for you" note sits on them (J1). TR92's drawer carries them.
//   5. STAR's page lists exactly his two cards as Baseball guest cards.
//   6. Prior year (E1): 2009 Career Best Jumbo Jerseys, Rickie Weeks moved to Football and added
//      (and no "Which Chris Carpenter is this?" stop: the checklist's Cardinals settle him); then
//      2010 Peak Performance Relics: Weeks's row shows "Last year's edition of this set had Rickie
//      Weeks (Football). Same one?" and NOT E2's line; the promoted link is pressed.
//   7. Weeks's page lists exactly his two cards as Baseball guest cards.
//
// The Hall of Fame Edit -> "Which Joe Morgan is this?" pick is no longer reachable here: the walk
// shows a card only when it needs a person, and Morgan's card asks nothing. That pick step is
// covered by tidy-up-same-name-player-asks-which-one.
//
// FIXTURE (SET-REGISTRY.md -> "Baseball -> 2010 -- the NEO-424 set-history fixture"; the set
// approved by Jason 2026-11-03, the 2009 edition 2026-11-04): SOLE WRITER of those inserts and of
// both years, BSC only (plus each insert's captured publisher's checklist); FRESH-ONLY (R7a): it
// commits five checklists, so a re-run on the same seed fails at "No cards in this checklist yet."
// by name; each project gets its own seed (GUIDE "Desktop and mobile").
//
// The names are REAL checklist names (the same exception the same-name pick-step spec records).
// Every lookup the flow reaches is in the enrichment recording (convex/adapters/__fixtures__/
// enrichment-lookups.json): STAR and Weeks in Baseball and Football, Brantley in Football, and the
// historic clubs, so nothing goes to Wikidata.
import type { Locator, Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import {
  columnHeading,
  columnOption,
  columnSearch,
  drillToColdManufacturer,
  drillToSet,
  expectAfterBscSync,
  openInsertsReconcile,
  pick,
  setBuilderReady,
  syncChecklistButton,
  VARIANT_TYPES_SYNC,
} from "../../support/set-builder";
import { addPlayerByHand, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { expectStepWithSportLots } from "../../support/marketplace-wait";
import { CHECKLISTS, settleChecklistFetch, usePublishersChecklist, type ChecklistName } from "../../support/published-checklist";
import {
  expectCardSettled,
  saveForLater,
  settleWalkAfterCommit,
  skipCard,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const TARGET = { sport: "Baseball", year: "2010", manufacturer: "Topps", set: "Topps" };
/** Phase 6: the same product one year earlier (rule E1 looks exactly one year back). */
const TARGET_2009 = { sport: "Baseball", year: "2009", manufacturer: "Topps", set: "Topps" };
/** Unknown to the Baseball catalogue, on both inserts below (measured on dev 2026-11-03). */
const STAR = "Kendry Morales";
/** Fetched and committed first: STAR is its only unknown name. */
const FIRST = "Team Bonus";
/** Fetched second: STAR arrives linked; Michael Brantley is its one other unknown name. */
const SECOND = "Silk Collection";
/** Hall of Fame phase: Bob Gibson and Joe Morgan, two Baseball namesakes each (Morgan has a Football one too), none active in 2010. */
const THIRD = "Peak Performance";
/** Team phase: the Browns, linked on THIRD; the wizard opens on its Save step for them alone. */
const FOURTH = "Turkey Red";
/**
 * Phase 6, 2010 side: Weeks's only 2010 insert outside the four above (measured
 * on the BSC shop facets 2026-11-04). It joins the SAME first Reconcile Inserts
 * save as the four above, because an insert row exists only once its column's
 * reconcile is saved, and 2010's Insert column is saved once, in phase 1.
 */
const SIXTH = "Peak Performance Relics";
const INSERTS = [FIRST, SECOND, THIRD, FOURTH, SIXTH];
/** Phase 6, 2009 side: the one 2009 insert with a single Weeks card and no other unknown name. */
const PRIOR = "Career Best Jumbo Jerseys";
/** Unknown to the Baseball catalogue, one card on PRIOR and one on SIXTH (measured on dev 2026-11-04). */
const WEEKS = "Rickie Weeks";
const BRANTLEY = "Michael Brantley";
const GIBSON = "Bob Gibson";
const MORGAN = "Joe Morgan";
const BROWNS = "St. Louis Browns";
/** The clubs the batch links by the stint of the player on the card (rule 2b), with that player. */
const HISTORIC_CLUBS: ReadonlyArray<readonly [string, string]> = [
  ["Washington Senators", "Walter Johnson"],
  ["Philadelphia Athletics", "Jimmie Foxx"],
  [BROWNS, "George Sisler"],
];
/**
 * Each insert's captured publisher's checklist (NEO-478/482): BSC's own per-card
 * answers, uploaded before the Sync, so no fetch here asks BSC for a card one by
 * one. The whole flow's fetches read the same teams and names they always did;
 * the files are registered in SET-REGISTRY.md. The Silk Collection's 201 cards are
 * all numbered `NNO`, which a checklist row keeps and pairs by player, one card to
 * one row (rule 7's exactly-one guard on the only key an unnumbered card has). Every
 * one of its players is on one card only, so each pairs and the line reads
 * "Teams from your checklist: 201 of 201 cards" (N is read off the file).
 */
const CHECKLIST_OF: Readonly<Record<string, ChecklistName | undefined>> = {
  [FIRST]: CHECKLISTS.teamBonus2010,
  [SECOND]: CHECKLISTS.silkCollection2010,
  [THIRD]: CHECKLISTS.peakPerformance2010,
  [FOURTH]: CHECKLISTS.turkeyRed2010,
  [SIXTH]: CHECKLISTS.peakPerformanceRelics2010,
  [PRIOR]: CHECKLISTS.careerBestJumboJerseys2009,
};
/**
 * GUIDE hard rule 3, the exception "a step that directly drives a live SportLots round trip
 * on data that is not pre-synced": the cold year's first Sets sync, which also asks SportLots.
 * It is the ceiling kept while SportLots is live (`expectStepWithSportLots`); paused, BSC alone
 * is the fake (NEO-552) and the wait is the marketplace rule: 7 s plus the seconds
 * "Waiting on BuySportsCards" is up (measured 6.3 s at most on the #487 merge-group run (GUIDE)). The wizard
 * opening afterwards is our own backend at the 7 s default. The fetch itself (the bulk
 * checklist, one BSC round trip) is waited on inside `settleChecklistFetch` with
 * `expectAfterMarketplace` (NEO-487).
 */
const LIVE_BSC_FETCH = 60_000;
/**
 * The retired purple note (NEO-645 `linkedForText`). NEO-656 J1 dropped it: nothing records why
 * NeonBinder linked a name, so a linked row never carries it. Asserted absent only.
 */
const LINKED_FOR_YOU = /Linked for you/;
/**
 * An answered row's Edit (NEO-645 C1): "Edit <name>", the linked player's name on a linked row.
 * Exact, read inside the row's own group. Contract: a locator, nothing waited for.
 */
function editPlayer(row: Locator, name: string): Locator {
  return row.getByRole("button", { name: `Edit ${name}`, exact: true });
}
const NOT_A_PLAYER = /^Not a player \(checklist, team card, stadium\)( .+)?$/;

/** The Player tile's row for `name` on the open card. Contract: a locator, nothing waited for. */
function playerRow(page: Page, name: string): Locator {
  return tidyTile(page, "Player").getByRole("group", { name: `Player ${name}`, exact: true });
}

/** `name`'s row while it is still waiting for an answer (it offers "Not a player"). */
function openPlayerRow(page: Page, name: string): Locator {
  return playerRow(page, name).filter({ has: page.getByRole("button", { name: NOT_A_PLAYER }) });
}

/**
 * Visit the open walk's cards in its order, calling `onCard` on each settled card; it returns
 * "stop" to end the visit on that card, "next" to Skip it (Skip writes nothing). Contract: ENTRY
 * the walk is open. EXIT a card `onCard` stopped on, or the end screen. Returns whether `onCard`
 * stopped. `maxCards` is a runaway guard (the largest insert here is 201 cards).
 */
async function visitWalk(page: Page, onCard: () => Promise<"stop" | "next">, maxCards = 220): Promise<boolean> {
  const card = tidyTile(page, "More about this card");
  const end = tidyFooterButton(page, "done");
  for (let i = 0; i < maxCards; i++) {
    await expect(card.or(end).first()).toBeVisible();
    if (await end.isVisible()) return false;
    await expectCardSettled(page);
    if ((await onCard()) === "stop") return true;
    await skipCard(page);
  }
  throw new Error(`the walk did not end within ${maxCards} cards`);
}

/**
 * On the open card, move `name`'s open Player row to Football and add him there as a new player,
 * with "Also add Baseball to their sports" left UNTICKED (so his Baseball cards are guest cards).
 * Contract: ENTRY `name`'s row is open on screen. EXIT the row reads answered.
 */
async function addAsFootballPlayer(page: Page, name: string, axeLabel: string): Promise<void> {
  const row = playerRow(page, name);
  await expect(row.getByText("Checking for players by that name…")).toHaveCount(0);
  await row.getByRole("button", { name: `Sport for this name: ${TARGET.sport}` }).click();
  const chooser = page.getByRole("listbox", { name: "Choose a sport" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("option", { name: "Football", exact: true }).click();
  await expect(chooser).toBeHidden();
  await expect(row.getByRole("button", { name: "Sport for this name: Football" })).toBeVisible();
  // The cross-sport checkbox is offered and left UNTICKED: the set's sport is not added to his
  // sports, which is what makes the Baseball cards guest cards.
  const alsoBaseball = row.getByRole("checkbox", { name: `Also add ${TARGET.sport} to their sports` });
  await expect(alsoBaseball).toBeVisible();
  await expect(alsoBaseball).not.toBeChecked();
  await expect(row.getByText("Checking for players by that name…")).toHaveCount(0);
  await expectAccessible(page, { within: tidyWalk(page), label: axeLabel });
  await row.getByRole("button", { name: /^Add as new player( .+)?$/, disabled: false }).click();
  await expect(editPlayer(row, name), `${name} was added`).toBeVisible();
  await expect(row.getByRole("button", { name: NOT_A_PLAYER })).toHaveCount(0);
}

/**
 * Open `name` under the set's Insert type, upload its captured checklist, fetch, settle Match Cards
 * on the file's measured fact (confirmed, or skipped with the save first: NEO-640) and settle
 * whether the walk opened. Contract: ENTRY the Variant
 * Types column is open with Insert listed. `reconcile` (live only) makes `inserts` their own sets
 * in the Reconcile Inserts dialog; the paused column fills from BSC alone. EXIT the cards are saved;
 * returns whether the walk is open.
 */
async function fetchInsert(
  page: Page,
  env: Parameters<typeof drillToSet>[1],
  name: string,
  {
    reconcile,
    target = TARGET,
    inserts = INSERTS,
  }: { reconcile: boolean; target?: typeof TARGET; inserts?: readonly string[] },
): Promise<boolean> {
  const dialog = page.getByRole("dialog", { name: "Reconcile Inserts" });
  await columnOption(page, "Variant Types", "Insert").click();
  if (!env.SL_PAUSED && reconcile) {
    await openInsertsReconcile(page, env);
    for (const insert of inserts) {
      await dialog.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill(insert);
      await dialog.getByRole("textbox", { name: "Filter BSC items" }).fill(insert);
      const insertSet = dialog.getByRole("textbox", { name: `NeonBinder set name for ${insert}`, exact: true });
      const makeOwn = dialog.getByRole("button", { name: `Make its own set: ${insert}`, exact: true });
      await expect(insertSet.or(makeOwn)).toBeVisible();
      if (await makeOwn.isVisible()) await makeOwn.click();
      await expect(insertSet).toBeVisible();
    }
    await dialog.getByRole("button", { name: /^Save [0-9]+ sets/ }).click();
    await expect(dialog).toBeHidden();
    // Saving leaves the columns at the offset the dialog opened from: re-drill.
    await drillToSet(page, env, target);
    await columnOption(page, "Variant Types", "Insert").click();
  } else if (env.SL_PAUSED) {
    await expect(columnHeading(page, "Inserts")).toBeVisible();
    await expect(dialog).toBeHidden();
  }
  // The paused column fills from BSC when it is opened: a BSC round trip under the column's wait
  // line (measured 2.3 s at most on the #487 merge-group run (GUIDE)), so 7 s plus the seconds BSC
  // is visibly holding it.
  await columnSearch(page, "Inserts").fill(name);
  await expectAfterBscSync(page, columnOption(page, "Inserts", name), `Inserts row ${name}`);
  await columnOption(page, "Inserts", name).click();
  // The empty-checklist assert makes the saved cards below THIS fetch's (fresh-only guard).
  await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  const checklist = CHECKLIST_OF[name];
  if (checklist === undefined) throw new Error(`${name} has no captured checklist in CHECKLIST_OF`);
  const published = await usePublishersChecklist(page, checklist);
  await syncChecklistButton(page).click();
  // NEO-496 (D10), NEO-640 (C5): BSC plus the uploaded checklist are two sources. Most of these
  // files pair every card at 100%, so Match Cards sits out and the cards save first; Peak
  // Performance Relics' repeated numbers open it. The helper settles on the file's fact (never a
  // race), waiting 7 s of ours plus BSC's. NEO-645: the save lands, then the walk opens on the
  // cards that need a person. A kept BSC-only card can change the count, so only its shape is pinned
  // here (the skip's exact count is the helper's assert).
  await settleChecklistFetch(page, env, { facts: published, what: `${name}'s fetch` });
  return settleWalkAfterCommit(page, page.getByText(/^Saved [1-9][0-9]* cards?\./).filter({ visible: true }).first());
}

/** In the open checklist: find card `number` by `player` and read its drawer's teams. */
async function expectCardTeam(page: Page, number: string, player: string, team: string): Promise<void> {
  await page.getByRole("searchbox", { name: "Search cards" }).fill(player);
  await editCardButton(page, number).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: `Remove team ${team}`, exact: true }), `#${number} carries ${team}`).toBeVisible();
  await page.getByRole("button", { name: "Done editing card" }).click();
  await expect(drawer).toBeHidden();
}

/** On /admin/players: open the player row whose accessible name matches `row`. */
async function openPlayer(page: Page, filter: string, row: RegExp | string): Promise<void> {
  await page.getByRole("textbox", { name: "Filter players" }).fill(filter);
  await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: row, ...(typeof row === "string" ? { exact: true } : {}) }).click();
}

test(
  "Tidy Up — a name linked on a saved card of the set links to the same player on the set's next variant (another sport's player, a Hall of Famer), the Player tile shows the link with no note and its Edit re-asks it; a club held in several eras links from its player's stint, never from set history; a year on, the prior year's edition suggests the same player (NEO-424, NEO-602)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    // ── PHASE 0: the fixture, from the UI: a FOOTBALL Michael Brantley ──
    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);
    await addPlayerByHand(page, BRANTLEY, "Football");

    // ── PHASE 1: cold drill to Baseball / 2010 / Topps / Topps; FIRST's STAR goes to Football ──
    await drillToColdManufacturer(page, env, { sport: TARGET.sport, year: TARGET.year, manufacturer: TARGET.manufacturer });
    await expect(setBuilderReady(page)).toBeVisible();
    // The Sets column's LISTBOX renders only once it holds a row (the cold year's first sync).
    await expectStepWithSportLots(page, page.getByRole("listbox", { name: "Sets" }), env, {
      liveMs: LIVE_BSC_FETCH,
      what: "the Sets list",
    });
    await pick(page, "Sets", TARGET.set);
    await expect(columnHeading(page, "Variant Types")).toBeVisible();
    await expectStepWithSportLots(page, columnOption(page, "Variant Types", "Insert"), env, {
      liveMs: VARIANT_TYPES_SYNC,
      what: "Variant Types row Insert",
    });
    expect(await fetchInsert(page, env, FIRST, { reconcile: true }), `${STAR} is unknown, so ${FIRST}'s walk opens`).toBe(true);
    let met = await visitWalk(page, async () => ((await openPlayerRow(page, STAR).count()) > 0 ? "stop" : "next"));
    expect(met, `${FIRST}'s walk shows ${STAR}'s open row`).toBe(true);
    await addAsFootballPlayer(page, STAR, "Tidy Up walk, a name moved to Football");
    // Every answer is saved; the other cards' questions are not this spec's.
    await saveForLater(page);

    // ── PHASE 2: SECOND. STAR arrives linked from the set's history; Brantley is rule E2 ──
    await drillToSet(page, env, TARGET);
    expect(await fetchInsert(page, env, SECOND, { reconcile: false }), `${BRANTLEY} is unknown here, so the walk opens`).toBe(true);
    let sawStar = false;
    let sawBrantley = false;
    met = await visitWalk(page, async () => {
      const star = playerRow(page, STAR);
      if (!sawStar && (await star.count()) > 0) {
        sawStar = true;
        // Linked at the commit; nothing to answer. Positive first: the row reads answered, its
        // Edit offered. J1, read against it: no "Linked for you" note, and no note of any kind.
        await expect(editPlayer(star, STAR), `${STAR} arrives linked`).toBeVisible();
        await expect(star.getByText(LINKED_FOR_YOU)).toHaveCount(0);
        await expect(star.getByRole("note")).toHaveCount(0);
        await expect(star.getByRole("button", { name: NOT_A_PLAYER })).toHaveCount(0);
        await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, a name linked from this set" });
        // Edit clears the link and re-asks (C1). The row's sport is still Football (his phase-1
        // answer), so STAR is the one exact namesake there. Main's rule (NEO-645 A7, reverted to
        // main): an exact namesake is the stronger, live answer, so it leads and the set-history
        // suggestion, with its reason line, gives way to it.
        await editPlayer(star, STAR).click();
        const linkExact = star.getByRole("button", { name: `Link to ${STAR}`, exact: true });
        await expect(linkExact).toBeVisible();
        await expect(star.getByRole("button", { name: "Sport for this name: Football" })).toBeVisible();
        await expect(star.getByRole("button", { name: /^Add as new player anyway( .+)?$/ })).toBeVisible();
        await expect(star.getByRole("button", { name: `Link to ${STAR} (Football)`, exact: true })).toHaveCount(0);
        await expect(star.getByText(/^Another card in this set is already linked to /)).toHaveCount(0);
        await expect(star.getByText(LINKED_FOR_YOU)).toHaveCount(0);
        await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, the exact namesake after Edit" });
        await linkExact.click();
        await expect(editPlayer(star, STAR), `${STAR} is linked again`).toBeVisible();
        await expect(linkExact).toHaveCount(0);
        // A link says nothing (J1): no note on the answered row.
        await expect(star.getByRole("note")).toHaveCount(0);
      }
      const brantley = openPlayerRow(page, BRANTLEY);
      if (!sawBrantley && (await brantley.count()) > 0) {
        sawBrantley = true;
        await expect(brantley.getByText("Checking for players by that name…")).toHaveCount(0);
        // One Michael Brantley on file, in Football: the promoted link, the demoted create, the reason.
        await expect(brantley.getByRole("button", { name: `Link to ${BRANTLEY} (Football)`, exact: true })).toBeVisible();
        await expect(brantley.getByRole("button", { name: /^Add as new player anyway( .+)?$/ })).toBeVisible();
        await expect(brantley.getByText(`We've only got one ${BRANTLEY} (Football) on file. Same one?`, { exact: true })).toBeVisible();
        await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, one namesake on file (rule E2)" });
        // Left unanswered: Skip writes nothing.
      }
      return sawStar && sawBrantley ? "stop" : "next";
    });
    expect(sawStar, `${STAR}'s card was in ${SECOND}'s walk`).toBe(true);
    expect(sawBrantley, `${BRANTLEY}'s card was in ${SECOND}'s walk`).toBe(true);
    expect(met).toBe(true);
    await saveForLater(page);

    // ── PHASE 3: THIRD. Hall of Famers and historic clubs are linked with no stop ──
    await drillToSet(page, env, TARGET);
    // Whether the walk opens depends on the insert's other names; this phase asks it nothing.
    if (await fetchInsert(page, env, THIRD, { reconcile: false })) await saveForLater(page);
    await expect(tidyWalk(page)).toBeHidden();
    for (const [club, player] of HISTORIC_CLUBS) {
      const number = { "Walter Johnson": "PP-4", "Jimmie Foxx": "PP-21", "George Sisler": "PP-22" }[player] ?? "";
      await expectCardTeam(page, number, player, club);
    }

    // ── PHASE 4: FOURTH. The Browns link from Sisler's stint, never from set history ──
    await drillToSet(page, env, TARGET);
    if (await fetchInsert(page, env, FOURTH, { reconcile: false })) {
      // Wherever the walk shows the Browns, no note claims a reason (NEO-602, J1).
      await visitWalk(page, async () => {
        const browns = tidyTile(page, "Team").getByRole("group", { name: `Team ${BROWNS}`, exact: true });
        if ((await browns.count()) > 0) {
          await expect(browns.getByText(BROWNS, { exact: true }).first()).toBeVisible();
          await expect(browns.getByText(LINKED_FOR_YOU)).toHaveCount(0);
        }
        return "next";
      });
      await tidyFooterButton(page, "done").click();
    }
    await expect(tidyWalk(page)).toBeHidden();
    await expectCardTeam(page, "TR92", "George Sisler", BROWNS);

    // The Hall of Famers: the 1943 Joe Morgan's page lists THIRD's card; the other BASEBALL Joe
    // Morgan's does not. The catalogue also files a Football Joe Morgan (b. 1928, 49ers), so every
    // row is named by sport as well as born year: a row's name reads "<name> <sport> b. <year> <team>".
    await page.goto("/admin/players");
    await expectPlayersLoaded(page);
    await openPlayer(page, MORGAN, /^Joe Morgan Baseball\b.*\bb\. 1943\b/);
    await expect(page.getByRole("list", { name: `Cards for ${MORGAN}` })).toContainText(THIRD);
    await openPlayer(page, MORGAN, /^Joe Morgan Baseball\b(?!.*\bb\. 1943\b)/);
    await expect(page.getByText("Sport: Baseball").first()).toBeVisible();
    await expect(page.getByRole("list", { name: `Cards for ${MORGAN}` }).filter({ hasText: THIRD })).toHaveCount(0);
    await openPlayer(page, GIBSON, /^Bob Gibson Baseball\b.*\bb\. 1935\b/);
    await expect(page.getByRole("list", { name: `Cards for ${GIBSON}` })).toContainText(THIRD);

    // ── PHASE 5: STAR's page lists both cards as Baseball GUEST cards ──
    await openPlayer(page, STAR, `${STAR} Football`);
    await expect(page.getByText("Sport: Football").first()).toBeVisible();
    const cards = page.getByRole("list", { name: `Cards for ${STAR}` });
    // Exactly the two inserts' cards: no second player was minted for the second insert.
    await expect(cards.getByRole("listitem")).toHaveCount(2);
    await expect(cards).toContainText(FIRST);
    await expect(cards).toContainText(SECOND);
    // A card is tagged with its sport only when it is NOT one of the player's: two Baseball tags.
    await expect(cards.getByText(TARGET.sport, { exact: true })).toHaveCount(2);
    await expectAccessible(page, { label: "Player detail with both inserts' cards linked" });

    // ── PHASE 6: the prior year's edition suggests the player (rule E1) ──
    await drillToColdManufacturer(page, env, {
      sport: TARGET_2009.sport,
      year: TARGET_2009.year,
      manufacturer: TARGET_2009.manufacturer,
    });
    await expectStepWithSportLots(page, page.getByRole("listbox", { name: "Sets" }), env, {
      liveMs: LIVE_BSC_FETCH,
      what: "the Sets list",
    });
    await pick(page, "Sets", TARGET_2009.set);
    await expect(columnHeading(page, "Variant Types")).toBeVisible();
    await expectStepWithSportLots(page, columnOption(page, "Variant Types", "Insert"), env, {
      liveMs: VARIANT_TYPES_SYNC,
      what: "Variant Types row Insert",
    });
    expect(
      await fetchInsert(page, env, PRIOR, { reconcile: true, target: TARGET_2009, inserts: [PRIOR] }),
      `${WEEKS} is unknown, so ${PRIOR}'s walk opens`,
    ).toBe(true);
    // Two Chris Carpenters are on file; the checklist's Cardinals settle him, so no card asks which.
    const carpenter = tidyWalk(page).getByText(/^Which Chris Carpenter is this\?$/);
    met = await visitWalk(page, async () => {
      await expect(carpenter, "a Chris Carpenter card asks which one").toHaveCount(0);
      return (await openPlayerRow(page, WEEKS).count()) > 0 ? "stop" : "next";
    });
    expect(met, `${PRIOR}'s walk shows ${WEEKS}'s open row`).toBe(true);
    await addAsFootballPlayer(page, WEEKS, "Tidy Up walk, a 2009 name moved to Football");
    await saveForLater(page);

    // 2010 side: Weeks is on no 2010 card of the set and no Baseball player has his name.
    await drillToSet(page, env, TARGET);
    expect(await fetchInsert(page, env, SIXTH, { reconcile: false }), `${WEEKS} is a suggestion, so the walk opens`).toBe(true);
    met = await visitWalk(page, async () => ((await openPlayerRow(page, WEEKS).count()) > 0 ? "stop" : "next"));
    expect(met, `${SIXTH}'s walk shows ${WEEKS}'s open row`).toBe(true);
    const weeks = playerRow(page, WEEKS);
    await expect(weeks.getByText("Checking for players by that name…")).toHaveCount(0);
    const linkWeeks = weeks.getByRole("button", { name: `Link to ${WEEKS} (Football)`, exact: true });
    await expect(linkWeeks).toBeVisible();
    await expect(weeks.getByRole("button", { name: /^Add as new player anyway( .+)?$/ })).toBeVisible();
    // The REASON tells E1 from E2: both put the same button on screen.
    await expect(weeks.getByText(`Last year's edition of this set had ${WEEKS} (Football). Same one?`, { exact: true })).toBeVisible();
    await expect(weeks.getByText(`We've only got one ${WEEKS} (Football) on file. Same one?`)).toHaveCount(0);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, last year's edition suggests a player (rule E1)" });
    await linkWeeks.click();
    await expect(editPlayer(weeks, WEEKS), `${WEEKS} is linked`).toBeVisible();
    await expect(linkWeeks).toHaveCount(0);
    await saveForLater(page);

    // ── PHASE 7: Weeks's page lists both cards as Baseball GUEST cards ──
    await page.goto("/admin/players");
    await expectPlayersLoaded(page);
    // Exact: the filter is a substring and lists the catalogue's "Rickie Weeks Jr." beside him.
    await openPlayer(page, WEEKS, `${WEEKS} Football`);
    await expect(page.getByText("Sport: Football").first()).toBeVisible();
    const weeksCards = page.getByRole("list", { name: `Cards for ${WEEKS}` });
    await expect(weeksCards.getByRole("listitem")).toHaveCount(2);
    await expect(weeksCards).toContainText(PRIOR);
    await expect(weeksCards).toContainText(SIXTH);
    await expect(weeksCards.getByText(TARGET.sport, { exact: true })).toHaveCount(2);
  },
);
