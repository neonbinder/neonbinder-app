// ONE FEATURE (R1, NEO-645 S2, decisions 25 and 38): a printed player name one letter off a
// player on file in the card's sport offers "Did you mean <name> (<team> <years>)?" on the walk's
// Player tile, ahead of "Add as new player", which drops from the green primary to an outline. It
// is never linked by itself: the press links it, like any pick. A name three letters off gets no
// suggestion, and its "Add as new player" stays the primary.
//
// The proofs, card by card:
//   #1 prints MISS (A's name with one letter dropped) at A's team:
//      - the row offers "Did you mean A (TEAM 2018–2021)?" before "Add as new player" in the row's
//        reading order; the suggestion is painted filled, "Add as new player" outline (a clear
//        fill);
//      - nothing is linked before the press: the row is still unanswered (it offers "Not a
//        player …", no Change player) and the Player tile is pink;
//      - "Link to existing…" opens its search with the printed name already typed; Cancel puts it
//        away and the suggestion is back;
//      - the press links A: Change player is up, the suggestion and the pink are gone;
//   #2 prints FAR (three letters off A's surname) at the same team: no "Did you mean" (the
//      negative, on the same locator that found #1's), and "Add as new player" is painted filled
//      (the positive beside it);
//   read back in Player Management: A's card list holds #1 alone.
// The counter-fixture that proves the spec can fail (A three letters off MISS, so no suggestion
// on #1) is recorded in the hand-off note, not kept as a file.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `dym`/`dys`/`Dyt` prefixes; R7a): a per-attempt
// sport `dym<token>` › 2020 › Topps › `dys<token>` › Insert › Base, all hand-made with no
// marketplace id, so the Sync is checklist-only (a pasted two-row checklist, no Match Cards, no
// BSC) and nothing is looked up (a hand-made sport has no Wikidata mapping). The team
// `Dyt<token>` is made in the career editor's New Team dialog; player A `Jackson Holliday<token>`
// is made in Player Management with one stint at it, 2018-2021 (covering the card year, so the
// link leaves no career gap). Not fresh-only: every name is per attempt. Nothing is deleted.
import type { Locator } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { escapeRe } from "../../support/cards";
import {
  addCareerStint,
  addPlayerByHand,
  createTeamInCareerEditor,
  expectPlayersLoaded,
  PLAYERS_MATCHES,
  playersCounter,
} from "../../support/players";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2020";
const STINT = { from: "2018", to: "2021" };
/** An outline NeonButton's fill (`--nb-fill: transparent`), as the browser computes it. */
const CLEAR_FILL = "rgba(0, 0, 0, 0)";

/** The button paints the outline look (a clear fill) or the filled one. Contract: a 7 s web-first assert. */
async function expectPaint(button: Locator, look: "outline" | "filled", what: string): Promise<void> {
  if (look === "outline") await expect(button, `${what} is painted outline`).toHaveCSS("background-color", CLEAR_FILL);
  else await expect(button, `${what} is painted filled`).not.toHaveCSS("background-color", CLEAR_FILL);
}

test(
  "Tidy Up — a name one letter off a player on file offers \"Did you mean …?\" ahead of an outlined Add as new player, links only when pressed, and a name three letters off gets none",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `dym${T}`;
    const SET = `dys${T}`;
    const TEAM = `Dyt${T}`;
    /** Player A, on file. */
    const A = `Jackson Holliday${T}`;
    /** One letter off A ("Holliday" -> "Holiday"): a near spelling. */
    const MISS = `Jackson Holiday${T}`;
    /** Three letters off A's surname ("Holliday" -> "Hulledoy"): past the two-edit limit. */
    const FAR = `Jackson Hulledoy${T}`;
    const DID_YOU_MEAN = `Did you mean ${A} (${TEAM} ${STINT.from}–${STINT.to})?`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE: player A in the sport, one stint at TEAM covering the card year ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, A, SPORT);
    await createTeamInCareerEditor(page, { search: TEAM });
    await addCareerStint(page, { search: TEAM, full: TEAM, ...STINT });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${A}`)).toBeVisible();

    // Back returns to the set builder where the drill left it (the navigation lives in the URL).
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── The checklist: #1 prints MISS at TEAM; #2 prints FAR at TEAM ──
    await usePastedChecklist(page, `number,player,team\n1,${MISS},${TEAM}\n2,${FAR},${TEAM}\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 2 cards\./).first());
    expect(opened, "two names nobody has open the walk").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    const anyDidYouMean = walk.getByRole("button", { name: /^Did you mean / });

    // ── STEP 1: #1 offers the near spelling, ahead of an outlined Add as new player ──
    await expect(walk.getByText(`#1 · ${MISS}`, { exact: true })).toBeVisible();
    const missRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${MISS}`, exact: true });
    await expect(missRow).toBeVisible();
    await expect(missRow.getByText("Checking for players by that name…")).toHaveCount(0);
    const suggestion = missRow.getByRole("button", { name: DID_YOU_MEAN, exact: true });
    const addNew = missRow.getByRole("button", { name: "Add as new player", exact: true });
    await expect(suggestion).toBeVisible();
    await expect(addNew).toBeVisible();
    // The one suggestion, read ahead of the create (the row's reading order).
    await expect(anyDidYouMean).toHaveCount(1);
    const order = await missRow.getByRole("button").allInnerTexts();
    expect(order.indexOf(DID_YOU_MEAN), `the row's buttons in order: ${order.join(" | ")}`).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(DID_YOU_MEAN), "Did you mean comes before Add as new player").toBeLessThan(order.indexOf("Add as new player"));
    await expectPaint(suggestion, "filled", "the suggestion");
    await expectPaint(addNew, "outline", "Add as new player beside a suggestion");

    // Nothing is linked before the press: the row is unanswered and the tile is pink.
    await expect(missRow.getByRole("button", { name: /^Not a player \(checklist, team card, stadium\)$/ })).toBeVisible();
    await expect(missRow.getByRole("button", { name: /^Change player/ })).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Player tile offering Did you mean" });

    // "Link to existing…" opens its search with the printed name typed; Cancel puts it away.
    const linkExisting = missRow.getByRole("button", { name: "Link to existing…", exact: true });
    await linkExisting.click();
    const search = missRow.getByRole("textbox", { name: "Search existing players", exact: true });
    await expect(search).toBeVisible();
    await expect(search).toHaveValue(MISS);
    await expect(search).toBeFocused();
    await missRow.getByRole("button", { name: "Cancel linking", exact: true }).click();
    await expect(search).toBeHidden();
    await expect(linkExisting).toBeFocused();
    await expect(suggestion).toBeVisible();

    // The press links A.
    await suggestion.click();
    await expect(missRow.getByRole("button", { name: /^Change player/ }), "the suggestion linked the name").toBeVisible();
    await expect(missRow.getByText(A, { exact: true })).toBeVisible();
    await expect(anyDidYouMean).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);

    // ── STEP 2: #2, three letters off, gets no suggestion ──
    await saveAndNext(page);
    await expect(walk.getByText(`#2 · ${FAR}`, { exact: true })).toBeVisible();
    await expectCardSettled(page);
    const farRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${FAR}`, exact: true });
    await expect(farRow.getByText("Checking for players by that name…")).toHaveCount(0);
    // Positive: the row is settled on "new", its create is the green primary.
    await expect(farRow.getByText(`“${FAR}” is new to NeonBinder.`, { exact: true })).toBeVisible();
    const farAddNew = farRow.getByRole("button", { name: "Add as new player", exact: true, disabled: false });
    await expect(farAddNew).toBeVisible();
    await expectPaint(farAddNew, "filled", "Add as new player with no suggestion");
    // Negative, on the locator that found #1's suggestion.
    await expect(anyDidYouMean).toHaveCount(0);
    // #2 is left for later: the walk writes nothing more.
    await saveForLater(page);

    // ── STEP 3: read back in Player Management: A's cards are #1 alone ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await page.getByRole("textbox", { name: "Filter players" }).fill(A);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`^${escapeRe(A)}( |$)`) }).click();
    await expect(page.getByRole("heading", { name: A, exact: true })).toBeVisible();
    const cards = page.getByRole("list", { name: `Cards for ${A}` }).getByRole("listitem");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("#1");
    await expect(cards).toContainText(SET);
  },
);
