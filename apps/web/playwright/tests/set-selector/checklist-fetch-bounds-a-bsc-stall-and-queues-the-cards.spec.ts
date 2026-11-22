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
//   2. Confirm saves the cards (NEO-645: "Saved 26 cards."); the Tidy Up walk opens
//      after the save when a card needs a person, and is closed at once with "Save
//      for later (Esc)", which writes nothing. No name is answered.
//   (A stalled card reaches the operator from the background lane only after
//   about 6 minutes, so the spec asserts the queued state, never the give-up.)
//   3. After the save the split is on the checklist, card by card. NEO-645: the
//      "N need you" pill counts every card with anything pink, and a card whose
//      player name NB does not know is pink for that name whether or not its team
//      is still being looked up, so the pill is no longer a count of team answers
//      (25 on the first run: a stalled card whose player NB knows is the only one
//      left out). The team side is what this spec is about, so it is read off each
//      row's attention mark ("Card <n>, <name> needs attention: <reasons>"):
//      - the 3 stalled cards (#1-#3) wait in the queue: their rows are on screen
//        and no mark of theirs names a team reason ("team name not yet linked",
//        "no team on this card yet");
//      - an answered card is the operator's for its team: #4 (from the checklist)
//        names the team reason;
//      - the checklist says so in its own words, "Still looking up teams for 3
//        cards. Nothing for you to do yet." (a status line; its number moves at
//        most every 5 s, so the first value after the save is the full three).
//      M on that line is also the proof of the two live answers: had either met a
//      BSC 429 or an open cooldown it would wait in the queue too, and the line
//      would say 4 (or 5) cards. NEO-489 (Jason, 2026-11-11): that is a pass, not
//      a red. The spec reads M off the line (3 to 5) and annotates which branch ran
//      (`bsc-lookup`). A missing line is the only red. Axe runs on the saved
//      checklist with the status line showing.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Halifax Mooseheads QMJHL",
// one of the registered spares, needs Jason's approval to take): SOLE WRITER of
// that set (BSC only, 26 cards, reached through the All Brands view); FRESH-ONLY (it commits the
// checklist), so a re-run on the same seed fails at "No cards in this checklist
// yet." by name, and so does CI's retry of a red that came after the commit: read the
// FIRST attempt's error (GUIDE Gotchas, "Fresh-only specs"). No name is answered (the
// walk is closed with Save for later): no player and no team is minted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { cardAttentionMark, editCardButton } from "../../support/cards";
import { bscLookupOutcome, expectAfterMarketplace, waitingOn } from "../../support/marketplace-wait";
import {
  CHECKLISTS,
  confirmChecklistMatchCards,
  matchCardsDialog,
  usePublishersChecklist,
} from "../../support/published-checklist";
import { openOneMarketplaceSetBase, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { saveForLater, settleWalkAfterCommit } from "../../support/tidy-walk";

const SET = "Halifax Mooseheads QMJHL";
/** The set's card count on BSC. */
const CARDS = 26;
/** The BSC card ids the fake never answers (cards #1-#3, the ids in the header). */
const STALL_IDS = ["96f9a87adeb7d02c275e117ef10d569c", "9dba15716322d30fc94e4bd96034e4bf", "adf14c41cda48abecf2b69b0faa399ae"] as const;
/** How many of them the fake swallows. */
const STALLED = STALL_IDS.length;
/**
 * How long the fake holds the fetch's one catalogue read (`search/bulk-upload/results`): long enough
 * for the page's line (shown 1.5 s into a wait) to be seen on a slow client, under the read's own
 * 30 s timeout (BSC_CHECKLIST_FETCH_TIMEOUT_MS), so it is an answer, never a failure to the gate.
 */
const HOLD_MS = 6_000;
/** The attention reasons that put a card's TEAM to the operator (`TIDY_ATTENTION_LABELS`). */
const TEAM_REASON = "team name not yet linked|no team on this card yet";

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
    // BSC plus the uploaded checklist are two sources (NEO-496), so the fetch opens Match Cards; the
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

    // ── 2. Confirm saved the cards (NEO-645); the walk, if it opened, is closed unanswered ──
    // Save for later writes nothing, so every name stays as the save left it.
    const saved = page.getByText(new RegExp(`Saved ${CARDS} cards`));
    if (await settleWalkAfterCommit(page, saved)) await saveForLater(page);

    // ── 3. The answered cards are the operator's, the three unanswered wait in the background ──
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
    // or its cooldown is open, so M is 3 (both answered) up to 5 (neither).
    let queued = 0;
    await expect(async () => {
      queued = Number((((await lookupStatus.textContent({ timeout: 1_000 })) ?? "").match(/for ([0-9]+) cards?/) ?? [])[1]);
      expect(queued, "the stalled cards plus at most the two live ones wait in the queue").toBeGreaterThanOrEqual(STALLED);
      expect(queued, "the stalled cards plus at most the two live ones wait in the queue").toBeLessThanOrEqual(STALLED + 2);
    }).toPass({ timeout: 7_000 });
    // NEO-645: the team side, card by card (the pill also counts unlinked player names; see the
    // header). A stalled card waits: its row is up (positive) and no mark of its names a team reason.
    // A stalled card gives up only after about 6 minutes, so this holds for the rest of the spec.
    for (const n of ["1", "2", "3"]) {
      await expect(editCardButton(page, n)).toBeVisible();
      await expect(cardAttentionMark(page, n, TEAM_REASON), `stalled card #${n} was put to the operator for its team`).toHaveCount(0);
    }
    // An answered card's team is the operator's: #4, whose team came from the checklist, says so.
    await expect(cardAttentionMark(page, "4", TEAM_REASON), "answered card #4 does not ask for its team").toBeVisible();
    bscLookupOutcome(queued === STALLED ? "answered" : "cooldown", `Halifax #24, #25 (${queued} cards waiting)`);
    await expectAccessible(page, { label: "Halifax checklist saved, the unanswered cards waiting in the background" });
  },
);
