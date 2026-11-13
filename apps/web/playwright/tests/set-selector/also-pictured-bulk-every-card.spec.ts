// NEO-528 (R1): the set builder's Attributes panel adds one player to the
// "Also on this card" list of every card of a checklist in one run, and takes him
// off every card again. On a hand-made Insert › Base with two cards, the admin
// chooses Q under "Also on every card", presses Add to every card,
// confirms ("Add Q to every card in Base?"), and the run's ledger ends "Added
// Q to 2 cards"; each card's drawer then lists Q under "Also on this card". Take off
// every card, confirmed, ends "Took Q off 2 cards", and the drawer's Also
// pictured is empty again. Both confirm dialogs and both finished ledgers pass
// axe, and the finished ledger's Dismiss ("Dismiss this run") takes it away.
// The Stop, failure and capped-ledger variants are covered by unit tests only
// (`components/SetSelector/AlsoPicturedBulkControl.test.tsx`): a live Stop
// needs a run long enough to interrupt, and a live failure a broken backend.
//
// Q is the player of the SECOND ordinary row of the seed's 2024 Topps Chrome
// Base, read off the collector's checklist (read only), and must not be the
// first row's player: `collection/smart-binder-secondary-player` counts the
// first row's player's cameos across the whole catalogue ("Cameos: 1 have, 0
// need"), and a card this spec gives Q is a cameo of Q's, never of his.
//
// R7/R7a: the hand-made set `apb<token>` (single token, per attempt,
// SET-REGISTRY.md) sits under the REAL Baseball > 2024 > Topps (the bulk
// picker searches the set's sport, Baseball, Q's sport) with no marketplace id
// anywhere beneath it. Its two cards end with no one else on them and are
// DELETED at the end; the set and its rows stand.
//
// R3: the "Also on this card" names come from `support/also-pictured.ts`; the drill
// is `drillToCustom` (R9). The card drawer's own field and the collector's
// side are `collection/smart-binder-secondary-player`.
import type { Page } from "@playwright/test";
import { ALSO_PICTURED, ALSO_PICTURED_BULK, alsoPicturedGroup } from "../../support/also-pictured";
import { addCardViaForm, confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import { drillToCollectorBase, ordinaryBaseRows, shortNameOf } from "../../support/collection";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, type CustomTarget } from "../../support/set-builder";

/** The Attributes panel remembers whether it was left open: open it only if it is not. */
async function openAttributes(page: Page) {
  const edit = page.getByRole("button", { name: "Edit attributes" });
  const hide = page.getByRole("button", { name: "Hide attributes" });
  await expect(edit.or(hide)).toBeVisible();
  if (await edit.isVisible()) await edit.click();
  await expect(hide).toBeVisible();
}

test(
  "Set builder: one player goes onto every card of a checklist as a cameo in one confirmed run, and comes off every card again",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const A = env.ATTEMPT_ID;
    const build: CustomTarget = {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set: `apb${env.ATTEMPT_TOKEN}`,
      variantType: "Insert",
      variant: "Base",
    };
    const numbers = [`5281-${A}`, `5282-${A}`];

    // --- Q: a real catalogue player, not the cameo spec's ------------------
    await signIn("/collection?tab=checklists");
    await expect(page.getByRole("heading", { level: 1, name: "Collection" })).toBeVisible({ timeout: LAUNCH_GATE });
    const base = await drillToCollectorBase(page);
    const rows = ordinaryBaseRows(base);
    const first = await shortNameOf(rows.first());
    const second = await shortNameOf(rows.nth(1));
    expect(second.player, "the second row's player is not the cameo spec's").not.toBe(first.player);
    const Q = second.player;

    // --- A hand-made checklist with two cards ------------------------------
    await drillToCustom(page, build);
    for (const [i, number] of numbers.entries()) {
      await addCardViaForm(page, { cardNumber: number, playerName: `Bulk${i + 1}${env.ATTEMPT_TOKEN}` });
    }
    await expect(page.getByRole("heading", { name: "Attributes for Base (Insert)" })).toBeVisible();
    await openAttributes(page);

    const bulk = page.getByRole("region", { name: ALSO_PICTURED_BULK.region, exact: true });
    const addEvery = bulk.getByRole("button", { name: ALSO_PICTURED_BULK.add, exact: true });
    const offEvery = bulk.getByRole("button", { name: ALSO_PICTURED_BULK.remove, exact: true });
    // Nothing chosen yet: both are refused.
    await expect(addEvery).toBeDisabled();
    await expect(offEvery).toBeDisabled();
    await bulk.getByRole("button", { name: ALSO_PICTURED_BULK.trigger, exact: true }).click();
    await page.getByRole("textbox", { name: ALSO_PICTURED_BULK.search, exact: true }).fill(Q);
    await page.getByRole("option", { name: ALSO_PICTURED_BULK.option(Q), exact: true }).click();
    await expect(addEvery).toBeEnabled();
    await expectAccessible(page, { within: bulk, label: "Also on every card, a player chosen" });

    /** One card's drawer, read and closed: is Q listed under "Also on this card"? */
    const drawerLists = async (number: string, listed: boolean) => {
      await editCardButton(page, number).click();
      const drawer = page.getByRole("dialog", { name: `Card #${number}`, exact: true });
      const field = alsoPicturedGroup(drawer);
      await expect(drawer.getByRole("button", { name: ALSO_PICTURED.trigger, exact: true })).toBeVisible();
      await expect(field.getByRole("button", { name: ALSO_PICTURED.remove(Q), exact: true })).toHaveCount(listed ? 1 : 0);
      await drawer.getByRole("button", { name: "Done editing card", exact: true }).click();
      await expect(drawer).toBeHidden();
    };

    // --- Add to every card, confirmed --------------------------------------
    await addEvery.click();
    const askAdd = page.getByRole("dialog", { name: ALSO_PICTURED_BULK.askAdd(Q) });
    await expect(askAdd.getByRole("button", { name: ALSO_PICTURED_BULK.yesAdd(Q), exact: true })).toBeVisible();
    await expectAccessible(page, { within: askAdd, label: "Add a player to every card, confirm" });
    await askAdd.getByRole("button", { name: ALSO_PICTURED_BULK.yesAdd(Q), exact: true }).click();
    await expect(askAdd).toBeHidden();
    // Our own writes, a page per checklist: the standard budget. The run's
    // ledger is a region named by its heading, which ends on the outcome.
    const addedLedger = page.getByRole("region", { name: ALSO_PICTURED_BULK.added(Q, "2 cards"), exact: true });
    await expect(addedLedger.getByRole("heading", { name: ALSO_PICTURED_BULK.added(Q, "2 cards"), exact: true })).toBeVisible();
    await expectAccessible(page, { within: addedLedger, label: "Also on every card, the run's ledger done" });
    for (const number of numbers) await drawerLists(number, true);

    // --- Take off every card, confirmed ------------------------------------
    // Q is still the choice after the run.
    await expect(offEvery).toBeEnabled();
    await offEvery.click();
    const askOff = page.getByRole("dialog", { name: ALSO_PICTURED_BULK.askRemove(Q) });
    await expect(askOff.getByRole("button", { name: ALSO_PICTURED_BULK.yesRemove(Q), exact: true })).toBeVisible();
    await expectAccessible(page, { within: askOff, label: "Take a player off every card, confirm" });
    await askOff.getByRole("button", { name: ALSO_PICTURED_BULK.yesRemove(Q), exact: true }).click();
    await expect(askOff).toBeHidden();
    const offLedger = page.getByRole("region", { name: ALSO_PICTURED_BULK.tookOff(Q, "2 cards"), exact: true });
    await expect(offLedger.getByRole("heading", { name: ALSO_PICTURED_BULK.tookOff(Q, "2 cards"), exact: true })).toBeVisible();
    await expectAccessible(page, { within: offLedger, label: "Also on every card, the take-off run's ledger done" });
    // A finished run's ledger stays until dismissed; Dismiss takes it away.
    await offLedger.getByRole("button", { name: ALSO_PICTURED_BULK.dismiss, exact: true }).click();
    await expect(offLedger).toHaveCount(0);
    await expect(addEvery).toBeVisible();
    for (const number of numbers) await drawerLists(number, false);

    // --- Cleanup: the two cards ---------------------------------------------
    for (const number of numbers) {
      await deleteCardButton(page, number).click();
      await confirmDeleteCardButton(page, number).click();
      await expect(editCardButton(page, number)).toBeHidden();
    }
    await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
  },
);
