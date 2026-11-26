// NEO-645 (R1, A17), NEO-656: a re-fetch of a set starts its names over from the data on file. No
// answer is carried, an operator's "Not a player" ruling included: the card is the only record of
// its names, so a name the checklist still prints is asked again unless a card links it.
//
// Jason: "it should refetch all card data and use whatever player/team data exists now. We do
// not need to keep track of answers." And (NEO-656, rule 9): "Any dialogs or interim information
// needed to do that is simply for the purpose of building the set/card data and should never be
// stored." A "Not a player" answer only takes the name off that card's waiting list; nothing
// remembers it (plan B3a), so a re-fetch that prints the name again asks about it again.
//
// The operator meets it like this:
//   1. First fetch, in the walk: #1's name is ruled "Not a player"; #2's name is added as a new
//      player (`Dal Rfa<token>`); #3 prints a different spelling (`Daul Rfa<token>`) and the
//      operator links it by hand to that player. #3 stays pink for its blank team, so it is the
//      one card left.
//   2. The same checklist is fetched again (Sync). #1 prints `Chk Rfa<token>` again and nothing
//      remembers the ruling, so the walk opens on #1 asking about the name again (a pink Player
//      row offering Not a player). The operator rules it out again.
//   3. #3's name stays linked: the card's own saved link is data on file (set history, main's
//      rule A), so the name is not asked again. No "Linked for you" note says so (J1: dropped,
//      nothing records why NB linked it). #3 is still pink for its team, so it is the one card left.
//
// FIXTURE (SET-REGISTRY.md, the `trf`/`trg` prefixes; R7a): a per-attempt sport `trf<token>` with
// year 2026, brand Topps and ONE set `trg<token>` with `Insert` › `Base`, all hand-made with no
// marketplace id anywhere, so each Sync is checklist-only (a pasted three-row checklist is the
// one source: no Match Cards, no BSC) and nothing is looked up (a hand-made sport has no Wikidata
// mapping). Minted names are per attempt, so the spec is not fresh-only. Nothing is deleted: the
// sport, its rows, the three cards and the one player stand.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  createPlayerOnOpenRow,
  expectCardsLeft,
  needsYouPill,
  pinkTile,
  ruleOutOpenPlayerRows,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";
/** J1 (NEO-656): the purple "Linked for you: …" note is gone; no tile says why NB linked a name. */
const LINKED_FOR_YOU = /^Linked for you/;

test(
  "Tidy Up — a re-fetch starts the names over: a ruled-out name is asked again, and a name a card links stays linked",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `trf${T}`;
    const SET = `trg${T}`;
    const RULED_OUT = `Chk Rfa${T}`;
    const PLAYER = `Dal Rfa${T}`;
    const SPELLING = `Daul Rfa${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its three-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // #3's blank team cell claims nothing, so #3 has no team and stays pink.
    const checklist = `number,player,team\n1,${RULED_OUT},No Team\n2,${PLAYER},No Team\n3,${SPELLING},\n`;
    await usePastedChecklist(page, checklist, 3);
    await syncChecklistButton(page).click();

    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 3 cards\./).first());
    expect(opened, "three cards with unanswered names, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 3);
    const header = (number: string, who: string) => walk.getByText(`#${number} · ${who}`, { exact: true });
    const spellingRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${SPELLING}`, exact: true });
    const linkedRow = spellingRow.getByRole("button", { name: `Edit ${PLAYER}`, exact: true });
    const linkedForYou = tidyTile(page, "Player").getByRole("note").filter({ hasText: LINKED_FOR_YOU });
    const ruledOutRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${RULED_OUT}`, exact: true });

    // ── STEP 1: the first fetch's answers ──
    await expect(header("1", RULED_OUT)).toBeVisible();
    expect(await ruleOutOpenPlayerRows(page)).toEqual([RULED_OUT]);
    await saveAndNext(page);
    await expect(header("2", PLAYER)).toBeVisible();
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${PLAYER}`);
    await saveAndNext(page);
    await expect(header("3", SPELLING)).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await spellingRow.getByRole("button", { name: "Link to existing…", exact: true }).click();
    await spellingRow.getByRole("textbox", { name: "Search existing players" }).fill(PLAYER);
    await spellingRow.getByRole("option", { name: `Link to ${PLAYER}`, exact: true }).click();
    // The operator's own link: answered.
    await expect(linkedRow).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you, 1 to fix");

    // ── STEP 2: the same checklist, fetched again ──
    await usePastedChecklist(page, checklist, 3);
    await syncChecklistButton(page).click();
    // A re-sync of saved cards first offers what the checklist says differently (#1 has no player
    // now, #3 is linked to another spelling). Skip changes applies none of it and goes on to the
    // gate and the save, as a plain re-fetch does.
    const review = page.getByRole("dialog", { name: "Review Changes — Base" });
    await expect(review).toBeVisible();
    await expect(review.getByText("0 changes will be applied", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Skip reviewing changes and continue", exact: true }).click();
    await expect(review).toBeHidden();
    const reopened = await settleWalkAfterCommit(page, page.getByText(/Saved 3 cards\./).first());
    expect(reopened, "#1's name is waiting again and #3 still has no team, so the walk opened again").toBe(true);
    // #1 and #3 need someone; #2 (linked to the player it created, No Team) does not.
    await expectCardsLeft(page, 2);

    // ── STEP 3: nothing remembered the ruling, so #1's name is asked again ──
    await expect(header("1", RULED_OUT)).toBeVisible();
    await expect(pinkTile(page, "Player"), "#1's printed name waits on the operator again").toHaveCount(1);
    await expect(ruledOutRow.getByRole("button", { name: /^Not a player \(/ })).toBeVisible();
    await expect(ruledOutRow.getByText(/ is not a player\.$/), "no ruling was carried onto the re-fetched card").toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a ruled-out name asked again by a re-fetch" });
    expect(await ruleOutOpenPlayerRows(page)).toEqual([RULED_OUT]);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await saveAndNext(page);

    // ── STEP 4: the name a card links stays linked, with no note ──
    await expect(header("3", SPELLING)).toBeVisible();
    await expectCardsLeft(page, 1);
    // The set's own saved card links the name, so the re-fetch asks nothing about it.
    await expect(linkedRow).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(linkedForYou, "J1: no tile says why NB linked the name").toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name still linked after a re-fetch" });
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you, 1 to fix");
  },
);
