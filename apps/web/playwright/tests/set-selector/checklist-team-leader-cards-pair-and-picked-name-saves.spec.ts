// NEO-343 / NEO-344 (R1): on a real two-marketplace fetch of 2014 Topps
// Football's Base, the Match Cards dialog's NAME DECISION is right, and the
// operator's answer is what the card is saved with.
//
//   (a) NEO-343: BSC sends a team-leader card as "<Team> TL" ("Buffalo Bills
//       TL"), SportLots as "<Team>". BSC's parser strips "TL" as it strips
//       "TC", so the 32 team-leader cards raise no decision. Before the fix
//       the header read 40 name and 38 player conflicts on this set (prod,
//       2026-10-13). STEP 4 bounds both counts at 12 (measured 8 and 7; see
//       below); STEP 5 reads #6a (New England Patriots) in the dialog:
//       matched, bare team name, no name or players conflict; STEP 9 finds the
//       SAVED #6a with the checklist search and reads its team as LINKED, not
//       "(unconfirmed)".
//   (b) NEO-344: a conflict that IS there shows each value bare (Jason,
//       2026-10-13: "I don't want the user swayed by what marketplace the data
//       comes from"), still opens on BSC's value, and the value the operator
//       picks is the one the card is saved with. STEP 6 manufactures the
//       conflict on #442 (unlink it, then link it to a SportLots-only card),
//       STEP 7 saves, STEP 8 reads the saved name back.
//
// One fetch carries both: a second spec would fetch this ~1,000-row real set
// again, and a real set has exactly one writer (R7a).
//
// FIXTURE (SET-REGISTRY.md -> "Football → 2014 — the NEO-343 team-leader
// fixture", approved by Jason 2026-10-13): Football -> 2014 -> Topps > Topps >
// Base. SOLE WRITER of Football -> 2014; not self-cleaning (the run-start
// reset is its cleanup). FRESH-ONLY: a re-run on the same seed finds the
// checklist committed and fails at STEP 3's empty-checklist assert, by name.
// Mints nothing: every review-wizard name is skipped.
//
// RE-DERIVE ON THE FIRST LIVE RUN (SportLots paused): the measurement below
// predates names-first pairing (NEO-591), which changes how a checklist row
// meets a card and so may change every count it quotes. Treat each as the last
// live reading, not a fact; re-measure and rewrite them the day the live branch
// first runs again.
// MEASURED on PR #335 run 38501127928 (Football 2014 Topps Base, live): the
// dialog opens on "Matched (554)" with 8 name conflicts and 7 player
// conflicts, "BSC only (0)" and "SportLots only (2)": #28 Vernon David ·
// Jumping and #35 Navarro Bowman · Celebrating. EVERY BSC card matched, #442
// included, so #442 is NOT BSC-only (an earlier draft assumed it was and
// failed to find its row in the BSC column).
//
// The conflict is MANUFACTURED from the real fetched halves (as
// checklist-pairing-dialog-cancel's is): #442 is found in the Matched list,
// UNLINKED (its BSC half lands in BSC only: 0 -> 1), and linked to the first
// SportLots-only card, a different person, so a name conflict is guaranteed.
// Both names are read off the screen; nothing is hardcoded but the card
// numbers.
//
// R3: checklist-pairing-dialog-cancel proves the bare pills on Future Stars
// and then CANCELS (its set is read-only); this is the only spec that saves
// through a name decision and reads the answer back, and the only one that
// fetches a team-leader card. checklist-search-narrows-and-clears owns the
// search box itself; this spec only uses it to reach two rows.
//
// NEO-287: paused, nothing is asked of SportLots, so there is no Match Cards
// dialog and no name decision: the feature has no surface. The paused branch
// proves the pause on the page, then (NEO-489) runs the one thing a one-marketplace
// fetch of this set can still prove: a publisher's checklist that says "No Team" on
// #6a, a team-leader card whose BSC bulk answer already names its team, raises the
// wizard's "Checklist says otherwise" step with the checklist's side "No team on the
// card"; taking the checklist's side saves #6a with no team and no "no team on this
// card yet" badge. NEO-591: the same file says "Prospect (Dallas Baptist)" on #38a (the
// Chiefs' card); Dallas Baptist is no minor-league or college football team on file, so
// the claim is HELD. Match Cards reads that row "· Prospect (Dallas Baptist)" and
// names it in its Unlink control; unlinked and linked back, the claim is unchanged; the
// wizard's disagreement on #38a shows Dallas Baptist on the checklist's side (not "No
// team on the card"); keeping the marketplace's side saves #38a with its own team AND
// as a Prospect Card (the claim rides with every outcome). This is the only registered
// set whose marketplace bulk answer carries a team, which is why both claims are
// exercised here. Zero BSC calls: all 554 rows are answered by the file, and #6a and
// #38a carry their teams from the bulk answer.
// NEO-591 (variations), the same paused upload, two more edits to the file:
//   STEM LINK: Julius Thomas is #9a and #9b on BSC (the same player twice). The file
//     prints him once, as "9" (`STEM`: 9a renumbered, 9b dropped), so the one row
//     covers both cards: each reads "Checklist: #9 · all versions" with no %. Unlink
//     on #9b drops that card's link alone: #9a keeps the row, #9b moves to Keeping
//     (it is BSC's alone), focus lands on its title there, and the status region
//     says "Unlinked from #9b. Row #9 still covers #9a. Moved to Keeping."
//   SIBLING CREATION: Kyle Long is #95 on BSC, one card. The file prints him twice
//     (`SIBLING`), as 95a and as 95b "(Photo Variation)". The card pairs 95a (letters
//     over digits: it is offered as #95a, #95 a pick away, no "Numbers differ"), and
//     95b, a variation BSC does not list, arrives pre-kept in Keeping as the row
//     "#95b Kyle Long · Photo Variation" (a checklist row); confirmed, it is saved
//     as a variation of #95a named "Photo Variation" (its list sub-line and drawer).
//     The numbers agree (95 is 95a), so the number is a quiet choice: "Number #95a"
//     and "Change number for #95a", opened to "Number choice on #95a".
//   Letters minted for a SportLots-only variation (no checklist row) are proved by
//   unit tests only while SportLots is paused (convex/fetchCardChecklist.namesFirst.test.ts).
//   The shapes are the capture's own (fixtures/checklists/2014-football-topps-base.csv,
//   BSC's per-card answers): 9a/9b one player, 95 one card, Kyle Long and Julius
//   Thomas on no other row; `usePublishersChecklist` throws if an edited number is
//   not on exactly one row.
// Exactly one of the two branches commits the set in a given seed.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { escapeRe } from "../../support/cards";
import {
  drillToBaseVariant,
  drillToColdManufacturer,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  confirmChecklistMatchCards,
  expectTeamsFromChecklist,
  matchCardsDialog,
  usePublishersChecklist,
} from "../../support/published-checklist";
import {
  advanceToSave,
  confirmSaveButton,
  disagreementOn,
  expectChecklistDisagreementFirst,
  pickDisagreementSide,
  reviewWizard,
} from "../../support/wizard";

const FOOTBALL_2014 = { sport: "Football", year: "2014", manufacturer: "Topps" };
/** One live BSC + SportLots round trip on a ~1,000-row two-sided fetch. */
const CHECKLIST_FETCH = 120_000;
/** The wizard opens behind the entity check's batch (live lookups). */
const WIZARD_OPENS = 60_000;
/** The bulk skip while the batch can still grow (checklist-one-marketplace-match-cards-keeps-every-card's ceiling). */
const BATCH_GROWS = 60_000;

/**
 * NEO-591: the Chiefs' team-leader card, its file cell changed to a prospect claim nobody on
 * file answers to (Dallas Baptist is no minor-league or college football team), so it is held.
 */
const HELD_PROSPECT = {
  number: "38a",
  card: "Kansas City Chiefs",
  team: "Kansas City Chiefs",
  cell: "Prospect (Dallas Baptist)",
  listed: "Dallas Baptist",
} as const;

/**
 * NEO-591: one player BSC lists twice (#9a, #9b) that the file prints once, as "9":
 * both cards share the row by its stem.
 */
const STEM = { renumber: { "9a": "9" }, drop: ["9b"], player: "Julius Thomas" } as const;
/**
 * NEO-591: one card BSC lists once (#95) that the file prints twice, the second a
 * variation: the card pairs 95a and 95b is created as its variation.
 */
const SIBLING = {
  card: "95",
  player: "Kyle Long",
  split: { "95": [{ number: "95a" }, { number: "95b", note: "(Photo Variation)" }] },
  base: "95a",
  variation: "95b",
  variationName: "Photo Variation",
} as const;

/** A row's name with its `#<number> ` prefix and any ` · <variation>` tail dropped. */
function nameFromLabel(label: string): string {
  return label.replace(/^#\S+ /, "").replace(/ · .*$/, "").trim();
}

test(
  "Match Cards on 2014 Topps Football — team-leader cards pair with no conflict, and the name the operator picks is the one saved (NEO-343, NEO-344)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1-2: cold drill to Football / 2014 / Topps, then the flagship
    // set's Base, mapping it on both sides (R9). No other spec opens the year,
    // so every column syncs itself; the helpers pay those marketplace waits.
    await drillToColdManufacturer(page, env, FOOTBALL_2014);
    await drillToBaseVariant(page, env, { ...FOOTBALL_2014, set: "Topps" });

    if (env.SL_PAUSED) {
      // No dialog, so no name decision to prove: the operator is told why.
      await expect(page.getByText("SportLots is on pause.")).toBeVisible();
      await expect(page.getByText(/Match Cards/)).toBeHidden();
      await expectAccessible(page, { label: "2014 Topps Football Base, SportLots on pause" });

      // ── NEO-489, SportLots on pause: a checklist that says "No Team" on a card BSC gives a team ──
      // With SportLots paused the fetch is BSC plus the checklist: Match Cards, then the review
      // wizard. This set is the one place the marketplace's OWN bulk answer carries a team (a
      // team-leader card, "New England Patriots TL", is its team: no other registered set has
      // one, see SET-REGISTRY.md), so it is where a No Team claim can disagree with a card that
      // already has a team. The publisher's file is the set's own captured one with ONE change:
      // #6a, the Patriots' card, now says No Team (`noTeamOn`). BSC calls added: 0. All 554 rows
      // are answered, so no card is asked of BSC per card, and the card that disagrees already
      // carries its team from the bulk answer, so nothing is looked up for it either.
      // NEO-591: #38a, the Chiefs' card, says "Prospect (Dallas Baptist)" (`HELD_PROSPECT`).
      // Fresh-only like the rest of this spec (the flow commits the set; the unpaused path
      // below never runs in the same seed), every name skipped.
      await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
      const claimed = await usePublishersChecklist(page, CHECKLISTS.topps2014FootballBase, {
        teamCells: { "6a": "No Team", [HELD_PROSPECT.number]: HELD_PROSPECT.cell },
        renumber: STEM.renumber,
        drop: STEM.drop,
        split: SIBLING.split,
      });
      await syncChecklistButton(page).click();
      // NEO-496 (D10, NQ1): BSC plus the uploaded checklist are two sources, so Match Cards opens
      // here too. Its wait is the helper's own (7 s of ours plus BSC's, `expectAfterMarketplace`).
      const pairing = matchCardsDialog(page);
      await expectAfterMarketplace(page, pairing.getByRole("button", { name: "Confirm card matches", disabled: false }), {
        platform: "BuySportsCards",
        what: "Match Cards after the paused 2014 Topps Football fetch",
      });
      // NEO-591: the held claim is on the row's line and in its Unlink control. Matched opens
      // collapsed whenever a column holds a card, expanded otherwise (STEP 5 below).
      const pausedExpand = pairing.getByRole("button", { name: /^Expand matched cards/ });
      const pausedCollapse = pairing.getByRole("button", { name: /^Collapse matched cards/ });
      await expect(pausedExpand.or(pausedCollapse)).toBeVisible();
      if (await pausedExpand.isVisible()) await pausedExpand.click();
      const heldRow = `#${HELD_PROSPECT.number} ${HELD_PROSPECT.card} · ${HELD_PROSPECT.cell}`;
      const unlinkHeld = pairing.getByRole("button", {
        name: `Unlink card #${HELD_PROSPECT.number} ${HELD_PROSPECT.card} from checklist row ${heldRow}`,
        exact: true,
      });
      await expect(unlinkHeld).toBeVisible();
      await expectAccessible(page, { within: pairing, label: "Match Cards, a held Prospect (X) row on 2014 Topps Football" });
      // Unlink: the checklist row is back on its list, still carrying its claim; link it back.
      await unlinkHeld.click();
      await expect(unlinkHeld).toHaveCount(0);
      await pairing.getByRole("textbox", { name: "Filter checklist rows" }).fill(`#${HELD_PROSPECT.number}`);
      await expect(pairing.getByRole("radio", { name: `Select ${heldRow}`, exact: true })).toBeVisible();
      await expectAccessible(page, { within: pairing, label: "Match Cards, the held Prospect (X) row unlinked onto the checklist list" });
      await pairing.getByRole("radio", { name: `Select ${heldRow}`, exact: true }).click();
      await pairing
        .getByRole("button", { name: `Link selected checklist row to #${HELD_PROSPECT.number} ${HELD_PROSPECT.card}`, exact: true })
        .click();
      await expect(unlinkHeld).toBeVisible();
      await expect(pairing.getByRole("radio", { name: `Select ${heldRow}`, exact: true })).toHaveCount(0);

      // ── NEO-591 STEM LINK: one row "9" covers BSC's #9a and #9b ──
      // Both cards carry the row's chip, read "all versions", with no % (a shared row is by
      // design, not a near match) and no number picker (a stem is no disagreement).
      const stemChip = pairing.getByText(`Checklist: #9 · all versions`, { exact: true });
      await expect(stemChip).toHaveCount(2);
      const stemUnlink = (n: string) =>
        pairing.getByRole("button", {
          name: new RegExp(`^Unlink card #${n} ${escapeRe(STEM.player)}( · .*)? from checklist row #9 ${escapeRe(STEM.player)}\b`),
        });
      const stemRows = pairing
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: new RegExp(`^Edit name for #9[ab] ${escapeRe(STEM.player)}`) }) });
      await expect(stemRows).toHaveCount(2);
      await expect(stemRows.getByText(/%$/)).toHaveCount(0);
      await expect(stemRows.getByRole("radiogroup", { name: /^Number for / })).toHaveCount(0);
      await expect(stemRows.getByText("Numbers differ", { exact: true })).toHaveCount(0);
      await expect(stemUnlink("9a")).toBeVisible();
      await expect(stemUnlink("9b")).toBeVisible();
      await expectAccessible(page, { within: pairing, label: "Match Cards, one checklist row shared by #9a and #9b (stem link)" });
      // Unlink #9b alone: #9a keeps the row (no row returns to the list), #9b is BSC's alone now
      // and moves to Keeping, focus follows it to its title there, and the status region says what
      // happened.
      await stemUnlink("9b").click();
      await expect(stemUnlink("9b")).toHaveCount(0);
      await expect(stemUnlink("9a")).toBeVisible();
      await expect(stemChip).toHaveCount(1);
      await expect(pairing.getByRole("radio", { name: /^Select #9 / })).toHaveCount(0);
      await expect(
        pairing.getByRole("status").filter({ hasText: /^Unlinked from #9b\./ }),
      ).toHaveText("Unlinked from #9b. Row #9 still covers #9a. Moved to Keeping.");
      await expect(
        pairing.getByRole("button", { name: new RegExp(`^Edit name for #9b ${escapeRe(STEM.player)}( · .*)?$`) }),
      ).toBeFocused();
      await expect(
        pairing.getByRole("button", { name: new RegExp(`^Remove #9b ${escapeRe(STEM.player)}( · .*)? from save list$`) }),
      ).toBeVisible();
      await expectAccessible(page, { within: pairing, label: "Match Cards, #9b unlinked from the shared row #9" });

      // ── NEO-591 SIBLING CREATION: BSC's one #95 against the file's 95a and 95b ──
      // The card paired 95a: offered as #95a (letters over digits) with no "Numbers differ" (95 and
      // 95a are the same card), so the number is a quiet choice, not a conflict: "Number #95a" and a
      // "Change number" control, no warning, no radios until it is opened.
      const kyle = pairing
        .getByRole("listitem")
        .filter({ has: page.getByRole("button", { name: `Edit name for #${SIBLING.base} ${SIBLING.player}`, exact: true }) });
      await expect(kyle.getByText(`Checklist: #${SIBLING.base}`, { exact: true })).toBeVisible();
      await expect(kyle.getByText("Numbers differ", { exact: true })).toHaveCount(0);
      await expect(kyle.getByText(/%$/)).toHaveCount(0);
      const kyleChosen = kyle.getByText(`Number #${SIBLING.base}`, { exact: true });
      const changeKyle = kyle.getByRole("button", { name: `Change number for #${SIBLING.base}`, exact: true });
      await expect(kyleChosen).toBeVisible();
      await expect(changeKyle).toHaveAttribute("aria-expanded", "false");
      await expect(kyle.getByRole("radio")).toHaveCount(0);
      await expect(kyle.getByText(/^Sources disagree on the number/)).toHaveCount(0);
      await expect(kyle.getByRole("group", { name: /^Number conflict on / })).toHaveCount(0);
      await changeKyle.click();
      await expect(changeKyle).toHaveAttribute("aria-expanded", "true");
      await expect(kyle.getByRole("group", { name: `Number choice on #${SIBLING.base}`, exact: true })).toBeVisible();
      await expect(kyleChosen).toBeHidden();
      await expect(kyle.getByText(/^Sources disagree on the number/)).toHaveCount(0);
      const kyleNumber = kyle.getByRole("radiogroup", { name: `Number for #${SIBLING.base}`, exact: true });
      // 95a is the checklist's alone (BSC printed 95), so its option says so; BSC's stays bare.
      await expect(
        kyleNumber.getByRole("radio", {
          name: `#${SIBLING.base} · your checklist — use this number for #${SIBLING.base}`,
          exact: true,
        }),
      ).toBeChecked();
      await expect(
        kyleNumber.getByRole("radio", { name: `#${SIBLING.card} — use this number for #${SIBLING.base}`, exact: true }),
      ).not.toBeChecked();
      // 95b has no card of its own: it was made a variation card and opens kept, on the Keeping shelf,
      // drawn like a Matched row: its title names the variation, tagged as a checklist row, with Remove.
      const sibling = pairing.getByRole("listitem").filter({
        has: page.getByRole("button", {
          name: `Edit name for checklist row #${SIBLING.variation} ${SIBLING.player} · ${SIBLING.variationName}`,
          exact: true,
        }),
      });
      await expect(sibling.getByText("Checklist row", { exact: true })).toBeVisible();
      await expect(
        sibling.getByRole("button", {
          name: new RegExp(`^Remove checklist row #${SIBLING.variation} ${escapeRe(SIBLING.player)}( · .*)? from save list$`),
        }),
      ).toBeVisible();
      await expect(pairing.getByRole("radio", { name: new RegExp(`^Select #${SIBLING.variation} `) })).toHaveCount(0);
      await expectAccessible(page, { within: pairing, label: "Match Cards, #95 paired to 95a with 95b pre-kept as its variation" });
      // The helper proves the teams line (two less than the file answers: #6a's and #38a's
      // disagreements are the operator's to settle), keeps any BSC-only card and confirms.
      await confirmChecklistMatchCards(page, {
        facts: { ...claimed, matched: claimed.matched - 2 },
        what: "the paused 2014 Topps Football fetch",
      });
      const pausedWizard = reviewWizard(page);
      // The wizard opens behind the entity check's batch (live lookups), like the unpaused path's.
      await expect(pausedWizard).toBeVisible({ timeout: WIZARD_OPENS });

      // The step that asks comes first, with exactly one group: #6a. Marketplace first, then the
      // checklist, each side's team: the card's own, and the checklist's claim in words.
      await expectChecklistDisagreementFirst(page);
      const onSix = disagreementOn(page, "6a");
      await expect(onSix).toBeVisible();
      await expect(pausedWizard.getByRole("radiogroup", { name: /^Disagreement on #/ })).toHaveCount(2);
      await expect(onSix.getByRole("definition")).toHaveText(["New England Patriots", "No team on the card"]);
      // NEO-591: the held claim shows X on the checklist's side, never "No team on the card".
      await expect(disagreementOn(page, HELD_PROSPECT.number).getByRole("definition")).toHaveText([
        HELD_PROSPECT.team,
        HELD_PROSPECT.listed,
      ]);
      await expectAccessible(page, { within: pausedWizard, label: "Entity review wizard, a No Team claim and a held Prospect (X) against team-leader cards" });
      await pickDisagreementSide(page, "6a", "Use the checklist's");
      await pickDisagreementSide(page, HELD_PROSPECT.number, "Keep the marketplace's");

      // The names are not this part's claim: skip them all (repeating while a Wikidata career
      // history can still stage a row), then save.
      const pausedNext = pausedWizard.getByRole("button", { name: "Next (Enter)", exact: true });
      await pausedNext.click();
      await expect(
        pausedWizard.getByRole("heading", { level: 3, name: "Checklist says otherwise" }),
      ).toBeHidden();
      const pausedNamesDone = pausedNext.or(confirmSaveButton(page));
      const pausedSkip = pausedWizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
      await expect(async () => {
        if (await pausedSkip.isVisible()) await pausedSkip.click();
        await expect(pausedNamesDone).toBeVisible({ timeout: 7_000 });
      }).toPass({ timeout: BATCH_GROWS });
      await advanceToSave(page);
      await confirmSaveButton(page).click();
      await expect(page.getByText(/Saved [1-9][0-9]* cards?/)).toBeVisible();
      await expect(pausedWizard).toBeHidden();

      // The checklist's side was taken: #6a (still named for its team, the TC rule) shows no team
      // at all. A fresh load of the set, #6a found by the checklist search ("6a" is a prefix
      // match: #6a, not #16a). Where the claim was NOT taken, the card would carry its team
      // linked (the team text twice, name and sub-line, as STEP 9 reads) or typed and
      // unconfirmed; here it is the name alone, no team chip in the drawer, and no
      // "no team on this card yet" badge, because the checklist's No Team is an answer.
      await drillToBaseVariant(page, env, { ...FOOTBALL_2014, set: "Topps" });
      const pausedSearch = page.getByRole("searchbox", { name: "Search cards" });
      await pausedSearch.fill("6a");
      await expect(page.getByText(/^1 of [0-9]+ cards$/)).toBeVisible();
      const sixRow = page.getByRole("button", { name: /^Edit card 6a?, New England Patriots$/ });
      await expect(sixRow).toBeVisible();
      await expect(page.getByText(/New England Patriots \(unconfirmed\)/)).toHaveCount(0);
      await expect(page.getByRole("img", { name: /^Card 6a?(, .*)? needs attention: no team on this card yet$/ })).toHaveCount(0);
      await sixRow.click();
      const sixDrawer = page.getByRole("dialog");
      await expect(sixDrawer.getByText("Teams", { exact: true })).toBeVisible();
      await expect(sixDrawer.getByRole("button", { name: /^Remove team / })).toHaveCount(0);
      await sixDrawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(sixDrawer).toBeHidden();

      // NEO-591: #38a kept the marketplace's team and is a Prospect Card all the same.
      await pausedSearch.fill(HELD_PROSPECT.number);
      await expect(page.getByText(/^1 of [0-9]+ cards$/)).toBeVisible();
      const heldEdit = page.getByRole("button", { name: `Edit card ${HELD_PROSPECT.number}, ${HELD_PROSPECT.card}`, exact: true });
      await heldEdit.click();
      const heldDrawer = page.getByRole("dialog", { name: `Card #${HELD_PROSPECT.number}` });
      await expect(heldDrawer.getByRole("button", { name: /^Remove team / })).toHaveAccessibleName(`Remove team ${HELD_PROSPECT.team}`);
      await heldDrawer.getByRole("button", { name: "Show features editor" }).click();
      await expect(heldDrawer.getByRole("button", { name: "Value for Prospect Card" })).toHaveAttribute("aria-pressed", "true");
      await heldDrawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(heldDrawer).toBeHidden();

      // NEO-591: the card took the row's lettered number, and 95b was saved as its variation,
      // named by the checklist's note ("95b" is a prefix match: #95b alone).
      await pausedSearch.fill(SIBLING.base);
      await expect(page.getByText(/^1 of [0-9]+ cards$/)).toBeVisible();
      await expect(page.getByRole("button", { name: `Edit card ${SIBLING.base}, ${SIBLING.player}`, exact: true })).toBeVisible();
      await pausedSearch.fill(SIBLING.variation);
      await expect(page.getByText(/^1 of [0-9]+ cards$/)).toBeVisible();
      await expect(
        page.getByText(new RegExp(`^Variation of #${SIBLING.base}( · .*)? · ${SIBLING.variationName}$`)),
      ).toBeVisible();
      await page.getByRole("button", { name: `Edit card ${SIBLING.variation}, ${SIBLING.player}`, exact: true }).click();
      const siblingDrawer = page.getByRole("dialog", { name: `Card #${SIBLING.variation}` });
      await expect(siblingDrawer.getByRole("textbox", { name: "Card variation", exact: true })).toHaveValue(SIBLING.variationName);
      // A linked parent reads as the card itself, with Clear beside it (no number box to type in).
      await expect(siblingDrawer.getByText(`#${SIBLING.base} ${SIBLING.player}`, { exact: true })).toBeVisible();
      await expect(siblingDrawer.getByRole("button", { name: "Clear variation parent", exact: true })).toBeVisible();
      await siblingDrawer.getByRole("button", { name: "Done editing card" }).click();
      await expect(siblingDrawer).toBeHidden();
      return;
    }

    // LIVE BRANCH. RE-DERIVE ON THE FIRST LIVE RUN (SportLots paused): written and measured
    // before names-first pairing (NEO-591). The counts, the "every BSC card matched" shape and
    // the Matched list's open state below are the last live reading; re-measure each.
    // ── STEP 3: fetch. The empty checklist makes everything below THIS fetch's.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // NEO-478/482: BSC's side comes from its own per-card answers, captured as the
    // publisher's checklist (SET-REGISTRY.md), so the ~550-card fetch makes no
    // per-card BSC call. The team-leader cards' team text is still BSC's.
    const checklist = await usePublishersChecklist(page, CHECKLISTS.topps2014FootballBase);
    await syncChecklistButton(page).click();
    const dialog = page.getByRole("dialog", { name: /^Match Cards/ });
    // Live BSC + SportLots round trip (GUIDE hard rule 3, marketplace exception).
    await expect(dialog).toBeVisible({ timeout: CHECKLIST_FETCH });
    // The dialog OPENING is not the fetch FINISHING: Confirm is "Loading…"
    // (aria-disabled) until the stream resolves. Same live round trip.
    const confirm = dialog.getByRole("button", { name: "Confirm card matches", disabled: false });
    await expect(confirm).toBeVisible({ timeout: CHECKLIST_FETCH });
    await expect(confirm).toHaveText("Confirm");
    await expectTeamsFromChecklist(page, checklist);

    // ── STEP 4 (a): at most 12 of each kind of conflict. The Matched toggle's
    // name appends ", N with a player conflict" then ", M with a name
    // conflict" whenever either is non-zero, so one full match bounds both at
    // 0-12. Measured 8 name and 7 player conflicts (PR #335 run 38501127928);
    // unwired, all 32 team-leader cards conflict on both (40 and 38 on prod).
    // Bounded, not pinned: the natural 8 and 7 are live marketplace
    // disagreements (#72, #247, #257, #405 by the catalogues), not this
    // spec's business, so 4 of slack absorbs catalogue drift while a
    // regression on more than 4 of the 32 team-leader cards still fails.
    // NEO-591: the name count now also holds a card whose name differs from its
    // checklist row's. The checklist here is BSC's own capture, and the product
    // matcher pairs all 554 of its rows to the capture's cards with the same name
    // on both sides (checked with `checklistMatch` and the modal's name key), so
    // the checklist adds nothing to the bound.
    const upTo12 = "([0-9]|1[0-2])";
    await expect(
      dialog.getByRole("button", {
        name: new RegExp(
          `^(Expand|Collapse) matched cards(, ${upTo12} with a player conflict)?(, ${upTo12} with a name conflict)?$`,
        ),
      }),
    ).toBeVisible();
    await expectAccessible(page, { within: dialog, label: "Match Cards dialog, 2014 Topps Football Base" });

    // ── STEP 5 (a): #6a, a team-leader card, is matched under the bare team
    // name with no decision on it. Matched opens collapsed whenever a column
    // holds a card and expanded otherwise (which, live, is to re-derive: names
    // first may now pair what used to wait in a column): wait for one state,
    // then open it.
    const expandMatched = dialog.getByRole("button", { name: /^Expand matched cards/ });
    const collapseMatched = dialog.getByRole("button", { name: /^Collapse matched cards/ });
    await expect(expandMatched.or(collapseMatched)).toBeVisible();
    if (await expandMatched.isVisible()) await expandMatched.click();
    await expect(collapseMatched).toBeVisible();
    // `Unlink <label>` carries the name the card will be saved with; a full
    // match refuses "New England Patriots TL". `#6a?`: BSC's number is "6a"
    // (the parent of a "6b" photo variation) unless NB normalises it.
    await expect(dialog.getByRole("button", { name: /^Unlink #6a? New England Patriots$/ })).toBeVisible();
    // No decision on it, title or roster (rides on the positive above, R2). NEO-591: nor from the
    // checklist: the capture's row 6a pairs card 6a by number and names "New England Patriots" too.
    await expect(dialog.getByRole("group", { name: /^Name conflict on #6a?( .*)?$/ })).toHaveCount(0);
    await expect(dialog.getByRole("group", { name: /^Players conflict on #6a?( .*)?$/ })).toHaveCount(0);

    // ── STEP 6 (b): a conflict on #442, shown bare. Matched is still open
    // from STEP 5. The measured shape (R2; re-derive on the first live run,
    // SportLots paused): every BSC card matched, so BSC
    // only is empty and #442 sits in the Matched list. Unlink it (the button
    // carries its label, `Unlink #442 <name>`); its BSC half lands in BSC only.
    // RE-DERIVE ON THE FIRST LIVE RUN: with the checklist uploaded, #442's pair carries its row,
    // and a split pair's BSC half that holds a checklist link is KEPT (it goes to Keeping, not
    // BSC only; CardPairingModal's UNLINK), so this step's counts and the BSC-column read below
    // are the pre-checklist reading.
    const bscOnly = (n: number) => dialog.getByRole("heading", { name: `BSC only (${n})`, exact: true });
    await expect(bscOnly(0)).toBeVisible();
    await dialog.getByRole("button", { name: /^Unlink #442 / }).click();
    await expect(bscOnly(1)).toBeVisible();
    // Collapse Matched so the columns are the dialog's working area again.
    await collapseMatched.click();
    await expect(expandMatched).toBeVisible();

    // The BSC half: #442, narrowed to by the column's filter (it matches the
    // row's label). Its name is read off the row before it is selected
    // (selecting renames the row).
    await dialog.getByRole("textbox", { name: "Filter BSC cards" }).fill("#442");
    const bscRow = dialog.getByRole("radio", { name: /^Select BSC card #442 / });
    await expect(bscRow).toBeVisible();
    const bscName = nameFromLabel(((await bscRow.getAttribute("aria-label")) ?? "").replace(/^Select BSC card /, ""));

    // The SportLots half: whichever SportLots-only card heads its column (any
    // one will do; measured #28 Vernon David · Jumping, and an unlinked
    // SportLots half of #442, if it had one, is appended AFTER the fetched
    // ones). Its pill shows the NAME, so the number and variation go.
    const slRow = dialog.getByRole("button", { name: /^Link selected BSC card to / }).first();
    await expect(slRow).toBeVisible();
    const slLabel = ((await slRow.getAttribute("aria-label")) ?? "").replace(/^Link selected BSC card to /, "");
    const slName = nameFromLabel(slLabel);
    // The data precondition, stated (R2): two different names, or there is no
    // disagreement to make.
    expect(bscName, "#442's BSC name").not.toBe("");
    expect(slName, "the SportLots card must name someone other than #442").not.toBe(bscName);

    // Link. The SportLots rows are disabled until a BSC row is selected.
    await bscRow.click();
    await expect(dialog.getByRole("radio", { name: /^#442 .*, selected\. Press to deselect\.$/ })).toBeVisible();
    await dialog.getByRole("button", { name: `Link selected BSC card to ${slLabel}`, exact: true }).click();

    // The conflict is raised on #442, and the link reopened Matched to show it.
    const nameGroup = dialog.getByRole("group", { name: "Name conflict on #442", exact: true });
    await expect(nameGroup).toBeVisible();
    await expect(collapseMatched).toBeVisible();

    // NEO-344: the warning names no marketplace, and each value is bare,
    // announced (`<value> — use this name for #442`) and shown (the checked
    // pill's `✓ ` is a separate aria-hidden span).
    await expect(
      nameGroup.getByText("Potential names for this card — pick the right one before it is listed."),
    ).toBeVisible();
    await expect(dialog.getByRole("radiogroup", { name: "Name for #442", exact: true })).toBeVisible();
    // NEO-591: two pills, whether or not #442 still holds its checklist row: the capture's row names
    // #442 as BSC does, and a name a marketplace also said is one bare pill, never "· your checklist".
    await expect(dialog.getByRole("radiogroup", { name: "Name for #442", exact: true }).getByRole("radio")).toHaveCount(2);
    const pill = (value: string) =>
      dialog.getByRole("radio", { name: `${value} — use this name for #442`, exact: true });
    const bscPill = pill(bscName);
    const slPill = pill(slName);
    await expect(bscPill).toHaveText(new RegExp(`^(✓ )?${escapeRe(bscName)}$`));
    await expect(slPill).toHaveText(new RegExp(`^(✓ )?${escapeRe(slName)}$`));
    // …and no choice, title or roster, names a marketplace. Rides on the
    // positives above (R2).
    await expect(dialog.getByText(/These marketplaces/)).toHaveCount(0);
    await expect(dialog.getByRole("radio", { name: /^(BSC|SportLots|Custom): / })).toHaveCount(0);
    await expect(dialog.getByRole("radio").filter({ hasText: /^(✓ )?(BSC|SportLots|Custom): / })).toHaveCount(0);
    await expectAccessible(page, { within: dialog, label: "Match Cards dialog, name conflict on #442" });

    // BSC's value stays preselected: read on the name the row will be saved
    // with, which its Unlink carries.
    await expect(bscPill).toBeChecked();
    await expect(dialog.getByRole("button", { name: new RegExp(`^Unlink #442 ${escapeRe(bscName)}( · .+)?$`) })).toBeVisible();

    // Pick the other value, by the value it shows.
    await slPill.click();
    await expect(slPill).toBeChecked();
    await expect(dialog.getByRole("button", { name: new RegExp(`^Unlink #442 ${escapeRe(slName)}( · .+)?$`) })).toBeVisible();
    await expect(dialog.getByRole("button", { name: new RegExp(`^Unlink #442 ${escapeRe(bscName)}( · .+)?$`) })).toBeHidden();

    // ── STEP 7: save. Nothing is kept: the unpaired cards are dropped and the
    // matched rows, #442 among them, are saved.
    await confirm.click();
    await expect(dialog).toBeHidden();

    // Two legitimate shapes, named by this gate (R2): the review wizard (names
    // the catalogue does not know — a team-leader card's team is also reported
    // as a PLAYER, the TC rule — or only its teams / titles steps), or the
    // direct commit. The wizard opens behind the entity check's live batch.
    const wizard = reviewWizard(page);
    const saved = page.getByText(/Saved [1-9][0-9]* cards?/);
    await expect(wizard.or(saved).first()).toBeVisible({ timeout: WIZARD_OPENS });
    if (await wizard.isVisible()) {
      await expectAccessible(page, { within: wizard, label: "Tidy-up wizard, 2014 Topps Football" });
      // The names are not this spec's claim: skip every one in one press,
      // lookups included, creating nothing. The batch can still grow after the
      // wizard opens (a Wikidata career history stages teams), leaving one row
      // undecided, so the press repeats until the names-done footer shows.
      const namesDone = wizard
        .getByRole("button", { name: "Next (Enter)", exact: true })
        .or(confirmSaveButton(page));
      const skipRemaining = wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
      await expect(async () => {
        if (await skipRemaining.isVisible()) await skipRemaining.click();
        await expect(namesDone).toBeVisible({ timeout: 7_000 });
      }).toPass({ timeout: BATCH_GROWS });
      // Teams and titles are not this spec's claim either: every line stays
      // on its default.
      await advanceToSave(page);
      await confirmSaveButton(page).click();
    }
    // Both shapes end here: our own write, the 7 s bar.
    await expect(saved).toBeVisible();

    // ── STEP 8 (b): the saved name is the one the operator picked. Re-enter
    // the set so the checklist mounts fresh from what was stored (Base is
    // mapped now, so the helper takes the Re-map path and writes nothing): a
    // read-back, not an echo of the dialog's draft. The list is virtualised
    // and runs to ~440 rows, so the checklist search reaches the row.
    await drillToBaseVariant(page, env, { ...FOOTBALL_2014, set: "Topps" });
    const search = page.getByRole("searchbox", { name: "Search cards" });
    const oneFound = page.getByText(/^1 of [0-9]+ cards$/);
    // A number term is a PREFIX match, and 442 is the set's last number.
    await search.fill("442");
    await expect(oneFound).toBeVisible();
    await expect(page.getByRole("button", { name: `Edit card 442, ${slName}`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Edit card 442, ${bscName}`, exact: true })).toHaveCount(0);

    // ── STEP 9 (a): the saved #6a is "New England Patriots" and its team is
    // LINKED. "6a" finds #6a and not #16a or #36a (prefix match).
    await search.fill("6a");
    await expect(oneFound).toBeVisible();
    await expect(page.getByRole("button", { name: /^Edit card 6a?, New England Patriots$/ })).toBeVisible();
    // On a team card the row's name cell and its team sub-line read the same.
    // The sub-line lists the card's LINKED teams by full name (then any
    // ` · <part>`); a typed team with no row reads "New England Patriots
    // (unconfirmed)" and an unlinked card leaves the line blank. So, with the
    // list narrowed to this one card, exactly TWO nodes reading the team (the
    // name and a linked sub-line) is the link. The sub-line arrives on its own
    // per-row read, so it is waited for (a Convex read, 7 s).
    await expect(page.getByText(/^New England Patriots( · .+)?$/)).toHaveCount(2);
    await expect(page.getByText(/New England Patriots \(unconfirmed\)/)).toHaveCount(0);
    await expectAccessible(page, { label: "2014 Topps Football Base checklist, searched to #6a" });
  },
);
