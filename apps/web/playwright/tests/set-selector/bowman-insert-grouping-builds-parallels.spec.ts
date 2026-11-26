// Origin: .maestro/flows/set-selector/bowman-insert-grouping-builds-parallels.yaml (Maestro suite retired in NEO-341; see git history)
// Fresh-only: it saves 2026 Bowman's inserts as sets, groups them, and builds
// Anime Kanji's cards from Anime.
//
// NEO-535 (parallel copies and the Card titles dialog), the second claim of
// this spec. The build's copies take their title in Jason's order: the builder's
// own, else the source card's hand edit re-headed with the parallel's
// description, else the builder's flagged result, and those go to a "Card
// titles" dialog. This flow proves that order on Anime's real parallels:
//   * `Anime Black Refractors` is renamed to a name so long that its
//     description alone is over 80 (the rename lands BEFORE the cards are
//     fetched, so the automatic build writes titles that cannot fit). The
//     dialog opens by itself when the build ends, lists THAT parallel only
//     (the other three parallels fit). NEO-581: one card's own title saved
//     alone lowers the ticker's "Fix N card titles" and its built line's
//     "N titles need a fix" by one; then one shorter "Set name in titles"
//     fixes every other title ("Every title fits now."), and the button and
//     the clause leave the ticker (it used to keep a button that said
//     "Nothing to fix."). The parallel opens with the box text in its titles,
//     the card's own title intact, and nothing to fix (no pink, no title to
//     fix). NEO-656: the career-gap check reads live data, so the real players
//     whose careers miss the card's team and year (Team USA, Japan, new MLB
//     teams) keep a blue "N need you" on the copies; blue is allowed here.
//   * `Anime Red Refractors` is renamed to a name whose description is 65
//     characters (the builder says the shared word "Anime" once: the parallel's
//     name starts with its insert's, so the description reads
//     "2026 Bowman <parallel>"), and Anime's BA-3 title is hand edited to drop
//     the first name ("Murakami #BA-3"). Rebuilt, BA-3 is the one card the
//     builder fails on (it would lose "Munetaka") that the hand edit rescues,
//     so the copy carries the edit at exactly 80 characters and is not in the
//     dialog; every other card had to leave something out (NEO-609: a team,
//     the number or a first name), so the other 28 are, the four whose names
//     are longest (BA-12, BA-19, BA-20, BA-29) among them. The checklist's own
//     "Fix card titles" reopens the dialog after a reload.
//   * The dialog's "Set name in titles" box opens holding the full set
//     description including the parallel's name (never a bare insert name);
//     typing it past 80 is refused in place and again on Save; Escape after an
//     edit asks "Toss your title edits?" and tossing forgets the edit.
//   Both are renamed back at the end. The arithmetic (`calc` of the builder over
//   the 29 BA- cards of fixtures/checklists/2026-bowman-insert-anime.csv) is
//   in the comment at LONG_PARALLEL and CARRY_PARALLEL.
//   NEO-645 (a card's own name is always in its title) leaves it unchanged:
//   every Anime card is named for its player, and a name that only says the
//   players again adds nothing (`cardSubjectName`), so each copy's title is the
//   player card's as before (re-checked offline with `assessListingTitle`, the
//   player's name passed as the card name: same titles, 29 failing on
//   CARRY_PARALLEL before BA-3's carry, none on BLACK).
//
// NEO-661, the third claim: a card still waiting on its BSC team lookup holds the insert's
// parallels back (Jason, 2026-11-24, asked whether such a card should: "Yes, wait for lookups").
// The uploaded checklist leaves LOOKUP_CARD's team cell BLANK (a blank cell makes no claim, so
// the fetch asks BSC for that one card's team, GUIDE "Checklist first"), and the fake answers that
// card-listing read 429 with a long Retry-After (`bscFake`, the 429 spec's rule): the cooldown ends
// the lookup and the card waits on the background lane ("Still looking up teams for 1 card.").
// The walk answers every pink; the card is not pink (a card owed its lookup never is), so after
// the walk nothing is pink and only the lookup holds the build: no "Building parallels of Anime"
// line while the status line shows. The fault is then cleared (the build's own BSC reads need the
// gate shut) and the operator settles the card ("No Team for this card" in its drawer), so no card
// awaits a lookup and the build starts with no click. NEO-562: the save is proved by what it causes
// (the hold releases, the build starts, the drawer comes back with No Team pressed), not by the
// "Saved No Team" toast: the build closes the drawer about 80 ms after the save (NEO-312) and the
// toast goes with it, so the toast is on screen only for that instant.
//   WHY THE OPERATOR AND NOT THE LANE ends the wait: Anime is uploaded whole as a publisher's
// checklist, so no spec asks BSC for an Anime card's team and none of those card-listing answers
// is known to be recorded; an unrecorded read 501s, is retried after 60 s and 5 min, then handed
// to the operator, and the lane waits out the Retry-After first in any case. The client's hold re-reads the live rows (`blocksParallelBuild`), so it releases the
// same way whichever write ends the wait; the lane's own write is the 429 spec's and the unit
// tests' (`bscTeamPool`, `parallelBuildHold`). The Retry-After (600 s, the gate's ceiling) outlasts
// the walk, so the lane never gets a turn before the release; afterwards its turn finds the card
// stamped and makes no call.
//   LOOKUP_CARD is #98 (CeeDee Lamb), a football player the Baseball catalogue does not hold: the
// walk adds him as a new player with no career, and no other card of his is in the set, so no fill
// rule writes a team at the save or in the walk (a filled team ends the wait; every BA- player is
// a catalogue player whose one team in the window the save fills, measured on this seed). Its only
// copy is Anime Kanji's, whose titles fit with or without a team, so the NEO-535 arithmetic below
// is untouched.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  columnHeading,
  columnOption,
  columnSearch,
  drillToSet,
  escapeRe,
  expectAfterBscSync,
  openAttributesPanel,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { CHECKLISTS, savedLine, settleChecklistFetch, usePublishersChecklist } from "../../support/published-checklist";
import { needsYouPill, settleWalkAfterCommit, tidyForTheParallelBuild, tidyWalk } from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const BOWMAN = { sport: "Baseball", year: "2026", manufacturer: "Bowman", set: "Bowman" };
/** 201 and up: the grouping suggestions the flow expects for the whole Bowman year. */
const OVER_200 = "(20[1-9]|2[1-9][0-9]|[3-9][0-9][0-9]|[1-9][0-9]{3,})";

// NEO-535 ── the parallels the flow renames, and the arithmetic behind each name.
// Every copy's description is "2026 Bowman Anime " + the parallel's name (the
// builder never cuts a description word).
/** Anime's first parallel, as BSC names it. */
const BLACK = "Anime Black Refractors";
/**
 * BLACK renamed: the description is 102 characters, so no title of this
 * parallel can fit and every card of it (29) is failing.
 */
const LONG_PARALLEL = "Anime Black Refractors Hologram Collectors Anniversary Platinum Rainbow Foil Edition";
/**
 * A parallel's description is "2026 Bowman " + its name: the name starts with
 * the insert's ("Anime"), and the builder says that word once. LONG_PARALLEL's
 * is 96 characters, so no title of the parallel can fit.
 */
const descriptionOf = (parallel: string) => `2026 Bowman ${parallel}`;
/** What the operator types into "Set name in titles" for LONG_PARALLEL: the box replaces the whole description. */
const FIX_BOX = "2026 Bowman Anime Black";
/** The cards each parallel holds (the 29 `BA-` rows of the Anime checklist file). */
const COPIES = 29;
/**
 * NEO-581 — BA-1's own title, saved on its own in LONG_PARALLEL's dialog
 * before the box (the partial fix). 32 characters, so it fits; it starts with
 * FIX_BOX so PART 5's "every title starts with the box text" holds for it too.
 */
const OWN_TITLE = `${FIX_BOX} Oh #BA-1`;
/** Anime's third parallel, as BSC names it. */
const RED = "Anime Red Refractors";
/**
 * RED renamed: the description is 65 characters, so with a player's name and
 * number no title of it fits whole: every one of the 29 has to give up its
 * team, its number or a first name (NEO-609: a Tidy Up cut, so it is on the
 * Card titles dialog). BA-12, BA-19, BA-20 and BA-29, whose names are the
 * longest, lose a first name; BA-3 (Munetaka Murakami) would too, and its hand
 * edit below, re-headed, is exactly 80, so it is carried and is the one card
 * off the dialog: 28 titles.
 */
const CARRY_PARALLEL = "Anime Red Refractors Hologram Foils Anniversary Prism";
/** BA-3's title as the operator edits it on Anime: the first name dropped. */
const HAND_EDIT = "2026 Bowman Anime Murakami #BA-3";
/** What BA-3's copy on CARRY_PARALLEL reads: the edit, re-headed with that parallel's description. */
const CARRIED_TITLE = `${descriptionOf(CARRY_PARALLEL)} Murakami #BA-3`;
// NEO-661 ── the card whose team lookup holds the build (header, third claim).
/** Anime's card whose checklist team cell is left blank, so BSC is asked for it (and answers 429). */
const LOOKUP_CARD = "98";
/** Its player as printed: the drawer's search handle. */
const LOOKUP_PLAYER = "CeeDee Lamb";
/** The gate's Retry-After ceiling (`RETRY_AFTER_MAX_MS`): the lane gets no turn before the release. */
const LOOKUP_RETRY_AFTER_S = 600;

/** Rename the option the attributes panel is showing, by its pencil. */
async function renameSelected(page: Page, from: string, to: string): Promise<void> {
  // NEO-569: the pencil sits in the open panel only, and a parallel starts it
  // shut. Gate on the row's own header first, so the open lands on `from`.
  await expect(page.getByRole("heading", { name: new RegExp(`^Attributes for ${escapeRe(from)} \\(Parallel\\)$`) })).toBeVisible();
  await openAttributesPanel(page);
  await page.getByRole("button", { name: `Rename ${from}`, exact: true }).click();
  const field = page.getByRole("textbox", { name: `Edit name for ${from}`, exact: true });
  await field.fill(to);
  await field.press("Enter");
  // The panel header names the row it shows: the rename landed on the row meant.
  await expect(page.getByRole("heading", { name: new RegExp(`^Attributes for ${escapeRe(to)} \\(Parallel\\)$`) })).toBeVisible();
}

/** Set once the Anime fetch is pressed: from then on LOOKUP_CARD's lookup may sit on the BSC team lane. */
const run = { synced: false };

// NEO-644: pass or fail, the lookup this spec leaves waiting (LOOKUP_CARD, 429'd) comes off the BSC
// team lane. The lane is one slot per deployment, so it would otherwise run after the spec ends, in
// front of every other shard's per-card team lookups. Only this test user's items are cancelled; one
// already running finishes. The count is recorded, not asserted: marking the card No Team may already
// have ended its lookup, so zero is a valid teardown here.
test.afterEach(async ({ bscFake }, testInfo) => {
  if (!run.synced) return;
  run.synced = false;
  const cleared = await bscFake.clearTeamLane();
  testInfo.annotations.push({ type: "bsc-team-lane-cleared", description: String(cleared) });
});

test(
  "2026 Bowman inserts — BSC's inserts become NB sets, Group Parallels nests Anime Kanji under Anime, and saving Anime builds Kanji's cards (NEO-293…312)",
  { tag: ["@set-selector", "@parallel-grouping"] },
  async ({ page, signIn, env, bscFake }) => {
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });
    const grouping = page.getByRole("dialog").filter({ hasText: /Drag inserts under a parent/ });
    const insert = columnOption(page, "Variant Types", "Insert");

    /** Re-drill to Bowman's Insert column from a fresh page load. */
    const openInserts = async () => {
      await drillToSet(page, env, BOWMAN);
      await insert.click();
    };
    const searchAnime = async () => {
      await columnSearch(page, "Inserts").fill("Anime");
      await expect(columnOption(page, "Inserts", "Anime")).toBeVisible();
    };

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openInserts();

    if (!env.SL_PAUSED) {
      // ── PART 1: Sync Inserts opens Reconcile (both marketplaces, live: the flow's 240 s) ──
      await page.getByRole("button", { name: "Sync Inserts" }).click();
      await expect(reconcile).toBeVisible({ timeout: 240_000 });

      const filterSets = reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" });
      const filterBsc = reconcile.getByRole("textbox", { name: "Filter BSC items" });
      await filterSets.fill("Anime");
      await filterBsc.fill("Anime");

      // "Anime" is either already a set (a rerun) or still BSC-only: make it its own set.
      const animeSet = reconcile.getByRole("textbox", { name: "NeonBinder set name for Anime", exact: true });
      const animeOwn = reconcile.getByRole("button", { name: "Make its own set: Anime", exact: true });
      await expect(animeSet.or(animeOwn)).toBeVisible();
      if (await animeOwn.isVisible()) await animeOwn.click();
      await expect(animeSet).toBeVisible();
      await expect(
        reconcile
          .getByRole("textbox", { name: "NeonBinder set name for Anime Kanji", exact: true })
          .or(reconcile.getByRole("button", { name: "Make its own set: Anime Kanji", exact: true })),
      ).toBeVisible();
      await expect(reconcile.getByRole("button", { name: /^Keep all [1-9][0-9]*, BSC sets?$/ })).toBeVisible();
      await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts dialog" });

      // Keep all of the rest of BSC's inserts: Ready grows by exactly what was pending in BSC.
      await filterBsc.clear();
      const bscCount = reconcile.getByText(/BSC \([1-9][0-9]*\)/);
      await expect(bscCount).toBeVisible();
      const summary = reconcile.getByText(/[0-9]+ ready, [0-9]+ pending/);
      const readyBefore = Number(((await summary.textContent()) ?? "").split(" ")[0]);
      const keepAllN = Number((((await bscCount.textContent()) ?? "").match(/\((\d+)\)/) ?? [])[1]);
      expect(readyBefore).toBeGreaterThan(0);
      expect(keepAllN).toBeGreaterThan(0);
      await reconcile.getByRole("button", { name: /^Keep all(?: [1-9][0-9]*)?, BSC sets?$/ }).click();
      await expect(reconcile.getByText(new RegExp(`^${readyBefore + keepAllN} ready, [0-9]+ pending`))).toBeVisible();

      await expect(
        reconcile.getByRole("textbox", { name: "NeonBinder set name for Anime Kanji", exact: true }),
      ).toBeVisible();
      await expect(animeSet).toBeVisible();
      await reconcile.getByRole("button", { name: /^Save [0-9]+ sets/ }).click();
      await expect(reconcile).toBeHidden();
      await openInserts();
    } else {
      // Paused: SportLots offers no twin, so the sets come in without a reconcile.
      // BSC alone (the fake, NEO-552): the column's own wait line covers its sync, so 7 s plus
      // the seconds BSC is visibly holding it (measured on the #487 merge-group run (GUIDE): 0.2 s for the heading, 1.8 s for the row).
      await expectAfterBscSync(page, columnHeading(page, "Inserts"), "the Inserts column opening");
      await expect(reconcile).toBeHidden();
      // The heading shows while the column's BSC sync is still running ("Syncing Inserts"),
      // before Anime is written: searching at that moment reads "No matches found", so the row
      // is waited on by the marketplace rule, not by a flat number.
      await columnSearch(page, "Inserts").fill("Anime");
      await expectAfterBscSync(page, columnOption(page, "Inserts", "Anime"), "the Inserts row Anime");
    }

    // ── PART 2: both are inserts; Group Parallels nests Kanji under Anime ──
    await searchAnime();
    await expect(columnOption(page, "Inserts", "Anime Kanji")).toBeVisible();
    await page.getByRole("button", { name: "Group Parallels" }).click();
    await expect(grouping).toBeVisible();
    await expectAccessible(page, { within: grouping, label: "Group Parallels dialog with suggestions" });
    await grouping.getByRole("button", { name: new RegExp(`^Accept all suggestions \\(${OVER_200}\\)`) }).click();
    await expect(grouping.getByText(new RegExp(`${OVER_200} promotions, 0 demotions`))).toBeVisible();
    await grouping.getByRole("button", { name: new RegExp(`^Save ${OVER_200} changes`) }).click();
    await expect(grouping).toBeHidden();

    // Saved: Anime Kanji left the top level, and the grouping has nothing left to suggest.
    await openInserts();
    await searchAnime();
    await expect(columnOption(page, "Inserts", "Anime Kanji")).toBeHidden();
    await page.getByRole("button", { name: "Group Parallels" }).click();
    await expect(grouping).toBeVisible();
    await expect(grouping.getByRole("checkbox", { name: /^Select .+/ }).first()).toBeVisible();
    await expect(grouping.getByText("No changes yet")).toBeVisible();
    await expectAccessible(page, { within: grouping, label: "Group Parallels dialog with nothing left to suggest" });
    await expect(grouping.getByRole("button", { name: /^Accept all suggestions \([0-9]+\)/ })).toBeHidden();
    await grouping.getByRole("button", { name: "Cancel" }).click();
    await expect(grouping).toBeHidden();

    // ── PART 3: a re-sync leaves grouped parallels be ──
    await page.getByRole("button", { name: "Sync Inserts" }).click();
    if (!env.SL_PAUSED) {
      await expect(reconcile).toBeVisible({ timeout: 240_000 });
    } else {
      // BSC alone: 7 s plus the seconds the column's wait line is up (measured 1.3 s on the #487 merge-group run (GUIDE)).
      await expectAfterMarketplace(
        page,
        page.getByText(
          /Stored [0-9]+ variants \(single platform\)|Some variants were not stored|Sync failed: could not load variants/,
        ),
        { platform: "BuySportsCards", what: "the Inserts re-sync's result line" },
      );
    }
    await expect(
      page.getByText(/[0-9]+ already grouped as (a parallel|parallels)\. Leaving (it|those) be\./),
    ).toBeVisible();
    await expect(page.getByText("Show grouped")).toBeVisible();
    if (!env.SL_PAUSED) {
      await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts dialog leaving grouped parallels be" });
      await reconcile.getByRole("button", { name: /^Save [0-9]+ sets/ }).click();
      await expect(reconcile).toBeHidden();
    }

    // ── PART 4: opening Anime lists Kanji as its parallel; syncing Anime builds Kanji's cards ──
    await openInserts();
    await searchAnime();
    await expect(columnOption(page, "Inserts", "Anime Kanji")).toBeHidden();
    await columnOption(page, "Inserts", "Anime").click();
    await expect(columnHeading(page, "Parallels")).toBeVisible();
    await expect(columnOption(page, "Parallels", "Anime Kanji")).toBeVisible();

    // NEO-535, before any card exists: one parallel gets a name so long that its
    // description alone is over 80, so the build's copies for it cannot fit. A
    // rename never reaches the marketplaces (product invariant 4: they are
    // asked by their ids), and the other three parallels are left alone.
    await columnOption(page, "Parallels", BLACK).click();
    await renameSelected(page, BLACK, LONG_PARALLEL);
    await openInserts();
    await searchAnime();
    await columnOption(page, "Inserts", "Anime").click();
    await expect(columnOption(page, "Parallels", LONG_PARALLEL)).toBeVisible();
    await expect(columnOption(page, "Parallels", BLACK)).toBeHidden();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // The publisher's checklist (NEO-478): Anime's teams are BSC's own answers, uploaded, so the fetch
    // asks BSC for the cards' list and for no card's team (NEO-489: the number column is trusted as
    // printed, so the `TBD` card pairs by its number like the rest, 36 of 36). Six of the cards are
    // football players; the file carries their teams as BSC named them.
    // NEO-661: LOOKUP_CARD's team cell is left blank, so its team is asked of BSC (header, third claim).
    const facts = await usePublishersChecklist(page, CHECKLISTS.bowmanAnime2026, { teamCells: { [LOOKUP_CARD]: "" } });
    // ...and BSC answers that one read 429 (the cooldown ends the lookup; the card waits on the lane).
    // A few times over, so a second ask is refused too; the 429 opens only this worker's gate (NEO-628).
    await bscFake.setFaults([
      bscFault.tooManyRequests(BSC_PATH.cardListing, { retryAfterS: LOOKUP_RETRY_AFTER_S, times: 5, ttlS: 900 }),
    ]);
    run.synced = true;
    await syncChecklistButton(page).click();

    // NEO-496 (D10, NQ1): BSC plus the uploaded checklist are two sources. NEO-640: the file is
    // BSC's own 36 cards, each paired by its number at 100%, so Match Cards is skipped with
    // SportLots paused or live. The helper waits on the fetch (GUIDE R5's marketplace wait,
    // measured time plus 7 s) and proves the saved line with its reason and the teams line.
    await settleChecklistFetch(page, env, { facts, what: "the Anime fetch" });

    // NEO-645 C5: the cards SAVE first, then the Tidy Up walk opens on its own when a card needs
    // a person.
    const saved = savedLine(page, facts.rows);
    if (await settleWalkAfterCommit(page, saved)) {
      await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk after the Anime save" });
      // J3: the parallels copy Anime's cards, so they are built only once no card has a name
      // waiting. The walk answers them as the old wizard's save did (players and teams added
      // as new, the same-name pick's top candidate), and the build starts on its own.
      await tidyForTheParallelBuild(page);
    }

    // ── NEO-661: nothing is pink, but LOOKUP_CARD still waits on its team lookup, so nothing is built ──
    const lookupLine = page.getByRole("status").filter({ hasText: /^Still looking up teams for 1 card\./ });
    const buildLine = page.getByText(/Building parallels of Anime — |Anime parallels — /);
    await expect(
      lookupLine,
      `${LOOKUP_CARD} no longer waits on its lookup: a rule filled its team, or the lane answered it`,
    ).toBeVisible();
    await expect(buildLine, "a card still waiting on its team lookup holds the parallels").toHaveCount(0);
    await expectAccessible(page, { label: "Anime saved, parallels held while a team lookup runs" });
    // Still held after the axe passes' seconds (the build starts the moment the live rows clear).
    await expect(lookupLine).toBeVisible();
    await expect(buildLine, "a card still waiting on its team lookup holds the parallels").toHaveCount(0);

    // The release: the fault and this worker's gate cleared (the build reads BSC per parallel), then
    // the operator settles the card in its drawer. No card waits any more: the build starts by itself.
    await bscFake.clear();
    const searchCards = page.getByRole("searchbox", { name: "Search cards" });
    await searchCards.fill(LOOKUP_PLAYER);
    await editCardButton(page, LOOKUP_CARD).click();
    const drawerCardName = page.getByRole("textbox", { name: "Card name", exact: true });
    await expect(drawerCardName).toBeVisible();
    await page.getByRole("button", { name: "No Team for this card", pressed: false }).click();
    // NEO-562: the save is proved by what it causes (header), never by the "Saved No Team" toast.
    await expect(lookupLine).toHaveCount(0);

    // The build of Kanji's cards from Anime reports itself, then lands.
    await expect(
      page.getByText(/Building parallels of Anime — [0-9]+ of [0-9]+|Anime parallels — [^.]+/).first(),
    ).toBeVisible();
    // The build holds Anime, so the drawer is closed while it runs (NEO-312) and comes back when it
    // ends, still on the card, read from the stored card: No Team stuck. The build reads BSC per
    // parallel, so this waits by the marketplace rule (GUIDE R5; measured on the fake: 3.9 s desktop,
    // 4.1 s mobile, none of it BSC's).
    const drawer = page.getByRole("dialog", { name: `Card #${LOOKUP_CARD}`, exact: true });
    await expectAfterMarketplace(page, drawer.getByRole("button", { name: "No Team for this card", pressed: true }), {
      platform: "BuySportsCards",
      what: `card #${LOOKUP_CARD}'s drawer, back after the Anime parallels build`,
    });
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawerCardName).toBeHidden();
    await searchCards.clear();

    // ── NEO-535: the build ends with titles to fix, and Card titles opens by itself ──
    // The build fetches each parallel's checklist from BSC before writing it, and
    // the dialog follows the last parallel's write: 7 s plus the seconds BSC is
    // visibly holding it (the marketplace rule, GUIDE).
    const titlesDialog = page.getByRole("dialog", { name: "Card titles" });
    const titleRow = (number: string) => titlesDialog.getByRole("textbox", { name: new RegExp(`^Title for #${escapeRe(number)} `) });
    // NEO-645: the build starts the moment the walk answers Anime's last name, so it can end
    // while the walk is still open. The dialog never opens over another one: the door then says
    // the titles are waiting, and its button opens them. Either way the dialog opens (R2).
    // NEO-562: card #98's drawer comes back as the build ends, so the door says "waiting" here
    // (seen locally, desktop and mobile); it is closed above, so the door's button is free.
    const titlesWaiting = page.getByText(/^Card titles are waiting\. Press Fix [1-9][0-9]* card titles? when you're ready\.$/).first();
    await expectAfterMarketplace(page, titlesDialog.or(titlesWaiting).first(), {
      platform: "BuySportsCards",
      what: "the Card titles dialog after the Anime parallels build",
    });
    if (await titlesWaiting.isVisible()) {
      await page.getByRole("button", { name: /^Fix [1-9][0-9]* card titles?$/ }).click();
    }
    await expect(titlesDialog).toBeVisible();
    // It lists the one parallel whose names were made too long, not the other three.
    const sections = titlesDialog.getByRole("heading", { level: 3 });
    await expect(sections).toHaveCount(1);
    await expect(sections).toContainText(LONG_PARALLEL);
    // Every one of the 29 cards fails: the description alone is 96 characters.
    expect(descriptionOf(LONG_PARALLEL)).toHaveLength(96);
    await expect(sections).toContainText(`${COPIES} titles`);
    await expect(titlesDialog.getByRole("textbox", { name: /^Title for #/ }).first()).toBeVisible();
    await expectAccessible(page, { within: titlesDialog, label: "Card titles dialog, a parallel's copies that run long" });

    // The box opens holding the FULL set description, the parallel's name in it
    // (the insert's word said once), not a bare insert name; 96 is over the
    // box's 80, so it says it is sitting out.
    const box = titlesDialog.getByRole("textbox", { name: "Set name in titles", exact: true });
    await expect(box).toHaveValue(descriptionOf(LONG_PARALLEL));
    await expect(titlesDialog.getByRole("status").filter({ hasText: "Over 80, so it's sitting out." })).toBeVisible();

    // A box typed past 80 is refused in place, and again when Save is pressed
    // (naming the parallel, with focus on the box); nothing is written.
    const fixTitles = page.getByRole("button", { name: /^Fix [1-9][0-9]* card titles?$/ });
    await box.fill(`${descriptionOf(LONG_PARALLEL)} extra`);
    await box.press("Tab");
    await expect(titlesDialog.getByRole("alert").filter({ hasText: "Set name in titles tops out at 80 characters." })).toBeVisible();
    await titlesDialog.getByRole("button", { name: "Save titles" }).click();
    await expect(
      titlesDialog.getByRole("alert").filter({
        hasText: `${LONG_PARALLEL}'s Set name in titles won't save as typed. Fix it or put it back, then save.`,
      }),
    ).toBeVisible();
    await expect(box).toBeFocused();
    await expect(titlesDialog).toBeVisible();
    await expectAccessible(page, { within: titlesDialog, label: "Card titles dialog, a box refused" });

    // Escape after an edit asks first; Cancel keeps the edit, "Toss 'em" forgets it.
    const toss = page.getByRole("dialog", { name: "Toss your title edits?", exact: true });
    await box.fill(FIX_BOX);
    await box.press("Tab");
    await expect(titlesDialog.getByRole("status").filter({ hasText: "Every title fits now." })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(toss).toBeVisible();
    await expectAccessible(page, { within: toss, label: "Toss your title edits confirm" });
    await toss.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(toss).toBeHidden();
    await expect(titlesDialog).toBeVisible();
    await expect(box).toHaveValue(FIX_BOX);
    await page.keyboard.press("Escape");
    await expect(toss).toBeVisible();
    await toss.getByRole("button", { name: "Toss 'em", exact: true }).click();
    await expect(titlesDialog).toBeHidden();
    await expect(fixTitles).toBeFocused();
    // Nothing was written: the door opens it again holding the description, not the edit.
    await fixTitles.click();
    await expect(titlesDialog).toBeVisible();
    await expect(box).toHaveValue(descriptionOf(LONG_PARALLEL));

    // ── NEO-581: the ticker reads the live count, not the one the build stored ──
    // The parallel's line in the ticker's ledger (a list item of the build
    // panel), and the clause it carries while titles still fail.
    const builtLine = page
      .getByRole("listitem")
      .filter({ hasText: new RegExp(`^${escapeRe(LONG_PARALLEL)} — Built ${COPIES} cards`) });
    const fixClause = /titles? needs? a fix/;
    const fixTitlesNamed = (count: number) =>
      page.getByRole("button", { name: `Fix ${count} card ${count === 1 ? "title" : "titles"}`, exact: true });

    // A partial fix: BA-1's own title, saved with the box untouched. Every other
    // row is answered "kept" (still over 80), so the save fixes exactly one.
    await titleRow("BA-1").fill(OWN_TITLE);
    await titleRow("BA-1").press("Tab");
    await titlesDialog.getByRole("button", { name: "Save titles" }).click();
    await expect(titlesDialog).toBeHidden();
    const left = COPIES - 1;
    // The door's line beside it and the ticker's live line (role status, always
    // on screen to Playwright): exactly one of them a status.
    await expect(
      page.getByRole("status").filter({ hasText: `Saved 1 title. ${left} still run long.` }),
    ).toHaveCount(1);
    // The button and the built line's clause drop by one; focus is back on the door.
    await expect(fixTitlesNamed(left)).toBeVisible();
    await expect(fixTitlesNamed(left)).toBeFocused();
    await expect(fixTitlesNamed(COPIES)).toHaveCount(0);
    await expect(builtLine).toBeVisible();
    await expect(builtLine).toContainText(`, ${left} titles need a fix`);
    await expect(builtLine).not.toContainText(`${COPIES} titles need a fix`);

    // The door opens on the rest: BA-1 is no longer in it.
    await fixTitlesNamed(left).click();
    await expect(titlesDialog).toBeVisible();
    await expect(sections).toHaveCount(1);
    await expect(sections).toContainText(`${left} titles`);
    await expect(titleRow("BA-2")).toBeVisible();
    await expect(titleRow("BA-1")).toHaveCount(0);
    await expect(box).toHaveValue(descriptionOf(LONG_PARALLEL));

    // One shorter box fixes every other title: it replaces the description on the cards that need it.
    await box.fill(FIX_BOX);
    await box.press("Tab");
    await expect(titlesDialog.getByRole("status").filter({ hasText: "Every title fits now." })).toBeVisible();
    await expectAccessible(page, { within: titlesDialog, label: "Card titles dialog, every title fits" });
    await titlesDialog.getByRole("button", { name: "Save titles" }).click();
    await expect(titlesDialog).toBeHidden();

    // NEO-581: nothing left to fix, so the button leaves with the last title,
    // and so does the built line's clause. The saved sentence stays, said twice:
    // the plain text where the door was, and the ticker's live line (exactly
    // one of them a status). A positive first: a negative passes on a page
    // that never drew (GUIDE, "negative asserts").
    const titlesSaved = `Saved ${left} titles.`;
    await expect(page.getByRole("status").filter({ hasText: titlesSaved })).toHaveCount(1);
    await expect(page.getByText(titlesSaved)).toHaveCount(2);
    await expect(builtLine).toBeVisible();
    await expect(builtLine).not.toContainText(fixClause);
    await expect(page.getByRole("button", { name: /^Fix [0-9]+ card titles?$/ })).toHaveCount(0);
    // Neither the clause nor the end-of-run tail ("N card titles need a fix.")
    // is anywhere on the page, the live line included.
    await expect(page.getByText(fixClause)).toHaveCount(0);
    // The stale button's old answer is never needed: nothing says "Nothing to fix".
    await expect(page.getByText("Every title fits now. Nothing to fix.")).toHaveCount(0);
    // The button had focus as it left; focus is parked on the ticker (its
    // region, named by its heading), never dropped to the page.
    await expect(page.getByRole("region", { name: /^Anime parallels — [1-9][0-9]* built/ })).toBeFocused();
    await expectAccessible(page, { label: "Parallel build ticker, every title fixed" });

    // Building Kanji's cards fetches its checklist from BSC under the build's wait line: 7 s plus
    // the seconds BSC is visibly holding it (measured 5.4 s at most on the #487 merge-group run (GUIDE)).
    await expectAfterMarketplace(
      page,
      page.getByRole("heading", { name: /Anime parallels — [1-9][0-9]* built(, [0-9]+ (blocked|skipped|failed))*/ }),
      { platform: "BuySportsCards", what: "the Anime parallels build finishing" },
    );
    // (a status line may repeat this for screen readers: any one of them will do)
    await expect(page.getByText(/Anime Kanji — Built [1-9][0-9]* cards?(, .+)?/).first()).toBeVisible();
    await expectAccessible(page, { label: "Anime parallels build ledger" });

    // Kanji stays attached to BSC as a variant; detaching asks first and can be cancelled.
    // Live, the Reconcile Save above stored each source's name, so the chip
    // reads "Anime Kanji". Paused, the sets arrive through the drill's own sync
    // with no reconcile (above), nothing stores a name, and the chip falls back
    // to BSC's slug: that is what the operator sees, so that is the handle.
    const chip = env.SL_PAUSED ? "anime-kanji" : "Anime Kanji";
    await columnOption(page, "Parallels", "Anime Kanji").click();
    // NEO-496 (Jason): the Cards section speaks only about the row on screen. Kanji's own
    // slot is up (its cards were built, so it offers a rebuild), and Anime's "Saved N cards."
    // and its parallels ledger went with the pick.
    await expect(page.getByRole("button", { name: "Rebuild from Anime" })).toBeVisible();
    await expect(page.getByText(/Saved [0-9]+ cards?/)).toBeHidden();
    await expect(page.getByRole("heading", { name: /^Anime parallels — / })).toBeHidden();
    // NEO-496: the sources live inside the attributes panel, closed below the set.
    await openAttributesPanel(page);
    await expect(page.getByText("Multi-source sets")).toBeVisible();
    const remove = page.getByRole("button", { name: `Remove ${chip}`, exact: true });
    await expect(remove).toBeVisible();
    await expect(page.getByLabel(`${chip} is attached as a BSC variant`)).toBeVisible();
    await expect(page.getByText("Needs re-mapping")).toBeHidden();
    await remove.click();
    const warning = page.getByText(/(1 card was|[1-9][0-9]* cards were) fetched from it; (its|their) BSC link will be dropped/);
    await expect(warning).toBeVisible();
    await expectAccessible(page, { label: "Detach Anime Kanji confirmation" });
    await page.getByRole("button", { name: `Cancel detach ${chip}` }).click();
    await expect(warning).toBeHidden();
    await expect(remove).toBeVisible();
    await expect(page.getByRole("button", { name: "Rebuild from Anime" })).toBeVisible();

    // ── PART 5 (NEO-535): the parallel opens with the box text, nothing to fix, titles fixed ──
    // NEO-656: blue career gaps stay (live data, real players); pink and titles are gone.
    /** Re-open Anime's parallels from a fresh page load and select one. */
    const openParallel = async (name: string) => {
      await openInserts();
      await searchAnime();
      await columnOption(page, "Inserts", "Anime").click();
      await columnOption(page, "Parallels", name).click();
      await expect(page.getByRole("heading", { name: new RegExp(`^Attributes for ${escapeRe(name)} \\(Parallel\\)$`) })).toBeVisible();
    };
    const cardTitle = page.getByRole("textbox", { name: "Card title", exact: true });
    const doneEditing = page.getByRole("button", { name: "Done editing card" });
    const search = page.getByRole("searchbox", { name: "Search cards" });
    const needYou = needsYouPill(page);
    const fixCardTitles = page.getByRole("button", { name: "Fix card titles", exact: true });

    await openParallel(LONG_PARALLEL);
    await expect(page.getByRole("heading", { name: /^Cards \([1-9][0-9]*\)$/ })).toBeVisible();
    // A positive first (a negative passes on a list that never drew): the
    // rows are on screen, so "nothing to fix" and "no Fix card titles" are read
    // off a loaded checklist.
    await expect(page.getByRole("button", { name: /^Edit card .+/ }).first()).toBeVisible();
    // NEO-656: blue only. The pill has no ", N to fix" suffix, so no card is pink.
    await expect(needYou).toHaveAccessibleName(/^[1-9][0-9]* needs? you$/);
    await expect(fixCardTitles).toBeHidden();
    // NEO-581, after the reload: no door anywhere offers the fixed titles
    // again, and nothing says they need a fix.
    await expect(page.getByRole("button", { name: /^Fix [0-9]+ card titles?$/ })).toHaveCount(0);
    await expect(page.getByText(/titles? needs? a fix/)).toHaveCount(0);
    await page.getByRole("button", { name: /^Edit card .+/ }).first().click();
    await expect(cardTitle).toHaveValue(new RegExp(`^${escapeRe(FIX_BOX)} `));
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();
    // NEO-581: the partial fix's own title was written, and the box saved after it left it alone.
    await search.fill("BA-1");
    await editCardButton(page, "BA-1").click();
    await expect(cardTitle).toHaveValue(OWN_TITLE);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── PART 6: a hand edit on Anime is carried onto the copy when the builder's title fails ──
    await openInserts();
    await searchAnime();
    await columnOption(page, "Inserts", "Anime").click();
    await search.fill("BA-3");
    // NEO-581: Anime's own page after the reload (where the build ticker stood)
    // offers no Fix button and no clause either; the row is the positive.
    await expect(editCardButton(page, "BA-3")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Fix [0-9]+ card titles?$/ })).toHaveCount(0);
    await expect(page.getByText(/titles? needs? a fix/)).toHaveCount(0);
    await editCardButton(page, "BA-3").click();
    await cardTitle.fill(HAND_EDIT);
    await cardTitle.press("Tab");
    await expect(page.getByText(/Saved Card title/)).toBeVisible();
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // Red Refractors takes the long name WITH its cards (a rename never touches them), then is rebuilt.
    await columnOption(page, "Parallels", RED).click();
    await expect(page.getByRole("heading", { name: new RegExp(`^Attributes for ${escapeRe(RED)} \\(Parallel\\)$`) })).toBeVisible();
    await renameSelected(page, RED, CARRY_PARALLEL);
    await page.getByRole("button", { name: "Rebuild from Anime" }).click();
    await page.getByRole("button", { name: "Replace the cards" }).click();
    // The rebuild reads this parallel's checklist from BSC first: 7 s plus the seconds BSC holds it.
    await expectAfterMarketplace(page, titlesDialog, {
      platform: "BuySportsCards",
      what: "the Card titles dialog after the rebuild",
    });
    await expect(sections).toHaveCount(1);
    await expect(sections).toContainText(CARRY_PARALLEL);
    // The arithmetic at CARRY_PARALLEL: every card had to leave something out
    // (NEO-609) but BA-3, whose hand edit fits, so it is carried.
    await expect(sections).toContainText(`${COPIES - 1} titles`);
    // The box holds the full description, the parallel's name in it, said once
    // after "2026 Bowman" (65 characters: it fits, so it is not sitting out).
    expect(descriptionOf(CARRY_PARALLEL)).toHaveLength(65);
    expect(CARRIED_TITLE).toHaveLength(80);
    await expect(titlesDialog.getByRole("textbox", { name: "Set name in titles", exact: true })).toHaveValue(
      descriptionOf(CARRY_PARALLEL),
    );
    for (const number of ["BA-12", "BA-19", "BA-20", "BA-29"]) await expect(titleRow(number)).toBeVisible();
    await expect(titleRow("BA-3")).toBeHidden();
    // Not now writes nothing and closes the dialog.
    await titlesDialog.getByRole("button", { name: "Not now" }).click();
    await expect(titlesDialog).toBeHidden();

    // BA-3's copy carries the edit, its description swapped for the parallel's.
    await search.fill("BA-3");
    await editCardButton(page, "BA-3").click();
    await expect(cardTitle).toHaveValue(CARRIED_TITLE);
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // After a reload the parallel's own checklist offers the dialog again.
    await openParallel(CARRY_PARALLEL);
    await expect(needYou).toBeVisible();
    await expect(fixCardTitles).toBeVisible();
    await fixCardTitles.click();
    await expect(titlesDialog).toBeVisible();
    await expect(titleRow("BA-12")).toBeVisible();
    await expect(titleRow("BA-3")).toBeHidden();
    await expectAccessible(page, { within: titlesDialog, label: "Card titles dialog, opened again after a reload" });
    await titlesDialog.getByRole("button", { name: "Not now" }).click();
    await expect(titlesDialog).toBeHidden();
    await expect(fixCardTitles).toBeFocused();

    // ── Rename both back: the registry's rows read as they did ──
    await renameSelected(page, CARRY_PARALLEL, RED);
    await openParallel(LONG_PARALLEL);
    await renameSelected(page, LONG_PARALLEL, BLACK);
    await openInserts();
    await searchAnime();
    await columnOption(page, "Inserts", "Anime").click();
    await expect(columnOption(page, "Parallels", BLACK)).toBeVisible();
    await expect(columnOption(page, "Parallels", RED)).toBeVisible();
    await expect(columnOption(page, "Parallels", LONG_PARALLEL)).toBeHidden();
    await expect(columnOption(page, "Parallels", CARRY_PARALLEL)).toBeHidden();
  },
);
