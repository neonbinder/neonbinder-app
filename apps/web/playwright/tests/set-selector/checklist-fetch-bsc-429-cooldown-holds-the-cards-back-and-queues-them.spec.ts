// NEO-552 (R1): when BuySportsCards pushes back with a 429 on the per-card team
// lookup of a checklist fetch, the fetch meets the cooldown at once: it lands inside
// the budget with no "Waiting on BuySportsCards" line, asks BSC for no further card,
// guesses no team (invariant 8), and after the save every card the lookup owed waits
// in the background queue ("Still looking up teams for N cards."), none of them put to
// the operator for its team.
//
// HOW THE 429 IS MADE. BuySportsCards is the fake (services/fake-bsc), so a spec asks
// it to misbehave: `bscFake.setFaults` puts a 429 with a Retry-After on the first
// `WAVE` (10) `GET marketplace/card/:id/card-listing` requests for THIS worker's fake
// account (support/bscFake.ts), then the rule is spent and the fake answers as recorded.
// The lookup asks BSC in waves of 10 at once (BSC_TEAM_LOOKUP_CONCURRENCY,
// convex/adapters/buysportscards.ts), so the first wave is the 10 the rule covers. The
// product honours the Retry-After, opens its call gate and sends nothing more. Against the
// fake that gate is this worker's own (one per test user, keyed on its fake namespace,
// convex/bscCallGate.ts; NEO-628), so the spec runs in an ordinary shard beside the others
// and stops no other worker's BSC calls. The `bscFake` fixture clears the rules and this
// worker's gate when the test ends, red or green. It replaces the real-BSC 429 branches the
// live suite could only hit by luck.
//
// WHY THE RULE IS NOT UNLIMITED (audit, NEO-552). An unlimited 429 would answer an extra
// ask with another 429, and the count below would read 32 either way. With the rule spent
// after the first wave, a card asked after the 429 is answered from its recording, becomes
// an answered card and drops the queued count below 32 (and shows "N need you"): that is
// how "asks BSC for no further card" is proved. It needs the set's card-listing answers
// recorded (the recorder run for this set covers all 32 cards); an extra ask for a card
// with no recording would be a failed lookup, queue like the rest, and show only as a
// miss in the fake's report. If the product's wave size changes, this spec goes red on
// the count by its number: update `WAVE` with it.
//
// NO PUBLISHER'S CHECKLIST (GUIDE, "Checklist first"). The reason to upload one is
// fewer BSC calls and smaller recordings. Here the point is the per-card lookup, which a
// checklist file would skip.
//
// MEASURED ON THE WALK (NEO-639 merged into NEO-645, first run on a fresh seed, 2026-11-22): the
// same four cards main's Teams step pre-filled are filled at the save on the walk, and 28 wait.
// #7 Kevin Brown (Los Angeles Kings) and #9 Sergei Kharin (Winnipeg Jets) carry a team on the
// saved checklist, #P2 and #16 are the other two (below the rows on screen), and the status line
// reads "Still looking up teams for 28 cards.". Kharin and Murray are players the reference
// catalogue knows, not pending names, so the commit's own fill reaches them: nothing was lost
// against main. The claim, a lookup that never answered holds no pre-fill back (NEO-639 rule 8),
// is proved here by those cards and by convex/tidyTeamFillAgreement.test.ts.
//
// WHAT IT PROVES, IN ORDER:
//   0. The page's own "Waiting on BuySportsCards" line (CardChecklist's sync wait line)
//      shows while a BSC call is held: the spec holds the fetch's one catalogue read
//      (`bscFault.slow` on the results read, HOLD_MS, far under the read's 30 s timeout).
//      This is the suite's deterministic proof of the PAGE line (NEO-628 audit): the set
//      is BSC-only with no checklist, so the fetch is one-source and Match Cards never
//      opens, and nothing else can stand the line down. (The stall spec's fetch is
//      two-source, so its line is the one inside Match Cards.)
//   1. The fetch's "Kept all N cards from BSC" line lands within 7 s of our own time
//      (`expectAfterMarketplace`, which credits the held read), and once it has, no
//      "Waiting on BuySportsCards" line is up: a cooldown does not hold a call, it ends
//      the lookup.
//   2. The cards are saved straight away (one source, nothing to match; NEO-645:
//      "Saved 32 cards."); the Tidy Up walk opens after the save when a card needs a
//      person, and is closed at once with "Save for later (Esc)", which writes
//      nothing. No name is answered.
//   3. After the save the checklist's status line names every card the lookup still
//      owes as waiting in the queue, in the product's words: all of the set's cards
//      but the four NB filled at the save (NEO-645 Q1-A, below). The line is the count
//      alone: 22 cards need the operator for their player names, so the second sentence
//      ("Nothing for you to do yet.") is left off by design (card-attention.ts,
//      teamLookupStatusLine). No card is put to the operator for its team: no row's attention mark names a team reason ("team
//      name not yet linked", "no team on this card yet"). NEO-645: the amber "N need
//      you" pill is no longer the proof, because it also counts a card whose player
//      name NB does not know (pink whatever its team lookup is doing). The rule covers only the
//      first wave, so a card asked after the 429 would have been answered and the count
//      would read less than 28: the count is the product's own stop.
//
// THE SAVE'S FILL (NEO-645 Q1-A; NEO-639: a lookup that never ran is not a claim, so it
// holds nothing back). #7 Kevin Brown, #9 and #P2 Sergei Kharin and #16 Mike Murray are
// players the reference catalogue knows, each with one team in the card's window, so the save
// writes that team with a purple note and the card no longer waits on the lookup. It is NB's
// own rule, not a team taken from BSC, so it is not a guess from the 429'd lookup. Measured on
// the first run on the walk against this seed's reference catalogue (28 of 32 waiting). Axe
// runs on the saved checklist with the status line showing.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Dayton Bombers ECHL"; approved by
// Jason on 2026-11-14, R7a): SOLE WRITER of that set
// (BSC only, 32 numbered cards, reached through the All Brands view); FRESH-ONLY (it
// commits the checklist), so a re-run on the same seed fails at "No cards in this
// checklist yet." by name, and so does CI's retry of a red that came after the commit:
// read the FIRST attempt's error (GUIDE Gotchas, "Fresh-only specs"). No name is
// answered (the walk is closed with Save for later): no player and no team is minted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { matchCardsDialog } from "../../support/published-checklist";
import { editCardButton } from "../../support/cards";
import { expectAfterMarketplace, waitingOn } from "../../support/marketplace-wait";
import { openOneMarketplaceSetBase, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { saveForLater, settleWalkAfterCommit } from "../../support/tidy-walk";

const SET = "Dayton Bombers ECHL";
/** The set's card count on BSC (SET-REGISTRY.md measurement). */
const CARDS = 32;
/** The team lookup's wave size (BSC_TEAM_LOOKUP_CONCURRENCY): the 429s cover exactly the first wave. */
const WAVE = 10;
/**
 * The cards the save fills (header, "THE SAVE'S FILL"): they do not wait. #P2 and #16 sit below
 * the rows on screen, so only the first two are read off the checklist; the count covers all four.
 */
const FILLED_AT_SAVE = 4;
const FILLED_ON_SCREEN = [
  { number: "7", team: "Los Angeles Kings" },
  { number: "9", team: "Winnipeg Jets" },
] as const;
/** The cards the lookup still owes after the save. */
const WAITING = CARDS - FILLED_AT_SAVE;
/** Long enough that the window outlasts the spec: the lane must not get a turn before the assert. */
const RETRY_AFTER_S = 90;
/**
 * How long the fake holds the fetch's catalogue read: the line mounts 1.5 s into a wait, and it
 * must outlast a whole-page axe check (light and dark) taken while it shows. Under the read's own 30 s timeout
 * (BSC_CHECKLIST_FETCH_TIMEOUT_MS), so it is an answer, never a failure to the gate.
 */
const HOLD_MS = 15_000;
/** Set once Sync is pressed: from then on the fetch may have queued this user's cards on the BSC team lane. */
const run = { synced: false };

// NEO-644: pass or fail, the cards this spec left waiting come off the BSC team lane. The lane is
// one slot per deployment, so they would otherwise run after the spec ends, in front of every other
// shard's per-card team lookups. Only this test user's items are cancelled (`bscFake.clearTeamLane`);
// one already running finishes. Before the `bscFake` fixture's own teardown clears the faults and gate.
test.afterEach(async ({ bscFake }) => {
  if (!run.synced) return;
  run.synced = false;
  await bscFake.clearTeamLane();
});

test(
  "Checklist fetch — a BSC 429 on the team lookup opens the cooldown: the fetch lands at once, no team is guessed, and every card waits in the background queue (NEO-552)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, bscFake }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openOneMarketplaceSetBase(page, env, { set: SET });
    // The precondition for a FIRST fetch (fresh-only): a re-run fails here, by name.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 0. The catalogue read is held: the page's own wait line says so ──
    // ── 1. BSC pushes back on every team lookup; the fetch meets the cooldown ──
    await bscFake.setFaults([
      bscFault.slow(BSC_PATH.results, HOLD_MS, { times: 1, ttlS: 600 }),
      bscFault.tooManyRequests(BSC_PATH.cardListing, { retryAfterS: RETRY_AFTER_S, times: WAVE, ttlS: 600 }),
    ]);
    run.synced = true;
    await syncChecklistButton(page).click();
    // One source, so no Match Cards: the line is the page's (it mounts 1.5 s into the held read).
    await expect(waitingOn(page, "BuySportsCards")).toBeVisible();
    await expect(matchCardsDialog(page)).toHaveCount(0);
    // The owner of the whole-page check with the page's wait line up (the stall spec checks its dialog).
    await expectAccessible(page, { label: "Checklist fetch waiting on BuySportsCards (the page's line)" });
    // The read was still held when both passes finished, so they read the state named above.
    await expect(waitingOn(page, "BuySportsCards"), "the held read ended before axe finished: raise HOLD_MS").toBeVisible();
    await expectAfterMarketplace(page, page.getByText(new RegExp(`Kept all ${CARDS} cards from BSC`)), {
      platform: "BuySportsCards",
      what: "the fetch's kept-cards line",
    });
    // A cooldown holds no call, so nothing says the screen is waiting on BSC (paired with the
    // kept line above, which proves the page is alive).
    await expect(waitingOn(page, "BuySportsCards")).toHaveCount(0);

    // ── 2. One source, so the cards are saved straight away (NEO-645); the walk, if it opened, is
    // closed unanswered. Save for later writes nothing, so every name stays as the save left it.
    const saved = page.getByText(new RegExp(`Saved ${CARDS} cards`));
    if (await settleWalkAfterCommit(page, saved)) await saveForLater(page);

    // ── 3. Every card waits in the queue; none is the operator's ──
    // The set's cards are on screen, so what follows is read off a live checklist.
    await expect(editCardButton(page, "1")).toBeVisible();
    // The queue's own words (a status line; its number moves at most every 5 s, so the first value
    // after the save is the full count). Every card but the four the save filled: the 429 ended the
    // lookup before any card was answered. The rule was spent after the first wave, so a card asked
    // afterwards would have been answered and this count would be lower. The count alone: cards
    // need the operator for their player names, so "Nothing for you to do yet." is left off.
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`^Still looking up teams for ${WAITING} cards\\.$`) }),
      `the status line does not say ${WAITING} cards wait: BSC was asked for a card after the 429 (the rule covers only the first ${WAVE} requests), or the save's fill moved`,
    ).toBeVisible();
    // The filled cards on screen carry the team the save wrote (each row's team line).
    for (const { number, team } of FILLED_ON_SCREEN) {
      await expect(editCardButton(page, number)).toBeVisible();
      await expect(page.getByText(team, { exact: true }).filter({ visible: true }).first(), `#${number} carries ${team}`).toBeVisible();
    }
    // No card is the operator's for its TEAM: a waiting card never raises a team reason (NEO-645: the
    // "N need you" pill also counts unlinked player names, so it is not this proof). Read off the rows
    // on screen (#1's is, above); every card is in the same state, and the line above counts them all.
    await expect(
      page.getByRole("img", { name: /^Card .+ (needs attention|is worth a check): (.*; )?(team name not yet linked|no team on this card yet)(;|$)/ }),
      "a waiting card was put to the operator for its team",
    ).toHaveCount(0);
    await expectAccessible(page, { label: "Dayton checklist saved, every card waiting in the background" });
  },
);
