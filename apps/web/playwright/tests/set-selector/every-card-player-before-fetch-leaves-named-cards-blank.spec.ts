// NEO-528 (R1): "Player on every card" stored on a checklist BEFORE its cards
// exist never overrides what the listing names. A card the marketplace's
// listing names somebody on is committed by the fetch with that somebody when
// the name resolves (#4 keeps its own Pete Rose), and with NO player when
// entity review rules the name out as not a person (#10 "1975 World Champions"
// and #18 "Former Teammates" stay blank: Jason, 2026-11-15, "No, keep them
// blank"; product invariant 8, a data claim holds back a guess). A stored cameo
// lands on every committed card either way, which is also what proves #10 went
// through the defaults at all. A parallel built from Base copies the hold-back.
//
// The fixture is a REAL set (Jason, 2026-11-15): Baseball > 2011 > Leaf >
// Leaf Pete Rose Legacy > Base, 75 cards, and its Parallel > Printing Plates
// Black. Its storyline cards name no person ("1975 World Champions", "Former
// Teammates", "One Heck of a Try" ..), and #4 names "Pete Rose & Harry 'Pete'
// Rose" (the publisher's checklist splits it into two names).
//
// The flow:
// - The set builder drills to the set's Base cold, and branches on the
//   checklist's own state. Empty: Pete Rose is stored as the player on every
//   card and Johnny Bench as a cameo (no cards, so no confirm), the
//   publisher's checklist is uploaded and the checklist synced. Match Cards'
//   Confirm (or its skip) SAVES the 75 cards (NEO-645: commit first), and the Tidy Up walk
//   opens on them. On the walk, card by card: a sources disagreement takes
//   the checklist's side (it splits #4's "Pete Rose & Harry 'Pete' Rose" into
//   two names); every name nobody knows is ruled out on its row, "Not a
//   player" ("1975 World Champions" and "Former Teammates" among them, each
//   answer reaching every card that prints it), Pete Rose himself never; a
//   team name nobody knows (#1's high school) is "Not a team", which leaves
//   #1 asking for a team under its own Pete Rose, and #1 is skipped. No
//   ruled-out card asks for a team. Done closes the walk with no name or
//   disagreement left pink (J3: the parallel build below needs that).
//   Already committed (a rerun on the same seed): the stored values are read
//   back as they are. Both branches end on the same asserts.
// - #10's and #18's drawers: no player, Johnny Bench under "Also on this
//   card", the description's "Cameo: Johnny Bench" line, and the exact card
//   title the walk's write regenerated (NEO-645 C7): the levels ("Base" while it
//   fits), the card's name, then the cameo. #10's runs over 80, so "Base" is
//   the first word cut and the cameo next, and the drawer says "Left out to
//   fit: Johnny Bench". #4's drawer: Pete Rose as its player (its title names
//   him, then "& Johnny Bench"; its card name only repeats him, so it adds
//   nothing), and the cameo.
// - Printing Plates Black is built from Base (or adopted, built): its #10 has
//   no player and its #4 keeps Pete Rose.
// - Back steps the drill out of the parallel.
//
// What this spec cannot cover on this set:
// - The default player FILLING a fetched card whose listing names nobody. No
//   card of this set is one, and BSC names somebody on nearly every card (a
//   team-leader card names its team, a storyline card its caption), so the
//   fake's recordings hold no such card to fetch. The fill at birth is proven
//   by `set-selector/player-on-every-card` (quick-add on a hand-made set) and,
//   for the commit, by `convex/cardPlayerDefaults.creation.test.ts` and
//   `convex/lib/cardPlayerDefaults.test.ts`.
// - The walk's Listing title tile on a ruled-out card: the walk is driven
//   card by card off whatever it opens on, so the titles are asserted once,
//   in the drawers, after the walk (both branches read them there).
//
// R7/R7a: SOLE WRITER of Baseball > 2011 > Leaf > Leaf Pete Rose Legacy (its
// Base, its Parallel rows and Printing Plates Black's cards) and of the year's
// Leaf brand row (SET-REGISTRY.md); the only spec that stores "Player on every
// card" values on it, and the only spec that lists Johnny Bench under "Also on
// this card" anywhere (a smart binder's cameo counts are catalogue-wide). Not
// fresh-only: the committed checklist and the built parallel stay and a rerun
// adopts them. It writes nothing else.
//
// R3: the drill is `drillToColdManufacturer` + `drillToBaseVariant` + `pick`
// (R9), the upload `usePublishersChecklist`, the walk `support/tidy-walk.ts`,
// and the section's and the drawer's names `support/also-pictured.ts`.
import type { Locator, Page } from "@playwright/test";
import {
  ALSO_PICTURED,
  EVERY_CARD_PLAYER as E,
  anyPlayerChip,
  cameoChip,
  cameoLine,
  cardDescription,
  cardTitle,
  closeCardDrawer,
  openCardDrawer,
  openEveryCardPlayer,
  playerChip,
  storeEveryCardValue,
} from "../../support/also-pictured";
import { escapeRe } from "../../support/cards";
import type { FlowEnv } from "../../support/env";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS, savedLine, settleChecklistFetch, usePublishersChecklist } from "../../support/published-checklist";
import {
  drillToBaseVariant,
  drillToColdManufacturer,
  drillToSet,
  pick,
  pickAfterBscSync,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import {
  expectCardSettled,
  finishTidyWalk,
  mustFixLine,
  pinkTile,
  ruleOutOpenPlayerRows,
  ruleOutOpenTeamRows,
  saveAndNext,
  settleWalkAfterCommit,
  skipCard,
  takeSourceSide,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  type TidyTileName,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const BUILD = { sport: "Baseball", year: "2011", manufacturer: "Leaf", set: "Leaf Pete Rose Legacy" } as const;
/** How a card's description names the set ("<year> <set>"). */
const SET_TITLE = `${BUILD.year} ${BUILD.set}`;
/** The stored "Player on every card" values. */
const PLAYER = "Pete Rose";
const CAMEO = "Johnny Bench";
/** Cards whose listing names somebody entity review rules out (not a person). */
const RULED_OUT = [
  // NEO-645 C7: every walk write regenerates the title. A card's own name is in it whenever it has
  // one (Jason, 2026-11-23): "<year> <set> Base <card name> <cameo> #N <team> <sport>", the variant
  // word "Base" kept while it fits and the first word cut; #18's team is "No Team", which a title
  // omits, so #18 keeps "Base" (74). #10's would run to 94: "Base" goes first (89), then the cameo
  // (76), and the drawer names only the cameo under "Left out to fit" (a label is never listed).
  // Computed offline with `assessListingTitle` (agent memory: compute titles with tsx first).
  {
    number: "10",
    printed: "1975 World Champions",
    title: `${SET_TITLE} 1975 World Champions #10 Cincinnati Reds Baseball`,
    leftOut: CAMEO,
  },
  { number: "18", printed: "Former Teammates", title: `${SET_TITLE} Base Former Teammates ${CAMEO} #18 Baseball`, leftOut: undefined },
] as const;
/** The card whose listing names Pete Rose (and his father): it keeps its own Pete Rose. */
const OWN = "4";
/** The parallel built from Base (a Printing Plate: BSC lists one per colour). */
const PARALLEL = "Printing Plates Black";

/** The card whose team name nobody knows (its high school): ruled out, it asks for a team. */
const HIGH_SCHOOL = "1";
/** The tiles a card can be skipped with; J3 holds the parallel build on the first three. */
const BLOCKING: readonly TidyTileName[] = ["Sources disagree", "Player", "Team"];
/** A runaway guard: the walk shows at most the checklist's 75 cards. */
const MAX_CARDS = 80;

/** The open card's number, off its first "#…" line (`tidyCardIdentity`). */
async function openCardNumber(page: Page): Promise<string> {
  const [first] = await tidyCardIdentity(page).allTextContents();
  return /^#(\S+)/.exec(first ?? "")?.[1] ?? "";
}

/**
 * Fetch and commit the empty checklist, the defaults stored first, then walk
 * the Tidy Up walk that opens on it. Contract: ENTRY the set's Base is on
 * screen with no cards. EXIT the walk is closed and the checklist is on screen
 * again, freshly drilled, with its cards.
 */
async function fetchAndCommit(page: Page, env: FlowEnv, section: Locator): Promise<void> {
  // Stored before the cards exist: saved with no question (no cards beneath).
  await storeEveryCardValue(page, section, PLAYER, "player");
  await storeEveryCardValue(page, section, CAMEO, "cameo");
  await expectAccessible(page, { within: section, label: "Player on every card, a player and a cameo stored before the fetch" });

  // GUIDE "Checklist first": every row names its team or says No Team, so BSC is asked for no card one by one.
  const facts = await usePublishersChecklist(page, CHECKLISTS.leafPeteRoseLegacy2011);
  // NEO-591: every row pairs its card, all 75. BSC names #27b and #38b "Old Teammates SP" and
  // "One Heck of a Try SP" where the checklist's parser reads the trailing SP as a print marker;
  // the pairing key drops it on both sides, so the SP cards pair their own rows instead of the
  // rows becoming variations of #27a / #38a. `facts` is the product matcher's own answer.
  expect(facts.matched, "every Leaf row pairs its card (a trailing SP is no part of a name)").toBe(facts.rows);
  await syncChecklistButton(page).click();
  // NEO-640 / NEO-645 C5: settled on the file's own Match Cards fact, never a race: Confirm (keeping
  // any BSC-only card) when the dialog opens, the skip's saved line when every card matched. Either
  // way the cards SAVE first (our own write, 7 s); the storyline captions are names nobody knows, so
  // the walk opens on its own after the save.
  await settleChecklistFetch(page, env, { facts, what: "the empty checklist's fetch" });
  const saved = savedLine(page, 75);
  await expect(saved).toBeVisible();
  expect(await settleWalkAfterCommit(page, saved), "the captions need a person, so the walk opened").toBe(true);
  const walk = tidyWalk(page);
  await expect(walk).toHaveAccessibleName(tidyUpName({ year: BUILD.year, set: BUILD.set }));

  const ruledOut: string[] = [];
  const linkedByHand: string[] = [];
  const skipped: { number: string; pink: TidyTileName[] }[] = [];
  const ownRow = tidyTile(page, "Player").getByRole("group", { name: `Player ${PLAYER}`, exact: true });
  for (let i = 0; i < MAX_CARDS; i++) {
    const done = tidyFooterButton(page, "done");
    await expect(tidyTile(page, "More about this card").or(done).first()).toBeVisible();
    if (await done.isVisible()) break;
    await expectCardSettled(page);
    const number = await openCardNumber(page);

    // The checklist's side of any disagreement (#4 reads two names on it). The Player tile waits
    // on the spelling, so the card settles again once it is taken.
    if ((await takeSourceSide(page, "Checklist")) > 0) {
      await expect(walk.getByText(/^(Looks up once the spelling is picked|Waiting on the spelling above)$/)).toHaveCount(0);
      await expect(tidyTile(page, "Player")).toBeVisible();
      await expectCardSettled(page);
    }
    // Pete Rose is the catalogue's own player and never ruled out. The commit links him; where a
    // row still asks (#4's name only arrives with the checklist's side), he is linked by hand to
    // the one Pete Rose on file, and the run says so.
    await expect(ownRow.getByText("Checking for players by that name…")).toHaveCount(0);
    if ((await ownRow.getByRole("button", { name: /^Not a player / }).count()) > 0) {
      await ownRow.getByRole("button", { name: /^Link to Pete Rose( \(Baseball\))?( Pete Rose)?$/, disabled: false }).click();
      // C1: the answered row's one button is "Edit <the linked player>".
      await expect(ownRow.getByRole("button", { name: `Edit ${PLAYER}`, exact: true })).toBeVisible();
      linkedByHand.push(number);
    }
    await expect(ownRow.getByRole("button", { name: /^Not a player / })).toHaveCount(0);
    ruledOut.push(...(await ruleOutOpenPlayerRows(page, { keep: [PLAYER] })));
    const teams = await ruleOutOpenTeamRows(page);

    if (number === HIGH_SCHOOL) {
      // #1's high school was ruled out, so #1 has no team and asks for one under its own
      // Pete Rose (the old wizard's "Cards with no team" listed it as "#1 · Pete Rose").
      expect(teams, "#1's high school was asked about and ruled out").toHaveLength(1);
      await expect(ownRow.getByRole("button", { name: `Edit ${PLAYER}`, exact: true })).toBeVisible();
      await expect(pinkTile(page, "Team")).toHaveCount(1);
      await expect(tidyTile(page, "Team").getByRole("button", { name: "No team on this card", exact: true })).toBeVisible();
    }
    const ruledOutCard = RULED_OUT.find((c) => c.number === number);
    if (ruledOutCard !== undefined) {
      // Ruled out here: the row says so, nothing on the Player tile is left, and the card asks
      // for no team (it carries the listing's Cincinnati Reds or No Team).
      const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${ruledOutCard.printed}`, exact: true });
      await expect(row.getByText(`${ruledOutCard.printed} is not a player.`, { exact: true })).toBeVisible();
      await expect(pinkTile(page, "Player")).toHaveCount(0);
      await expect(pinkTile(page, "Team")).toHaveCount(0);
      if (number === RULED_OUT[0].number) {
        await expectAccessible(page, { within: walk, label: "Tidy Up walk, a caption ruled out as not a player" });
      }
    }

    // Settled into one state: the status line says what is still pink, or Save & next is usable.
    const save = tidyFooterButton(page, "saveAndNext", { usable: true });
    await expect(save.or(mustFixLine(page)).first()).toBeVisible();
    if (await save.isVisible()) {
      await saveAndNext(page);
      continue;
    }
    const pink: TidyTileName[] = [];
    for (const name of BLOCKING) if ((await pinkTile(page, name).count()) > 0) pink.push(name);
    skipped.push({ number, pink });
    await skipCard(page);
  }
  await expect(tidyFooterButton(page, "done"), `the walk did not end within ${MAX_CARDS} cards`).toBeVisible();

  // Each caption was ruled out on a card that prints it; #1 is the one card left asking for a team.
  for (const { printed } of RULED_OUT) {
    expect(ruledOut, `"${printed}" was ruled out on the walk`).toContain(printed);
  }
  expect(ruledOut, "Pete Rose is never ruled out").not.toContain(PLAYER);
  expect(skipped.find((c) => c.number === HIGH_SCHOOL)?.pink, "#1 was skipped asking for its team").toEqual(["Team"]);
  // J3: no card was left with a name or a disagreement pink (a teamless card's Team tile has no
  // name row left, so it never holds the build).
  for (const { number, pink } of skipped) {
    expect(pink.filter((t) => t !== "Team"), `#${number} was skipped with a name or disagreement pink`).toEqual([]);
  }
  if (linkedByHand.length > 0) {
    test.info().annotations.push({ type: "pete-rose-linked-on-the-walk", description: linkedByHand.map((n) => `#${n}`).join(", ") });
  }
  await finishTidyWalk(page);
  // A fresh load of the checklist, as a rerun finds it.
  await drillToBaseVariant(page, env, BUILD);
}

test(
  "Set builder: a player stored on every card before the fetch never overrides a listed name; a ruled-out name leaves its card blank, a resolved one keeps its own player, and a stored cameo reaches every card",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // No other spec opens Baseball 2011, so every column may sync itself: the
    // cold drill pays those waits (R9).
    await drillToColdManufacturer(page, env, { ...BUILD, expectSets: true });
    await drillToBaseVariant(page, env, BUILD);
    const empty = page.getByText("No cards in this checklist yet.");
    const cards = page.getByRole("heading", { level: 2, name: /^Cards \([1-9][0-9]*\)$/ });
    await expect(empty.or(cards)).toBeVisible();
    let section = await openEveryCardPlayer(page);
    if (await empty.isVisible()) {
      await fetchAndCommit(page, env, section);
      section = await openEveryCardPlayer(page);
    }

    // Both branches: the committed checklist, with the values stored on Base.
    await expect(cards).toHaveAccessibleName("Cards (75)");
    await expect(section.getByRole("button", { name: E.stopPlayer(PLAYER), exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: E.stopCameo(CAMEO), exact: true })).toBeVisible();

    // --- The ruled-out cards: no player, the cameo ---------------------------
    for (const { number, printed, title, leftOut } of RULED_OUT) {
      const drawer = await openCardDrawer(page, number);
      const description = cardDescription(drawer);
      // The card has loaded (its description, written at the commit, names the
      // card and no player: "<set> card #10. Team: ... Cameo: ...", never what
      // it prints) and carries the cameo...
      await expect(description).toHaveValue(new RegExp(`^${escapeRe(SET_TITLE)} card #${number}\\.`));
      await expect(description).not.toHaveValue(new RegExp(escapeRe(printed)));
      await expect(description).toHaveValue(cameoLine(CAMEO));
      await expect(cameoChip(drawer, CAMEO)).toBeVisible();
      await expect(drawer.getByLabel(ALSO_PICTURED.chip(CAMEO), { exact: true })).toBeVisible();
      // ...and no player: the stored Pete Rose was held back.
      await expect(drawer.getByRole("button", { name: "Add player", exact: true })).toBeVisible();
      await expect(anyPlayerChip(drawer)).toHaveCount(0);
      // The title the walk regenerated, exact: the card's name, then the cameo
      // while it has room (cut first when over 80, and the note names it).
      await expect(cardTitle(drawer)).toHaveValue(title);
      const leftOutNote = drawer.getByText(/^Left out to fit: /);
      if (leftOut === undefined) await expect(leftOutNote).toHaveCount(0);
      else await expect(leftOutNote).toHaveText(`Left out to fit: ${leftOut}`);
      if (number === RULED_OUT[0].number) {
        await expectAccessible(page, { within: drawer, label: "Card drawer, a ruled-out card with no player and a cameo" });
      }
      await closeCardDrawer(drawer);
    }

    // --- #4 keeps its own Pete Rose, and has the cameo -------------------------
    const own = await openCardDrawer(page, OWN);
    await expect(cardDescription(own)).toHaveValue(cameoLine(CAMEO));
    await expect(playerChip(own, PLAYER)).toBeVisible();
    await expect(anyPlayerChip(own)).toHaveCount(1);
    await expect(cameoChip(own, CAMEO)).toBeVisible();
    // NEO-645 C7: 79 characters once "Base" (84 with it, the first word cut) is out; nothing else cut.
    await expect(cardTitle(own)).toHaveValue(
      `${SET_TITLE} ${PLAYER} & ${CAMEO} #${OWN} Cincinnati Reds Baseball`,
    );
    await closeCardDrawer(own);

    // --- A parallel built from Base copies the hold-back --------------------
    await drillToSet(page, env, BUILD);
    await pick(page, "Variant Types", "Parallel", { search: false });
    await pickAfterBscSync(page, "Parallels", PARALLEL);
    const parallelHeading = page.getByRole("heading", { name: `Attributes for ${PARALLEL} (Insert)` });
    await expect(parallelHeading).toBeVisible();
    // Built (a rerun on the same seed) or not yet: a parallel is built from
    // Base, never fetched. The checklist settles on its cards or its empty line
    // first (its "Build from Base" shows while the cards are still loading).
    await expect(empty.or(cards)).toBeVisible();
    if (await empty.isVisible()) {
      await page.getByRole("button", { name: "Build from Base", exact: true }).click();
      // Our own writes, one copy per Base card the plate's BSC list also has
      // (BSC lists 60 plates, 43 of them Base numbers): the standard budget.
      await expect(page.getByText(new RegExp(`^${escapeRe(PARALLEL)} — Built [1-9][0-9]* cards`))).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Rebuild from Base", exact: true })).toBeVisible();
    await expect(cards).toBeVisible();
    const copy = await openCardDrawer(page, RULED_OUT[0].number);
    await expect(cardDescription(copy)).toHaveValue(new RegExp(`card #${RULED_OUT[0].number}\\.`));
    await expect(copy.getByRole("button", { name: "Add player", exact: true })).toBeVisible();
    await expect(anyPlayerChip(copy)).toHaveCount(0);
    await expect(cameoChip(copy, CAMEO)).toBeVisible();
    await closeCardDrawer(copy);
    const ownCopy = await openCardDrawer(page, OWN);
    await expect(playerChip(ownCopy, PLAYER)).toBeVisible();
    await closeCardDrawer(ownCopy);

    // The drill lives in the URL: Back steps out of the parallel.
    await page.goBack();
    await expect(parallelHeading).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Attributes for Parallel (Variant)" })).toBeVisible();
  },
);
