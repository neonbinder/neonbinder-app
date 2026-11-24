// Origin: .maestro/flows/set-selector/checklist-one-marketplace-skips-match-dialog.yaml (Maestro suite retired in NEO-341; see git history)
// A set with exactly ONE marketplace attached (BSC; SportLots carries no
// 1995 Roanoke Express ECHL base) and the publisher's checklist: BSC and the
// checklist are two sources (NEO-496, D10/NQ1); the run starts on the progress line and
// Match Cards opens because the card the checklist leaves out needs the operator
// (NEO-640: a run with every card Matched at 100% would skip it). That card is BSC's alone and is kept, so
// every fetched card is saved. The committed set lists them as "BSC only" and a
// card added by hand titles itself from the set, not from "Unknown"/"All Brands".
// (Renamed from checklist-one-marketplace-skips-match-dialog in NEO-496: with a
// checklist in play the dialog is no longer skipped.)
//
// NEO-645: Match Cards' Confirm SAVES the cards, and the Tidy Up walk opens on them (one card
// at a time, tiles that save as they are answered). NEO-335 / NEO-518 / NEO-569 ride this
// fixture (the suite's one set where every card arrives with a team name nobody links, and a
// real BSC-linked fetch + commit): on the walk, LIVE_PLAYER is created on his own card with two
// career stints; one card is answered "No team on this card"; another gets a team nobody
// offered, after the "Other team…" search proves it ranks by the set's league and year; the
// "N need you" count is final at "Saved"; the one team written is read back off the cards in the
// drawer; and a re-sync re-asks none of the answered cards. LAST (a known gap goes last in a
// fresh-only spec, so everything above is proved first): LIVE_PLAYER's no-team card pre-selects
// the career team the set's leagues rank first.
//
// NEO-645, every card has a name: every card here is NNO and named for its player, so their
// names (and titles) are the player's. The one card with no player is the one added by hand
// with a number alone: stored as NB's "Card #<number>", which never goes into its title; the
// walk asks it for a name on a pink "Card name" tile (STEP 10b), and the name given is stored and
// put in its title ahead of the number (read back at the end).
//
// WRITES BEYOND THE CARDS, deliberately: ONE player (Chris Pollack, below), his two stints, and
// TWO teams: the career club, a real one-word club from support/recorded-names.ts (NEO-413: a
// Hockey no-match the catalogue does not hold), and `RXO<token>T`, a single search token per
// attempt. RXO ends in a LETTER so it cannot be a prefix of another attempt's longer token
// (Convex search treats the last term as a prefix, which would turn "No matches" into a match).
// Both are created BEFORE the fetch, in the empty checklist's add-card form (its New team dialog,
// no league; the form is cancelled, no card is added). The walk's own "+ New team" would SAVE the
// team on the card it opens on (a click on a team saves it), and the club must exist without being
// on LIVE_PLAYER's card, so his Team tile can still pre-select the league-ranked career team. "Roanoke Express", the team
// every card prints, is answered "Not a team" once for the checklist (the old review's skip of
// its New Team step), which reaches every card that prints it. All of it is global; the same
// trade checklist-wizard-career-team-commits makes.
//
// ONE LIVE BSC LOOKUP PER SYNC, ON PURPOSE (NEO-489). Both syncs upload `roanokeExpress1995OneLive`
// first: the publisher's checklist for 24 of the 25 cards, Chris Pollack's row LEFT OUT, so BSC is
// asked about his card alone. The fake BSC answers it (it does not 429 on its own); which team it
// named, if any, is annotated (`bsc-lookup`), and every later assert is the same either way.
//
// NEO-569: before the checklist is fetched, NCAA is added to the Base row's League list (it starts
// with the sport's league, the NHL). LIVE_PLAYER then gets TWO career stints covering the set's
// year, the created club (no league: nothing ranks it) and Wisconsin Badgers, an NCAA team of the
// reference catalogue. With the NCAA in the set's leagues the Badgers rank first and are
// PRE-SELECTED on his no-team card; the club, same years, is offered and not selected.
//
// NEEDS A RUN (NEO-639 merged into NEO-645). Main made the FIRST sync's lookup fail on purpose
// (`bscFake.setFaults([bscFault.answersUnavailable(BSC_PATH.cardListing)])` before the fetch,
// `bscFake.clear()` before the re-sync) to prove a lookup that never answered holds no pre-fill
// back. That is not folded in here: on the walk a card whose lookup failed waits for the lookup
// (it is not a stop, `isAwaitingTeamLookup`), so STEP 6's pink Team tile for LIVE_PLAYER's card
// and the `bscLookupOutcome("answered")` annotation would not read the same. The claim is proved
// on the walk by checklist-fetch-bsc-429-cooldown-... (#7 filled from a 429'd lookup) and by
// tidyTeamFillAgreement.test.ts; what is added here is the years on the unselected chip (STEP 11).
//
// Sole writer of the Roanoke Express ECHL set; fresh-only (it commits the checklist). Re-seed
// before re-running.
import type { Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  columnHeading,
  columnOption,
  columnSearch,
  columnSelection,
  drillToColdManufacturer,
  escapeRe,
  expectAfterBscSync,
  openAttributesPanel,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { createTeamInCardForm, editCardButton } from "../../support/cards";
import { bscLookupOutcome, expectAfterMarketplace, expectStepWithSportLots } from "../../support/marketplace-wait";
import { recordedNoMatchName } from "../../support/recorded-names";
import {
  CHECKLISTS,
  cancelCardFetchButton,
  checklistFetchProgress,
  expectTeamsFromChecklist,
  matchCardsDialog,
  opensMatchCards,
  settleChecklistFetch,
  usePublishersChecklist,
} from "../../support/published-checklist";
import {
  createPlayerOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  skipCard,
  skipUntil,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";

const SET = "Roanoke Express ECHL";
const YEAR = "1995";
/**
 * The one card left out of the uploaded checklist (its row is not in
 * `roanokeExpress1995OneLive`), so BSC is asked about it live. A Hockey no-match in the
 * enrichment recording that the catalogue does not hold, so his row offers the plain "Add as
 * new player" (never a promoted "Link to" a namesake).
 */
const LIVE_PLAYER = "Chris Pollack";
/** An NCAA hockey team of the reference catalogue ("Wisconsin" + "Badgers"), his second career stint. */
const COLLEGE_TEAM = "Wisconsin Badgers";
/** NEO-645: the name given, on the walk's "Card name" tile, to the hand-added card (STEP 10b). */
const HAND_CARD_NAME = "Team Card";
/**
 * The pill's whole name: "1 needs you, 1 to fix" / "N need you, N to fix". On this fixture every
 * counted card is pink at every read: until its name is answered it is a player-name item, and
 * its printed team is a team-name item until "Not a team", then "no team" until a team is saved.
 * So the to-fix count is always the whole count.
 */
function needYou(n: number): string {
  return `${n === 1 ? "1 needs you" : `${n} need you`}, ${n} to fix`;
}

/** LIVE_PLAYER's name row on the open card's Player tile (answered or not). */
function livePlayerRow(page: Page) {
  return tidyTile(page, "Player").getByRole("group", { name: `Player ${LIVE_PLAYER}`, exact: true });
}

/** The open card's Team tile control that answers a card with no team. */
function noTeamOnCard(page: Page) {
  return tidyTile(page, "Team").getByRole("button", { name: "No team on this card", exact: true });
}

/** A team chip on the open card's Team tile, by the team's name (a chip may add " · <years / played here>"). */
function teamChip(page: Page, name: string) {
  return tidyTile(page, "Team").getByRole("button", { name: new RegExp(`^${escapeRe(name)}( · .*)?$`) });
}

/**
 * The open card's printed team names, each answered "Not a team" if nobody has yet (the old
 * review's skip of the name's New Team step). An answer is the checklist's: it reaches every card
 * that prints the name. Contract: ENTRY a settled card. EXIT no printed team name waits and the
 * Team tile asks for a team ("No team on this card" is up). Returns the names THIS call answered.
 */
async function releasePrintedTeam(page: Page): Promise<string[]> {
  await expectCardSettled(page);
  const tile = tidyTile(page, "Team");
  const notATeam = /^Not a team( .+)?$/;
  const open = tile.getByRole("group", { name: /^Team / }).filter({ has: page.getByRole("button", { name: notATeam }) });
  await expect(tile.getByText("Checking for teams by that name…")).toHaveCount(0);
  await expect(open.or(noTeamOnCard(page)).first(), "the Team tile asks about a printed team or for a team").toBeVisible();
  const answered: string[] = [];
  for (let i = 0; i < 3 && (await open.count()) > 0; i++) {
    const rowName = (await open.first().getAttribute("aria-label")) ?? "";
    await open.first().getByRole("button", { name: notATeam }).click();
    await expect(tile.getByRole("group", { name: rowName, exact: true }).getByRole("button", { name: notATeam })).toHaveCount(0);
    answered.push(rowName.replace(/^Team /, ""));
  }
  await expect(open).toHaveCount(0);
  await expect(noTeamOnCard(page), "with the printed names ruled out, the card asks for a team").toBeVisible();
  return answered;
}

/** The open card's face: ONE img named "Card #NNO, <who>[, <teams>]" (every number here is NNO). */
function cardFace(page: Page) {
  return tidyWalk(page).getByRole("img", { name: /^Card #/ });
}

/** The open card's whole face name, which tells two NNO cards apart. */
async function openCardFace(page: Page): Promise<string> {
  const face = (await cardFace(page).getAttribute("aria-label")) ?? "";
  expect(face, "the open card's face is named").toMatch(/^Card #NNO, /);
  return face;
}

/** The open card's name: the face's second part ("Card #NNO, Paul Croteau" -> "Paul Croteau"). */
async function openCardName(page: Page): Promise<string> {
  return (await openCardFace(page)).split(", ")[1] ?? "";
}

/** The checklist row's attention mark of the NNO card named `name` (every card here is NNO). */
function markOf(page: Page, name: string) {
  return page.getByRole("img", { name: new RegExp(`^Card NNO, ${escapeRe(name)} (needs attention|is worth a check): `) });
}

/** The team reasons a mark can name (CardAttentionBadge's reasons). */
const TEAM_REASON = /team/i;

/**
 * Press the drawer's "Next card" until a card with a team chip is on screen.
 * Each press is proved to have MOVED the drawer (the Card name field changes)
 * before the chip is looked for, so a press that did not land cannot make the
 * walk skip a teamed card. `maxCards` is a runaway guard. Returns how many
 * chipless cards it stood on (the one it started on included).
 */
async function nextCardUntilTeamChip(page: Page, maxCards = 30): Promise<number> {
  const chip = page.getByRole("button", { name: /^Remove team / });
  const cardName = page.getByRole("textbox", { name: "Card name" });
  const next = page.getByRole("button", { name: "Next card" });
  let passed = 0;
  for (let i = 0; i < maxCards; i++) {
    if (await chip.first().isVisible()) return passed;
    passed++;
    const before = await cardName.inputValue();
    await next.click();
    await expect(cardName).not.toHaveValue(before);
  }
  await expect(chip.first(), "no further card carries a team chip").toBeVisible();
  return passed;
}

/**
 * From the card the drawer is on, press "Next card" to the end of the checklist and prove
 * every card it lands on carries NO team chip. Each landing is proved by the Card name field
 * changing and the picker's "Add team" button being on screen (the positive the empty chip
 * list is read against). Returns how many cards it landed on. `maxCards` is a runaway guard.
 */
async function expectNoTeamChipsToTheEnd(page: Page, maxCards = 40): Promise<number> {
  const dialog = page.getByRole("dialog");
  const chip = dialog.getByRole("button", { name: /^Remove team / });
  const addTeam = dialog.getByRole("button", { name: "Add team", exact: true });
  const cardName = dialog.getByRole("textbox", { name: "Card name" });
  const next = dialog.getByRole("button", { name: "Next card" });
  let landed = 0;
  while (await next.isEnabled()) {
    expect(landed, "the drawer never reached the end of the checklist").toBeLessThan(maxCards);
    const before = await cardName.inputValue();
    await next.click();
    await expect(cardName).not.toHaveValue(before);
    await expect(addTeam).toBeVisible();
    await expect(chip).toHaveCount(0);
    landed++;
  }
  return landed;
}

test(
  "Checklist — a set with exactly ONE marketplace attached and its publisher's checklist starts on the progress line and opens Match Cards for the card the checklist leaves out, keeps it, and saves every fetched card",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // All Brands, so the set is reachable under Unknown.
    await drillToColdManufacturer(page, env, { sport: "Hockey", year: YEAR, manufacturer: "All Brands" });
    await expect(columnHeading(page, "Sets")).toBeVisible({ timeout: 15_000 });
    await columnSearch(page, "Sets").fill(SET);
    await columnOption(page, "Sets", SET).click();
    await expect(columnHeading(page, "Variant Types")).toBeVisible({ timeout: 20_000 });
    await expect(columnSelection(page, "Manufacturers", "Unknown")).toBeVisible();
    // A set with ONE marketplace attached syncs its variant types from BSC alone, under the
    // column's wait line (measured 1.3 s at most on the #487 merge-group run (GUIDE)), live or paused.
    await expectAfterBscSync(page, columnOption(page, "Variant Types", "Base"), "Variant Types row Base");

    // The picker opens for the unmapped base; BSC offers it, SportLots does not carry it.
    await columnOption(page, "Variant Types", "Base").click();
    const picker = page.getByRole("dialog", { name: "Select Base Set" });
    await expect(picker).toBeVisible();
    // The picker still asks SportLots for a candidate (60 s while it is live); paused, BSC's
    // candidates alone under the picker's wait line (measured 0.8 s on the #487 merge-group run (GUIDE)).
    await expectStepWithSportLots(page, picker.getByRole("button", { name: "Confirm Base Set" }), env, {
      liveMs: 60_000,
      what: "the Base picker's candidates",
    });
    await expect(picker.getByRole("option", { name: /^BSC base candidate: / }).first()).toBeVisible();
    const slCandidates = picker.getByRole("option", { name: /^SportLots base candidate: / });
    if (!env.SL_PAUSED) {
      await expect(slCandidates.first()).toBeVisible();
    } else {
      await expect(picker.getByText(/^SportLots wasn't asked: /)).toBeVisible();
      await expect(slCandidates).toHaveCount(0);
    }
    await expectAccessible(page, { within: picker, label: "Select Base Set picker, one marketplace offers a base" });

    // Cancel: BSC alone stays attached (no Base mapping).
    await picker.getByRole("button", { name: "Cancel" }).click();
    const cancelled = page.getByText(/Base mapping cancelled/);
    await expect(cancelled).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(cancelled).toBeHidden();
    await expect(page.getByRole("button", { name: "Map Base Set" })).toBeVisible();

    // NEO-569: NCAA joins the Base row's League list before any card exists (a no-team card's
    // career chips are ranked by the leagues of the row the cards save under).
    await openAttributesPanel(page);
    const baseLeagues = page
      .getByRole("region", { name: "Set attributes panel" })
      .getByRole("group", { name: "League", exact: true });
    const addLeague = baseLeagues.getByRole("combobox", { name: "Add league" });
    await addLeague.click();
    await addLeague.fill("NCAA");
    await page.getByRole("listbox", { name: "Add league suggestions" }).getByRole("option", { name: /^NCAA/ }).click();
    await expect(page.getByText("Saved League").first()).toBeVisible();
    await expect(baseLeagues.getByRole("listitem").filter({ hasText: "NCAA" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Open add card form" })).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await expectAccessible(page, { label: "Empty checklist with an unmapped base" });
    // The two teams the walk uses are made now, in the add-card form (cancelled, no card added).
    const team = recordedNoMatchName(env, "checklist-one-marketplace-match-cards-keeps-every-card");
    const other = `RXO${env.ATTEMPT_TOKEN}T`;
    await page.getByRole("button", { name: "Open add card form" }).click();
    await expect(page.getByRole("textbox", { name: "Card name", exact: true })).toBeVisible();
    await createTeamInCardForm(page, team);
    await createTeamInCardForm(page, other);
    await page.getByRole("button", { name: "Cancel new card" }).click();
    await expect(page.getByRole("textbox", { name: "Card name", exact: true })).toBeHidden();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // The publisher's checklist, 24 of the 25 cards (LIVE_PLAYER's row left out), so BSC is
    // asked about ONE card and not 25 (NEO-489).
    const facts = await usePublishersChecklist(page, CHECKLISTS.roanokeExpress1995OneLive);
    // NEO-640: a two-source run skips Match Cards only when every card is Matched at 100%; this
    // file leaves a card out, so it must open (R2: the fixture's fact, stated before the fetch).
    expect(opensMatchCards(facts, env), "Roanoke's one-live file leaves a card out, so Match Cards opens").toBe(true);
    await syncChecklistButton(page).click();
    // NEO-640 (C5): every run with two or more sources starts on the progress line, no dialog yet;
    // the dialog opens only once a streamed card turns out to need the operator.
    await expect(checklistFetchProgress(page)).toBeVisible();
    await expect(cancelCardFetchButton(page)).toBeVisible();

    // NEO-496 (D10, NQ1): ONE marketplace plus the publisher's checklist are TWO sources, and the
    // card the file leaves out needs the operator, so the fetch opens Match Cards.
    // One live BSC round trip (the one lookup): 7 s of our own time plus however long BuySportsCards
    // held it (NEO-487), never a flat ceiling.
    const matchCards = matchCardsDialog(page);
    await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: "Match Cards after the fetch" });
    const confirmMatches = matchCards.getByRole("button", { name: "Confirm card matches", disabled: false });
    await expectAfterMarketplace(page, confirmMatches, { platform: "BuySportsCards", what: "Confirm unlocked after the fetch" });
    // The dialog took over from the progress line.
    await expect(checklistFetchProgress(page)).toHaveCount(0);
    // The teams line is said while the dialog is open.
    await expectTeamsFromChecklist(page, facts);
    // Every row of the file pairs with its card by number; LIVE_PLAYER's card, the one the file
    // leaves out, is BSC's alone, and no row is left over.
    await expect(matchCards.getByRole("heading", { name: "BSC only (1)" })).toBeVisible();
    const keepLive = matchCards.getByRole("button", { name: new RegExp(`^Keep #\\S+ ${LIVE_PLAYER} as BSC-only$`) });
    await expect(keepLive).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Checklist only (0)" })).toBeVisible();
    await expect(matchCards.getByText(`Matched (${facts.rows})`)).toBeVisible();
    await expectAccessible(page, { within: matchCards, label: "Match Cards, one marketplace and a publisher's checklist" });
    // Keep it, so every fetched card saves: the file's rows plus LIVE_PLAYER's card.
    await keepLive.click();
    await expect(matchCards.getByRole("heading", { name: "BSC only (0)" })).toBeVisible();
    await expect(matchCards.getByRole("heading", { name: "Keeping (1)" })).toBeVisible();
    const FETCHED = facts.rows + 1;
    // NEO-645: Confirm IS the commit. "Saved N cards." is our own write (7 s), and the walk opens
    // on it by itself, since every card arrives with a name nobody has answered.
    await confirmMatches.click();
    await expect(matchCards).toBeHidden();
    const saved = page.getByText(new RegExp(`^Saved ${FETCHED} cards\\.`)).first();
    expect(await settleWalkAfterCommit(page, saved), "the saved cards need a person, so the walk opened").toBe(true);

    // ── STEP 5b: the count is FINAL at "Saved" (NEO-335) ──
    // The pill is read with the saved line (one render's work), and the walk opened on exactly the
    // cards it counts: a count still climbing behind a background lookup would differ, by number.
    const pill = needsYouPill(page);
    await expect(pill).toBeVisible();
    const needing = Number(((await pill.textContent()) ?? "").match(/^[0-9]+/)?.[0]);
    expect(needing, "every card prints a name nobody has answered yet").toBeGreaterThanOrEqual(FETCHED - 2);
    expect(needing).toBeLessThanOrEqual(FETCHED);
    await expectCardsLeft(page, needing);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, the first card after the commit" });

    // ── STEP 6: LIVE_PLAYER's card: create him, rule the printed team out, stage his career ──
    // NEO-335 needs ONE card whose team the evidence knows, and none of these cards carries a team
    // the evidence can fill, so the evidence is a player's career: LIVE_PLAYER (the one card BSC is
    // asked about) is created here, with two stints covering the set's year (1995).
    await skipUntil(page, livePlayerRow(page), { maxCards: FETCHED });
    const liveRow = livePlayerRow(page);
    await expect(liveRow.getByText("Checking for players by that name…")).toHaveCount(0);
    // Not a promoted "Link to" a namesake ("… anyway" would be its decline): the plain create.
    await expect(liveRow.getByRole("button", { name: /^Add as new player( .+)?$/ })).toBeVisible();
    await expect(liveRow.getByRole("button", { name: /^Add as new player anyway/ })).toHaveCount(0);
    expect(await createPlayerOnOpenRow(page)).toBe(`Player ${LIVE_PLAYER}`);
    // A player made on this card brings his career to check (blue, never pink).
    const career = tidyTile(page, "Career");
    await expect(career).toHaveAccessibleDescription(/To check/);
    await expect(career.getByRole("group", { name: `Career ${LIVE_PLAYER}`, exact: true })).toBeVisible();

    // The printed team, ruled "Not a team" (once, for every card that prints it). BSC answered his
    // card; whether it named the team is annotated, and everything after is the same either way.
    const printedOnLive = await releasePrintedTeam(page);
    bscLookupOutcome("answered", `${LIVE_PLAYER} (${printedOnLive.length > 0 ? `named ${printedOnLive.join(", ")}` : "no team"})`);
    await expect(pinkTile(page, "Team"), "a card with no team is still a stop").toHaveCount(1);

    const teamTile = tidyTile(page, "Team");
    // His two stints, both covering 1995: the club (1994-1996) and the Badgers (same years).
    const addStint = career.getByRole("button", { name: `+ Add stint for ${LIVE_PLAYER}`, exact: true });
    for (const stint of [team, COLLEGE_TEAM]) {
      await addStint.click();
      const name = career.getByRole("combobox", { name: `Career team name for ${LIVE_PLAYER}` });
      await expect(name).toBeVisible();
      await name.fill(stint);
      await career.getByRole("spinbutton", { name: `From year for ${LIVE_PLAYER}` }).fill("1994");
      await career.getByRole("spinbutton", { name: `To year (optional) for ${LIVE_PLAYER}` }).fill("1996");
      // Usable only once the typed name IS one saved team (knownTeamsOnly).
      const add = career.getByRole("button", { name: `Add career team for ${LIVE_PLAYER}` });
      await expect(add, `${stint} is a team NeonBinder holds`).toBeEnabled();
      await add.click();
      await expect(addStint, "the stint was added and the entry closed").toBeVisible();
    }
    // Both teams are now his career's chips on the Team tile, and nothing is saved: the set's league
    // ranks the Badgers first, so they are preselected (aria-current) and the club is only offered.
    await expect(teamChip(page, COLLEGE_TEAM)).toHaveAttribute("aria-current", "true");
    await expect(teamChip(page, team)).not.toHaveAttribute("aria-current", "true");
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, a created player's career and team chips" });
    // Nothing saved for his team yet: Save for later writes nothing (STEP 11 answers him).
    await saveForLater(page);
    await expect(pill).toHaveAccessibleName(needYou(needing));

    // ── STEP 7: two other cards, from a new sitting (the pill) ──
    // Cards A and B are cards whose player name is still open (pink), so each stays a stop after
    // its team is answered; LIVE_PLAYER's name is answered now, so neither is his.
    await openTidyWalk(page);
    await skipUntil(page, pinkTile(page, "Player"), { maxCards: FETCHED });
    // CARD A: "No team on this card".
    const nameA = await openCardName(page);
    await releasePrintedTeam(page);
    await noTeamOnCard(page).click();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(teamTile.getByText("No team on this card.", { exact: true })).toBeVisible();
    // Its player name is still open, so the card is still a stop: Save & next is held, Skip moves on.
    await expect(tidyFooterButton(page, "saveAndNext")).toHaveAttribute("aria-disabled", "true");
    const cardA = await openCardFace(page);
    await skipCard(page);
    // The walk lives in the URL: Back is card A again, its answer kept; Forward is where Skip went.
    const afterA = await openCardFace(page);
    await page.goBack();
    await expect(cardFace(page)).toHaveAccessibleName(cardA);
    await expectCardSettled(page);
    await expect(teamTile.getByText("No team on this card.", { exact: true })).toBeVisible();
    await page.goForward();
    await expect(cardFace(page)).toHaveAccessibleName(afterA);
    await skipUntil(page, pinkTile(page, "Player"), { maxCards: FETCHED });

    // CARD B: a team nobody offered. First NEO-518: "Other team…" RANKS BY THE SET. This is a
    // Hockey 1995 set, so its league is the NHL and its year 1995. "pittsburgh" is shared by the
    // NHL's Pittsburgh Penguins (active since 1967), a long-gone Pittsburgh Pirates (1925-29) and
    // Pittsburgh Panthers (a college), all Hockey rows of the reference catalogue; ranked by the
    // set, the Penguins lead, are the highlighted row, and Enter takes them.
    const nameB = await openCardName(page);
    expect(nameB, "card B is another card").not.toBe(nameA);
    await releasePrintedTeam(page);
    await teamTile.getByRole("button", { name: "Other team…", exact: true }).click();
    const search = teamTile.getByRole("textbox", { name: "Search existing teams" });
    const results = teamTile.getByRole("listbox", { name: "Search existing teams" });
    // Press the field first, so the pointer rests on it and not where the list opens: a pointer
    // resting on a row moves the highlight (onMouseEnter) off the first row.
    await search.click();
    await search.fill("pittsburgh");
    // The lower-ranked rows are on screen, so the list is the settled answer and "first" is the
    // first of the final order. No row count is pinned: the catalogue may hold more one day.
    await expect(results.getByRole("option", { name: "Link to Pittsburgh Panthers", exact: true })).toBeVisible();
    await expect(results.getByRole("option", { name: "Link to Pittsburgh Pirates", exact: true })).toBeVisible();
    await expect(results.getByRole("option").first()).toHaveAccessibleName("Link to Pittsburgh Penguins");
    await expect(results.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(results.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
    await expectAccessible(page, { within: tidyWalk(page), label: "Other team search ranked by the set's league and year" });
    // Enter would take the Penguins (and save them: a click on a team saves it), but this card is
    // RXO's, so the search is cancelled here and the ranking above is what was proved.
    await teamTile.getByRole("button", { name: "Cancel linking" }).click();
    await expect(search).toBeHidden();
    // THE WRITE: RXO (made before the fetch) is found by its one token and linked: saved at once.
    await teamTile.getByRole("button", { name: "Other team…", exact: true }).click();
    await search.fill(other);
    await teamTile.getByRole("option", { name: `Link to ${other}`, exact: true }).click();
    await expect(search).toBeHidden();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(teamTile.getByRole("group", { name: `Team ${other}`, exact: true })).toBeVisible();
    await expect(teamTile.getByRole("button", { name: /^Save teams?$/ })).toHaveCount(0);
    await saveForLater(page);

    // ── STEP 8: the count holds, and each answer is on its own card's mark ──
    // Cards A and B still wait on their player names, so the pill has not moved.
    await expect(pill).toHaveAccessibleName(needYou(needing));
    const cardSearch = page.getByRole("searchbox", { name: "Search cards" });
    const reasonsOf = async (name: string) => {
      await cardSearch.fill(name);
      await expect(markOf(page, name)).toBeVisible();
      return (await markOf(page, name).getAttribute("aria-label")) ?? "";
    };
    // The positive the two negatives are read against: LIVE_PLAYER's card has no team yet, and says so.
    expect(await reasonsOf(LIVE_PLAYER)).toMatch(TEAM_REASON);
    expect(await reasonsOf(nameA), "card A's \"No team on this card\" answered its team").not.toMatch(TEAM_REASON);
    expect(await reasonsOf(nameB), "card B's team answered it").not.toMatch(TEAM_REASON);
    await cardSearch.fill("");

    // Every card is BSC only; nothing is SL only.
    await expect(page.getByText(new RegExp(`\\(${FETCHED}\\)`)).first()).toBeVisible();
    await expect(page.getByText("BSC only").first()).toBeVisible();
    await expect(page.getByText("SL only")).toBeHidden();
    await expectAccessible(page, { label: "Committed checklist, every card BSC only" });

    // A card added by hand titles itself from the set, not from Unknown/All Brands.
    const card = `NB272-${env.ATTEMPT_ID}`;
    await page.getByRole("button", { name: "Open add card form" }).click();
    const number = page.getByRole("textbox", { name: "Card number" });
    await expect(number).toBeVisible();
    await number.fill(card);
    await page.getByRole("button", { name: "Submit new card" }).click();
    await editCardButton(page, card).click();
    const title = page.getByRole("dialog").getByRole("textbox", { name: "Card title" });
    await expect(title).toBeVisible();
    await expect(title).toHaveValue(new RegExp(SET));
    await expectAccessible(page, { within: page.getByRole("dialog"), label: "Card detail drawer with an auto title" });
    await expect(title).not.toHaveValue(/Unknown/);
    await expect(title).not.toHaveValue(/All Brands/);
    // NEO-645: a card added with a number alone is stored under NB's placeholder name, "Card
    // #<number>" (no player, nothing printed), and that placeholder is no name: never in the title.
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "Card name", exact: true })).toHaveValue(`Card #${card}`);
    await expect(title).not.toHaveValue(/Card #/);

    // ── STEP 9: the one team written in the walk is on its card, and no other card has one ──
    // The drawer opened above walks the checklist with "Next card" in its display order, and
    // NB272-... sorts FIRST, so walking forward visits every committed card once. Card B's RXO is
    // the only team chip: card A answered "no team", LIVE_PLAYER's team is not saved yet, and the
    // printed team was ruled out for every card (a checklist claim never writes a team itself).
    const dialog = page.getByRole("dialog");
    const chiplessBefore = await nextCardUntilTeamChip(page);
    await expect(dialog.getByRole("button", { name: new RegExp(`^Remove team ${other}( · .*)?$`) })).toBeVisible();
    // From card B to the end: every card it lands on (the one right after B included) has no chip.
    const chiplessAfter = await expectNoTeamChipsToTheEnd(page);
    expect(chiplessBefore + chiplessAfter, "every card but card B was seen without a team chip").toBe(FETCHED);
    await page.getByRole("button", { name: "Done editing card" }).click();
    await expect(title).toBeHidden();

    // ── STEP 10: a re-sync re-asks none of the answered cards (NEO-335, NEO-203) ──
    // The same checklist again: ONE live BSC lookup this time too, and Match Cards keeps
    // LIVE_PLAYER's card so every card comes back through. The content review comes first and
    // always comes (card B stores a team no source lists, LIVE_PLAYER's card a player link against
    // an incoming name): "Skip changes" keeps NeonBinder's version.
    await usePublishersChecklist(page, CHECKLISTS.roanokeExpress1995OneLive);
    await syncChecklistButton(page).click();
    // A re-sync of the same file settles on the file's own measured fact (NEO-640): through Match
    // Cards when it opens, past it to the saved line when every card matched.
    await settleChecklistFetch(page, env, { facts, what: "the re-sync" });
    const skipChanges = page.getByRole("button", { name: "Skip reviewing changes and continue" });
    await expect(skipChanges).toBeVisible();
    await skipChanges.click();
    // EXACTLY "Saved N cards." plus the checklist's own tail, and NOTHING else: every name was
    // answered or left as it stands, so this commit has nothing more to report.
    const resaved = page.getByText(
      new RegExp(`^Saved ${FETCHED} cards\\. Teams from your checklist: ${facts.matched} of ${FETCHED} cards\\.$`),
    );
    // The hand-made NB272 card has no team, so it is one more card that needs a person.
    expect(await settleWalkAfterCommit(page, resaved.first())).toBe(true);
    await expect(pill).toHaveAccessibleName(needYou(needing + 1));
    await expectCardsLeft(page, needing + 1);

    // ── STEP 10b: the hand-added card is asked for a name, and the name goes into its title (NEO-645) ──
    // Every card has a name. NB272 has no player and only NB's "Card #<number>" (STEP 8), so the
    // walk shows it a pink "Card name" tile: a card made before the rule is asked like a new one.
    // It is this run's own card (the set's sole writer), so the answer is a plain fixed name.
    const cardNameTile = tidyWalk(page).getByRole("group", { name: "Card name", exact: true });
    await skipUntil(page, cardNameTile, { maxCards: FETCHED + 1 });
    await expect(cardFace(page)).toHaveAccessibleName(new RegExp(`^Card #${escapeRe(card)}(, |$)`));
    await expect(cardNameTile).toHaveAccessibleDescription(/To fix/);
    // The box shares its name with the tile (both "Card name"), so it is read inside the tile.
    const nameBox = cardNameTile.getByRole("textbox", { name: "Card name", exact: true });
    await expect(nameBox).toBeVisible();
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, a card with no player asked for its name" });
    await nameBox.fill(HAND_CARD_NAME);
    await cardNameTile.getByRole("button", { name: "Save name", exact: true }).click();
    // The tile goes with the item; the face now reads the card by its name. The card has no team
    // yet, so it is still a stop and still counted.
    await expect(cardNameTile).toHaveCount(0);
    await expect(cardFace(page)).toHaveAccessibleName(new RegExp(`^Card #${escapeRe(card)}, ${HAND_CARD_NAME}$`));
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(pill).toHaveAccessibleName(needYou(needing + 1));

    // ── STEP 11 (LAST): LIVE_PLAYER's no-team card pre-selects the career team the set ranks first ──
    // The walk the re-sync opened is a new sitting, so his card comes up again with its Team tile
    // mounted fresh (a new sitting from the pill): what is pressed now is the pre-fill, not anybody's
    // press. Both stints cover
    // the set's year, so the window alone is a tie; the SET'S LEAGUES break it (NEO-569): Wisconsin
    // Badgers play in the NCAA, which the Base row's League list holds, so they are PRE-SELECTED;
    // the club has no league and ranks last, so it is offered and not selected. (Without NCAA on
    // the row the two tie and neither is selected.)
    await saveForLater(page);
    await openTidyWalk(page);
    await skipUntil(page, livePlayerRow(page), { maxCards: FETCHED + 1 });
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(teamChip(page, team)).toBeVisible();
    await expect(teamChip(page, COLLEGE_TEAM)).toHaveAttribute("aria-current", "true");
    await expect(teamChip(page, team)).not.toHaveAttribute("aria-current", "true");
    // NEO-639 (C8): the chip the pre-fill passes over says his years with that club, bare (one player
    // on the card, so no name in front: "<team> · 1994–1996"), and the pre-filled one says who played there.
    await expect(teamChip(page, team)).toHaveAccessibleName(`${team} · 1994–1996`);
    await expect(teamChip(page, COLLEGE_TEAM)).toHaveAccessibleName(`${COLLEGE_TEAM} · ${LIVE_PLAYER} played here`);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, a league-ranked team pre-fill" });
    // The operator clicks the club instead, which saves it: the card's last pink goes, and Save &
    // next (the career is only blue) moves on.
    await teamChip(page, team).click();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(teamTile.getByRole("group", { name: `Team ${team}`, exact: true })).toBeVisible();
    await saveAndNext(page);
    // His card may have been the walk's last: the end screen ("1 card fixed") closes with Done,
    // a card with Save for later. Either way nothing else is written.
    const done = tidyFooterButton(page, "done");
    await expect(done.or(tidyFooterButton(page, "saveForLater")).first()).toBeVisible();
    if (await done.isVisible()) await finishTidyWalk(page);
    else await saveForLater(page);
    // NB272 joined the count at STEP 8 and his card left it: back to the commit's count.
    await expect(pill).toHaveAccessibleName(needYou(needing));

    // NEO-645 read-back: the name given at STEP 10b is stored, and Save name rebuilt the title with
    // it, after the levels and ahead of the number (no player or cameo stands between them).
    // The card list is windowed (only the rows near its scroll position are mounted), and the walk
    // closing leaves it wherever it was, so the card is found through the search box (as STEP 8
    // does), not assumed on screen. Its number is a minted token: exactly one row.
    await cardSearch.fill(card);
    await expect(page.getByText(/^1 of [0-9]+ cards$/)).toBeVisible();
    await editCardButton(page, card).click();
    const handDrawer = page.getByRole("dialog");
    await expect(handDrawer.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue(HAND_CARD_NAME);
    await expect(handDrawer.getByRole("textbox", { name: "Card title" })).toHaveValue(
      new RegExp(`${SET} (Base )?${HAND_CARD_NAME} #${escapeRe(card)}( |$)`),
    );
    await handDrawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(handDrawer).toBeHidden();
    await cardSearch.fill("");
  },
);
