// Origin: .maestro/flows/set-selector/inserts-1996-score-one-nb-set-two-bsc-sources.yaml (Maestro suite retired in NEO-341; see git history)
// Sole writer of the 1996 Score Dugout Collection Artists Proofs insert; fresh-only.
//
// NEO-535 / NEO-645: the "Listing title" tile of the Tidy Up walk is proved in the SportLots-PAUSED
// branch, which has no marketplace pairing and no 220-card merge. There ONE BSC insert (Series 1,
// 110 cards, a captured publisher's checklist uploaded first) is renamed to a name long enough that
// every title has to leave something out (NEO-609: a whole team, the number or a first name), so
// Match Cards' Confirm saves 110 cards that are each worth a check, and the walk opens on them.
// Card by card the tile shows what went ("Left out to fit"), takes titles typed by hand (one typed
// past 80 is refused in place), and "Shorten the set name for every card" saves a "Set name in
// titles" that retitles every card by the NEO-637 rules (server-side since NEO-645): a generated
// title is rebuilt with it, a typed title that still leaves something out gets the new set name in
// place of the old, and a typed title that leaves something out with no set name in it is
// rebuilt. The stored titles are read back; #3's swap into a typed title and #12 losing its "cut
// short" flag (both red on an earlier NEO-645 build, fixed since) are asserted LAST, in P9.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  columnOption,
  columnSearch,
  drillToSet,
  escapeRe,
  expectAfterBscSync,
  openAttributesPanel,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { cardAttentionMark, editCardButton } from "../../support/cards";
import { CHECKLISTS, confirmChecklistMatchCards, usePublishersChecklist } from "../../support/published-checklist";
import {
  expectCardSettled,
  expectCardsLeft,
  openTidyWalk,
  saveForLater,
  settleWalkAfterCommit,
  skipCard,
  skipUntil,
  tidyCardIdentity,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import { expectNoOverCapLook, expectOverCapLook } from "../../support/theme";
import type { Page } from "@playwright/test";

const SERIES_1 = "Dugout Collection Artist's Proofs Series 1";
const SERIES_2 = "Dugout Collection Artist's Proofs Series 2";
const MERGED = "Dugout Collection Artists Proofs";
const FETCH = 120_000;

// ── The SportLots-paused branch's fixture (NEO-535, NEO-609) ──
// Series 1's NB row is renamed to LONG_INSERT. The title arithmetic is exact because
// the name is a fixed string (no minted token), computed with the title builder
// (`assessListingTitle`) over the captured checklist. The description "1996 Score
// <name>" is 67 characters, and the row's type name ("Insert") is a quiet cut, so
// every one of the 110 titles has to give up a whole team, the number or a first name
// (NEO-609): every card is on the walk, worth a check. The cards the spec reads:
//   #2  Rich Becker      loses the team and the number, keeps his full name; the set name
//                        (NEO-618: any cut, not only a first name) brings both back, the
//                        team whole
//   #6  Jim Thome        fits at exactly 80 and loses ONLY the team; the set name brings it
//                        back whole (NEO-618)
//   #12 Darren Daulton   loses the team and "Darren"; the set name brings the name back and
//                        the team fits as its nickname (NEO-606), the sport kept
// and #76 Todd Hollandsworth runs over 80 after every cut (81) until the set name makes it fit.
// NEO-637, the titles the operator writes (computed the same way), each typed BEFORE the set
// name is saved:
//   #3  Ryan Klesko      holding the description: "Klesko #3" after it, 77, so it still leaves
//                        out "Ryan" and the team; the set name is swapped in for the
//                        description and "Klesko #3" kept
//   #8  Don Mattingly    OWN_TITLE (after one typed past 80): the team is left out and neither
//                        the description nor the box text is in it, so the set name drops the
//                        edit and the title is the generated one
const SERIES_1_CARDS = 110;
const LONG_INSERT = "Dugout Collection Artists Proofs Hologram Foil Series II";
const LONG_DESCRIPTION = `1996 Score ${LONG_INSERT}`;
// The set name the operator saves: the description without the filler words.
const SHORT_BOX = "1996 Score Dugout Collection Artists Proofs";
/** #12 under the set name: the first name back, the team by its nickname (NEO-606), the sport kept. */
const DAULTON_BOXED = `${SHORT_BOX} Darren Daulton #12 Phillies Baseball`;
/** #76 under the set name: it fits, the team by its nickname. */
const HOLLANDSWORTH_BOXED = `${SHORT_BOX} Todd Hollandsworth #76 Dodgers`;
/** #2 before the set name: the full name kept, the team and the number left out (80 is the cap). */
const BECKER_BUILT = `${LONG_DESCRIPTION} Rich Becker`;
/** #2 under the set name (NEO-618): the number and the whole team back; the sport does not fit (83). */
const BECKER_BOXED = `${SHORT_BOX} Rich Becker #2 Minnesota Twins`;
/** #6 before the set name: it fits at exactly 80 with only its team left out. */
const THOME_BUILT = `${LONG_DESCRIPTION} Jim Thome #6`;
/** #6 under the set name (NEO-618): the team back whole; the sport does not fit (83). */
const THOME_BOXED = `${SHORT_BOX} Jim Thome #6 Cleveland Indians`;
// What the operator types over #8's generated title: first past the cap, then their own.
const OVER_TITLE = `${LONG_DESCRIPTION} Don Mattingly #8 New York Yankees`;
const OWN_TITLE = "1996 Score Artists Proofs Don Mattingly #8 My Own Title";
/** #8 under the set name, its edit dropped: the generated title, the team whole; the sport does not fit (86). */
const MATTINGLY_BOXED = `${SHORT_BOX} Don Mattingly #8 New York Yankees`;
/** NEO-637 — #3 as the operator types it: the set name kept, "Ryan" and the team out. */
const KLESKO_OWN = (setName: string) => `${setName} Klesko #3`;

async function openScoreInserts(page: Page, env: Parameters<typeof drillToSet>[1]) {
  await drillToSet(page, env, { year: "1996", manufacturer: "Score", set: "Score", createManufacturer: true });
  await pick(page, "Variant Types", "Insert", { search: false });
}

/**
 * NEO-535 / NEO-645, the SportLots-paused branch: the walk's "Listing title" tile and
 * "Set name in titles", proved on ONE BSC insert (Series 1) with nothing but BSC attached.
 *
 * Contract: ENTRY the Inserts column is open on the 1996 Score variant type with both
 * BSC series listed under their own names (the caller asserted that). EXIT the set is
 * committed (110 cards) and its stored titles read back; the insert row stays renamed
 * to LONG_INSERT and carries SHORT_BOX as its "Set name in titles". Fresh-only.
 */
async function cardTitlesWithOnlyBscAttached(page: Page, env: Parameters<typeof drillToSet>[1]) {
  // ── P1. Rename Series 1 so its titles cannot fit ──
  // The fetch reads the row's BSC id from its slot, never its name (product invariant 4),
  // so the rename cannot change what is fetched.
  await columnOption(page, "Inserts", SERIES_1).click();
  await expect(page.getByRole("heading", { name: `Attributes for ${SERIES_1}` })).toBeVisible();
  // NEO-569: the pencil sits in the open panel only, and an insert row starts it shut.
  await openAttributesPanel(page);
  await page.getByRole("button", { name: `Rename ${SERIES_1}` }).click();
  const edit = page.getByRole("textbox", { name: `Edit name for ${SERIES_1}` });
  await edit.fill(LONG_INSERT);
  await edit.press("Enter");
  // The panel header renders the CURRENTLY SELECTED row: the rename landed on the row we mean.
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
  // The arithmetic the fixture rests on (a drift in these strings is a spec bug, caught here).
  expect(LONG_DESCRIPTION, "the description is 67 characters").toHaveLength(67);
  expect(SHORT_BOX, "the box text is 43 characters").toHaveLength(43);
  expect([BECKER_BUILT.length, THOME_BUILT.length, BECKER_BOXED.length, THOME_BOXED.length]).toEqual([79, 80, 74, 74]);
  // NEO-637: every title the operator writes fits, and so does #8's under the set name.
  expect([KLESKO_OWN(LONG_DESCRIPTION).length, MATTINGLY_BOXED.length]).toEqual([77, 77]);

  // ── P2. Fetch with the publisher's checklist uploaded first, BSC alone ──
  const facts = await usePublishersChecklist(page, CHECKLISTS.dugoutArtistsProofs1996Series1);
  expect(facts.rows, "the captured file holds every one of Series 1's cards").toBe(SERIES_1_CARDS);
  await syncChecklistButton(page).click();
  // NEO-496 (D10): a publisher's checklist is a source, so even one marketplace opens Match Cards.
  // The helper waits for it (one live BSC round trip: our 7 s plus the time BSC is measured to take),
  // asserts "Teams from your checklist" while it is open, keeps every BSC card and confirms.
  // NEO-645: Confirm IS the commit, of all 110 cards (our own write, 7 s), and the Tidy Up walk
  // opens on them by itself: every title had to leave something out, so every card is worth a check.
  await confirmChecklistMatchCards(page, { facts, what: "the solo fetch of Series 1" });
  const saved = page.getByText(new RegExp(`^Saved ${SERIES_1_CARDS} cards\\.`)).first();
  expect(await settleWalkAfterCommit(page, saved), "every title left something out, so the walk opened").toBe(true);
  await expect(tidyWalk(page)).toHaveAccessibleName(tidyUpName({ year: "1996", set: "Score", variant: LONG_INSERT }));
  await expectCardsLeft(page, SERIES_1_CARDS);
  await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, every title left something out (SportLots paused)" });

  // ── P3. The Listing title tile, card by card, BEFORE any set-name change ──
  // The walk goes in (ready, number) order, and a card whose name lookups are still running is
  // not ready, so the cards this spec reads are found by their number off the open card, and every
  // other card is skipped (Skip writes nothing). Bounded by the checklist's size.
  const titleTile = tidyTile(page, "Listing title");
  const shownTitle = (text: string) => titleTile.getByText(text, { exact: true });
  const leftOut = titleTile.getByText(/^Left out to fit: /);
  const titleBox = (number: number) => titleTile.getByRole("textbox", { name: `Card title for #${number}`, exact: true });
  const editTitle = titleTile.getByRole("button", { name: "Edit title", exact: true });
  /** Type a title by hand and keep it with Enter: the editor closes and the tile shows it. */
  const typeTitle = async (number: number, text: string) => {
    await editTitle.click();
    await titleBox(number).fill(text);
    await titleBox(number).press("Enter");
    await expect(titleBox(number)).toBeHidden();
    await expect(shownTitle(text)).toBeVisible();
  };
  const handlers: Record<string, () => Promise<void>> = {
    // #2 kept its full name and gave up its team and number: a cut (blue) puts it on the walk.
    "2": async () => {
      await expect(titleTile).toHaveAccessibleDescription(/To check/);
      await expect(shownTitle(BECKER_BUILT)).toBeVisible();
      await expect(leftOut).toHaveText(/^Left out to fit: Minnesota Twins, #2$/);
    },
    // #3 typed by hand, holding the set's description: "Ryan" and the team stay out.
    "3": async () => {
      await expect(shownTitle(`${LONG_DESCRIPTION} Ryan Klesko`)).toBeVisible();
      await typeTitle(3, KLESKO_OWN(LONG_DESCRIPTION));
    },
    // #6 fits at exactly 80 and gave up its team alone (nothing after it: no comma).
    "6": async () => {
      await expect(shownTitle(THOME_BUILT)).toBeVisible();
      await expect(leftOut).toHaveText(/^Left out to fit: Cleveland Indians$/);
    },
    // #8: a title typed past 80 is refused in place (invalid, the pink look, Save title held);
    // then the operator's own, which fits, and Enter keeps it.
    "8": async () => {
      await editTitle.click();
      const box = titleBox(8);
      await box.fill(OVER_TITLE);
      const over = titleTile.getByText("Over the limit, so it opens ready to edit.", { exact: true });
      await expect(over).toBeVisible();
      await expect(box).toHaveAttribute("aria-invalid", "true");
      await expectOverCapLook(box, over);
      await expect(titleTile.getByRole("button", { name: "Save title", exact: true })).toHaveAttribute("aria-disabled", "true");
      await expectAccessible(page, { within: tidyWalk(page), label: "Listing title tile, a title typed past 80 (SportLots paused)" });
      await box.fill(OWN_TITLE);
      await expect(box).not.toHaveAttribute("aria-invalid", "true");
      await expect(over).toHaveCount(0);
      await expect(titleTile.getByText("Fits now. Enter saves it.", { exact: true })).toBeVisible();
      await expectNoOverCapLook(box);
      await box.press("Enter");
      await expect(box).toBeHidden();
      await expect(shownTitle(OWN_TITLE)).toBeVisible();
    },
    // #12 lost "Darren" and its team, whole (it does not fit even as "Phillies").
    "12": async () => {
      await expect(shownTitle(`${LONG_DESCRIPTION} Daulton #12`)).toBeVisible();
      await expect(leftOut).toHaveText(/Darren/);
      await expect(leftOut).toHaveText(/Philadelphia Phillies/);
    },
  };
  const todo = new Set(Object.keys(handlers));
  for (let i = 0; i < SERIES_1_CARDS && todo.size > 0; i++) {
    await expectCardSettled(page);
    const number = (await tidyCardIdentity(page).first().textContent())?.match(/^#(\S+)/)?.[1] ?? "";
    if (todo.has(number)) {
      await handlers[number]();
      todo.delete(number);
    }
    if (todo.size > 0) await skipCard(page);
  }
  expect([...todo], "the walk showed every card this spec reads").toEqual([]);

  // ── P4. "Shorten the set name for every card", from #12 in a new sitting (the pill) ──
  await saveForLater(page);
  await openTidyWalk(page);
  await skipUntil(page, tidyWalk(page).getByText(/^#12$/), { maxCards: SERIES_1_CARDS });
  const shorten = titleTile.getByRole("button", { name: "Shorten the set name for every card", exact: true });
  await expect(shorten).toHaveAttribute("aria-expanded", "false");
  await shorten.click();
  await expect(shorten).toHaveAttribute("aria-expanded", "true");
  const box = titleTile.getByRole("textbox", { name: "Set name in titles", exact: true });
  await expect(box).toBeFocused();
  // It opens on what the titles say now: the builder's description of the set (the year, the
  // brand and the renamed insert, capped at 80), never the set row's bare name ("Score").
  await expect(box).toHaveValue(LONG_DESCRIPTION);
  await box.fill(SHORT_BOX);
  // The card's title follows the box as it is typed (nothing saved yet): #12 has its first name
  // back, opening with the box text verbatim, and its team fits as the nickname (NEO-606).
  await expect(shownTitle(DAULTON_BOXED)).toBeVisible();
  await expectAccessible(page, { within: tidyWalk(page), label: "Listing title tile, Set name in titles open (SportLots paused)" });
  // Escape closes only the field, nothing saved: the title is the stored one again.
  await box.press("Escape");
  await expect(box).toBeHidden();
  await expect(shorten).toBeFocused();
  await expect(shownTitle(`${LONG_DESCRIPTION} Daulton #12`)).toBeVisible();
  // Again, and this time saved for every card of the checklist. The box opens on the description
  // again: the Escape kept nothing of the typed text.
  await shorten.click();
  await expect(box).toHaveValue(LONG_DESCRIPTION);
  await box.fill(SHORT_BOX);
  await titleTile.getByRole("button", { name: `Save and apply to all ${SERIES_1_CARDS} cards`, exact: true }).click();
  await expect(titleTile.getByText("Set name saved. The other cards' titles are updating.", { exact: true })).toBeVisible();
  await expect(box).toBeHidden();
  // #12's STORED title is the set name's now, and nothing is left out of it (STEP P9 reads, last,
  // that it is no longer flagged as cut).
  await expect(shownTitle(DAULTON_BOXED)).toBeVisible();
  await expect(leftOut).toHaveCount(0);
  await saveForLater(page);

  // ── P8. The stored cards carry the chosen titles ──
  await openScoreInserts(page, env);
  await columnSearch(page, "Inserts").fill("Artist");
  await expect(columnOption(page, "Inserts", LONG_INSERT)).toBeVisible();
  // Series 2 was never touched: BSC's own name, no card fetched.
  await expect(columnOption(page, "Inserts", SERIES_2)).toBeVisible();
  await columnOption(page, "Inserts", LONG_INSERT).click();
  const cardTitle = page.getByRole("textbox", { name: "Card title" });
  // The checklist opens at its end; its search brings a card's row up.
  const openCard = async (number: number) => {
    await page.getByRole("searchbox", { name: "Search cards" }).fill(String(number));
    await page.getByRole("button", { name: new RegExp(`^Edit card ${number}, `) }).click();
    await expect(cardTitle).toBeVisible();
  };
  const closeCard = async () => {
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardTitle).toBeHidden();
  };
  // The set name retitled every card in scheduled pages (NEO-637's rules, server-side). A
  // GENERATED title is rebuilt with it: #12 (on screen when it was saved) and #2, #6 and #76,
  // which were never opened after it. #2 and #6 fit but left a team (and #2 its number) out
  // (NEO-618); #76 ran over 80 and fits now.
  await openCard(12);
  await expect(cardTitle).toHaveValue(DAULTON_BOXED);
  await closeCard();
  await openCard(2);
  await expect(cardTitle).toHaveValue(BECKER_BOXED);
  await expectAccessible(page, { label: "Card detail drawer, a fitting title the set name rebuilt (SportLots paused)" });
  await closeCard();
  await openCard(6);
  await expect(cardTitle).toHaveValue(THOME_BOXED);
  await closeCard();
  await openCard(76);
  await expect(cardTitle).toHaveValue(HOLLANDSWORTH_BOXED);
  await closeCard();
  // A typed title that left something out with neither the description nor the set name in it
  // has nothing to swap: the edit is dropped and the title is the generated one (#8).
  await openCard(8);
  await expect(cardTitle).toHaveValue(MATTINGLY_BOXED);
  await closeCard();
  // The box text sits on the insert row itself (its attributes panel), for the cards that come next.
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
  const editAttributes = page.getByRole("button", { name: "Edit attributes" });
  const hideAttributes = page.getByRole("button", { name: "Hide attributes" });
  // The panel remembers whether it was left open, so open it only if needed.
  await expect(editAttributes.or(hideAttributes)).toBeVisible();
  if (await editAttributes.isVisible()) await editAttributes.click();
  await expect(hideAttributes).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Value for Set name in titles" })).toHaveValue(SHORT_BOX);

  // The drill lives in the URL: Back undoes the pick of the renamed row, and the Inserts column
  // is open again with the row still listed (NEO-224).
  await page.goBack();
  await expect(columnSearch(page, "Inserts")).toBeVisible();
  await expect(columnOption(page, "Inserts", LONG_INSERT)).toBeVisible();
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeHidden();

  // ── P9 (LAST: two findings of an earlier NEO-645 run, fixed since and kept as regressions) ──
  // NEO-637: a typed title that still leaves something out (#3 left out "Ryan" and the team) takes
  // the set name in place of the description it holds, its own words kept (the pre-walk version of
  // this spec proved it). The row opens with the checklist at its end, so the card is brought up
  // by its player's name.
  await columnOption(page, "Inserts", LONG_INSERT).click();
  const search = page.getByRole("searchbox", { name: "Search cards" });
  await search.fill("Klesko");
  await page.getByRole("button", { name: /^Edit card 3, / }).click();
  await expect(cardTitle).toBeVisible();
  await expect(cardTitle).toHaveValue(KLESKO_OWN(SHORT_BOX));
  await closeCard();
  // #12 under the set name leaves nothing out (its team fits as the nickname, NEO-606, and the tile
  // lists nothing under "Left out to fit"), so it is not "worth a check: listing title was cut
  // short" any more. Its row's Edit button is the positive the missing mark is read against.
  await search.fill("Daulton");
  await expect(editCardButton(page, "12")).toBeVisible();
  await expect(cardAttentionMark(page, "12", "listing title was cut short")).toHaveCount(0);
}

test(
  "Inserts — ONE NeonBinder set maps to TWO BSC sets and one SportLots set, and a re-sync keeps NeonBinder's own card name (1996 Score, NEO-137 + NEO-203)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const id = env.ATTEMPT_ID;
    // NEO-535: the NB211 marker plus a filler tail, so the description alone
    // ("1996 Score <renamed>", 99+ characters on every runner) is over 80 and
    // EVERY card's title is still over the cap after every cut (the builder
    // never cuts a description word): the "Card titles" step is certain.
    const renamed = `${MERGED} NB211-${id} Hologram Foil Rainbow Refractor Edition`;
    const reconcile = page.getByRole("dialog", { name: "Reconcile Inserts" });
    const pairing = page.getByRole("dialog", { name: /Match Cards/ });
    const confirmMatches = page.getByRole("button", { name: "Confirm card matches", disabled: false });
    const saveSets = reconcile.getByRole("button", { name: /^Save [0-9]+ sets$/ });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openScoreInserts(page, env);

    if (env.SL_PAUSED) {
      // Only BSC answers: the two BSC sets stay separate and nothing reconciles.
      await expect(page.getByRole("heading", { name: "Inserts", exact: true })).toBeVisible();
      await expect(reconcile).toBeHidden();
      await columnSearch(page, "Inserts").fill("Artist");
      // The first visit syncs from BSC (sign-in included): our 7 s plus the time BSC is measured to take.
      await expectAfterBscSync(page, columnOption(page, "Inserts", SERIES_1), `Inserts row ${SERIES_1}`);
      await expect(columnOption(page, "Inserts", SERIES_2)).toBeVisible();
      await expect(columnOption(page, "Inserts", SERIES_1).getByText("BSC", { exact: true })).toBeVisible();
      await expect(page.getByText("SL", { exact: true })).toBeHidden();
      await expectAccessible(page, { label: "Score inserts, BSC-only (SportLots paused)" });
      // NEO-535: the Card titles step, with SportLots out of the picture.
      await cardTitlesWithOnlyBscAttached(page, env);
      return;
    }

    // ── 1. The first sync opens the reconcile: merge the two BSC series into one NB set ──
    // The first visit syncs from BSC: our 7 s plus the time BSC is measured to take, never a flat ceiling.
    await expectAfterMarketplace(page, reconcile, { platform: "BuySportsCards", what: "the Inserts reconcile" });
    await expect(reconcile.getByText(/Ready \([0-9]+/)).toBeVisible();
    await expectAccessible(page, { within: reconcile, label: "Reconcile Inserts dialog" });

    await reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill("Artist");
    await expect(reconcile.getByText(/Ready \(1 of [0-9]+\)/)).toBeVisible();
    await expect(reconcile.getByText(/Pending \([0-9]+/)).toBeVisible();
    const setName = reconcile.getByRole("textbox", { name: `NeonBinder set name for ${SERIES_2}` });
    await expect(setName).toBeVisible();

    await reconcile.getByRole("textbox", { name: "Filter BSC items" }).fill("Artist");
    await expect(reconcile.getByText(/BSC \(1 of [0-9]+\)/)).toBeVisible();
    await reconcile.getByText(SERIES_1, { exact: true }).click();
    await reconcile.getByLabel(`Add ${SERIES_1} to this set, ${SERIES_2}`, { exact: true }).click();
    await expect(reconcile.getByText(/BSC \(0 of [0-9]+\)/)).toBeVisible();

    // Name the merged set (no apostrophe, so no marketplace name is quoted back).
    await setName.fill(MERGED);
    await setName.press("Enter");
    await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${MERGED}` })).toBeVisible();

    await saveSets.click();
    await expect(reconcile).toBeHidden();

    // ── 2. Re-open: one NB set holds both BSC sets ──
    await openScoreInserts(page, env);
    await columnSearch(page, "Inserts").fill("Artist");
    await expect(columnOption(page, "Inserts", MERGED)).toBeVisible();
    await expect(page.getByText(/Artist's Proofs Series [12]/)).toBeHidden();
    await columnOption(page, "Inserts", MERGED).click();

    // NEO-496: the sources live inside the attributes panel, closed below the set.
    await openAttributesPanel(page);
    const multiSource = page.getByRole("heading", { name: "Multi-source sets" });
    await expect(multiSource).toBeVisible();
    await expect(page.getByText(SERIES_1).first()).toBeVisible();
    await expect(page.getByText(SERIES_2).first()).toBeVisible();
    await expect(page.getByText(/PRIMARY/)).toBeHidden();
    await expectAccessible(page, { label: "Multi-source insert set" });

    // ── 3b. Rename the NB set to its NB211 marker BEFORE any card is fetched ──
    // NEO-335 Phase 2 / NEO-535: a card under an insert row carries the
    // INSERT's name in its title's description, which is never cut, so this
    // long name leaves every card over 80 after every cut and the wizard's
    // "Card titles" step (and its "Set name in titles" box) comes up on every
    // run (STEP 4b). The card fetches read the row's marketplace ids from its
    // slots, never its name (product invariant 4), so the rename cannot change
    // what STEP 3 fetches. STEP 6 keeps its claim: a row renamed away from its
    // marketplace label survives a forced "Sync Inserts".
    await page.getByRole("button", { name: `Rename ${MERGED}` }).click();
    const edit = page.getByRole("textbox", { name: `Edit name for ${MERGED}` });
    await edit.fill(renamed);
    await edit.press("Enter");
    // Hard precondition: the panel header renders the CURRENTLY SELECTED row, so
    // this proves the rename landed on the row we mean.
    await expect(page.getByRole("heading", { name: `Attributes for ${renamed}` })).toBeVisible();

    // ── 3. Fetch the checklist: both BSC sets + SportLots pair into one ──
    await syncChecklistButton(page).click();
    await expect(pairing).toBeVisible({ timeout: FETCH });
    await expect(confirmMatches).toBeVisible({ timeout: FETCH });
    await expect(pairing.getByText(new RegExp(`Match Cards — ${MERGED}`))).toBeVisible();
    await expect(pairing.getByText(/Unlink/).first()).toBeVisible();
    await expect(pairing.getByText(/BSC only/)).toBeHidden();
    await expect(pairing.getByText(/SportLots only/)).toBeHidden();
    await expect(pairing.getByText(/Nothing kept/)).toBeHidden();
    await expect(pairing.getByText(/220 cards will be saved/)).toBeVisible();
    await expectAccessible(page, { within: pairing, label: "Match Cards dialog (two BSC sources + SportLots)" });
    // NEO-645: Confirm IS the commit of the 220 cards, and the Tidy Up walk opens on them by itself
    // (every title is over 80 after every cut, so every card is a stop).
    await confirmMatches.click();
    await expect(pairing).toBeHidden({ timeout: 60_000 });
    const saved220 = page.getByText(/^Saved 220 cards\./).first();
    await expect(saved220).toBeVisible({ timeout: FETCH });
    expect(await settleWalkAfterCommit(page, saved220), "every title is over 80, so the walk opened").toBe(true);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, every title over 80" });

    // ── 4. THE SET'S "SET NAME IN TITLES", FROM THE WALK (NEO-335, NEO-535, NEO-645) ──
    // STEP 3b's long insert name leaves every card's title over 80, so the open card's Listing
    // title tile is pink and opens ready to edit. "Shorten the set name for every card" saves the
    // box text as the row's set name and retitles every card; STEP 5 reads it back off a stored
    // card. ONE alphanumeric token per attempt.
    const short = `DCAP${env.ATTEMPT_TOKEN}`;
    const titleTile = tidyTile(page, "Listing title");
    await expect(titleTile).toHaveAccessibleDescription(/To fix/);
    await titleTile.getByRole("button", { name: "Shorten the set name for every card", exact: true }).click();
    const shortName = titleTile.getByRole("textbox", { name: "Set name in titles", exact: true });
    await expect(shortName).toBeFocused();
    await shortName.fill(short);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, Set name in titles" });
    await titleTile.getByRole("button", { name: "Save and apply to all 220 cards", exact: true }).click();
    await expect(titleTile.getByText("Set name saved. The other cards' titles are updating.", { exact: true })).toBeVisible();
    await expect(titleTile).not.toHaveAccessibleDescription(/To fix/);
    await saveForLater(page);
    await expectAccessible(page, { label: "Saved 1996 Score insert checklist" });

    // ── 5. NeonBinder's own card name survives a re-sync (NEO-203) ──
    await expect(page.getByText("BSC source", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Edit card / }).first().click();
    const cardName = page.getByRole("textbox", { name: "Card name" });
    await expect(cardName).toBeVisible();
    await expectAccessible(page, { label: "Card detail drawer" });
    // STEP 4b's box text OPENS this STORED card's title, verbatim with nothing
    // prepended (the title the commit wrote, not a preview: nothing here has
    // regenerated it).
    await expect(page.getByRole("textbox", { name: "Card title" })).toHaveValue(new RegExp(`^${short} `));
    await cardName.pressSequentially(`NB203-${id}`);
    await cardName.press("Enter");
    await expect(page.getByText(/Saved Card name/)).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();
    await expect(page.getByText(new RegExp(`NB203-${id}`)).first()).toBeVisible();

    await syncChecklistButton(page).click();
    await expect(pairing).toBeVisible({ timeout: FETCH });
    await expect(confirmMatches).toBeVisible({ timeout: FETCH });
    await expect(pairing.getByText(/220 cards will be saved/)).toBeVisible();
    await confirmMatches.click();

    const review = page.getByRole("dialog", { name: new RegExp(`Review Changes — ${MERGED}`) });
    await expect(review).toBeVisible();
    await expect(review.getByText(/Content changes \(1\)/)).toBeVisible();
    await expect(review.getByText("Card name", { exact: true }).first()).toBeVisible();
    await expect(review.getByText(new RegExp(`NB203-${id}`)).first()).toBeVisible();
    await expect(review.getByText(/ 0 new .*unchanged/)).toBeVisible();
    await expectAccessible(page, { within: review, label: "Review Changes dialog" });
    await expect(review.getByText(/no longer listed upstream/)).toBeHidden();
    await review.getByRole("button", { name: "Apply selected changes" }).click();
    // NEO-645: the commit's line, then the walk opens by itself if a card still needs a person
    // (not this spec's business: Save for later closes it and writes nothing).
    const saved = page.getByText(/^Saved 220 cards\./).first();
    await expect(saved).toBeVisible({ timeout: FETCH });
    if (await settleWalkAfterCommit(page, saved)) await saveForLater(page);
    await expect(page.getByText(new RegExp(`NB203-${id}`)).first()).toBeVisible();

    // ── 6. The set is still renamed (STEP 3b), re-sync the column: the name check offers suggestions ──
    // The panel header renders the CURRENTLY SELECTED row, so this proves the row
    // still carries OUR name after a card fetch, a commit and a re-sync.
    await expect(page.getByRole("heading", { name: `Attributes for ${renamed}` })).toBeVisible();

    await page.getByRole("button", { name: "Sync Inserts" }).click();
    await expect(reconcile).toBeVisible({ timeout: 240_000 });
    await reconcile.getByRole("textbox", { name: "Filter NeonBinder sets" }).fill(`NB211-${id}`);
    await expect(reconcile.getByText(/Ready \(1 of [0-9]+\)/)).toBeVisible();
    await expect(reconcile.getByRole("textbox", { name: `NeonBinder set name for ${renamed}` })).toBeVisible();
    await saveSets.click();
    await expect(reconcile).toBeHidden();

    // ── 7. The renamed set keeps its name; upstream spellings are only suggestions ──
    await openScoreInserts(page, env);
    await columnSearch(page, "Inserts").fill("Artist");
    await expect(columnOption(page, "Inserts", renamed)).toBeVisible();
    await expect(page.getByText(/Artist.s Proofs Series [12]/)).toBeHidden();

    await page.getByRole("button", { name: /names? to check — review suggestions/ }).click();
    const nameCheck = page.getByRole("dialog", { name: "Name Check — Inserts" });
    await expect(nameCheck).toBeVisible();
    await expect(nameCheck.getByText(/SportLots calls it "Dugout Collection Artists Proofs"/)).toBeVisible();
    await expect(nameCheck.getByText(/BSC calls it "Dugout Collection Artist.s Proofs Series [12]"/)).toBeVisible();
    await expectAccessible(page, { within: nameCheck, label: "Name Check dialog" });
    const keep = (side: string) =>
      nameCheck.getByRole("button", {
        name: new RegExp(`^Keep mine — keep "${renamed}"; stop suggesting ${side}'s ".*"$`),
      });
    await keep("BSC").click();
    await keep("SportLots").click();
    await expect(nameCheck.getByText("0 to take · 2 to keep")).toBeVisible();
    await nameCheck.getByRole("button", { name: "Apply decisions" }).click();
    await expect(page.getByText("2 declined")).toBeVisible();

    await expect(columnOption(page, "Inserts", renamed)).toBeVisible();
    await columnOption(page, "Inserts", renamed).click();

    // ── 8. Both BSC sources are still attached; detaching one asks first ──
    await openAttributesPanel(page);
    await expect(multiSource).toBeVisible();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 1/).first()).toBeVisible();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 2/).first()).toBeVisible();
    await page.getByRole("button", { name: /^Remove Dugout Collection Artist.s Proofs Series 1$/ }).click();
    await expect(
      page.getByText(/110 cards were fetched from it; their BSC link will be dropped/),
    ).toBeVisible();
    await expectAccessible(page, { label: "Detach BSC source confirm" });
    await page.getByRole("button", { name: /^Cancel detach Dugout Collection Artist.s Proofs Series 1$/ }).click();
    await expect(page.getByText(/were fetched from it/)).toBeHidden();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 1/).first()).toBeVisible();
    await expect(page.getByText(/Dugout Collection Artist.s Proofs Series 2/).first()).toBeVisible();
  },
);
