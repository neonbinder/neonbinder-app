// NEO-426 on the NEO-645 walk (R1): when BuySportsCards ANSWERS that a card has no team, and the
// card's only person is new and is added with a sport marked "No teams in this sport" as their
// home sport, the card is stamped No team the moment the person is added: its Team tile stops
// asking by itself. The one feature, as an operator meets it:
//   1. The worker's custom sport is marked teamless (its own row, never a shared sport).
//   2. The FIRST fetch of a real set leaves card 1 to BSC: the uploaded publisher's checklist
//      answers every other card ("No Team", the hosts have none) and has no row for card 1, so
//      BSC is asked about card 1 alone, and answers that it names no team. Match Cards' Confirm
//      saves the cards (NEO-645) and the walk opens (six names are new).
//   3. In the walk, on card 1: its person, Lauren Shehadi, is new, so both tiles are pink: the
//      Player tile, and the Team tile, which says the listing has no team (nothing can be stamped
//      while the person is unknown: she could play anywhere). The operator moves her to the
//      teamless sport (Baseball left off her sports) and adds her as new. That answer re-asks the
//      default, and the BSC answer lets it through: the Team tile turns to "No team on this card."
//      by itself, is no longer pink, and Save & next moves on.
//   4. Save for later; the committed card 1 has her and reads No Team, unbadged, and its card
//      editor shows "No Team for this card" pressed. A fresh load reads it back from the server,
//      where the stamp is decided.
// The default needs BOTH halves: had BSC's lookup failed (a cooldown, an unrecorded read), or had
// she stayed in Baseball, card 1's Team tile would stay pink (invariant 8: missing data is not a
// claim, but a teamless default needs the person's sport). The listed-team half (a team on the
// listing holds the default back) is `sport-no-teams-listing-team-holds-back-the-default`; the
// pasted checklist path and the quick-add path are
// `sport-no-teams-stamps-no-team-so-the-card-makes-no-walk-stop`.
// R2: every move is proved by the card that lands; each negative sits beside a positive.
//
// FIXTURE (SET-REGISTRY.md, "Topps Stars of MLB Network", approved by Jason 2026-11-09 and, for
// this spec, 2026-11-19): `Baseball › 2024 › Topps › Topps Stars of MLB Network › Base`, a real set
// the seed maps and leaves empty. NEO-645 (overnight decision 10): a fetch now commits, so the set
// is no longer a read-only fixture; this spec is its SOLE WRITER and FRESH-ONLY: the fetch
// commits the set's 10 cards and the walk creates Shehadi in the worker's custom sport; a second
// run on the same seed fails by name at "No cards in this checklist yet." (re-seed first; CI seeds
// each pass). Every other name is left for later (Skip and Save for later write nothing). Its file
// is the set's capture with card 1's row left out
// (`2024-topps-stars-of-mlb-network-base-shehadi-live`), so the spec makes ONE live per-card BSC
// read (GUIDE "Checklist first"); that card-listing is recorded in the fake. Shehadi is a recorded
// Baseball no-match, so her lookup is a fixture hit; moved to the custom sport she costs none (no
// Wikidata mapping). Nothing is minted. It is also the sole writer of the worker's custom sport's
// teamless flag for its length; the body turns it off and the afterEach does so on a second page
// if the body did not (R7).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import type { Page } from "@playwright/test";
import { columnOption, columnSelection, customSport, drillToBaseVariant, escapeRe, setBuilderReady } from "../../support/set-builder";
import { editCardButton } from "../../support/cards";
import { CHECKLISTS } from "../../support/published-checklist";
import { ensureSportHasTeams, openSportAttributes, pressTeamlessToggle, teamlessToggle } from "../../support/teamless-sport";
import { fetchChecklistToWizard } from "../../support/wizard";
import {
  createPlayerOnOpenRow,
  expectCardSettled,
  expectTidyWalkOpen,
  mustFixLine,
  pinkTile,
  saveAndNext,
  saveForLater,
  skipUntil,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

/** `fetchChecklistToWizard`'s default set (Topps Stars of MLB Network), with the file that leaves card 1 to BSC. */
const TARGET = {};
const FETCH = { checklist: CHECKLISTS.starsOfMlbNetworkShehadiLive, firstFetch: true };
/** Card 1's person: the one card the uploaded file leaves to BSC. */
const PERSON = "Lauren Shehadi";
const LIVE_CARD = "1";
/** The set's own sport, the one she would be born in. */
const SET_SPORT = "Baseball";

/** What the afterEach must undo, recorded before each write is made. */
const written: { sport?: string; sportFlagged: boolean } = { sportFlagged: false };

/** A checklist row is one run of text; the match stops at the next row's "#" (and "#1" never reads as "#10"). */
function rowSays(page: Page, number: string, text: string) {
  return page.getByText(new RegExp(`#${escapeRe(number)}(?![0-9])[^#]*${escapeRe(text)}`));
}

test.afterEach(async ({ page }, testInfo) => {
  if (!written.sportFlagged || !written.sport) return;
  const sport = written.sport;
  const bodyFailed = testInfo.status !== testInfo.expectedStatus;
  // A page of its own, so a red body's screenshot stays whole.
  const tidy = await page.context().newPage();
  try {
    await ensureSportHasTeams(tidy, sport);
    written.sportFlagged = false;
  } catch (error) {
    // The body's own error stays the one the report shows (a throw here would replace it).
    if (!bodyFailed) throw error;
    testInfo.annotations.push({ type: "cleanup-failed", description: `turn No teams in this sport off: ${String(error)}` });
  } finally {
    await tidy.close();
  }
});

test(
  "No teams in this sport — a BuySportsCards answer of no team, once the card's new person is added in a teamless sport, stamps the card No team on the walk and it stops asking (NEO-426, NEO-645)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const sport = customSport(env);
    written.sport = sport;
    written.sportFlagged = false;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ══ 1. THE SPORT: the worker's own custom sport, marked teamless ══
    await openSportAttributes(page, sport);
    // R2 precondition: the sport starts with teams (a leftover flag fails here, by name).
    await expect(teamlessToggle(page, false)).toBeVisible();
    written.sportFlagged = true; // from the press on, the afterEach owns turning it off
    await pressTeamlessToggle(page, false);
    // Navigation lives in the URL: Back is the Sports column with nothing picked, Forward the sport again.
    await page.goBack();
    await expect(columnOption(page, "Sports", SET_SPORT)).toBeVisible();
    await expect(columnSelection(page, "Sports", sport)).toHaveCount(0);
    await page.goForward();
    await expect(columnSelection(page, "Sports", sport)).toBeVisible();
    await expect(page.getByRole("heading", { name: `Attributes for ${sport} (Sport)` })).toBeVisible();

    // ══ 2. THE FIRST FETCH: every card answered by the file but card 1, which BSC answers ══
    // `fetchChecklistToWizard` asserts the set is still empty (fresh-only), then "Teams from your
    // checklist: 9 of N cards" (9 read off the file) inside Match Cards, whose Confirm saves the
    // cards; the walk opens on its own.
    await fetchChecklistToWizard(page, env, TARGET, FETCH);
    await expectTidyWalkOpen(page);
    const walk = tidyWalk(page);

    // ══ 3. CARD 1 IN THE WALK: BSC named no team; she is moved to the teamless sport and added ══
    // Card 1 sorts behind the loaded cards until its listing's team lookup has answered, so the
    // walk is skipped to it (Skip writes nothing).
    const header = walk.getByText(new RegExp(`^#${escapeRe(LIVE_CARD)} · `));
    await skipUntil(page, header, { maxCards: 12 });
    await expectCardSettled(page);
    const teamTile = tidyTile(page, "Team");
    const stampedLine = teamTile.getByText("No team on this card.", { exact: true });
    // R2 precondition: her name is pending, so nothing is stamped yet; the Team tile asks, and says
    // the listing named no team (the BSC answer the default will need).
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamTile.getByText(/^The listing has no team for this card\. /)).toBeVisible();
    await expect(teamTile.getByRole("button", { name: "No team on this card", exact: true })).toBeVisible();
    await expect(stampedLine).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toBeVisible();

    const playerRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${PERSON}`, exact: true });
    const inSetSport = playerRow.getByRole("button", { name: `Sport for this name: ${SET_SPORT}` });
    await expect(inSetSport).toBeVisible();
    await inSetSport.click();
    const chooser = playerRow.getByRole("listbox", { name: "Choose a sport" });
    await expect(chooser).toBeVisible();
    await chooser.getByRole("option", { name: sport, exact: true }).click();
    await expect(chooser).toBeHidden();
    await expect(playerRow.getByRole("button", { name: `Sport for this name: ${sport}` })).toBeVisible();
    // Her HOME sport is the teamless one, and Baseball is not added beside it.
    const alsoSetSport = playerRow.getByRole("checkbox", { name: `Also add ${SET_SPORT} to their sports` });
    await expect(alsoSetSport).toBeVisible();
    await expect(alsoSetSport).not.toBeChecked();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a new person moved to a teamless sport, the listing naming no team" });
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${PERSON}`);
    await expect(pinkTile(page, "Player")).toHaveCount(0);

    // Adding her re-asked the default, and BSC's no-team answer let it through: stamped by itself.
    await expect(stampedLine).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(teamTile.getByRole("button", { name: "No team on this card", exact: true })).toHaveCount(0);
    await expect(mustFixLine(page)).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a card stamped No team by its person's sport" });
    // Nothing on the card is pink any more, so Save & next moves on.
    await saveAndNext(page);
    await expect(header).toHaveCount(0);

    // ══ 4. THE CARD: her, No Team, unbadged ══
    await saveForLater(page);
    // The card list is found the way an operator finds one card, by its person in "Search cards".
    const search = page.getByRole("searchbox", { name: "Search cards" });
    await search.fill(PERSON);
    const card = editCardButton(page, LIVE_CARD);
    await expect(card).toBeVisible();
    await expect(rowSays(page, LIVE_CARD, "No Team")).toBeVisible();
    await expect(
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(LIVE_CARD)}(, .*)? needs attention: `) }),
    ).toHaveCount(0);
    await expectAccessible(page, { label: "Checklist with a card stamped No team by its person's teamless sport" });

    // Read back from the server, which decides the stamp: a fresh load of the set keeps it.
    // Drilled again rather than reloaded: with SportLots paused this Base is BSC-only and reads
    // unmapped, so its address reopens the Base picker, which the drill helper cancels the way
    // every read of such a set does.
    await drillToBaseVariant(page, env, { set: "Topps Stars of MLB Network" });
    await search.fill(PERSON);
    await expect(card).toBeVisible();
    await expect(rowSays(page, LIVE_CARD, "No Team")).toBeVisible();
    await card.click();
    const cardName = page.getByRole("textbox", { name: "Card name" });
    await expect(cardName).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove player ${PERSON}` })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove team / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "No Team for this card", pressed: true })).toBeVisible();
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(cardName).toBeHidden();

    // The sport asks for teams again.
    await openSportAttributes(page, sport);
    await pressTeamlessToggle(page, true);
    written.sportFlagged = false;
  },
);
