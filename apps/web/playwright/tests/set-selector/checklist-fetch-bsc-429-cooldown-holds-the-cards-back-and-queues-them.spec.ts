// NEO-552 (R1): when BuySportsCards pushes back with a 429 on the per-card team
// lookup of a checklist fetch, the fetch meets the cooldown at once: it lands inside
// the budget with no "Waiting on BuySportsCards" line, asks BSC for no further card,
// guesses no team (invariant 8), and after the save every card the lookup owed waits
// in the background queue ("Still looking up teams for N cards. Nothing for you to do
// yet."), none of them put to the operator.
//
// HOW THE 429 IS MADE. BuySportsCards is the fake (services/fake-bsc), so a spec asks
// it to misbehave: `bscFake.setFaults` puts a 429 with a Retry-After on every
// `GET marketplace/card/:id/card-listing` for THIS worker's fake account (support/
// bscFake.ts). The product honours the Retry-After, opens its call gate and sends
// nothing more. That gate is DEPLOYMENT-WIDE (convex/bscCallGate.ts), which is why
// this spec carries `@bsc-breaker`: CI runs it alone, after every shard, and the
// `bscFake` fixture clears the rules and the gate when the test ends, red or green.
// It replaces the real-BSC 429 branches the live suite could only hit by luck.
//
// NO PUBLISHER'S CHECKLIST (GUIDE, "Checklist first"). The reason to upload one is
// fewer BSC calls and smaller recordings. Here every card-listing request is answered
// 429 by the fault before any recording is looked up, so no recording is read or
// needed; and the point is the per-card lookup, which a checklist file would skip.
//
// WHAT IT PROVES, IN ORDER:
//   1. The fetch's "Kept all N cards from BSC" line lands within 7 s of our own time
//      (`expectAfterMarketplace`), and once it has, no "Waiting on BuySportsCards" line
//      is up: a cooldown does not hold a call, it ends the lookup.
//   2. Every name is skipped, so the wizard reaches "Cards with no team" (every card
//      is listed there: not one has a BSC pre-fill to confirm).
//   3. After the save the checklist's status line names ALL of the set's cards as
//      waiting in the queue, in the product's words, and the amber "N need you" pill
//      is absent: nothing is the operator's yet. With the rule unlimited, a card that
//      had been asked after the 429 would have been 429'd too, so the count is the
//      product's own stop, not the fake running out of answers. Axe runs on the saved
//      checklist with the status line showing.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Dayton Bombers ECHL"; PROPOSED, a
// registered spare: taking it needs Jason's approval, R7a): SOLE WRITER of that set
// (BSC only, 32 numbered cards, reached through the All Brands view); FRESH-ONLY (it
// commits the checklist), so a re-run on the same seed fails at "No cards in this
// checklist yet." by name. Every name is skipped: no player and no team is minted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { editCardButton } from "../../support/cards";
import { expectAfterMarketplace, waitingOn } from "../../support/marketplace-wait";
import { setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { advanceToSave, confirmSaveButton, openOneMarketplaceSetBase, reviewWizard } from "../../support/wizard";

const SET = "Dayton Bombers ECHL";
/** The set's card count on BSC (SET-REGISTRY.md measurement). */
const CARDS = 32;
/** Long enough that the window outlasts the spec: the lane must not get a turn before the assert. */
const RETRY_AFTER_S = 90;

test(
  "Checklist fetch — a BSC 429 on the team lookup opens the cooldown: the fetch lands at once, no team is guessed, and every card waits in the background queue (NEO-552)",
  { tag: ["@set-selector", "@bsc-breaker"] },
  async ({ page, signIn, env, bscFake }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openOneMarketplaceSetBase(page, env, { set: SET });
    // The precondition for a FIRST fetch (fresh-only): a re-run fails here, by name.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 1. BSC pushes back on every team lookup; the fetch meets the cooldown ──
    await bscFake.setFaults([bscFault.tooManyRequests(BSC_PATH.cardListing, { retryAfterS: RETRY_AFTER_S, ttlS: 600 })]);
    await syncChecklistButton(page).click();
    await expectAfterMarketplace(page, page.getByText(new RegExp(`Kept all ${CARDS} cards from BSC`)), {
      platform: "BuySportsCards",
      what: "the fetch's kept-cards line",
    });
    // A cooldown holds no call, so nothing says the screen is waiting on BSC (paired with the
    // kept line above, which proves the page is alive).
    await expect(waitingOn(page, "BuySportsCards")).toHaveCount(0);
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();

    // ── 2. Every name skipped; the teams step lists the cards, none pre-filled ──
    const skipRemaining = wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
    const next = wizard.getByRole("button", { name: "Next (Enter)", exact: true });
    await expect(skipRemaining.or(next).first()).toBeVisible();
    if (await skipRemaining.isVisible()) await skipRemaining.click();
    await expect(next).toBeVisible();
    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Cards with no team after a BSC 429" });

    // ── 3. Save: every card waits in the queue; none is the operator's ──
    await advanceToSave(page);
    await confirmSaveButton(page).click();
    await expect(page.getByText(new RegExp(`Saved ${CARDS} cards`))).toBeVisible();
    await expect(wizard).toBeHidden();
    // The set's cards are on screen, so what follows is read off a live checklist.
    await expect(editCardButton(page, "1")).toBeVisible();
    // The queue's own words (a status line; its number moves at most every 5 s, so the first value
    // after the save is the full count). All CARDS: the 429 ended the lookup before any card was
    // answered, and nothing it owed was guessed.
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`^Still looking up teams for ${CARDS} cards\\. Nothing for you to do yet\\.`) }),
    ).toBeVisible();
    // Nothing is the operator's yet: the "N need you" pill is rendered only while some card needs them.
    await expect(page.getByRole("button", { name: /need[s]? you$/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Dayton checklist saved, every card waiting in the background" });
  },
);
