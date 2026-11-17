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
//     (the other three parallels fit), and one shorter "Set name in titles"
//     fixes every title ("Every title fits now."). The ticker's button stays
//     and finds nothing left; the parallel opens with the box text in its
//     titles and no attention.
//   * `Anime Red Refractors` is renamed to a name whose description is 65
//     characters (the builder says the shared word "Anime" once: the parallel's
//     name starts with its insert's, so the description reads
//     "2026 Bowman <parallel>"), and Anime's BA-3 title is hand edited to drop
//     the first name ("Murakami #BA-3"). Rebuilt, BA-3 is the one card the
//     builder fails on (it would lose "Munetaka") that the hand edit rescues,
//     so the copy carries the edit at exactly 80 characters and is not in the
//     dialog; the four whose names are too long to fit even so (BA-12, BA-19,
//     BA-20, BA-29) are. The checklist's own "Fix card titles" reopens the
//     dialog after a reload.
//   * The dialog's "Set name in titles" box opens holding the full set
//     description including the parallel's name (never a bare insert name);
//     typing it past 80 is refused in place and again on Save; Escape after an
//     edit asks "Toss your title edits?" and tossing forgets the edit.
//   Both are renamed back at the end. The arithmetic (`calc` of the builder over
//   the 29 BA- cards of fixtures/checklists/2026-bowman-insert-anime.csv) is
//   in the comment at LONG_PARALLEL and CARRY_PARALLEL.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace, expectStepWithSportLots } from "../../support/marketplace-wait";
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
import { CHECKLISTS, confirmChecklistMatchCards, matchCardsDialog, usePublishersChecklist } from "../../support/published-checklist";
import { advanceToSave, confirmSaveButton, reviewWizard } from "../../support/wizard";
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
/** Anime's third parallel, as BSC names it. */
const RED = "Anime Red Refractors";
/**
 * RED renamed: the description is 65 characters. With a player's full name the
 * title is over 80 after every cut except for BA-12, BA-19, BA-20 and BA-29,
 * whose names are the longest and which lose a first name; BA-3 (Munetaka
 * Murakami) would too, and its hand edit below, re-headed, is exactly 80.
 */
const CARRY_PARALLEL = "Anime Red Refractors Hologram Foils Anniversary Prism";
/** BA-3's title as the operator edits it on Anime: the first name dropped. */
const HAND_EDIT = "2026 Bowman Anime Murakami #BA-3";
/** What BA-3's copy on CARRY_PARALLEL reads: the edit, re-headed with that parallel's description. */
const CARRIED_TITLE = `${descriptionOf(CARRY_PARALLEL)} Murakami #BA-3`;
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

test(
  "2026 Bowman inserts — BSC's inserts become NB sets, Group Parallels nests Anime Kanji under Anime, and saving Anime builds Kanji's cards (NEO-293…312)",
  { tag: ["@set-selector", "@parallel-grouping"] },
  async ({ page, signIn, env }) => {
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
    const facts = await usePublishersChecklist(page, CHECKLISTS.bowmanAnime2026);
    await syncChecklistButton(page).click();

    // NEO-496 (D10, NQ1): BSC plus the uploaded checklist are two sources, so Match Cards opens
    // with SportLots paused or live. The cards come from BSC (and SportLots, paired, when it is
    // live): GUIDE R5's marketplace wait, measured time plus 7 s, never a flat ceiling.
    const matchCards = matchCardsDialog(page);
    await expectAfterMarketplace(page, matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }), {
      platform: "BuySportsCards",
      what: "the Anime fetch's Match Cards",
    });
    await expect(matchCards.getByRole("heading", { name: "Match Cards — Anime" })).toBeVisible();
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog" });
    // Proves the teams line while the dialog is open, keeps any card the file leaves out, confirms.
    await confirmChecklistMatchCards(page, { facts, what: "the Anime fetch" });

    // Either new names need review, or the cards save straight away. Since
    // NEO-335 the wizard ("Tidy up <year> <set> <variant>" since NEO-497) has THREE shapes: names to decide
    // (footer "Skip remaining names (N)"), or every name known and the open
    // question is a teamless card or a trimmed title (it opens on that step with
    // "Next (Enter)"). Same branch below: past the names, advanceToSave leaves
    // the teams / titles steps on their defaults and stops on the Save step.
    const wizard = reviewWizard(page);
    const saved = page.getByText(/Saved [0-9]+ cards/);
    // Live, the wizard opens after the pairing's Confirm (the flow's 60 s); paused, once the
    // Match Cards is confirmed above: our own queueing, measured 1.8 s at most on the #487 merge-group run (GUIDE), the standard 7 s.
    await expectStepWithSportLots(page, wizard.or(saved).first(), env, { liveMs: 60_000, what: "the tidy-up dialog or the save", statusLine: false });
    if (await wizard.isVisible()) {
      await expectAccessible(page, { within: wizard, label: "Tidy-up wizard" });
      // The footer's first action says which shape opened (it paints with the batch).
      const skipRemaining = wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
      await expect(
        skipRemaining.or(wizard.getByRole("button", { name: "Next (Enter)", exact: true })).or(confirmSaveButton(page)),
      ).toBeVisible();
      if (await skipRemaining.isVisible()) {
        await skipRemaining.click();
        // The lookups behind the batch settle here (the flow's 60 s, unchanged).
        await expect(
          wizard.getByRole("button", { name: "Next (Enter)", exact: true }).or(confirmSaveButton(page)),
        ).toBeVisible({ timeout: 60_000 });
      }
      await advanceToSave(page);
      await confirmSaveButton(page).click();
    }
    await expect(page.getByText(/Saved [1-9][0-9]* cards?/)).toBeVisible();

    // The build of Kanji's cards from Anime reports itself, then lands.
    await expect(
      page.getByText(/Building parallels of Anime — [0-9]+ of [0-9]+|Anime parallels — [^.]+/).first(),
    ).toBeVisible();

    // ── NEO-535: the build ends with titles to fix, and Card titles opens by itself ──
    // The build fetches each parallel's checklist from BSC before writing it, and
    // the dialog follows the last parallel's write: 7 s plus the seconds BSC is
    // visibly holding it (the marketplace rule, GUIDE).
    const titlesDialog = page.getByRole("dialog", { name: "Card titles" });
    await expectAfterMarketplace(page, titlesDialog, {
      platform: "BuySportsCards",
      what: "the Card titles dialog after the Anime parallels build",
    });
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

    // One shorter box fixes every title: it replaces the description on the cards that need it.
    await box.fill(FIX_BOX);
    await box.press("Tab");
    await expect(titlesDialog.getByRole("status").filter({ hasText: "Every title fits now." })).toBeVisible();
    await expectAccessible(page, { within: titlesDialog, label: "Card titles dialog, every title fits" });
    await titlesDialog.getByRole("button", { name: "Save titles" }).click();
    await expect(titlesDialog).toBeHidden();

    // The ticker keeps its button, focus is back on it, and it has nothing left to fix.
    await expect(fixTitles).toBeVisible();
    await expect(fixTitles).toBeFocused();
    const fixed = Number(((await fixTitles.textContent()) ?? "").match(/\d+/)?.[0]);
    expect(fixed).toBe(COPIES);
    // The saved sentence is said twice, once each: the plain text beside the
    // door, and the ticker's screen-reader line (role status, always on screen
    // to Playwright). Two matches in all, exactly one of them a status.
    const savedLine = `Saved ${fixed} ${fixed === 1 ? "title" : "titles"}.`;
    await expect(page.getByRole("status").filter({ hasText: savedLine })).toHaveCount(1);
    await expect(page.getByText(savedLine)).toHaveCount(2);
    await fixTitles.click();
    // The same pair again: the door's line beside it, and the live line.
    const nothingToFix = "Every title fits now. Nothing to fix.";
    await expect(page.getByRole("status").filter({ hasText: nothingToFix })).toHaveCount(1);
    await expect(page.getByText(nothingToFix)).toHaveCount(2);
    await expect(titlesDialog).toHaveCount(0);
    await expectAccessible(page, { label: "Parallel build ticker, nothing left to fix" });

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

    // ── PART 5 (NEO-535): the parallel opens with the box text, and attention is gone ──
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
    const needYou = page.getByRole("button", { name: /^[0-9]+ needs? you$/ });
    const fixCardTitles = page.getByRole("button", { name: "Fix card titles", exact: true });

    await openParallel(LONG_PARALLEL);
    await expect(page.getByRole("heading", { name: /^Cards \([1-9][0-9]*\)$/ })).toBeVisible();
    // A positive first (a negative passes on a list that never drew): the
    // rows are on screen, so "no attention" and "no Fix card titles" are read
    // off a loaded checklist.
    await expect(page.getByRole("button", { name: /^Edit card .+/ }).first()).toBeVisible();
    await expect(needYou).toBeHidden();
    await expect(fixCardTitles).toBeHidden();
    await page.getByRole("button", { name: /^Edit card .+/ }).first().click();
    await expect(cardTitle).toHaveValue(new RegExp(`^${escapeRe(FIX_BOX)} `));
    await doneEditing.click();
    await expect(cardTitle).toBeHidden();

    // ── PART 6: a hand edit on Anime is carried onto the copy when the builder's title fails ──
    await openInserts();
    await searchAnime();
    await columnOption(page, "Inserts", "Anime").click();
    await search.fill("BA-3");
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
    // The arithmetic at CARRY_PARALLEL: these four cannot fit; BA-3's hand edit does, so it is carried.
    await expect(sections).toContainText("4 titles");
    // The box holds the full description, the parallel's name in it, said once
    // after "2026 Bowman" (65 characters: it fits, so it is not sitting out).
    expect(descriptionOf(CARRY_PARALLEL)).toHaveLength(65);
    expect(CARRIED_TITLE).toHaveLength(80);
    await expect(titlesDialog.getByRole("textbox", { name: "Set name in titles", exact: true })).toHaveValue(
      descriptionOf(CARRY_PARALLEL),
    );
    const titleRow = (number: string) => titlesDialog.getByRole("textbox", { name: new RegExp(`^Title for #${escapeRe(number)} `) });
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
