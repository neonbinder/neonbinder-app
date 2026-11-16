// Origin: .maestro/flows/set-selector/inserts-1996-score-one-nb-set-two-bsc-sources.yaml (Maestro suite retired in NEO-341; see git history)
// Sole writer of the 1996 Score Dugout Collection Artists Proofs insert; fresh-only.
//
// NEO-535: the "Card titles" step is also proved in the SportLots-PAUSED branch, which
// has no marketplace pairing and no 220-card merge. There ONE BSC insert (Series 1,
// 110 cards, a captured publisher's checklist uploaded first) is renamed to a name
// long enough that titles run over 80 or lose a first name, so the wizard opens its
// "Card titles" step and its "Set name in titles" box, and the box and per-card
// edits are proved there, then read back off the stored cards.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectAfterMarketplace } from "../../support/marketplace-wait";
import {
  columnOption,
  columnSearch,
  drillToSet,
  escapeRe,
  expectAfterBscSync,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { CHECKLISTS, expectTeamsFromChecklist, usePublishersChecklist } from "../../support/published-checklist";
import {
  addAsNewPlayerButton,
  advanceToSave,
  answerPlayerAsNew,
  answerStepAsNew,
  awaitLookupsSettled,
  confirmSaveButton,
  LOOKUPS,
  newStepHeading,
  nextStepButton,
  readStep,
  reviewWizard,
  stepCounter,
  tidyUpName,
} from "../../support/wizard";
import type { Page } from "@playwright/test";

const SERIES_1 = "Dugout Collection Artist's Proofs Series 1";
const SERIES_2 = "Dugout Collection Artist's Proofs Series 2";
const MERGED = "Dugout Collection Artists Proofs";
const FETCH = 120_000;

/**
 * Wait for "Add remaining players as new" to have FINISHED, never for its busy label to be
 * gone. The press paints "Adding players…" a render later, and the walk is a few writes, so a
 * `toBeHidden` on that label can pass before it ever shows (the trace of a red mobile run: the
 * check ran 85 ms after the tap, the label painted after it, and the walk moved the wizard on
 * under the next click). The finished walk has two positive signs: the link reads "(0)" (a team
 * or league name is still undecided), or every name is decided and the footer offers Next /
 * Confirm & Save. The steps still showing before it read "(N)" with N above zero.
 */
async function expectBulkWalkDone(page: Page): Promise<void> {
  const wizard = reviewWizard(page);
  await expect(
    wizard
      .getByRole("button", { name: /^Add remaining players as new \(0\)$/ })
      .or(nextStepButton(page))
      .or(confirmSaveButton(page)),
  ).toBeVisible({ timeout: 240_000 });
}

// ── The SportLots-paused branch's fixture (NEO-535) ──
// Series 1's NB row is renamed to LONG_INSERT. The title arithmetic is exact because
// the name is a fixed string (no minted token): the description "1996 Score <name>" is
// 67 characters, so of the 110 cards 45 lose a first name or run over 80 and 65 fit
// whole (computed with the title builder, `assessListingTitle`, over the captured
// checklist). The three cards the spec reads back sit among the last rows of the list,
// where a fresh mount of the checklist renders them (#104, #106, #107):
//   #104 LaTroy Hawkins  loses a first name   (listed; hand-edited in the step)
//   #106 Derek Jeter     fits with full names (NOT listed; the box must leave it alone)
//   #107 Michael Tucker  loses a first name   (listed; the box brings the name back)
// and #76 Todd Hollandsworth runs over 80 after every cut (listed, flagged).
const SERIES_1_CARDS = 110;
const LONG_INSERT = "Dugout Collection Artists Proofs Hologram Foil Series II";
const LONG_DESCRIPTION = `1996 Score ${LONG_INSERT}`;
// The box text the operator types: the description without the filler words.
const SHORT_BOX = "1996 Score Dugout Collection Artists Proofs";
// What the operator types over #104's generated title.
const OWN_TITLE = "1996 Score Artists Proofs LaTroy Hawkins #104 My Own Title";

async function openScoreInserts(page: Page, env: Parameters<typeof drillToSet>[1]) {
  await drillToSet(page, env, { year: "1996", manufacturer: "Score", set: "Score", createManufacturer: true });
  await pick(page, "Variant Types", "Insert", { search: false });
}

/**
 * NEO-535, the SportLots-paused branch: the "Card titles" step and "Set name in
 * titles", proved on ONE BSC insert (Series 1) with nothing but BSC attached.
 *
 * Contract: ENTRY the Inserts column is open on the 1996 Score variant type with both
 * BSC series listed under their own names (the caller asserted that). EXIT the set is
 * committed (110 cards) and its stored titles read back; the insert row stays renamed
 * to LONG_INSERT and carries SHORT_BOX as its "Set name in titles". Fresh-only.
 */
async function cardTitlesWithOnlyBscAttached(page: Page, env: Parameters<typeof drillToSet>[1]) {
  const wizard = reviewWizard(page);
  const next = nextStepButton(page);
  const confirmSave = confirmSaveButton(page);

  // ── P1. Rename Series 1 so its titles cannot fit ──
  // The fetch reads the row's BSC id from its slot, never its name (product invariant 4),
  // so the rename cannot change what is fetched.
  await columnOption(page, "Inserts", SERIES_1).click();
  await expect(page.getByRole("heading", { name: `Attributes for ${SERIES_1}` })).toBeVisible();
  await page.getByRole("button", { name: `Rename ${SERIES_1}` }).click();
  const edit = page.getByRole("textbox", { name: `Edit name for ${SERIES_1}` });
  await edit.fill(LONG_INSERT);
  await edit.press("Enter");
  // The panel header renders the CURRENTLY SELECTED row: the rename landed on the row we mean.
  await expect(page.getByRole("heading", { name: `Attributes for ${LONG_INSERT}` })).toBeVisible();
  // The arithmetic the fixture rests on (a drift in these strings is a spec bug, caught here).
  expect(LONG_DESCRIPTION, "the description is 67 characters").toHaveLength(67);
  expect(SHORT_BOX, "the box text is 43 characters").toHaveLength(43);

  // ── P2. Fetch with the publisher's checklist uploaded first, BSC alone ──
  const facts = await usePublishersChecklist(page, CHECKLISTS.dugoutArtistsProofs1996Series1);
  expect(facts.rows, "the captured file holds every one of Series 1's cards").toBe(SERIES_1_CARDS);
  await syncChecklistButton(page).click();
  // One live BSC round trip: our 7 s plus the time BSC is measured to take, never a flat ceiling.
  await expectAfterMarketplace(page, page.getByText(new RegExp(`Kept all ${SERIES_1_CARDS} cards from BSC`)), {
    platform: "BuySportsCards",
    what: "the solo fetch's kept-cards line",
  });
  await expect(page.getByText(/Match Cards/)).toBeHidden();
  // Every card's team comes from the checklist, so none is asked of BSC.
  await expectTeamsFromChecklist(page, facts);

  // ── P3. Names first: the few the catalogue lacks are created as new ──
  // The queue behind the lookups is the batch-lookups ceiling `walkToPlayerRow` waits at (LOOKUPS).
  await expect(wizard).toBeVisible({ timeout: 60_000 });
  await expect(wizard).toHaveAccessibleName(tidyUpName({ year: "1996", set: "Score", variant: LONG_INSERT }));
  await awaitLookupsSettled(page);
  const addNew = addAsNewPlayerButton(page);
  const addRemaining = wizard.getByRole("button", { name: /Add remaining players as new/ });
  for (let i = 0; i < 250; i++) {
    await expect(next.or(confirmSave).or(addNew).or(newStepHeading(page))).toBeVisible({ timeout: LOOKUPS });
    if ((await next.isVisible()) || (await confirmSave.isVisible())) break;
    if (await addNew.isVisible()) {
      await answerPlayerAsNew(page);
      if (await addRemaining.isVisible()) {
        await addRemaining.click();
        await expectBulkWalkDone(page);
      }
    } else {
      await answerStepAsNew(page);
    }
  }
  await expect(next.or(confirmSave)).toBeVisible();

  // ── P4. THE CARD TITLES STEP ──
  // Which post-name step came first: teams only when a card would save teamless (every card
  // here carries the checklist's team, so normally not); Next leaves its lines on their default.
  const subtitle = wizard.getByText(/^(Cards with no team|Card titles|Ready to save)$/);
  await expect(subtitle).toBeVisible();
  if ((await subtitle.textContent()) === "Cards with no team") await next.click();
  await expect(wizard.getByText("Card titles", { exact: true })).toBeVisible();
  await expect(
    wizard.getByRole("heading", { name: "These titles lost a first name or ran long. Keep 'em, or make 'em yours." }),
  ).toBeVisible();

  const box = wizard.getByRole("textbox", { name: "Set name in titles", exact: true });
  const title = (number: number) => wizard.getByRole("textbox", { name: new RegExp(`^Title for #${number} `) });
  // The box opens on the set's whole description, and shows how much of the 80 it is.
  await expect(box).toHaveValue(LONG_DESCRIPTION);
  await expect(box).toHaveAccessibleDescription(/\b67\/80\b/);
  // The over-long titles: #107 lost "Michael", #76 runs over 80 after every cut and is flagged.
  await expect(title(107)).toHaveValue(`${LONG_DESCRIPTION} Tucker #107`);
  await expect(title(107)).toHaveAccessibleDescription(/Left out to fit: .*Michael/);
  await expect(title(76)).toHaveValue(`${LONG_DESCRIPTION} Hollandsworth`);
  await expect(title(76)).toHaveAccessibleDescription(/Too long to list as-is\./);
  // #106 fits with its whole name, so it is not on this step at all.
  await expect(title(106)).toHaveCount(0);
  const listed = await wizard.getByRole("textbox", { name: /^Title for #/ }).count();
  expect(listed, "the step lists the titles that lost a first name or ran long, not all 110").toBeGreaterThan(0);
  expect(listed).toBeLessThan(SERIES_1_CARDS);
  await expectAccessible(page, { within: wizard, label: "Card titles step, titles over 80 (SportLots paused)" });

  // ── P5. Trim the box: only the listed titles change ──
  await box.fill(SHORT_BOX);
  // Enter settles the box in place; its status is read at the settle.
  await box.press("Enter");
  await expect(wizard.getByText("Every title fits now.")).toBeVisible();
  await expect(box).toHaveAccessibleDescription(/\b43\/80\b/);
  // #107 has its first name back, opening with the box text verbatim.
  await expect(title(107)).toHaveValue(`${SHORT_BOX} Michael Tucker #107 Baseball`);
  await expect(title(107)).not.toHaveAccessibleDescription(/Michael/);
  // #76 now fits: the over-the-cap alert is gone, and the title opens with the box text.
  await expect(title(76)).toHaveValue(new RegExp(`^${escapeRe(SHORT_BOX)} Todd Hollandsworth `));
  await expect(title(76)).not.toHaveAccessibleDescription(/Too long to list as-is\./);
  // The list itself never moved under the edit, and #106 is still off it.
  await expect(wizard.getByRole("textbox", { name: /^Title for #/ })).toHaveCount(listed);
  await expect(title(106)).toHaveCount(0);
  await expectAccessible(page, { within: wizard, label: "Card titles step, every title fits (SportLots paused)" });

  // ── P6. A title typed by hand wins on its card ──
  await title(104).fill(OWN_TITLE);
  await title(104).press("Enter");
  await expect(wizard.getByRole("button", { name: /^Use generated title for #104 / })).toBeVisible();
  await expect(title(104)).toHaveValue(OWN_TITLE);
  // The box did not take #107's edit away: a hand edit is per card.
  await expect(title(107)).toHaveValue(`${SHORT_BOX} Michael Tucker #107 Baseball`);

  // ── P7. Save: the Save step is a later step, and Enter on it commits ──
  const { x: titlesStep } = await readStep(page);
  await next.click();
  await expect(wizard.getByText("Ready to save", { exact: true })).toBeVisible();
  expect((await readStep(page)).x, "the Save step is a later step than Card titles").toBeGreaterThan(titlesStep);
  await expect(wizard.getByText(new RegExp(`Save ${SERIES_1_CARDS} cards?\\?`))).toBeVisible();
  await expect(confirmSave).toBeVisible();
  await confirmSave.press("Enter");
  await expect(page.getByText(new RegExp(`Saved ${SERIES_1_CARDS} cards`))).toBeVisible();
  await expect(wizard).toBeHidden();

  // ── P8. The stored cards carry the chosen titles ──
  // Re-enter the set: a fresh load of the checklist renders the LAST rows, where #104-#110 are.
  await openScoreInserts(page, env);
  await columnSearch(page, "Inserts").fill("Artist");
  await expect(columnOption(page, "Inserts", LONG_INSERT)).toBeVisible();
  // Series 2 was never touched: BSC's own name, no card fetched.
  await expect(columnOption(page, "Inserts", SERIES_2)).toBeVisible();
  await columnOption(page, "Inserts", LONG_INSERT).click();
  const cardTitle = page.getByRole("textbox", { name: "Card title" });
  const openCard = async (number: number) => {
    await page.getByRole("button", { name: new RegExp(`^Edit card ${number}, `) }).click();
    await expect(cardTitle).toBeVisible();
  };
  const closeCard = async () => {
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardTitle).toBeHidden();
  };
  // #107: the box text opens it (the listed title the operator kept).
  await openCard(107);
  await expect(cardTitle).toHaveValue(`${SHORT_BOX} Michael Tucker #107 Baseball`);
  await closeCard();
  // #104: the title the operator typed.
  await openCard(104);
  await expect(cardTitle).toHaveValue(OWN_TITLE);
  await closeCard();
  // #106: it fit with its whole name, so the box never touched it: the builder's own title, saved.
  await openCard(106);
  await expect(cardTitle).toHaveValue(`${LONG_DESCRIPTION} Derek Jeter`);
  await expectAccessible(page, { label: "Card detail drawer, a title the box left alone (SportLots paused)" });
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
    const wizard = reviewWizard(page);
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
    await confirmMatches.click();
    await expect(pairing).toBeHidden({ timeout: 60_000 });

    // ── 4. Entity review: decide one row, back out of the discard, then add the rest ──
    await expect(wizard).toBeVisible({ timeout: FETCH });
    await expect(wizard.getByText(/still looking up/)).toBeHidden({ timeout: 180_000 });
    await expectAccessible(page, { within: wizard, label: "Tidy-up wizard" });
    // NEO-331: a New League step's primary is held until a Level is pressed
    // (none is pre-pressed), so read which kind settled first. "Other" claims
    // nothing (the batch is discarded or bulk-added anyway).
    const anyAddAsNew = wizard.getByRole("button", { name: /^Add as New (Player|Team|League)( anyway)?$/ });
    await expect(anyAddAsNew.first()).toBeVisible({ timeout: 30_000 });
    const firstKind = (await anyAddAsNew.first().textContent()) ?? "";
    if (/League/.test(firstKind)) {
      await wizard.getByRole("radio", { name: "Other", exact: true }).click();
    }
    if (/Player/.test(firstKind)) {
      // NEO-424: a player step may lead with a suggested link; creating is the intent.
      await answerPlayerAsNew(page);
    } else {
      await wizard
        .getByRole("button", { name: /^Add as New (Team|League)( anyway)?$/, disabled: false })
        .first()
        .click({ timeout: 30_000 });
    }
    // NEO-335: ONE decision reads "Step 2 of …" (on a name step x is the decided
    // count plus one): the same claim, as strict, as the old "1 of N reviewed".
    await expect(stepCounter(page)).toHaveText(/^Step 2 of [0-9]+$/);
    await wizard.getByRole("button", { name: "Cancel (Esc)" }).click();
    await expect(page.getByText(/Discard 1 decision/)).toBeVisible();
    await expect(page.getByText(/The same names come back the next time you sync this set/)).toBeVisible();
    await expectAccessible(page, {
      within: page.getByRole("dialog", { name: /Discard 1 decision/ }),
      label: "Discard decisions confirm",
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(wizard).toBeVisible();
    await expect(stepCounter(page)).toHaveText(/^Step 2 of [0-9]+$/);

    await wizard.getByRole("button", { name: /Add remaining players as new/ }).click();
    // Deciding a team step in the middle of the walk would race the bulk's own writes
    // (Convex OCC), and a user watches the walk finish before touching the next step.
    await expectBulkWalkDone(page);
    const confirmSave = confirmSaveButton(page);
    // The names-done footer (NEO-335): "Next (Enter)" on a teams / titles step,
    // else Confirm & Save. Neither renders while a name is undecided.
    const next = wizard.getByRole("button", { name: "Next (Enter)", exact: true });
    const stepHeading = wizard.getByRole("heading", { name: /^New (Team|League): / });
    for (let i = 0; i < 250; i++) {
      await expect(next.or(confirmSave).or(stepHeading)).toBeVisible({ timeout: 240_000 });
      if ((await next.isVisible()) || (await confirmSave.isVisible())) break;
      // R10 loop rule: act on the step, then wait for ITS heading to go before
      // looking for the next one (NEO-331: a league step gets its Level first).
      const step = (await stepHeading.textContent()) ?? "";
      await answerStepAsNew(page);
      await expect(wizard.getByRole("heading", { name: step, exact: true })).toBeHidden();
    }
    await expect(next.or(confirmSave)).toBeVisible();

    // ── 4b. THE CARD TITLES STEP, AND THE SET'S "SET NAME IN TITLES" (NEO-335, NEO-535) ──
    // STEP 3b's long insert name leaves every card's title over 80 after every
    // cut, so the "Card titles" step is certain; a run where it does not come up
    // fails at its subtitle below, by name. The box opens prefilled with the
    // builder's own whole description; untouched and over 80 it sits out. The
    // operator replaces it: every over-cap title then opens with the box text,
    // verbatim, it rides the commit as the batch's `listingShortName`, and STEP
    // 5 reads it back off a stored card. ONE alphanumeric token per attempt.
    const short = `DCAP${env.ATTEMPT_TOKEN}`;
    // Which post-name step came first: the teams step only when a card would save
    // teamless (this fetch names its teams, so usually not). Teams are not this
    // spec's business: Next leaves every line on its default.
    const subtitle = wizard.getByText(/^(Cards with no team|Card titles|Ready to save)$/);
    await expect(subtitle).toBeVisible();
    if ((await subtitle.textContent()) === "Cards with no team") {
      await next.click();
    }
    await expect(wizard.getByText("Card titles", { exact: true })).toBeVisible();
    const shortName = wizard.getByRole("textbox", { name: "Set name in titles", exact: true });
    // The prefill: the builder's whole description, year, maker and the insert
    // first (a parallel name the leaf's features carry would follow it).
    await expect(shortName).toHaveValue(new RegExp(`^1996 Score ${escapeRe(renamed)}`));
    await expect(wizard.getByText("Over 80, so it's sitting out. Trim it and your titles pick it up.")).toBeVisible();
    await shortName.clear();
    await shortName.fill(short);
    // Enter settles the box in place; its status is read at the settle. The
    // proof the box reached EVERY title: the line is computed from the same
    // assessment as the list, over every new card.
    await shortName.press("Enter");
    await expect(wizard.getByText("Every title fits now.")).toBeVisible();
    await expect(shortName).toHaveValue(short);
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Card titles step" });
    const { x: titlesStep } = await readStep(page);
    await next.click();
    await expect(wizard.getByText("Ready to save", { exact: true })).toBeVisible();
    expect((await readStep(page)).x, "the Save step is a later step than Card titles").toBeGreaterThan(titlesStep);
    // Focus follows the Save step, and the label says "(Enter)": Enter committing IS the feature.
    await expect(confirmSave).toBeVisible();
    await confirmSave.press("Enter");
    await expect(page.getByText(/Saved 220 cards/)).toBeVisible({ timeout: FETCH });
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
    // NEO-335: the wizard has no NAMES to ask about here, but it can still open
    // TEAMS-ONLY (same title, straight onto its teams step) when a card would
    // save with no team. Whether any is in that state is the marketplaces'
    // business, so both shapes are accepted and the save is asserted after
    // either. The two never coexist: the sync cleared the previous "Saved 220
    // cards." banner when it started, and the wizard stays open until its commit
    // writes the next one.
    const saved = page.getByText(/Saved 220 cards/);
    await expect(wizard.or(saved).first()).toBeVisible({ timeout: FETCH });
    if (await wizard.isVisible()) {
      // The precondition, by name: no names to decide, and a post-name step is
      // the sitting's first.
      await expect(wizard.getByRole("button", { name: /Skip remaining names/ })).toBeHidden();
      await expect(wizard.getByText(/^(Cards with no team|Card titles)$/)).toBeVisible();
      await expect(stepCounter(page)).toHaveText(/^Step 1 of [0-9]+$/);
      // Teams are not this spec's business: Next leaves every line on its default.
      await advanceToSave(page);
      await expect(wizard.getByText(/Save [0-9]+ cards?\?/)).toBeVisible();
      await confirmSaveButton(page).click();
    }
    await expect(saved).toBeVisible({ timeout: FETCH });
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
