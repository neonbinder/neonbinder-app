// NEO-487 (R1): when BuySportsCards stops answering for some cards during a
// checklist fetch, the fetch still finishes inside the budget (a stall ends
// within one wave of lookups, it is never waited out card by card), and after
// the save the cards BSC did not answer wait in the background queue for
// another try instead of being put to the operator.
//
// HOW THE STALL IS MADE (NEO-552; it was a deployment switch, D7, Jason 2026-11-10).
// BuySportsCards is the fake (services/fake-bsc), so a spec asks it to stall:
// `bscFake.setFaults` puts a `hang` rule on `GET marketplace/card/:id/card-listing`
// for each of three BSC card ids, on THIS worker's fake account (support/bscFake.ts).
// The fake never answers those three; NeonBinder's own 5 s timeout ends each call,
// and one retry follows. The ids are cards #1, #2 and #3 of Hockey 1995 Halifax
// Mooseheads QMJHL on BSC (read from BSC's storefront search, 2026-11-10; each is the
// card's own id):
//
//   STALL_IDS: 96f9a87adeb7d02c275e117ef10d569c,9dba15716322d30fc94e4bd96034e4bf,adf14c41cda48abecf2b69b0faa399ae
//
// Six timeouts in a row are a run of failures to Convex's BSC call gate
// (convex/bscCallGate.ts: five open it). Against the fake that gate is this worker's
// own (one per test user, keyed on its fake namespace; NEO-628), so it stops only this
// worker's BuySportsCards calls, and the spec runs in an ordinary shard beside the
// others. The `bscFake` fixture clears the rules and this worker's gate when the test
// ends, red or green. No deployment setting is needed; a spec that cannot place its
// rules fails at that step, by name.
//
// THE PUBLISHER'S CHECKLIST (Jason, 2026-11-10: prefer prebuilt checklists over
// live calls, keeping a small live read as the coverage; since NEO-552 the reason is
// smaller recordings and faster specs, not BSC's mood).
// The spec uploads fixtures/checklists/1995-hockey-halifax-mooseheads-qmjhl-base-
// five-live.csv: the set's own BSC answers for 21 of its 26 cards, with cards
// #1, #2, #3, #24 and #25 left OUT. So BSC is asked per card for exactly five:
// the three stalled ones (#1-#3), which this spec is about, and two that
// answer (#24, #25), which prove a lookup that is NOT stalled still lands.
//

// WHAT IT PROVES, IN ORDER:
//   1. The screen says the fetch is held up after the Sync click, in one of two places
//      (NEO-624): the page's "Waiting on BuySportsCards..." line, which mounts after 1.5 s
//      of waiting and stands down while Match Cards is open, or, when Match Cards opens
//      first (seen on the phone project), the dialog's own "teams are still resolving in
//      the background (N of 26 done)" with at least the three stalled cards outstanding.
//      Either is asserted, axe runs on the one that shows, and a `bsc-wait` annotation
//      says which ran. The page line is gone once the fetch is handed on. The fetch
//      lands within 7 s of our own time plus any seconds that line is up
//      (`expectAfterMarketplace`); with the checklist uploaded it lands in Match Cards
//      (NEO-496), where the five BSC-only cards are kept and confirmed. The
//      three hung cards hold the screen for about ten seconds (NeonBinder's 5 s
//      timeout, a short pause, one retry), all of it BSC's: a stall retried card
//      by card would blow the budget with our own time. The result line then says the
//      checklist supplied the teams of 21 cards ("Teams from your checklist").
//   2. Every name is skipped, so the wizard's "Cards with no team" step lists the
//      whole set (it cannot tell a stalled card from an answered one whose team
//      name was skipped); the spec only proves the step is reached.
//   (A stalled card reaches the operator from the background lane only after
//   about 6 minutes, so the spec asserts the queued state, never the give-up.)
//   3. After the save the split is on the checklist: the 23 cards that have an
//      answer (21 from the checklist and the 2 BSC answered live; their team name
//      was skipped, so they end teamless) are the operator's, "23 need you", and
//      the 3 it did not answer are not in that count: they wait in the queue, and
//      the checklist says so in its own words, "Still looking up teams for 3
//      cards. Nothing for you to do yet." (a status line; its number moves at
//      most every 5 s, so the first value after the save is the full three). The
//      "23" is also the proof of the two live answers: had either met a BSC 429
//      or an open cooldown it would wait in the queue too, and the line would
//      say 4 (or 5) cards. NEO-489 (Jason, 2026-11-11): that is a pass, not a
//      red. The spec reads M off the line (3 to 5), asserts exactly 26 - M need
//      you, and annotates which branch ran (`bsc-lookup`). A missing line is the
//      only red. Both are positives; neither can be read off a dead page. Axe runs on the
//      saved checklist with the status line showing.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Halifax Mooseheads QMJHL",
// one of the registered spares, needs Jason's approval to take): SOLE WRITER of
// that set (BSC only, 26 cards, reached through the All Brands view); FRESH-ONLY (it commits the
// checklist), so a re-run on the same seed fails at "No cards in this checklist
// yet." by name, and so does CI's retry of a red that came after the commit: read the
// FIRST attempt's error (GUIDE Gotchas, "Fresh-only specs"). Every name is skipped: no
// player and no team is minted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { editCardButton } from "../../support/cards";
import { bscLookupOutcome, waitingOn } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  confirmChecklistMatchCards,
  matchCardsDialog,
  usePublishersChecklist,
} from "../../support/published-checklist";
import { setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  advanceToSave,
  confirmSaveButton,
  openOneMarketplaceSetBase,
  reviewWizard,
} from "../../support/wizard";

const SET = "Halifax Mooseheads QMJHL";
/** The set's card count on BSC. */
const CARDS = 26;
/** The BSC card ids the fake never answers (cards #1-#3, the ids in the header). */
const STALL_IDS = ["96f9a87adeb7d02c275e117ef10d569c", "9dba15716322d30fc94e4bd96034e4bf", "adf14c41cda48abecf2b69b0faa399ae"] as const;
/** How many of them the fake swallows. */
const STALLED = STALL_IDS.length;

test(
  "Checklist fetch — a BSC stall on some cards ends within one wave: the fetch lands and the unanswered cards wait in the background queue, not in the operator's count (NEO-487)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, bscFake }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openOneMarketplaceSetBase(page, env, { set: SET });
    // The precondition for a FIRST fetch (fresh-only): a re-run fails here, by name.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 1. The fetch, with the trimmed checklist: BSC is asked per card for five only ──
    const facts = await usePublishersChecklist(page, CHECKLISTS.halifaxMooseheads1995FiveLive);
    // The fake never answers the three stalled cards (its rules last 10 minutes at most, and teardown drops them).
    await bscFake.setFaults(STALL_IDS.map((cardId) => bscFault.hangs(BSC_PATH.cardListing, { cardId, ttlS: 600 })));
    await syncChecklistButton(page).click();
    // The three hung cards hold the fetch for about ten seconds (a 5 s timeout, a pause, one retry).
    // NEO-624: the screen says so in one of two places. The page's wait line mounts after 1.5 s of
    // waiting and stands down while Match Cards is open; with the checklist uploaded, Match Cards can
    // open mid-stream (the phone run did), and then the dialog's own sentence carries the wait, its
    // count short of the set by at least the three hung cards. Either is the hang holding, within 7 s.
    const waitLine = waitingOn(page, "BuySportsCards");
    const matchCards = matchCardsDialog(page);
    const STILL_RESOLVING = new RegExp(`^Pair away — teams are still resolving in the background \\(([0-9]+) of ${CARDS} done\\)\\.`);
    // The sentence is shown and also said by a status beside it: any one of the two.
    const stillResolving = matchCards.getByText(STILL_RESOLVING).first();
    await expect(waitLine.or(stillResolving).first()).toBeVisible();
    if (await waitLine.isVisible()) {
      test.info().annotations.push({ type: "bsc-wait", description: "the page's Waiting on BuySportsCards line" });
      await expectAccessible(page, { label: "Checklist fetch waiting on BuySportsCards during a stall" });
    } else {
      await expect(stillResolving).toBeVisible();
      const done = Number(STILL_RESOLVING.exec((await stillResolving.textContent()) ?? "")?.[1]);
      expect(done, "Match Cards counts the stalled cards as still resolving").toBeLessThanOrEqual(CARDS - STALLED);
      test.info().annotations.push({ type: "bsc-wait", description: `Match Cards, ${done} of ${CARDS} done` });
      await expectAccessible(page, { within: matchCards, label: "Match Cards while the stalled cards still resolve" });
    }
    // NEO-496 (D10, NQ1): BSC plus the uploaded checklist are two sources, so Match Cards opens.
    // The helper waits on it with `expectAfterMarketplace` (7 s of ours plus BSC's), proves the
    // teams line, keeps the five BSC cards the file leaves out and confirms: all 26 go on.
    await confirmChecklistMatchCards(page, { facts, what: "the Halifax fetch" });
    // The fetch was handed on, so the wait line is gone (a positive, the dialog's confirm, came first).
    await expect(waitingOn(page, "BuySportsCards")).toHaveCount(0);
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();

    // ── 2. Every name skipped; the teams step is reached ──
    const skipRemaining = wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
    const next = wizard.getByRole("button", { name: "Next (Enter)", exact: true });
    await expect(skipRemaining.or(next).first()).toBeVisible();
    if (await skipRemaining.isVisible()) await skipRemaining.click();
    await expect(next).toBeVisible();
    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Cards with no team after a BSC stall" });

    // ── 3. Save: the answered cards are the operator's, the three unanswered wait in the background ──
    await advanceToSave(page);
    await confirmSaveButton(page).click();
    await expect(page.getByText(new RegExp(`Saved ${CARDS} cards`))).toBeVisible();
    await expect(wizard).toBeHidden();
    // The set's cards are on screen, so what follows is read off a live checklist.
    await expect(editCardButton(page, "1")).toBeVisible();
    // The queue's own words: the status line names the cards that wait, and says it is not the operator's yet.
    // No line at all means no card was left unanswered (the fake's rules did not hold): red, by name.
    const lookupStatus = page.getByRole("status").filter({ hasText: /^Still looking up teams for [0-9]+ cards?\./ });
    await expect(
      lookupStatus,
      "no 'Still looking up teams' line: the fake BSC answered the three stalled cards (their hang rules did not hold), so none was queued",
    ).toBeVisible();
    // NEO-489 (Jason, 2026-11-11: a BSC 429 or an open cooldown on a live card is a pass). The three
    // stalled cards always wait. The two live lookups (#24, #25) wait too when BSC rate-limits them
    // or its cooldown is open, so M is 3 (both answered) up to 5 (neither). Whatever M is, the
    // cards BSC DID answer end teamless and are the operator's, exactly CARDS - M.
    // The line and the button are read TOGETHER and retried together: the queue drains while the
    // page is open, so a count read once and a button asserted a moment later could straddle a
    // drain and disagree about the same instant. Each pass reads M, then asserts 26 - M need you
    // (a count that is not CARDS - M fails by its number). Exact, positive.
    let queued = 0;
    await expect(async () => {
      queued = Number((((await lookupStatus.textContent({ timeout: 1_000 })) ?? "").match(/for ([0-9]+) cards?/) ?? [])[1]);
      expect(queued, "the stalled cards plus at most the two live ones wait in the queue").toBeGreaterThanOrEqual(STALLED);
      expect(queued, "the stalled cards plus at most the two live ones wait in the queue").toBeLessThanOrEqual(STALLED + 2);
      await expect(page.getByRole("button", { name: `${CARDS - queued} need you`, exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 7_000 });
    bscLookupOutcome(queued === STALLED ? "answered" : "cooldown", `Halifax #24, #25 (${queued} cards waiting)`);
    await expectAccessible(page, { label: "Halifax checklist saved, the unanswered cards waiting in the background" });
  },
);
