// NEO-528 (R1): "Player on every card" stored on a checklist BEFORE its cards
// exist never overrides what the listing names. A card the marketplace's
// listing names somebody on is committed by the fetch with that somebody when
// the name resolves (#4 keeps its own Pete Rose), and with NO player when
// entity review rules the name out as not a person (#10 "1975 World Champions"
// and #18 "Former Teammates" stay blank: Jason, 2026-11-15, "No, keep them
// blank"; product invariant 8, a data claim holds back a guess). A stored cameo
// lands on every committed card either way, which is also what proves #10 went
// through the defaults at all. A parallel built from Base copies the hold-back.
//
// The fixture is a REAL set (Jason, 2026-11-15): Baseball > 2011 > Leaf >
// Leaf Pete Rose Legacy > Base, 75 cards, and its Parallel > Printing Plates
// Black. Its storyline cards name no person ("1975 World Champions", "Former
// Teammates", "One Heck of a Try" ..), and #4 names "Pete Rose & Harry 'Pete'
// Rose" (the publisher's checklist splits it into two names).
//
// The flow:
// - The set builder drills to the set's Base cold, and branches on the
//   checklist's own state. Empty: Pete Rose is stored as the player on every
//   card and Johnny Bench as a cameo (no cards, so no confirm), the
//   publisher's checklist is uploaded, the checklist synced, the four player
//   disagreements take the checklist's side (so #4 reads two names), and the
//   review's names are ruled out ONE BY ONE ("Skip <name> — not a person"),
//   "1975 World Champions" and "Former Teammates" among them. "Cards with no
//   team" then lists only #1 (its high-school team was skipped), filed under
//   its own Pete Rose, and no ruled-out card; it is left for later and 75
//   cards are saved. Already committed (a rerun on the same seed): the stored
//   values are read back as they are. Both branches end on the same asserts.
// - #10's and #18's drawers: no player, Johnny Bench under "Also on this
//   card", the description's "Cameo: Johnny Bench" line, and the exact card
//   title with no player before the number (the cameo stands there, NEO-528 +
//   NEO-535). #4's drawer: Pete Rose as its player (its title names him, then
//   "& Johnny Bench"), and the cameo.
// - Printing Plates Black is built from Base (or adopted, built): its #10 has
//   no player and its #4 keeps Pete Rose.
// - Back steps the drill out of the parallel.
//
// What this spec cannot cover on this set:
// - The default player FILLING a fetched card whose listing names nobody. No
//   card of this set is one, and BSC names somebody on nearly every card (a
//   team-leader card names its team, a storyline card its caption), so the
//   fake's recordings hold no such card to fetch. The fill at birth is proven
//   by `set-selector/player-on-every-card` (quick-add on a hand-made set) and,
//   for the commit, by `convex/cardPlayerDefaults.creation.test.ts` and
//   `convex/lib/cardPlayerDefaults.test.ts`.
// - The wizard's "Cards with no players" group and the card-titles preview of
//   a ruled-out card: every card here carries a team claim (its own or the
//   checklist's No Team), so none reaches the teams step but #1, and no title
//   is long enough to open the titles step. Both previews are unit-tested
//   (`components/SetSelector/teams-on-cards.test.tsx`, `card-titles.test.tsx`);
//   the committed titles are asserted here instead.
//
// R7/R7a: SOLE WRITER of Baseball > 2011 > Leaf > Leaf Pete Rose Legacy (its
// Base, its Parallel rows and Printing Plates Black's cards) and of the year's
// Leaf brand row (SET-REGISTRY.md); the only spec that stores "Player on every
// card" values on it, and the only spec that lists Johnny Bench under "Also on
// this card" anywhere (a smart binder's cameo counts are catalogue-wide). Not
// fresh-only: the committed checklist and the built parallel stay and a rerun
// adopts them. It writes nothing else.
//
// R3: the drill is `drillToColdManufacturer` + `drillToBaseVariant` + `pick`
// (R9), the upload `usePublishersChecklist`, the review `support/wizard.ts`,
// and the section's and the drawer's names `support/also-pictured.ts`.
import type { Locator, Page } from "@playwright/test";
import {
  ALSO_PICTURED,
  EVERY_CARD_PLAYER as E,
  anyPlayerChip,
  cameoChip,
  cameoLine,
  cardDescription,
  cardTitle,
  closeCardDrawer,
  openCardDrawer,
  openEveryCardPlayer,
  playerChip,
  storeEveryCardValue,
} from "../../support/also-pictured";
import { escapeRe } from "../../support/cards";
import { nameOf } from "../../support/collection";
import type { FlowEnv } from "../../support/env";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS, confirmChecklistMatchCards, usePublishersChecklist } from "../../support/published-checklist";
import {
  drillToBaseVariant,
  drillToColdManufacturer,
  drillToSet,
  pick,
  pickAfterBscSync,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import {
  advanceToSave,
  checklistDisagreementHeading,
  confirmSaveButton,
  disagreementOn,
  expectChecklistDisagreementFirst,
  expectNameStepLeft,
  nextStepButton,
  personSkip,
  pickSideForAllCards,
  reviewWizard,
  tidyUpName,
} from "../../support/wizard";

const BUILD = { sport: "Baseball", year: "2011", manufacturer: "Leaf", set: "Leaf Pete Rose Legacy" } as const;
/** How a card's description names the set ("<year> <set>"). */
const SET_TITLE = `${BUILD.year} ${BUILD.set}`;
/** The stored "Player on every card" values. */
const PLAYER = "Pete Rose";
const CAMEO = "Johnny Bench";
/** Cards whose listing names somebody entity review rules out (not a person). */
const RULED_OUT = [
  // The committed titles (NEO-528 + NEO-535): no player, so the stored cameo
  // stands where the player would; #18's team is "No Team", which a title omits.
  // NEO-609: the Base checklist's own name is in the title while it fits.
  { number: "10", printed: "1975 World Champions", title: `${SET_TITLE} Base ${CAMEO} #10 Cincinnati Reds Baseball` },
  { number: "18", printed: "Former Teammates", title: `${SET_TITLE} Base ${CAMEO} #18 Baseball` },
] as const;
/** The card whose listing names Pete Rose (and his father): it keeps its own Pete Rose. */
const OWN = "4";
/** The parallel built from Base (a Printing Plate: BSC lists one per colour). */
const PARALLEL = "Printing Plates Black";

/** The wizard opens behind the entity check's batch (live lookups; the 1984 cameo spec's ceiling). */
const WIZARD_OPENS = 60_000;
/** A name step waits on its row's lookup before its skip is usable (the batch-lookups ceiling, `LOOKUPS`' class; the 1984 cameo spec's 60 s). */
const NAME_STEP = 60_000;

/**
 * Fetch and commit the empty checklist, the defaults stored first. Contract:
 * ENTRY the set's Base is on screen with no cards. EXIT the checklist is on
 * screen again, freshly drilled, with its cards.
 */
async function fetchAndCommit(page: Page, env: FlowEnv, section: Locator): Promise<void> {
  // Stored before the cards exist: saved with no question (no cards beneath).
  await storeEveryCardValue(page, section, PLAYER, "player");
  await storeEveryCardValue(page, section, CAMEO, "cameo");
  await expectAccessible(page, { within: section, label: "Player on every card, a player and a cameo stored before the fetch" });

  // GUIDE "Checklist first": every row names its team or says No Team, so BSC is asked for no card one by one.
  const facts = await usePublishersChecklist(page, CHECKLISTS.leafPeteRoseLegacy2011);
  // NEO-591: every row pairs its card, all 75. BSC names #27b and #38b "Old Teammates SP" and
  // "One Heck of a Try SP" where the checklist's parser reads the trailing SP as a print marker;
  // the pairing key drops it on both sides, so the SP cards pair their own rows instead of the
  // rows becoming variations of #27a / #38a. `facts` is the product matcher's own answer.
  expect(facts.matched, "every Leaf row pairs its card (a trailing SP is no part of a name)").toBe(facts.rows);
  await syncChecklistButton(page).click();
  // NEO-496 (D10, NQ1): the uploaded checklist is a second source, so the fetch opens Match Cards on
  // either branch (SportLots paused or not). The helper waits on it (7 s of ours plus BSC's), proves the
  // teams line while it is open (the only time before the save), keeps any BSC-only card and confirms.
  await confirmChecklistMatchCards(page, { facts, what: "the empty checklist's fetch" });
  const wizard = reviewWizard(page);
  await expect(wizard).toBeVisible({ timeout: WIZARD_OPENS });
  await expect(wizard).toHaveAccessibleName(tidyUpName({ year: BUILD.year, set: BUILD.set }));

  // The checklist splits #4's "Pete Rose & Harry 'Pete' Rose" into two names
  // (and drops the "SP" BSC prints on two names): its side, on every card, is
  // what lets #4 resolve to Pete Rose.
  await expectChecklistDisagreementFirst(page);
  await expect(disagreementOn(page, OWN)).toBeVisible();
  await pickSideForAllCards(page, "Use the checklist's", [OWN]);
  await nextStepButton(page).click();
  await expect(checklistDisagreementHeading(page)).toBeHidden();

  // Every name nobody knows is ruled out on its own step, "Skip <name> — not a
  // person" (the storyline captions, Harry 'Pete' Rose, "Pete" and "Coach"); a
  // team step (#1's high school) is skipped as not a team. Each press is proved
  // to have moved the wizard off that row (its own skip gone, NEO-467).
  const skipped: string[] = [];
  const teamSkip = wizard.getByRole("button", { name: /^Skip .* — (not a team|this team has no league)$/, disabled: false });
  const usablePerson = wizard.getByRole("button", { name: /^Skip .* — not a person$/, disabled: false });
  const namesDone = nextStepButton(page).or(confirmSaveButton(page));
  for (let i = 0; i < 20; i++) {
    await expect(usablePerson.or(teamSkip).or(namesDone).first()).toBeVisible({ timeout: NAME_STEP });
    if (await namesDone.isVisible()) break;
    // One read of whichever skip is up now, then person or team is told from
    // its label: choosing the control first (`isVisible() ? a : b`) let the
    // wizard move to a team step in between and `nameOf(a)` wait for a button
    // that was gone (NEO-568). The press is aimed at the name just read, so a
    // step that moved on matches nothing rather than skipping the next row.
    const label = await nameOf(usablePerson.or(teamSkip).first());
    if (/ — not a person$/.test(label)) skipped.push(label.replace(/^Skip (.*) — not a person$/, "$1"));
    await wizard.getByRole("button", { name: label, exact: true, disabled: false }).click();
    await expectNameStepLeft(page, label);
  }
  await expect(namesDone).toBeVisible();
  await expect(personSkip(page)).toHaveCount(0);
  for (const { printed } of RULED_OUT) {
    expect(skipped, `"${printed}" was ruled out on its own step`).toContain(printed);
  }

  // "Cards with no team": only #1, under its own Pete Rose. No ruled-out card
  // is filed under the stored player (each carries a team claim, so none is
  // listed at all).
  await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
  await expect(wizard.getByText(`#1 · ${PLAYER}`, { exact: true })).toBeVisible();
  await expect(wizard.getByRole("radiogroup", { name: `Team for ${PLAYER}` })).toBeVisible();
  for (const { number } of RULED_OUT) {
    await expect(wizard.getByText(new RegExp(`^#${number} · `))).toHaveCount(0);
  }
  await expectAccessible(page, { within: wizard, label: "Entity review wizard, cards with no team after the ruled-out names" });
  await advanceToSave(page);
  await expect(wizard.getByRole("heading", { name: "Save 75 cards?" })).toBeVisible();
  await confirmSaveButton(page).click();
  await expect(page.getByText(/Saved 75 cards/)).toBeVisible();
  await expect(wizard).toBeHidden();
  // A fresh load of the checklist, as a rerun finds it.
  await drillToBaseVariant(page, env, BUILD);
}

test(
  "Set builder: a player stored on every card before the fetch never overrides a listed name; a ruled-out name leaves its card blank, a resolved one keeps its own player, and a stored cameo reaches every card",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // No other spec opens Baseball 2011, so every column may sync itself: the
    // cold drill pays those waits (R9).
    await drillToColdManufacturer(page, env, { ...BUILD, expectSets: true });
    await drillToBaseVariant(page, env, BUILD);
    const empty = page.getByText("No cards in this checklist yet.");
    const cards = page.getByRole("heading", { level: 2, name: /^Cards \([1-9][0-9]*\)$/ });
    await expect(empty.or(cards)).toBeVisible();
    let section = await openEveryCardPlayer(page);
    if (await empty.isVisible()) {
      await fetchAndCommit(page, env, section);
      section = await openEveryCardPlayer(page);
    }

    // Both branches: the committed checklist, with the values stored on Base.
    await expect(cards).toHaveAccessibleName("Cards (75)");
    await expect(section.getByRole("button", { name: E.stopPlayer(PLAYER), exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopCameo(CAMEO), exact: true })).toBeVisible();

    // --- The ruled-out cards: no player, the cameo ---------------------------
    for (const { number, printed, title } of RULED_OUT) {
      const drawer = await openCardDrawer(page, number);
      const description = cardDescription(drawer);
      // The card has loaded (its description, written at the commit, names the
      // card and no player: "<set> card #10. Team: ... Cameo: ...", never what
      // it prints) and carries the cameo...
      await expect(description).toHaveValue(new RegExp(`^${escapeRe(SET_TITLE)} card #${number}\\.`));
      await expect(description).not.toHaveValue(new RegExp(escapeRe(printed)));
      await expect(description).toHaveValue(cameoLine(CAMEO));
      await expect(cameoChip(drawer, CAMEO)).toBeVisible();
      await expect(drawer.getByLabel(ALSO_PICTURED.chip(CAMEO), { exact: true })).toBeVisible();
      // ...and no player: the stored Pete Rose was held back.
      await expect(drawer.getByRole("button", { name: "Add player", exact: true })).toBeVisible();
      await expect(anyPlayerChip(drawer)).toHaveCount(0);
      // The committed title, exact: no player between the set and the number,
      // only the cameo (a title names it while it has room, and drops it first
      // when over 80: NEO-528 + NEO-535).
      await expect(cardTitle(drawer)).toHaveValue(title);
      if (number === RULED_OUT[0].number) {
        await expectAccessible(page, { within: drawer, label: "Card drawer, a ruled-out card with no player and a cameo" });
      }
      await closeCardDrawer(drawer);
    }

    // --- #4 keeps its own Pete Rose, and has the cameo -------------------------
    const own = await openCardDrawer(page, OWN);
    await expect(cardDescription(own)).toHaveValue(cameoLine(CAMEO));
    await expect(playerChip(own, PLAYER)).toBeVisible();
    await expect(anyPlayerChip(own)).toHaveCount(1);
    await expect(cameoChip(own, CAMEO)).toBeVisible();
    // NEO-609: 84 characters with "Base", the first word cut: 79 without it,
    // and nothing else goes.
    await expect(cardTitle(own)).toHaveValue(
      `${SET_TITLE} ${PLAYER} & ${CAMEO} #${OWN} Cincinnati Reds Baseball`,
    );
    await closeCardDrawer(own);

    // --- A parallel built from Base copies the hold-back --------------------
    await drillToSet(page, env, BUILD);
    await pick(page, "Variant Types", "Parallel", { search: false });
    await pickAfterBscSync(page, "Parallels", PARALLEL);
    const parallelHeading = page.getByRole("heading", { name: `Attributes for ${PARALLEL} (Insert)` });
    await expect(parallelHeading).toBeVisible();
    // Built (a rerun on the same seed) or not yet: a parallel is built from
    // Base, never fetched. The checklist settles on its cards or its empty line
    // first (its "Build from Base" shows while the cards are still loading).
    await expect(empty.or(cards)).toBeVisible();
    if (await empty.isVisible()) {
      await page.getByRole("button", { name: "Build from Base", exact: true }).click();
      // Our own writes, one copy per Base card the plate's BSC list also has
      // (BSC lists 60 plates, 43 of them Base numbers): the standard budget.
      await expect(page.getByText(new RegExp(`^${escapeRe(PARALLEL)} — Built [1-9][0-9]* cards`))).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Rebuild from Base", exact: true })).toBeVisible();
    await expect(cards).toBeVisible();
    const copy = await openCardDrawer(page, RULED_OUT[0].number);
    await expect(cardDescription(copy)).toHaveValue(new RegExp(`card #${RULED_OUT[0].number}\\.`));
    await expect(copy.getByRole("button", { name: "Add player", exact: true })).toBeVisible();
    await expect(anyPlayerChip(copy)).toHaveCount(0);
    await expect(cameoChip(copy, CAMEO)).toBeVisible();
    await closeCardDrawer(copy);
    const ownCopy = await openCardDrawer(page, OWN);
    await expect(playerChip(ownCopy, PLAYER)).toBeVisible();
    await closeCardDrawer(ownCopy);

    // The drill lives in the URL: Back steps out of the parallel.
    await page.goBack();
    await expect(parallelHeading).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Attributes for Parallel (Variant)" })).toBeVisible();
  },
);
