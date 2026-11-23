// NEO-645 (R1, A17): a re-fetch of a set starts its names over. The walk's earlier answers are not
// carried; each name resolves again through the data on file now. Only an operator's "Not a
// player" ruling is kept (main's NEO-212 skips).
//
// Jason: "it should refetch all card data and use whatever player/team data exists now. We do
// not need to keep track of answers." The gate resets every name row of the set before it writes
// the fetch's facts (`tidyNames.resetForRefetch`; unit rule in convex/tidyNames.refetch.test.ts).
//
// The operator meets it like this:
//   1. First fetch, in the walk: #1's name is ruled "Not a player"; #2's name is added as a new
//      player (`Dal Rfa<token>`); #3 prints a different spelling (`Daul Rfa<token>`) and the
//      operator links it by hand to that player. #3 stays pink for its blank team, so it is the
//      one card left.
//   2. The same checklist is fetched again (Sync). The operator's link on #3 is gone as an answer:
//      the name is linked again by the data on file (#3's own saved card already links it, set
//      history, main's rule A), and the row says so with the purple note "Linked for you: another
//      card in this set is already linked to them". Had the answer been carried, the row would read
//      as the operator's own link, with no note.
//   3. #1's "Not a player" ruling is kept: the re-fetch asks nothing about it, so the pill and the
//      walk count only #3.
//
// Why no "asked again" (pink Player row) after the re-fetch: a card the walk linked keeps its
// link, and set history re-links the printed name from it (unit test "the operator's link is not
// carried"). The name is asked again only when nothing on file settles it (no card links it, or
// two cards link it to two players), which the walk cannot reach on one fetch.
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
const SET_HISTORY_NOTE = "Linked for you: another card in this set is already linked to them";

test(
  "Tidy Up — a re-fetch starts the names over: an answered name is linked again by the data on file, and only a Not a player ruling is kept",
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
    const historyNote = spellingRow.getByRole("note").filter({ hasText: SET_HISTORY_NOTE });

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
    // The operator's own link: answered, and no "Linked for you" note (nobody linked it for them).
    await expect(linkedRow).toBeVisible();
    await expect(historyNote).toHaveCount(0);
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
    expect(reopened, "#3 still has no team, so the walk opened again").toBe(true);
    await expect(header("3", SPELLING)).toBeVisible();
    // The link is the data's now, not the operator's: the set's own saved card links the name.
    await expect(linkedRow).toBeVisible();
    await expect(historyNote).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name linked again by a re-fetch" });

    // ── STEP 3: the Not a player ruling was kept, so only #3 needs anyone ──
    await expectCardsLeft(page, 1);
    await expect(walk.getByText(/^#1 · /), "#1's ruling was kept: the re-fetch asked nothing about it").toHaveCount(0);
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you, 1 to fix");
  },
);
