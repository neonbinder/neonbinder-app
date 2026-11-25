// NEO-656 (R1): in the Tidy Up walk, an answer to a printed name links the OPEN card only, and
// "Apply to all cards printing “<name>”" then links every other card still waiting on that name;
// a card left with nothing to fix or check drops out of the walk.
//
// The operator meets it like this:
//   1. The name's row on the first card says which cards print it ("Printed on #1, #2, #3").
//   2. "Add as new player" links #1 and nothing else (Jason, NEO-656: "We should not be keeping
//      answers to anything"; the card is the record): #1 drops out, #2 and #3 still wait, so the
//      walk's "N cards left" falls by one.
//   3. The answered row offers "Apply to all cards printing “<name>”"; pressed, it says "Linked 2
//      more cards." and #2 (nothing else on it) drops out too.
//   4. Save & next skips the emptied card (#2) and opens the next card still flagged (#3), where
//      the name already reads answered (its Edit is up) and only the card's own problem (no team)
//      is left pink.
//   5. The browser's Back walks back to #1; Save for later closes the walk, and the checklist's
//      pill counts the two cards still flagged.
//
// Flag colour is live (Jason, NEO-656: "it should read real data and display pink/blue as
// appropriate depending on the current state of the data"): #1 and #2 are No Team, so a new
// player leaves no career gap and nothing blue. #3 stays: its team cell is blank, so it has no
// team and no No-team stamp (pink). #4 prints another name.
//
// FIXTURE (SET-REGISTRY.md, the `tna`/`tnb` prefixes; R7a): a per-attempt sport `tna<token>`
// with year 2026, brand Topps and ONE set `tnb<token>` with `Insert` › `Base`, all hand-made
// with no marketplace id anywhere, so the Sync is checklist-only (a pasted four-row checklist
// is the one source: no Match Cards, no BSC) and nothing is looked up (a hand-made sport has
// no Wikidata mapping). Minted names are per attempt, so the spec is not fresh-only. Nothing
// is deleted: the sport, its rows, its four cards and the one new player stand.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  applyNameToAll,
  createPlayerOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  needsYouPill,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";

test(
  "Tidy Up — an answer links the open card only, Apply to all cards printing the name links every card still waiting on it, and a card with nothing left drops out of the walk",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `tna${T}`;
    const SET = `tnb${T}`;
    const SHARED = `Rea Tna${T}`;
    const OTHER = `Oth Tna${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its four-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // "No Team" is a claim of none (no pink); #3's blank cell claims nothing, so #3 has no team.
    const checklist =
      `number,player,team\n` +
      `1,${SHARED},No Team\n2,${SHARED},No Team\n3,${SHARED},\n4,${OTHER},No Team\n`;
    await usePastedChecklist(page, checklist, 4);
    await syncChecklistButton(page).click();

    // ── The commit saves the four cards, and the walk opens on its own ──
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 4 cards\./).first());
    expect(opened, "four cards with unanswered names, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 4);

    // The card header reads "#<number> · <who>".
    const header = (number: string, who: string) => walk.getByText(`#${number} · ${who}`, { exact: true });
    const sharedRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${SHARED}`, exact: true });

    // ── STEP 1: card #1 asks about the name, and says which cards print it ──
    await expect(header("1", SHARED)).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(sharedRow.getByText("Printed on #1, #2, #3", { exact: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name printed on three cards" });

    // ── STEP 2: the answer links the open card, and only it ──
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${SHARED}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(sharedRow.getByRole("button", { name: `Edit ${SHARED}`, exact: true })).toBeVisible();
    // #1 has nothing left and drops out; #2, #3 and #4 still wait (an answer that reached every
    // card that prints the name would leave two).
    await expectCardsLeft(page, 3);
    // The answered name says nothing about which cards print it any more.
    await expect(sharedRow.getByText(/^Printed on /)).toHaveCount(0);

    // ── STEP 3: Apply to all reaches the two cards still waiting on the name ──
    expect(await applyNameToAll(page, "Player", SHARED)).toBe("Linked 2 more cards.");
    // #2 has nothing left and drops out; #3 (no team) and #4 (another name) stay.
    await expectCardsLeft(page, 2);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, the shared name applied to every card" });

    // ── STEP 4: Save & next skips the emptied card ──
    await saveAndNext(page);
    await expect(header("3", SHARED)).toBeVisible();
    await expect(walk.getByText(/^#2 · /), "#2 was emptied by the answer, so the walk never shows it").toHaveCount(0);
    // #1 is behind us with nothing on it; #3 and #4 are left.
    await expectCardsLeft(page, 2);
    // Apply to all reached #3: its row reads answered, and only its own problem is pink.
    await expect(sharedRow.getByRole("button", { name: `Edit ${SHARED}`, exact: true })).toBeVisible();
    await expect(sharedRow.getByRole("button", { name: /^Not a player / })).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a card the answer reached" });

    // ── STEP 5: Back walks back to #1, its answer still on it ──
    await page.goBack();
    await expect(header("1", SHARED)).toBeVisible();
    await expect(header("3", SHARED)).toHaveCount(0);
    await expectCardSettled(page);
    await expect(sharedRow.getByRole("button", { name: `Edit ${SHARED}`, exact: true })).toBeVisible();

    // ── STEP 6: Save for later; the checklist counts the two cards still flagged, both pink (#3 no
    // team, #4 its unanswered name) ──
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("2 need you, 2 to fix");
  },
);
