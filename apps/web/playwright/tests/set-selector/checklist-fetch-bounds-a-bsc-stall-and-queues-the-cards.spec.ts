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
//   1. The fake holds the fetch's catalogue read for HOLD_MS; Match Cards cannot be open
//      without rows, so the page's own "Waiting on BuySportsCards" line must show (no
//      `.or()`; RED until the page line stays up until the dialog opens, see step 1's
//      comment). Then the fetch opens Match Cards (two sources) and the dialog says
//      "Waiting on BuySportsCards..." while the hung lookups are held, its "(N of 26
//      done)" short by at least the three hung cards (axe runs on the dialog while it
//      shows). No wait line is left once the fetch is handed on. The fetch
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
import { bscLookupOutcome, expectAfterMarketplace, waitingOn } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  checklistFetchProgress,
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
/**
 * How long the fake holds the fetch's one catalogue read (`search/bulk-upload/results`): long enough
 * for the page's line (shown 1.5 s into a wait) to be seen and for axe to read the page in both
 * modes while the two-source progress line is up (NEO-640; the 429 spec holds its one-source page
 * line the same 15 s for the same reason), under the read's own 30 s timeout
 * (BSC_CHECKLIST_FETCH_TIMEOUT_MS), so it is an answer, never a failure to the gate. A fault hold,
 * not a spec budget: every wait after it still credits only the seconds the wait line is up.
 */
const HOLD_MS = 15_000;

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
    // The fake never answers the three stalled cards (its rules last 10 minutes at most, and teardown
    // drops them), and it holds the fetch's one catalogue read for HOLD_MS first (an answer, far under
    // that read's own 30 s timeout).
    await bscFake.setFaults([
      bscFault.slow(BSC_PATH.results, HOLD_MS, { times: 1, ttlS: 600 }),
      ...STALL_IDS.map((cardId) => bscFault.hangs(BSC_PATH.cardListing, { cardId, ttlS: 600 })),
    ]);
    await syncChecklistButton(page).click();
    // NEO-628 audit: the page's own line, deterministically. Match Cards opens on the fetch's first
    // streamed rows, and there are none while the catalogue read is held, so the dialog cannot be
    // open: the screen must say it is waiting on BSC itself (the line mounts 1.5 s into the wait).
    // RED until CardChecklist's page line stays up until the dialog actually opens: today it stands
    // down as soon as a two-source run starts (`pairingPhase` is "review" before the call goes out),
    // so nothing says "Waiting on BuySportsCards" until Match Cards mounts (NEO-624's 5.6 s of
    // silence on the phone run). The 429 spec proves the same line on a one-source fetch.
    await expect(
      waitingOn(page, "BuySportsCards"),
      "no Waiting on BuySportsCards line while the catalogue read is held and Match Cards is not open yet",
    ).toBeVisible();
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // NEO-640: a two-source run starts on its progress line, with its Cancel, and no dialog: this
    // held read is the one moment the state stands still long enough to read it whole (light and dark).
    await expect(checklistFetchProgress(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel checklist fetch" })).toBeVisible();
    await expectAccessible(page, { label: "Two-source checklist fetch on its progress line, BSC's read held" });
    await expect(checklistFetchProgress(page), "the held read ended before axe finished: raise HOLD_MS").toBeVisible();
    // BSC plus the uploaded checklist are two sources (NEO-496), and five cards have no row, so the fetch opens Match Cards; the
    // page's line stands down and the dialog carries the same line of its own (its `waitingSlot`),
    // shown 1.5 s after it mounts. The three hung cards hold the fetch for about ten seconds more (a
    // 5 s timeout, a pause, one retry), which outlasts that. So: the dialog (BSC's time credited by
    // the line above), then its line, with no `.or()`.
    const matchCards = matchCardsDialog(page);
    await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: "Match Cards opening on the Halifax fetch" });
    await expect(waitingOn(matchCards, "BuySportsCards")).toBeVisible();
    // And the dialog's count is short of the set by at least the three hung cards: the hang holds.
    const STILL_RESOLVING = new RegExp(`^Pair away — teams are still resolving in the background \\(([0-9]+) of ${CARDS} done\\)\\.`);
    // The sentence is shown and also said by a status beside it: any one of the two.
    const stillResolving = matchCards.getByText(STILL_RESOLVING).first();
    await expect(stillResolving).toBeVisible();
    const done = Number(STILL_RESOLVING.exec((await stillResolving.textContent()) ?? "")?.[1]);
    expect(done, "Match Cards counts the stalled cards as still resolving").toBeLessThanOrEqual(CARDS - STALLED);
    // The page with its own line is checked whole by the 429 spec (its owner); this state changes the dialog.
    await expectAccessible(page, { within: matchCards, label: "Match Cards waiting on BuySportsCards during a stall" });
    // NEO-496 (D10, NQ1): the helper finds the open dialog, waits for Confirm with
    // `expectAfterMarketplace` (7 s of ours plus every second the dialog's wait line is up), proves the
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
