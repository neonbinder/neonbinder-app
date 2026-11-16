// NEO-528 (R1): a cameo stored as "Player on every card" on a checklist BEFORE
// its cards exist reaches every card the fetch commits. Each card keeps its own
// player, lists the cameo under "Also on this card", and its description
// carries "Cameo: <name>"; a collector's smart binder for that player with
// "Include cameos" takes the cards in, tags them Cameo, and counts them apart
// ("Cameos: 1 have, 24 need": all 25 cards carry him).
//
// The fixture is a REAL set (Jason, 2026-11-15): Baseball > 2026 > Topps >
// Topps > Insert > Profiles, 25 cards `TP-1`..`TP-25`, each a different star.
// The cameo is Ken Griffey Jr. (Jason's pick), on none of its cards.
//
// The flow:
// - The set builder drills to Profiles and branches on the checklist's own
//   state. Empty: Ken Griffey Jr. is stored as a cameo on every card (no cards,
//   so no confirm), the publisher's checklist is uploaded, the checklist
//   synced, every review name nobody knows is skipped, and the 25 cards are
//   saved. Already committed (a rerun on the same seed): the stored cameo is
//   read back. Both branches end on the same asserts.
// - TP-1's and TP-3's drawers: their own player (Shohei Ohtani, Hank Aaron),
//   Griffey under "Also on this card", "Cameo: Ken Griffey Jr." in the
//   description. Back steps the drill out of Profiles.
// - The collector holds TP-1 in Main. A new smart binder "Player = Griffey,
//   and Set = 2026 Topps" with "Include cameos" on: Find cards offers TP-1
//   tagged as Griffey's cameo, it is added, and sorted by checklist with empty
//   slots the cover reads "Cameos: 1 have, 24 need".
// - Cleanup: the binder is deleted and the copy removed (the failure hook does
//   the same on a red run). The committed cards and the stored cameo stay.
//
// R7/R7a: SOLE WRITER of Baseball > 2026 > Topps > Topps > Insert (its column
// sync, BSC only under a SportLots pause) and of Profiles' rows and cards
// (SET-REGISTRY.md), and the ONLY spec that lists Ken Griffey Jr. under "Also
// on this card" anywhere: a smart binder's cameo counts are catalogue-wide, so
// "24 need" holds only while nothing else does. Not fresh-only: a rerun adopts
// the committed checklist. The collector writes only the signed-in user's own
// binder and copy, and removes both.
//
// R3: the drill is `drillToSet` + `pick` + `pickAfterBscSync` (R9), the upload
// `usePublishersChecklist`, the review `support/wizard.ts`, the set builder's
// names `support/also-pictured.ts`, and the collector's `support/cameo-binder.ts`.
import type { Locator, Page } from "@playwright/test";
import {
  EVERY_CARD_PLAYER as E,
  cameoChip,
  cameoLine,
  cardDescription,
  closeCardDrawer,
  openCardDrawer,
  openEveryCardPlayer,
  playerChip,
  storeEveryCardValue,
  ALSO_PICTURED,
} from "../../support/also-pictured";
import { cameoPhrase, deleteBinder, holdInMain, openCollectorChecklist, removeCopy } from "../../support/cameo-binder";
import { escapeRe } from "../../support/cards";
import type { CollectorSet } from "../../support/collection";
import type { FlowEnv } from "../../support/env";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS, confirmChecklistMatchCards, usePublishersChecklist } from "../../support/published-checklist";
import { drillToSet, pick, pickAfterBscSync, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { advanceToSave, confirmSaveButton, nextStepButton, reviewWizard, tidyUpName } from "../../support/wizard";

const BUILD = { sport: "Baseball", year: "2026", manufacturer: "Topps", set: "Topps" } as const;
const INSERT = "Profiles";
const COLLECTOR: CollectorSet = { ...BUILD, checklist: { type: "Insert", name: INSERT } };
/** A card's label on the collector's screens: an insert's name sits in the set part. */
const CARD_LABEL = `${BUILD.year} ${BUILD.set} ${INSERT}`;
/** A set's name in a smart rule and its picker ("<season> <set>"). */
const SET_LABEL = `${BUILD.year} ${BUILD.set}`;
const CAMEO = "Ken Griffey Jr.";
/** Two cards and their own players, checked in the set builder. */
const OWN_CARDS = [
  { number: "TP-1", player: "Shohei Ohtani" },
  { number: "TP-3", player: "Hank Aaron" },
] as const;
const CARDS = 25;

/** The wizard opens behind the entity check's batch (live lookups; the same spec's ceiling). */
const WIZARD_OPENS = 60_000;
/** "Skip remaining names" is repeated while lookups still stage names (the same spec's ceiling). */
const BATCH_GROWS = 60_000;

/** Drill the set builder to Profiles. EXIT its Attributes panel heading is up. */
async function drillToProfiles(page: Page, env: FlowEnv): Promise<void> {
  await drillToSet(page, env, BUILD);
  await pick(page, "Variant Types", "Insert", { search: false });
  // Under a SportLots pause the Inserts column fills straight from BSC (no Reconcile).
  await pickAfterBscSync(page, "Inserts", INSERT);
  await expect(page.getByRole("heading", { name: `Attributes for ${INSERT} (Insert)` })).toBeVisible();
}

/**
 * Fetch and commit the empty checklist, the cameo stored first. Contract:
 * ENTRY Profiles is on screen with no cards. EXIT it is on screen again,
 * freshly drilled, with its cards.
 */
async function fetchAndCommit(page: Page, env: FlowEnv, section: Locator): Promise<void> {
  await storeEveryCardValue(page, section, CAMEO, "cameo");
  await expectAccessible(page, { within: section, label: "Player on every card, a cameo stored before the fetch" });

  // GUIDE "Checklist first": every row names its team, so BSC is asked for no card one by one.
  const facts = await usePublishersChecklist(page, CHECKLISTS.toppsProfiles2026);
  await syncChecklistButton(page).click();
  // NEO-496 (D10, NQ1): the uploaded checklist is a second source, so the fetch opens Match Cards on
  // either branch (SportLots paused or not). The helper waits on it (7 s of ours plus BSC's), proves the
  // teams line while it is open (the only time before the save), keeps any BSC-only card and confirms.
  await confirmChecklistMatchCards(page, { facts, what: "the empty checklist's fetch" });
  const wizard = reviewWizard(page);
  await expect(wizard).toBeVisible({ timeout: WIZARD_OPENS });
  await expect(wizard).toHaveAccessibleName(tidyUpName({ year: BUILD.year, set: BUILD.set, variant: INSERT }));
  // The names are not this spec's claim: skip the ones nobody knows, repeating
  // while a lookup can still stage one, then save.
  const namesDone = nextStepButton(page).or(confirmSaveButton(page));
  const skipRemaining = wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
  await expect(async () => {
    if (await skipRemaining.isVisible()) await skipRemaining.click();
    await expect(namesDone).toBeVisible({ timeout: 7_000 });
  }).toPass({ timeout: BATCH_GROWS });
  await advanceToSave(page);
  await expect(wizard.getByRole("heading", { name: `Save ${CARDS} cards?` })).toBeVisible();
  await confirmSaveButton(page).click();
  await expect(page.getByText(new RegExp(`Saved ${CARDS} cards`))).toBeVisible();
  await expect(wizard).toBeHidden();
  await drillToProfiles(page, env);
}

/** What the body wrote, each set right BEFORE its write, cleared once undone. */
const written: { binder?: string; copy?: string } = {};

// A red run must not leave the binder or the copy (the worker's next run would
// meet them). A page of its own, brought to the front (left behind the test's
// page it stalls on the phone project), so the failure's screenshot and ARIA
// snapshot still show where the body stopped. Each step runs even when an
// earlier one fails; the first failure is rethrown.
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const { binder, copy } = written;
  delete written.binder;
  delete written.copy;
  if (!binder && !copy) return;
  const clean = await context.newPage();
  await clean.bringToFront();
  const failures: unknown[] = [];
  try {
    if (binder) await deleteBinder(clean, binder).catch((e: unknown) => failures.push(e));
    if (copy) {
      await openCollectorChecklist(clean, COLLECTOR, copy.replace(/^#(\S+).*$/, "$1"))
        .then((checklist) => removeCopy(clean, checklist, copy))
        .catch((e: unknown) => failures.push(e));
    }
  } finally {
    await clean.close();
  }
  if (failures.length > 0) throw failures[0];
});

test(
  "Set builder: a cameo stored on every card before the fetch reaches every committed card beside its own player, and a smart binder with Include cameos takes them in and counts them apart",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const binder = `Griffey${env.ATTEMPT_TOKEN}`;
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // --- As admin: the checklist, fetched with the cameo stored, or adopted ---
    await drillToProfiles(page, env);
    const empty = page.getByText("No cards in this checklist yet.");
    const cards = page.getByRole("heading", { level: 2, name: /^Cards \([1-9][0-9]*\)$/ });
    await expect(empty.or(cards)).toBeVisible();
    let section = await openEveryCardPlayer(page);
    if (await empty.isVisible()) {
      await fetchAndCommit(page, env, section);
      section = await openEveryCardPlayer(page);
    }
    await expect(cards).toHaveAccessibleName(`Cards (${CARDS})`);
    await expect(section.getByRole("button", { name: E.stopCameo(CAMEO), exact: true })).toBeVisible();

    // Each card keeps its own player and lists the cameo.
    for (const { number, player } of OWN_CARDS) {
      const drawer = await openCardDrawer(page, number);
      await expect(cardDescription(drawer)).toHaveValue(cameoLine(CAMEO));
      await expect(playerChip(drawer, player)).toBeVisible();
      await expect(playerChip(drawer, CAMEO)).toHaveCount(0);
      await expect(cameoChip(drawer, CAMEO)).toBeVisible();
      await expect(drawer.getByLabel(ALSO_PICTURED.chip(CAMEO), { exact: true })).toBeVisible();
      if (number === OWN_CARDS[0].number) {
        await expectAccessible(page, { within: drawer, label: "Card drawer, a fetched card with the stored cameo" });
      }
      await closeCardDrawer(drawer);
    }
    // The drill lives in the URL: Back steps out of Profiles.
    await page.goBack();
    await expect(page.getByRole("heading", { name: `Attributes for ${INSERT} (Insert)` })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Attributes for Insert (Variant)" })).toBeVisible();

    // --- The collector holds TP-1 ----------------------------------------------
    const [held] = OWN_CARDS;
    const checklist = await openCollectorChecklist(page, COLLECTOR, held.number);
    const short = await holdInMain(page, checklist, held.number, (s) => {
      written.copy = s;
    });
    expect(short, "TP-1's own player").toBe(`#${held.number} ${held.player}`);

    // --- A smart binder for the cameo, Include cameos on -------------------------
    await page.goto("/collection?tab=binders");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible();
    const shelf = page.getByRole("list", { name: "Your binders" });
    await shelf.getByRole("button", { name: "New binder", exact: true }).click();
    const newDialog = page.getByRole("dialog", { name: "New binder", exact: true });
    await newDialog.getByRole("textbox", { name: "Binder name" }).fill(binder);
    await newDialog.getByRole("radio", { name: /^Smart: a rule helps fill it/ }).check();
    await newDialog.getByRole("combobox", { name: "Line 1" }).selectOption({ label: "Player" });
    await newDialog.getByRole("combobox", { name: "Players" }).fill(CAMEO);
    await newDialog.getByRole("option", { name: `${CAMEO} · Baseball`, exact: true }).click();
    await expect(newDialog.getByRole("button", { name: `Remove ${CAMEO}`, exact: true })).toBeVisible();
    await newDialog.getByRole("button", { name: "Add a line", exact: true }).click();
    await newDialog.getByRole("combobox", { name: "Line 2" }).selectOption({ label: "Set" });
    await newDialog.getByRole("combobox", { name: "Sets" }).fill(SET_LABEL);
    await newDialog.getByRole("option", { name: SET_LABEL, exact: true }).click();
    await expect(newDialog.getByRole("button", { name: `Remove ${SET_LABEL}`, exact: true })).toBeVisible();
    const includeCameos = newDialog.getByRole("checkbox", { name: "Include cameos", exact: true });
    await includeCameos.check();
    await expect(includeCameos).toBeChecked();
    written.binder = binder;
    await newDialog.getByRole("button", { name: "Put it on the shelf" }).click();
    await expect(newDialog).toBeHidden();

    // Find cards opens by itself: TP-1, held in Main, tagged as Griffey's cameo.
    const find = page.getByRole("dialog", { name: `Find cards for ${binder}`, exact: true });
    const heldLabel = `${escapeRe(CARD_LABEL)} #${escapeRe(held.number)}\\b`;
    const addHeld = find.getByRole("button", { name: new RegExp(`^Add ${heldLabel}.* from Main$`) });
    await expect(addHeld).toBeVisible();
    const heldRow = find
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: new RegExp(`^Add ${heldLabel}.* from Main$`) }) });
    await expect(heldRow.getByText(cameoPhrase(CAMEO), { exact: true })).toBeVisible();
    await expectAccessible(page, { within: find, label: "Find cards, a fetched card tagged as a cameo" });
    await addHeld.click();
    await expect(addHeld).toHaveCount(0);
    await find.getByRole("button", { name: "Done" }).click();
    await expect(find).toBeHidden();
    await expect(page.getByRole("heading", { level: 2, name: binder, exact: true })).toBeVisible();

    // --- Sorted by checklist with empty slots: the cameos counted apart ------
    await page.getByRole("button", { name: "Binder settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: `${binder} settings`, exact: true });
    await expect(settings.getByText(`Takes ${CAMEO}, and ${SET_LABEL}, cameos included.`, { exact: true })).toBeVisible();
    await settings.getByRole("radio", { name: /^Keep sorted by checklist/ }).check();
    await expect(settings.getByRole("radio", { name: /^Keep sorted by checklist/ })).toBeChecked();
    const emptySlots = settings.getByRole("checkbox", { name: /^Include empty slots/ });
    await emptySlots.check();
    await expect(emptySlots).toBeChecked();
    await settings.getByRole("button", { name: "Done" }).click();
    await expect(settings).toBeHidden();
    // All 25 cards carry him: one held, 24 to find. On a desktop the line sits
    // on the inside cover, on a phone above the page: found on the page.
    await expect(page.getByText(`Cameos: 1 have, ${CARDS - 1} need`, { exact: true })).toBeVisible();
    const cover = page.getByRole("region", { name: `${binder}, open`, exact: true });
    await expect(
      cover.getByRole("button", { name: new RegExp(`^${heldLabel}.*, ${escapeRe(cameoPhrase(CAMEO))}$`) }),
    ).toBeVisible();
    await expectAccessible(page, { label: "Smart binder counting a fetched set's cameos apart" });

    // --- Cleanup: the binder and the copy --------------------------------------
    await deleteBinder(page, binder);
    delete written.binder;
    await removeCopy(page, await openCollectorChecklist(page, COLLECTOR, held.number), short);
    delete written.copy;
  },
);
