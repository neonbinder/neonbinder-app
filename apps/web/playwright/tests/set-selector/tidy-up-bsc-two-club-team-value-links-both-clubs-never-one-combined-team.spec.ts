// Origin: .maestro/flows/set-selector/checklist-dual-team-card-links-both-teams.yaml (Maestro suite retired in NEO-341; see git history)
// Renamed from checklist-dual-team-card-links-both-teams (NEO-645): the "Tidy up this set" wizard is
// gone; the cards save at Match Cards' Confirm and the per-card Tidy Up walk asks what is left, so
// the claim is now read on the walk's Team tile, the checklist row and the card drawer.
//
// ONE FEATURE (NEO-333, R1): a BSC team value that names two clubs ("Boston Red Sox, Detroit
// Tigers") becomes TWO team links, never one combined team. Proved on live data through the
// operator's own path (Fetch from Marketplaces -> Match Cards -> Confirm saves -> the walk):
//   (a) nothing asks about a comma-joined team. If the walk opens (a card needs a person: an
//       autograph format, a title, a name), every card it shows is read: no Team tile holds a
//       group named for a comma-joined value, and neither half of PDA-WW's value is ever asked
//       (both clubs are seeded current teams, so a half asked means the split resolved only one).
//       When PDA-WW itself is in the walk, its Team tile shows the two clubs as two settled
//       teams, nothing to fix;
//   (b) after the save, PDA-WW's checklist row reads both clubs, and its drawer holds exactly two
//       team chips, one per club;
//   (c) Team Management holds exactly ONE team containing "Boston Red Sox" (the row alone cannot
//       tell two links from one combined team, so the count is what closes it).
//
// FIXTURE (SET-REGISTRY.md -> "Baseball -> 2025 -- the NEO-333 dual-team fixture"): Baseball ->
// 2025 -> Bowman > Bowman Draft > Insert > Prospect Dual Autographs. SOLE WRITER of Baseball ->
// 2025; FRESH-ONLY (a re-run finds the Insert column already saved and the checklist committed,
// and fails at "No cards in this checklist yet.", by name: re-seed first). Mints no player, team
// or league: every walk card is SKIPPED (Skip writes nothing), which is what lets (c) count to
// exactly one. It mints no names either, so no env-minted marker is needed; the per-project run
// only differs in the signed-in worker.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  COLD_SYNC,
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
import { expectTeamsLoaded, teamsCounter } from "../../support/players";
import { bscLookupOutcome, expectStepWithSportLots } from "../../support/marketplace-wait";
import { CHECKLISTS, confirmChecklistMatchCards, matchCardsDialog, usePublishersChecklist } from "../../support/published-checklist";
import { closeCardDrawer, openCardDrawer } from "../../support/also-pictured";
import {
  expectCardSettled,
  finishTidyWalk,
  pinkTile,
  settleWalkAfterCommit,
  skipCard,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const INSERT = "Prospect Dual Autographs";
const BOWMAN_DRAFT = { sport: "Baseball", year: "2025", manufacturer: "Bowman", set: "Bowman Draft" };
/** A live BSC (+ SportLots) checklist round trip, the ceiling kept while SportLots is live (`expectStepWithSportLots`). */
const CHECKLIST_FETCH = 120_000;
/** The clubs of PDA-WW's one BSC team value. */
const CLUBS = ["Boston Red Sox", "Detroit Tigers"] as const;
/** The walk's runaway guard: the insert has 14 cards. */
const MAX_WALK_CARDS = 20;

test(
  "Tidy Up — a BSC team value naming two clubs saves as two team links: the walk never asks about a combined team, and the card, its drawer and Team Management hold both clubs, never one joined team (NEO-333)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: cold drill to Baseball / 2025 / Bowman, then pick `Bowman Draft` ──
    // No spec has opened 2025, so every column arrives empty and syncs itself;
    // the helper pays those waits (its COLD_SYNC marketplace ceilings).
    await drillToColdManufacturer(page, env, { sport: "Baseball", year: "2025", manufacturer: "Bowman" });
    // The Sets column's LISTBOX renders only once it holds a row. The helper
    // waited the sync out with SportLots live; paused, BSC's sets can still be
    // landing, so this waits by the marketplace rule (measured 0.2 s on the #487 merge-group run (GUIDE)).
    await expectStepWithSportLots(page, page.getByRole("listbox", { name: "Sets" }), env, {
      liveMs: COLD_SYNC,
      what: "the Sets list",
    });
    await pick(page, "Sets", "Bowman Draft");
    await expect(columnHeading(page, "Variant Types")).toBeVisible();
    // Selecting the set fires its COLD variant-type sync (BSC + SportLots).
    const insertType = columnOption(page, "Variant Types", "Insert");
    await expectStepWithSportLots(page, insertType, env, { liveMs: VARIANT_TYPES_SYNC, what: "Variant Types row Insert" });

    // ── STEP 2: make the insert an NB set: the Inserts reconcile (sole writer) ──
    await insertType.click();

    if (!env.SL_PAUSED) {
      // The column is EMPTY on a fresh preview, so selecting the type fires
      // its own two-sided sync, which opens the reconcile: a COLD insert-level
      // BSC + SportLots fetch. NEO-345: the autograph-format spec reconciles
      // its own insert in this same column, so when it ran first the column is
      // already saved and the dialog opens from "Sync Inserts" instead
      // (`openInsertsReconcile` takes either). REQUIRED either way.
      await openInsertsReconcile(page, env);

      // Narrow both lists to the insert; the Save still writes every Ready set.
      await reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill(INSERT);
      const filterBsc = reconcile.getByRole("textbox", { name: "Filter BSC items" });
      await filterBsc.fill(INSERT);

      // Two legitimate shapes, named by this gate so the branch after it can
      // only choose between them: Ready already, or Pending (BSC only).
      const insertSet = reconcile.getByRole("textbox", { name: `NeonBinder set name for ${INSERT}`, exact: true });
      const makeOwn = reconcile.getByRole("button", { name: `Make its own set: ${INSERT}`, exact: true });
      await expect(insertSet.or(makeOwn)).toBeVisible();
      // Pending: "Keep all" on the FILTERED BSC column makes every item it
      // shows its own set (the insert, plus any parallel BSC lists under the
      // same words: sets in a year this spec owns).
      if (await makeOwn.isVisible()) {
        await reconcile.getByRole("button", { name: /^Keep all [1-9][0-9]*, BSC sets?$/ }).click();
      }
      await expect(insertSet).toBeVisible();
      await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts dialog (Prospect Dual Autographs)" });

      await reconcile.getByRole("button", { name: /^Save [0-9]+ sets/ }).click();
      await expect(reconcile).toBeHidden();

      // Saving leaves the columns at the offset the dialog opened from: re-drill
      // (every level is warm now) and reopen the Insert column.
      await drillToSet(page, env, BOWMAN_DRAFT);
      await columnOption(page, "Variant Types", "Insert").click();
    } else {
      // Paused: one marketplace, nothing to reconcile; the column fills
      // straight from BSC (the same cold fetch).
      // BSC alone: 7 s plus the seconds the column's wait line is up (measured 0.2 s on the #487 merge-group run (GUIDE)).
      await expectAfterBscSync(page, columnHeading(page, "Inserts"), "the Inserts column opening");
      await expect(reconcile).toBeHidden();
    }

    // ── STEP 3: select the insert ──
    await columnSearch(page, "Inserts").fill(INSERT);
    await columnOption(page, "Inserts", INSERT).click();

    // ── STEP 4: fetch from the marketplaces on the insert ──
    // The empty-checklist assert makes the saved cards below THIS fetch's.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // The publisher's checklist (NEO-478): the 13 other cards' teams are BSC's own answers, uploaded, so
    // BSC is asked per card for ONE card, PDA-WW, whose two-club value is what this spec reads live. (Its
    // row is left out of the file on purpose; the fixture is fixtures/checklists/2025-bowman-draft-insert-
    // prospect-dual-autographs.csv.) Fourteen live lookups in a burst met a BSC 429 here (every one of
    // them), so the card the spec is about was never answered.
    const facts = await usePublishersChecklist(page, CHECKLISTS.prospectDualAutographs2025);
    await syncChecklistButton(page).click();

    // NEO-496 (D10, NQ1): BSC plus the uploaded checklist are two sources, so Match Cards
    // opens with SportLots paused or live (before NEO-496 a paused fetch took the
    // one-marketplace path). BSC's per-card team lookup (the code NEO-333 changed) runs
    // INSIDE this fetch, before Confirm unlocks: a live round trip. PDA-WW, the card this
    // spec reads, is the row the file leaves out, so it is BSC-only here and MUST be kept;
    // the helper keeps every BSC-only card, proves the teams line and confirms. A fetch that
    // lost the BSC side would carry no BSC team values, and STEP 6's row read fails it by name.
    const matchCards = matchCardsDialog(page);
    await expectStepWithSportLots(page, matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }), env, {
      liveMs: CHECKLIST_FETCH,
      what: "the insert checklist fetch",
    });
    await expect(matchCards.getByRole("heading", { name: `Match Cards — ${INSERT}` })).toBeVisible();
    await expectAccessible(page, { within: matchCards, label: "Match Cards dialog (Prospect Dual Autographs)" });
    await confirmChecklistMatchCards(page, { facts, what: "the Prospect Dual Autographs fetch" });
    // NEO-645: Confirm IS the commit. "Saved N cards." is our own write (7 s), and the walk opens
    // after it only when a card needs a person.
    const saved = page.getByText(/Saved [1-9][0-9]* cards?\./).first();
    await expect(saved).toBeVisible();
    const opened = await settleWalkAfterCommit(page, saved);

    // ── STEP 5: claim (a): nothing on the walk asks about a comma-joined team ──
    // TWO LEGITIMATE SHAPES, settled by `settleWalkAfterCommit` (R2): no card needs a person (the
    // walk stays shut; on the catalogue every name is known, so an unsplit value, which resolves
    // to no team and is a pending name, would itself have opened it), or the walk is open for
    // something else on the cards, and then every card it shows is read before it is skipped.
    let dualOnTile = false;
    if (opened) {
      const walk = tidyWalk(page);
      const teamTile = tidyTile(page, "Team");
      // A group "Team <a>, <b>" is a team row named for the joined value (the pre-NEO-333 bug).
      const combined = teamTile.getByRole("group", { name: /^Team [^,]+,/ });
      // A half ASKED (its row still offers "Not a team"): the split happened, one part unresolved.
      const halfAsked = teamTile
        .getByRole("group", { name: /^Team (Boston Red Sox|Detroit Tigers)( |$)/ })
        .filter({ has: page.getByRole("button", { name: /^Not a team( .+)?$/ }) });
      const dualCard = walk.getByText(/^#PDA-WW( · .+)?$/).first();
      const club = (name: string) => teamTile.getByRole("group", { name: new RegExp(`^Team ${name}( |$)`) });
      await expectAccessible(page, { within: walk, label: "Tidy Up walk on Prospect Dual Autographs" });
      const endScreen = tidyFooterButton(page, "done");
      for (let i = 0; i < MAX_WALK_CARDS; i++) {
        await expect(tidyTile(page, "More about this card").or(endScreen).first()).toBeVisible();
        if (await endScreen.isVisible()) break;
        // The positive under the negatives (R2): a settled card is on screen.
        await expectCardSettled(page);
        await expect(combined, "no Team tile row is a comma-joined team").toHaveCount(0);
        await expect(halfAsked, "neither half of the two-club value is asked").toHaveCount(0);
        if ((await dualCard.count()) > 0) {
          // PDA-WW's tile: both clubs as two settled teams (answered lookup), or, when its one
          // live lookup was skipped (NEO-489: a BSC 429 or cooldown is a pass), a card with no
          // team yet. Never one club alone: STEP 6 reads which it was off the stored card.
          await expect(club(CLUBS[0]).or(pinkTile(page, "Team")).first()).toBeVisible();
          if (await club(CLUBS[0]).isVisible()) {
            await expect(club(CLUBS[1])).toBeVisible();
            for (const name of CLUBS) {
              // The answered row's Edit, named for NB's linked club (NEO-645 C1).
              await expect(club(name).getByRole("button", { name: /^Edit (?!cameo )/ })).toBeVisible();
            }
            await expect(pinkTile(page, "Team"), "two linked clubs leave nothing to fix on the Team tile").toHaveCount(0);
            await expectAccessible(page, { within: walk, label: "Tidy Up walk on PDA-WW, two clubs on the Team tile" });
            dualOnTile = true;
          }
        }
        if (i === 0) {
          // Navigation lives in the URL: Back is this card again after a Skip, Forward the next.
          const before = await tidyCardIdentity(page).allTextContents();
          await skipCard(page);
          if (await endScreen.isVisible()) break;
          await page.goBack();
          await expect(tidyCardIdentity(page)).toHaveText(before);
          await expectCardSettled(page);
          await page.goForward();
          await expect(tidyCardIdentity(page)).not.toHaveText(before);
          continue;
        }
        // Skip writes nothing: this spec mints no team, which is what lets STEP 7 count to one.
        await skipCard(page);
      }
      await expect(endScreen, `the walk ended within ${MAX_WALK_CARDS} cards`).toBeVisible();
      await finishTidyWalk(page);
    }
    test.info().annotations.push({
      type: "walk",
      description: opened ? (dualOnTile ? "open, PDA-WW read on the Team tile" : "open, PDA-WW not on the walk") : "shut",
    });

    // ── STEP 6: claim (b): PDA-WW's row reads both clubs, and its drawer holds two team chips ──
    // The rows render from getCardChecklist after the commit: a read-back of what was stored. The
    // sub-line is ONE text node (linked teams' full names joined ", ", then " · /N", ...), so a
    // FULL match means an `<name> (unconfirmed)` tail, or a card linked to only one club, cannot
    // answer. Either order is accepted. No other card in the set carries either club, so the pair
    // IS PDA-WW. The links are written BY THE SAVE (the NEO-333 fence), so 7 s is the budget. The
    // list sits where its first streamed batch left it, so the card is found by its number.
    //
    // NEO-489 (Jason, 2026-11-11: a BSC 429 or an open cooldown on the spec's live card is a
    // pass). PDA-WW's one live lookup either ANSWERED (both clubs linked) or was SKIPPED (the card
    // has no team and waits in the background queue: "Still looking up teams for 1 card.").
    // Never a third shape: the row never reads ONE club alone.
    await page.getByRole("searchbox", { name: "Search cards" }).fill("PDA-WW");
    const bothClubs = page.getByText(/^(Boston Red Sox, Detroit Tigers|Detroit Tigers, Boston Red Sox)( · .*)?$/);
    const lookingUp = page.getByRole("status").filter({ hasText: "Still looking up teams for 1 card." });
    await expect(bothClubs.or(lookingUp).first()).toBeVisible();
    await expect(page.getByText(/^(Boston Red Sox|Detroit Tigers)( · .*)?$/)).toHaveCount(0);
    const answered = await bothClubs.isVisible();
    bscLookupOutcome(answered ? "answered" : "cooldown", "PDA-WW");
    // The walk showed PDA-WW's two clubs only on an answered lookup.
    if (dualOnTile) await expect(bothClubs, "the Team tile's two clubs are the stored card's").toBeVisible();
    await expectAccessible(page, { label: "Prospect Dual Autographs checklist, dual-team card saved" });
    if (answered) {
      // The drawer: one chip per linked team. Two chips, one per club, is two links; a combined
      // team would be ONE chip whose name holds both.
      const drawer = await openCardDrawer(page, "PDA-WW");
      for (const name of CLUBS) {
        await expect(drawer.getByRole("button", { name: `Remove team ${name}`, exact: true })).toBeVisible();
      }
      await expect(drawer.getByRole("button", { name: /^Remove team / })).toHaveCount(2);
      await closeCardDrawer(drawer);
    }

    // ── STEP 7: claim (c): no combined team exists ──
    // Exactly one team on the deployment has "Boston Red Sox" in its full name
    // or an alias: the seed's club. A team minted from the joined value would
    // contain it too, whichever half came first, and make this "2 matches". The
    // filter is a SUBSTRING match, so "1 match" is the positive and
    // the negative in one read. Scoped to this club, not a bare ",": other
    // specs' comma-bearing teams are not this claim. A reload separates the
    // database from the session.
    await page.goto("/admin/teams");
    await expectTeamsLoaded(page, 30_000);
    await page.getByRole("textbox", { name: "Filter teams" }).fill("Boston Red Sox");
    // The counter is a bare "1 match" for exactly one (not "11 matches"), the
    // positive and the negative in one read.
    await expect(teamsCounter(page, "1 match")).toBeVisible();
    // And the one row is the club (the master row is labelled with the full name).
    await expect(page.getByRole("button", { name: /^Boston Red Sox/ })).toBeVisible();
    await expectAccessible(page, { label: "Team Management, filtered to Boston Red Sox" });
  },
);
