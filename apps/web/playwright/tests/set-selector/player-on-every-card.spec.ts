// NEO-528 round 3 (R1): "Player on every card" is a stored attribute of a set
// builder row, at any level, that every NEW card beneath it is born with. A
// pick on a checklist with no cards is saved with no question; cards added
// afterwards carry the stored player (unless they name their own) and the
// stored cameos; a cameo picked with cards present is confirmed and brought
// onto the cards already there; clearing a chip only stops future copies; and
// a value stored on a row above shows on the rows beneath as inherited.
//
// The flow, on a hand-made set `pev<token>` > Insert > Base with no cards:
// - Both actions wait for the section's stored values (its "Checking…" state
//   is unit-tested, EveryCardPlayerControl.test.tsx). Q chosen reads
//   "Picked:" until stored.
// - Q, "Add to every card": no confirm, the "Saved" note beside the actions,
//   the section reads "Player:" with Q's chip and no "Picked:" any more.
// - Two cards quick-added with no player are born with Q (drawer); one
//   quick-added naming R keeps R and gets no Q.
// - Q2, "Add as cameo" with three cards present: confirm, ledger "Added Q2 as
//   a cameo on 3 cards"; a card's drawer lists Q2 under "Also on this card" and
//   its description carries "Cameo: Q2".
// - × on Q's chip: the "Cleared" note, focus back on the picker;
//   the next quick-added card has no player (and is born with the stored
//   cameo Q2), the first card still has Q.
// - Q stored on the SET row (the cards beneath are brought along: only the
//   card with no player changes, "Added Q to 1 card"); the Insert variant type
//   and the Base checklist beneath both show "Q (from pev<token>)" with no ×,
//   and Base's own cameo stays its own. Back undoes the Base pick.
// - The cameo confirm keeps its yes and Cancel inside the dialog: side by side
//   on a desktop, Cancel stacked under yes on a phone.
// axe, light and dark: the section with a pick not yet stored, with a stored
// player, the cameo confirm, the finished ledger and the inherited line.
//
// What this spec does not cover: the Stop, failure and capped-ledger variants
// (`components/SetSelector/EveryCardPlayerControl.test.tsx`), the sport,
// year and manufacturer levels (the same control; unit tests), and the
// commit-path copy at birth on a fetched checklist (needs a registered real
// set; see SET-REGISTRY.md `pev`).
//
// Q, R and Q2 are the players of the 2nd, 3rd and 4th ordinary rows of the
// seed's 2024 Topps Chrome Base, read off the collector's checklist (read
// only), all different and none the FIRST row's player:
// `collection/smart-binder-secondary-player` counts that player's cameos
// across the whole catalogue (memory: cameo counts are catalogue-wide).
//
// R7/R7a: the hand-made set `pev<token>` (single token, per attempt,
// SET-REGISTRY.md) sits under the REAL Baseball > 2024 > Topps (the pickers
// search the set's sport, Baseball, the players' sport) with no marketplace id
// anywhere beneath it. Its four cards are DELETED at the end, and by the
// failure hook on a red run, so no catalogue card is left naming Q, R or Q2;
// the set, its rows and their stored values stand (per attempt, read by no
// other spec).
//
// R3: every name of the section and the drawer's "Also on this card" comes from
// `support/also-pictured.ts`; the drills are `drillToCustom` / `selectOrCreate`
// (R9); the cards are added with `addCardViaForm`.
import type { Locator, Page } from "@playwright/test";
import { ALSO_PICTURED, EVERY_CARD_PLAYER as E, alsoPicturedGroup, openEveryCardPlayer } from "../../support/also-pictured";
import {
  addCardViaForm,
  confirmDeleteCardButton,
  deleteCardButton,
  editCardButton,
  escapeRe,
} from "../../support/cards";
import { drillToCollectorBase, ordinaryBaseRows, shortNameOf } from "../../support/collection";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, selectOrCreate, type CustomTarget } from "../../support/set-builder";

/** Open a card's drawer, run `check` on it, and close it again. */
async function inDrawer(page: Page, number: string, check: (drawer: Locator) => Promise<void>) {
  await editCardButton(page, number).click();
  const drawer = page.getByRole("dialog", { name: `Card #${number}`, exact: true });
  // The drawer's two pickers have drawn: its players and its "Also on this card".
  await expect(drawer.getByRole("button", { name: ALSO_PICTURED.trigger, exact: true })).toBeVisible();
  await check(drawer);
  await drawer.getByRole("button", { name: "Done editing card", exact: true }).click();
  await expect(drawer).toBeHidden();
}

/** The drawer's Players field names `name` (its chip's ×, the PlayerPicker default). */
const playerChip = (drawer: Locator, name: string) =>
  drawer.getByRole("button", { name: `Remove player ${name}`, exact: true });
/** Any player chip at all in the drawer's Players field. */
const anyPlayerChip = (drawer: Locator) => drawer.getByRole("button", { name: /^Remove player / });

/**
 * Delete the hand-made cards, on a fresh drill to their checklist. Each number
 * leaves `numbers` once its row is gone, so a cleanup that stops part way
 * leaves only what is still there for the failure hook.
 */
async function deleteCards(page: Page, build: CustomTarget, numbers: string[]) {
  await drillToCustom(page, build);
  for (const number of [...numbers]) {
    await deleteCardButton(page, number).click();
    await confirmDeleteCardButton(page, number).click();
    await expect(editCardButton(page, number)).toBeHidden();
    numbers.splice(numbers.indexOf(number), 1);
  }
  await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
}

/**
 * What the body wrote: each card number pushed once its row shows, and
 * cleared once the body's own cleanup has deleted them.
 */
const written: { build?: CustomTarget; cards: string[] } = { cards: [] };

// A red run must not leave a catalogue card naming Q, R or Q2 (a smart binder
// for one of them would count it). A page of its own, brought to the front
// (left behind the test's page it stalls on the phone project), so the
// failure's screenshot and ARIA snapshot still show where the body stopped.
test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const { build, cards } = written;
  written.build = undefined;
  written.cards = [];
  if (!build || cards.length === 0) return;
  const clean = await context.newPage();
  await clean.bringToFront();
  try {
    await deleteCards(clean, build, cards);
  } finally {
    await clean.close();
  }
});

test(
  "Set builder: Player on every card is stored on a row; new cards are born with its player and cameos, a cameo confirmed with cards present reaches them, clearing stops only future copies, and rows beneath show it inherited",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const A = env.ATTEMPT_ID;
    const SET = `pev${env.ATTEMPT_TOKEN}`;
    const setRow: CustomTarget = { sport: "Baseball", year: "2024", manufacturer: "Topps", set: SET };
    const build: CustomTarget = { ...setRow, variantType: "Insert", variant: "Base" };
    const [c1, c2, c3, c4] = [1, 2, 3, 4].map((n) => `528${n}-${A}`);
    const cardName = (n: number) => `Every${n}${env.ATTEMPT_TOKEN}`;

    // --- Q, R, Q2: real catalogue players, none the cameo spec's -------------
    await signIn("/collection?tab=checklists");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible({ timeout: LAUNCH_GATE });
    const base = await drillToCollectorBase(page);
    const rows = ordinaryBaseRows(base);
    await expect(rows.nth(3)).toBeVisible();
    const [first, Q, R, Q2] = await Promise.all([0, 1, 2, 3].map(async (i) => (await shortNameOf(rows.nth(i))).player));
    expect(new Set([first, Q, R, Q2]).size, "four different players, Q, R and Q2 not the cameo spec's").toBe(4);

    // --- A hand-made checklist with no cards --------------------------------
    await drillToCustom(page, build);
    written.build = build;
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Attributes for Base (Insert)" })).toBeVisible();
    await openEveryCardPlayer(page);

    const section = page.getByRole("region", { name: E.region, exact: true });
    const trigger = section.getByRole("button", { name: E.trigger, exact: true });
    const addPlayer = section.getByRole("button", { name: E.addPlayer, exact: true });
    const addCameo = section.getByRole("button", { name: E.addCameo, exact: true });
    // The section's own status line: "Checking…" while it loads, then a
    // save's or a clear's note, beside the actions (not the panel's toast).
    const note = (text: string) => section.getByRole("status").filter({ hasText: text });
    const picked = section.getByText(E.pickedLine, { exact: true });
    let firstPick = true;
    const choose = async (name: string) => {
      await trigger.click();
      await page.getByRole("textbox", { name: E.search, exact: true }).fill(name);
      await page.getByRole("option", { name: E.option(name), exact: true }).click();
      // The pick shows as a pick, not as a stored value, until an action stores it.
      await expect(section.getByRole("button", { name: E.clearPick(name), exact: true })).toBeVisible();
      await expect(picked).toBeVisible();
      // Enabled once the stored values have loaded ("Checking…" is gone).
      await expect(addPlayer).toBeEnabled();
      await expect(section.getByText(E.checking, { exact: true })).toHaveCount(0);
      if (firstPick) {
        firstPick = false;
        await expectAccessible(page, { within: section, label: "Player on every card, a pick not yet stored" });
      }
    };

    // Nothing chosen yet: both actions are refused (aria-disabled).
    await expect(addPlayer).toBeDisabled();
    await expect(addCameo).toBeDisabled();
    await expect(picked).toHaveCount(0);

    // --- Q as the player, no cards: saved with no question ------------------
    await choose(Q);
    await addPlayer.click();
    await expect(note(E.saved(Q))).toBeVisible();
    await expect(page.getByRole("dialog", { name: E.askPlayer(Q, "Base"), exact: true })).toHaveCount(0);
    await expect(picked).toHaveCount(0);
    await expect(section.getByText(E.playerLine, { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopPlayer(Q), exact: true })).toBeVisible();
    await expectAccessible(page, { within: section, label: "Player on every card, a player stored" });

    // --- New cards are born with Q; a card naming R keeps R ------------------
    for (const [i, number] of [c1, c2].entries()) {
      await addCardViaForm(page, { cardNumber: number, playerName: cardName(i + 1) });
      written.cards.push(number);
    }
    await addCardViaForm(page, {
      cardNumber: c3,
      playerName: cardName(3),
      beforeSubmit: async () => {
        await page.getByRole("button", { name: "Add a player to the new card", exact: true }).click();
        await page.getByRole("textbox", { name: "Find a player for the new card", exact: true }).fill(R);
        await page.getByRole("option", { name: `Add ${R}`, exact: true }).click();
        await expect(page.getByRole("button", { name: `Remove player ${R}`, exact: true })).toBeVisible();
        // Close the popover (it covers Add / Cancel): a press outside it.
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "Find a player for the new card", exact: true })).toBeHidden();
      },
    });
    written.cards.push(c3);
    for (const number of [c1, c2]) {
      await inDrawer(page, number, async (drawer) => {
        await expect(playerChip(drawer, Q)).toBeVisible();
      });
    }
    await inDrawer(page, c3, async (drawer) => {
      await expect(playerChip(drawer, R)).toBeVisible();
      await expect(playerChip(drawer, Q)).toHaveCount(0);
    });

    // --- Q2 as a cameo, cards present: confirmed, then brought onto them -----
    await choose(Q2);
    await addCameo.click();
    const askCameo = page.getByRole("dialog", { name: E.askCameo(Q2, "Base"), exact: true });
    const yesCameo = askCameo.getByRole("button", { name: E.yesCameo, exact: true });
    await expect(yesCameo).toBeVisible();
    await expectAccessible(page, { within: askCameo, label: "Player on every card, the cameo confirm" });
    // Its two buttons sit inside the dialog: side by side on a desktop, Cancel
    // stacked under the green yes on a phone (where they would not fit a row).
    const cancelCameo = askCameo.getByRole("button", { name: "Cancel", exact: true });
    const [box, yesBox, cancelBox] = await Promise.all([askCameo.boundingBox(), yesCameo.boundingBox(), cancelCameo.boundingBox()]);
    expect(box && yesBox && cancelBox, "the confirm and both its buttons are laid out").toBeTruthy();
    for (const b of [yesBox!, cancelBox!]) {
      expect(b.x, "a button starts inside the dialog").toBeGreaterThanOrEqual(box!.x);
      expect(b.y, "a button starts inside the dialog").toBeGreaterThanOrEqual(box!.y);
      expect(b.x + b.width, "a button ends inside the dialog").toBeLessThanOrEqual(box!.x + box!.width + 0.5);
      expect(b.y + b.height, "a button ends inside the dialog").toBeLessThanOrEqual(box!.y + box!.height + 0.5);
    }
    if (isMobile) {
      expect(cancelBox!.y, "on a phone Cancel sits under the yes").toBeGreaterThanOrEqual(yesBox!.y + yesBox!.height - 0.5);
    } else {
      expect(Math.abs(cancelBox!.y + cancelBox!.height / 2 - (yesBox!.y + yesBox!.height / 2)), "on a desktop the two share a row").toBeLessThan(2);
    }
    await yesCameo.click();
    await expect(askCameo).toBeHidden();
    // Our own writes, a page per checklist: the standard budget. The ledger is
    // a region named by its heading, which ends on the outcome.
    const cameoLedger = page.getByRole("region", { name: E.addedCameo(Q2, "3 cards"), exact: true });
    await expect(cameoLedger.getByRole("heading", { name: E.addedCameo(Q2, "3 cards"), exact: true })).toBeVisible();
    await expectAccessible(page, { within: cameoLedger, label: "Player on every card, the cameo run's ledger done" });
    // Stored as well: the section's Cameos line carries Q2's chip.
    await expect(section.getByText(E.cameoLine, { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopCameo(Q2), exact: true })).toBeVisible();
    // A finished run's ledger stays until dismissed.
    await cameoLedger.getByRole("button", { name: E.dismiss, exact: true }).click();
    await expect(cameoLedger).toHaveCount(0);
    await inDrawer(page, c1, async (drawer) => {
      await expect(alsoPicturedGroup(drawer).getByRole("button", { name: ALSO_PICTURED.remove(Q2), exact: true })).toBeVisible();
      await expect(playerChip(drawer, Q)).toBeVisible();
      await expect(drawer.getByRole("textbox", { name: "Card description", exact: true })).toHaveValue(
        new RegExp(`Cameo: ${escapeRe(Q2)}`),
      );
    });

    // --- × on Q's chip: future cards only -----------------------------------
    await section.getByRole("button", { name: E.stopPlayer(Q), exact: true }).click();
    await expect(note(E.cleared(Q))).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopPlayer(Q), exact: true })).toHaveCount(0);
    await expect(section.getByRole("button", { name: E.stopCameo(Q2), exact: true })).toBeVisible();
    await expect(trigger).toBeFocused();
    await addCardViaForm(page, { cardNumber: c4, playerName: cardName(4) });
    written.cards.push(c4);
    await inDrawer(page, c4, async (drawer) => {
      // Born with the stored cameo, and with no player now Q is cleared.
      await expect(alsoPicturedGroup(drawer).getByRole("button", { name: ALSO_PICTURED.remove(Q2), exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Add player", exact: true })).toBeVisible();
      await expect(anyPlayerChip(drawer)).toHaveCount(0);
    });
    await inDrawer(page, c1, async (drawer) => {
      await expect(playerChip(drawer, Q)).toBeVisible();
    });

    // --- Q on the SET row: the rows beneath show it inherited ----------------
    await drillToCustom(page, setRow);
    await expect(page.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    await openEveryCardPlayer(page);
    await choose(Q);
    await addPlayer.click();
    // Cards beneath: confirmed. Only the card with no player changes (c4); Q's
    // own two are already his and R's card keeps R.
    // The scope names the set; it may go on to count its checklists ("pev… (2
    // checklists)"), which is the server's walk, not this spec's claim.
    const askPlayer = page.getByRole("dialog", { name: new RegExp(`^Add ${escapeRe(Q)} to every card in ${escapeRe(SET)}`) });
    await askPlayer.getByRole("button", { name: E.yesPlayer, exact: true }).click();
    await expect(askPlayer).toBeHidden();
    const playerLedger = page.getByRole("region", { name: E.added(Q, "1 card"), exact: true });
    await expect(playerLedger.getByRole("heading", { name: E.added(Q, "1 card"), exact: true })).toBeVisible();
    await playerLedger.getByRole("button", { name: E.dismiss, exact: true }).click();
    await expect(playerLedger).toHaveCount(0);
    await expect(section.getByRole("button", { name: E.stopPlayer(Q), exact: true })).toBeVisible();

    const inheritedQ = section.getByText(E.inherited(SET, Q), { exact: true });
    await selectOrCreate(page, "Variant Types", "Insert", { via: "list" });
    await expect(page.getByRole("heading", { name: "Attributes for Insert (Variant)" })).toBeVisible();
    await openEveryCardPlayer(page);
    await expect(inheritedQ).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopPlayer(Q), exact: true })).toHaveCount(0);

    await selectOrCreate(page, "Inserts", "Base", { via: "list" });
    await expect(page.getByRole("heading", { name: "Attributes for Base (Insert)" })).toBeVisible();
    await openEveryCardPlayer(page);
    await expect(inheritedQ).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopPlayer(Q), exact: true })).toHaveCount(0);
    // Each kind resolves on its own: Base's own cameo is still its own.
    await expect(section.getByRole("button", { name: E.stopCameo(Q2), exact: true })).toBeVisible();
    await expectAccessible(page, { within: section, label: "Player on every card, inherited from the set" });

    // The drill lives in the URL: Back undoes the Base pick.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Attributes for Insert (Variant)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Attributes for Base (Insert)" })).toHaveCount(0);

    // --- Cleanup: the four cards --------------------------------------------
    await deleteCards(page, build, written.cards);
    expect(written.cards, "every card deleted").toEqual([]);
    written.build = undefined;
  },
);
