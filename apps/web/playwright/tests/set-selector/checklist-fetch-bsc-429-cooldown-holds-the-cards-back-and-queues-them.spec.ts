// NEO-552 (R1): when BuySportsCards pushes back with a 429 on the per-card team
// lookup of a checklist fetch, the fetch meets the cooldown at once: it lands inside
// the budget with no "Waiting on BuySportsCards" line, asks BSC for no further card,
// and after the save every card the lookup owed and NB's own rules did not settle
// waits in the background queue ("Still looking up teams for N cards. Nothing for you
// to do yet."), none of them put to the operator. A lookup that never answered is
// missing data, not a claim (invariant 8, NEO-639): it holds no pre-fill back, so the
// cards NB's own rules settle (a stored player with one team in [setYear-1, setYear])
// come up pre-filled and, saved with that team, are never queued.
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
// ask with another 429, and the count below would read the same either way. With the rule
// spent after the first wave, a card asked after the 429 is answered from its recording,
// becomes an answered card and drops the queued count below CARDS - PREFILLED (and shows
// "N need you"): that is how "asks BSC for no further card" is proved. The pre-fill does
// not blur it (NEO-639): an extra ask answered for one of the pre-filled cards would carry
// the listing's team, a name claim, so that card's chip would not be preselected and the
// pressed-chip asserts in step 2 fail; answered for any other card, it leaves the queue,
// and the count reads below CARDS - PREFILLED. It needs the set's card-listing answers
// recorded (the recorder run for this set covers all 32 cards); an extra ask for a card
// with no recording would be a failed lookup, queue like the rest, and show only as a
// miss in the fake's report. If the product's wave size changes, this spec goes red on
// the count by its number: update `WAVE` with it.
//
// NO PUBLISHER'S CHECKLIST (GUIDE, "Checklist first"). The reason to upload one is
// fewer BSC calls and smaller recordings. Here the point is the per-card lookup, which a
// checklist file would skip.
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
//   2. Every name is skipped, so the wizard reaches "Cards with no team" (no card has
//      a BSC team). Once the section's own status reads its loaded words ("Teams
//      suggested", not "Checking teams…"; Next is not held while it loads), exactly the
//      PREFILLED cards' chips are preselected, each by name: NB's rules, not BSC, filled
//      them, because a lookup that never answered holds nothing back (NEO-639).
//   3. After the save the checklist's status line names every card but the PREFILLED
//      ones as waiting in the queue, in the product's words, and the amber "N need you"
//      pill is absent: nothing is the operator's yet. The rule covers only the first
//      wave, so a card asked after the 429 would have been answered and the count would
//      read less than CARDS - PREFILLED: the count is the product's own stop. Axe runs on
//      the saved checklist with the status line showing.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Dayton Bombers ECHL"; approved by
// Jason on 2026-11-14, R7a): SOLE WRITER of that set
// (BSC only, 32 numbered cards, reached through the All Brands view); FRESH-ONLY (it
// commits the checklist), so a re-run on the same seed fails at "No cards in this
// checklist yet." by name, and so does CI's retry of a red that came after the commit:
// read the FIRST attempt's error (GUIDE Gotchas, "Fresh-only specs"). Every name is
// skipped: no player and no team is minted. The set has no set-level team (NEO-556) on
// purpose: one would settle every card and leave nothing to queue.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import { matchCardsDialog } from "../../support/published-checklist";
import { editCardButton } from "../../support/cards";
import { expectAfterMarketplace, waitingOn } from "../../support/marketplace-wait";
import { setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import { advanceToSave, confirmSaveButton, openOneMarketplaceSetBase, reviewWizard } from "../../support/wizard";

const SET = "Dayton Bombers ECHL";
/** The set's card count on BSC (SET-REGISTRY.md measurement). */
const CARDS = 32;
/**
 * The Teams step's lines NB's own rules pre-fill although no lookup answered (NEO-639): a
 * seed player the career rules settle (exactly one team covering [1994, 1995], or the
 * legend rule's one-team career in the set's league; teams-on-cards.ts, "The career
 * window"). #7 Kevin Brown, #9 and #P2 Sergei Kharin (one line), #16 Mike Murray, measured
 * on a fresh seed 2026-11-21. Chip name `<team> — <owner>`: a pre-filled chip carries no
 * years, and a player's cards share one line, owner `<name>, N cards`.
 */
const PREFILLED_LINES: ReadonlyArray<{ team: string; owner: string }> = [
  { team: "Los Angeles Kings", owner: "Kevin Brown" },
  { team: "Winnipeg Jets", owner: "Sergei Kharin, 2 cards" },
  { team: "Philadelphia Flyers", owner: "Mike Murray" },
];
/** The cards those lines cover (#7, #9, #P2, #16): saved with their team, so never queued. */
const PREFILLED = 4;
/** The team lookup's wave size (BSC_TEAM_LOOKUP_CONCURRENCY): the 429s cover exactly the first wave. */
const WAVE = 10;
/** Long enough that the window outlasts the spec: the lane must not get a turn before the assert. */
const RETRY_AFTER_S = 90;
/**
 * How long the fake holds the fetch's catalogue read: the line mounts 1.5 s into a wait, and it
 * must outlast a whole-page axe check (light and dark) taken while it shows. Under the read's own 30 s timeout
 * (BSC_CHECKLIST_FETCH_TIMEOUT_MS), so it is an answer, never a failure to the gate.
 */
const HOLD_MS = 15_000;

test(
  "Checklist fetch — a BSC 429 on the team lookup opens the cooldown: the fetch lands at once, only NB's own rules pre-fill a team, and every other card waits in the background queue (NEO-552, NEO-639)",
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
    const wizard = reviewWizard(page);
    await expect(wizard).toBeVisible();

    // ── 2. Every name skipped; the teams step pre-fills only what NB's own rules settle ──
    const skipRemaining = wizard.getByRole("button", { name: /Skip remaining names \([0-9]+\)/ });
    const next = wizard.getByRole("button", { name: "Next (Enter)", exact: true });
    await expect(skipRemaining.or(next).first()).toBeVisible();
    if (await skipRemaining.isVisible()) await skipRemaining.click();
    await expect(next).toBeVisible();
    await expect(wizard.getByText("Cards with no team", { exact: true })).toBeVisible();
    // Next is not held while the section loads its suggestions, so wait for its one status
    // (sr-only, TeamsOnCardsSection) to read its loaded words before reading or saving a line.
    await expect(
      wizard.getByRole("status").filter({ hasText: /^(Checking teams…|Teams suggested)$/ }),
      "the Teams section never finished loading its suggestions",
    ).toHaveText("Teams suggested");
    // The pre-filled lines, by name: a missing lookup held none of them back (NEO-639).
    for (const { team, owner } of PREFILLED_LINES) {
      await expect(
        wizard.getByRole("radio", { name: `${team} — ${owner}`, exact: true }),
        `${owner}'s line is not pre-filled with ${team}: the pre-fill changed (NEO-639)`,
      ).toBeChecked();
    }
    // And no other line: every other card stays on "Leave for later" (R2 pair with the above).
    await expect(
      wizard.getByRole("radio", { name: /^(?!Leave for later — |No team on this card — )/, checked: true }),
      `the pre-fill covers more or fewer than the ${PREFILLED_LINES.length} lines above`,
    ).toHaveCount(PREFILLED_LINES.length);
    await expectAccessible(page, { within: wizard, label: "Entity review wizard, Cards with no team after a BSC 429" });

    // ── 3. Save: every card but the pre-filled ones waits in the queue; none is the operator's ──
    await advanceToSave(page);
    await confirmSaveButton(page).click();
    await expect(page.getByText(new RegExp(`Saved ${CARDS} cards`))).toBeVisible();
    await expect(wizard).toBeHidden();
    // The set's cards are on screen, so what follows is read off a live checklist.
    await expect(editCardButton(page, "1")).toBeVisible();
    // The queue's own words (a status line; its number moves at most every 5 s, so the first value
    // after the save is the full count). CARDS - PREFILLED: the 429 ended the lookup before any card
    // was answered, and a card saved with its pre-filled team is never queued (NEO-639). The rule
    // was spent after the first wave, so a card asked afterwards would have been answered and this
    // count would be lower.
    const queued = CARDS - PREFILLED;
    await expect(
      page.getByRole("status").filter({ hasText: new RegExp(`^Still looking up teams for ${queued} cards\\. Nothing for you to do yet\\.`) }),
      `the status line does not say ${queued} cards wait (${CARDS} less the ${PREFILLED} pre-filled): ` +
        `lower means BSC was asked for a card after the 429 (the rule covers only the first ${WAVE} requests); ` +
        `higher means the pre-fill changed and a pre-filled card was queued`,
    ).toBeVisible();
    // Nothing is the operator's yet: the "N need you" pill is rendered only while some card needs them.
    await expect(page.getByRole("button", { name: /need[s]? you$/ })).toHaveCount(0);
    await expectAccessible(page, { label: "Dayton checklist saved, every card waiting in the background" });
  },
);
