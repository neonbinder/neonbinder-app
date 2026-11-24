// ONE FEATURE (NEO-657, the Tidy Up walk's Career tile): after "Add as new player" on a card that
// names exactly one team NeonBinder holds, in a set with a year, the Career tile opens "+ Add stint"
// already filled with that team and the set's year as From and To (Jason, 2026-11-23: "When adding
// a new player IF we know the team on the card we should automatically create a new stint for the
// player for the year of the card. It should be open and editable so that if that is not the right
// years the admin can fix it."). "+ Add", or Enter on a year, adds it at once; Save & next with the
// form still open adds what it shows (years the operator edited included); Esc closes it and adds
// nothing. A card with no team opens no form. The stint form's team suggestions name each saved
// team's era ("Use <full name> <from>–<to|present>"). Players admin reads every career back.
// NEO-656: the Career tile is the live career gap, so it is up only while the new player's career
// lacks the card's team, and it is gone the moment "+ Add" (or Enter, or Save & next) writes the
// stint. A card with no team has no gap, so no Career tile. The prefill is only for a player made
// on the open card ("Add as new player" in this sitting).
//
// FIXTURE (R7a, SET-REGISTRY.md prefix `tcs`): ONE hand-made set per attempt, `tcs<token>`, under
// the REAL Baseball › 2024 › Topps (the cards' teams resolve against Baseball's catalogue teams),
// `Insert` › `Base`, no marketplace id anywhere: a pasted five-row checklist is the one source (no
// Match Cards, no BSC). Each card is a different NEW player, because the prefill is the card the
// player is made on. All five are real people whose Baseball lookup the enrichment recording holds
// as a no-match (`result: null`, the retired 1996 Line Up Venezuelan Winter League fixture), in no
// pool of support/recorded-names.ts, on no committed checklist, and not in the catalogue (probed
// 2026-11-24 by a run: each stayed a pending name; Alex Speas, also recorded, is a catalogue player
// and was dropped; #5 is named as the Venezuelan set printed him, "CO" for coach): each Add as new player is a recorded hit that sends nothing to Wikidata and leaves
// the career empty ("No career from Wikidata."), so the only stint is the one this spec adds.
//   #1 Jose G. Urdaneta · Seattle Mariners   prefilled, "+ Add" as shown       -> Mariners 2024
//   #2 Carlos Alvarez · Colorado Rockies     From edited to 2022, Enter        -> Rockies 2022–2024
//   #3 Cristobal Colon · Chicago Cubs        years edited, Save & next         -> Cubs 2021–2023
//   #4 Antonio Armas Jr. · San Diego Padres  Esc, the era suggestion, Skip     -> no stint
//   #5 Jesus Tiamo CO · No Team              no form opens                     -> no stint
// The walk's card order follows each card's lookups, so the spec answers whichever card is up.
// FRESH-ONLY: the five players are global rows with real names, so a second run on the same seed
// links to them. CI reseeds each pass. Nothing is deleted (R7): the set, its cards and the players
// stand; no team is created and no catalogue row is written (catalogue teams are only linked to).
import type { Locator, Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  createPlayerOnOpenRow,
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  skipCard,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import { LOOKUPS } from "../../support/recorded-names";

/** The gap row's line for a player whose career is empty (CareerGapRow). */
const NO_CAREER = "No career on file yet.";

const YEAR = "2024";
/** The cards, by number: each a new player (see the header) and the team the checklist prints. */
const CARDS = {
  added: { n: "1", player: "Jose G. Urdaneta", team: "Seattle Mariners" },
  entered: { n: "2", player: "Carlos Alvarez", team: "Colorado Rockies" },
  saved: { n: "3", player: "Cristobal Colon", team: "Chicago Cubs" },
  escaped: { n: "4", player: "Antonio Armas Jr.", team: "San Diego Padres" },
  teamless: { n: "5", player: "Jesus Tiamo CO", team: "No Team" },
} as const;
type CardKey = keyof typeof CARDS;
/** The catalogue's Baseball Seattle Mariners era (read only), as a team suggestion names it. */
const MARINERS_ERA = "1977–present";

/** Players admin, one Baseball player's detail open; returns his career lines. */
async function openPlayer(page: Page, name: string): Promise<Locator> {
  await page.goto("/admin/players");
  // A mid-flow reload, the flow's 30 s.
  await expectPlayersLoaded(page, 30_000);
  await page.getByRole("textbox", { name: "Filter players" }).fill(name);
  await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`^${escapeRe(name)} Baseball\\b`) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.getByRole("list", { name: "Career history" }).getByRole("listitem");
}

test(
  "Tidy Up — a new player's Career tile opens + Add stint prefilled with the card's one team and the set's year: + Add or Enter adds it, Save & next adds it as edited, Esc adds nothing, no team opens nothing",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, isMobile }) => {
    const SET = `tcs${env.ATTEMPT_TOKEN}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its five-row checklist; the commit opens the walk ──
    await drillToCustom(page, { sport: "Baseball", year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    // R2 precondition: a fresh per-attempt checklist with no card.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    const rows = Object.values(CARDS).map(({ n, player, team }) => `${n},${player},${team}`);
    await usePastedChecklist(page, `number,player,team\n${rows.join("\n")}\n`, rows.length);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 5 cards\./).first());
    expect(opened, "five new names to answer, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expectCardsLeft(page, 5);

    const header = (k: CardKey) => walk.getByText(`#${CARDS[k].n} · ${CARDS[k].player}`, { exact: true });
    const career = tidyTile(page, "Career");
    /** The new player's row on the Career tile, and its stint form's controls (CareerTeamEntry, `label` = the player). */
    const stint = (k: CardKey) => {
      const who = CARDS[k].player;
      const row = career.getByRole("group", { name: `Career ${who}`, exact: true });
      return {
        row,
        teamName: row.getByRole("combobox", { name: `Career team name for ${who}`, exact: true }),
        from: row.getByRole("spinbutton", { name: `From year for ${who}`, exact: true }),
        to: row.getByRole("spinbutton", { name: `To year (optional) for ${who}`, exact: true }),
        add: row.getByRole("button", { name: `Add career team for ${who}`, exact: true }),
        addStint: row.getByRole("button", { name: `+ Add stint for ${who}`, exact: true }),
        /** The auto-opened form, named for where its values came from (the plain form is unnamed). */
        prefilled: row.getByRole("group", { name: `New stint for ${who}, prefilled from the card`, exact: true }),
      };
    };

    /** Make the card's player new, then the Career tile is up with his empty Wikidata career. */
    async function makeNewPlayer(k: CardKey) {
      const who = CARDS[k].player;
      await expect(pinkTile(page, "Player")).toHaveCount(1);
      const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${who}`, exact: true });
      // His lookup has answered (a recorded no-match, but it waits in the deployment-wide
      // enrichment pool behind every other run's lookups: the batch-lookup ceiling, LOOKUPS). Its
      // answer offers him as new, or first offers a same-name player of another sport on file
      // (NEO-424; a Soccer Carlos Alvarez is), which the spec declines with "... anyway". Usable
      // only: the aria-disabled "Add as new player" shown while the near-matches load is no answer.
      const create = row.getByRole("button", { name: "Add as new player", exact: true, disabled: false });
      const anyway = row.getByRole("button", { name: "Add as new player anyway", exact: true, disabled: false });
      await expect(create.or(anyway).first()).toBeVisible({ timeout: LOOKUPS });
      if (await anyway.isVisible()) {
        await anyway.click();
        await expect(anyway).toHaveCount(0);
      }
      expect(await createPlayerOnOpenRow(page)).toBe(`Player ${who}`);
      await expect(pinkTile(page, "Player")).toHaveCount(0);
      // A card with no team has no career gap, so no Career tile (#5).
      if (CARDS[k].team === "No Team") return;
      await expect(career).toHaveAccessibleDescription("To check");
      await expect(stint(k).row.getByText(NO_CAREER, { exact: true })).toBeVisible();
    }

    /** The prefilled form is open: the card's team, the set's year as From and To, no "+ Add stint". */
    async function expectPrefilled(k: CardKey) {
      const f = stint(k);
      await expect(f.prefilled).toBeVisible();
      await expect(f.teamName).toHaveValue(CARDS[k].team);
      await expect(f.from).toHaveValue(YEAR);
      await expect(f.to).toHaveValue(YEAR);
      await expect(f.add).toBeEnabled();
      await expect(f.addStint, "the form stands in for + Add stint while it is open").toHaveCount(0);
      // Blue never holds the card.
      await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    }

    /** The form wrote the stint, so the career covers the card's team: the gap, and its tile, are gone. */
    async function expectStintAdded() {
      await expect(career, "the stint covers the card's team, so the card has no career question left").toHaveCount(0);
    }

    /** The form closed without writing; the gap stays, and the plain "+ Add stint" is back, empty-handed. */
    async function expectFormClosed(k: CardKey) {
      const f = stint(k);
      await expect(f.addStint).toBeVisible();
      await expect(f.prefilled).toHaveCount(0);
      await expect(f.teamName).toHaveCount(0);
      await expect(f.from).toHaveCount(0);
    }

    // ── #1: "+ Add" adds the stint as shown ──
    async function addedCard() {
      await makeNewPlayer("added");
      await expectPrefilled("added");
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, Career tile with a prefilled stint from the card's team" });
      await stint("added").add.click();
      await expectStintAdded();
      await expect(header("added"), "a tile answer never moves the walk").toBeVisible();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk, card after the prefilled stint was added" });
    }

    // ── #2: an edited From year, then Enter on it, adds the edited range ──
    async function enteredCard() {
      await makeNewPlayer("entered");
      await expectPrefilled("entered");
      const f = stint("entered");
      // The form opens with focus on From year, so the keyboard edits it and Enter adds.
      await expect(f.from).toBeFocused();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("2022");
      await expect(f.from).toHaveValue("2022");
      await page.keyboard.press("Enter");
      await expectStintAdded();
    }

    // ── #3: years edited, the form left open, Save & next adds what it shows ──
    async function savedCard() {
      await makeNewPlayer("saved");
      await expectPrefilled("saved");
      const f = stint("saved");
      await f.from.fill("2021");
      await f.to.fill("2023");
      await expect(f.from).toHaveValue("2021");
      await expect(f.to).toHaveValue("2023");
      await expect(f.add).toBeEnabled();
      // The card moves on in the caller's saveAndNext; Players admin reads the stint back.
    }

    // ── #4: Esc closes the prefilled form and adds nothing; a team suggestion names its era ──
    async function escapedCard() {
      await makeNewPlayer("escaped");
      await expectPrefilled("escaped");
      const f = stint("escaped");
      // Esc from inside the form (a year field), as the operator would.
      await f.from.click();
      await page.keyboard.press("Escape");
      await expectFormClosed("escaped");
      await expect(header("escaped"), "Esc closed the form, never the card").toBeVisible();

      // The plain form: a saved team's suggestion carries its era in its name and on screen.
      await f.addStint.click();
      await expect(f.teamName).toHaveValue("");
      await expect(f.prefilled, "a reopened form is the plain one, prefilled no more").toHaveCount(0);
      await expect(f.from).toHaveValue("");
      // Part of the name: a box that already holds a team's whole name offers no list.
      await f.teamName.fill("Seattle Mar");
      const suggestion = f.row
        .getByRole("listbox", { name: "Existing team suggestions" })
        // The era is part of the option's name: two rows can share one full name.
        .getByRole("option", { name: `Use ${CARDS.added.team} ${MARINERS_ERA}`, exact: true });
      await expect(suggestion).toBeVisible();
      const era = suggestion.getByText(MARINERS_ERA, { exact: true });
      await expect(era).toBeVisible();
      // Wrapped, never clipped off the side of the list (a phone's width included): once scrolled
      // to, all of it is on screen (the intersection is cut by any clipping ancestor).
      await era.scrollIntoViewIfNeeded();
      await expect(era).toBeInViewport({ ratio: 1 });
      await expectAccessible(page, { within: walk, label: `Tidy Up walk, stint team suggestions with eras${isMobile ? " (mobile)" : ""}` });
      // Close the list (Esc in the name field), then the form (Esc from a year field): nothing added.
      await f.teamName.press("Escape");
      await expect(suggestion).toHaveCount(0);
      await f.from.click();
      await page.keyboard.press("Escape");
      await expectFormClosed("escaped");
    }

    // ── #5: a card with no team opens no form ──
    async function teamlessCard() {
      await makeNewPlayer("teamless");
      await expect(career, "no team on the card, so no career gap and no form").toHaveCount(0);
    }

    const handlers: Record<CardKey, () => Promise<void>> = {
      added: addedCard,
      entered: enteredCard,
      saved: savedCard,
      escaped: escapedCard,
      teamless: teamlessCard,
    };
    const keys = Object.keys(CARDS) as CardKey[];
    const anyHeader = keys.map(header).reduce((a, b) => a.or(b));

    // Whichever card is up (the order follows the cards' lookups), five times.
    const done: CardKey[] = [];
    for (let left = keys.length; left > 0; left--) {
      await expect(anyHeader.first()).toBeVisible();
      await expectCardSettled(page);
      let up: CardKey | undefined;
      for (const k of keys) if (!done.includes(k) && (await header(k).isVisible())) up = k;
      expect(up, "the card up is one this spec has not answered yet").toBeDefined();
      const k = up as CardKey;
      await expectCardsLeft(page, left);
      await handlers[k]();
      // #4 only closed its form: the gap is still open, and Save & next would add the default stint
      // for it (NEO-656), so that card is Skipped, writing nothing.
      if (k === "escaped") await skipCard(page);
      else await saveAndNext(page);
      await expect(header(k), "Save & next moved off the card").toHaveCount(0);
      done.push(k);
      if (done.length === 1) {
        // The browser's Back walks back to the card just passed, its player still answered; Forward returns.
        await page.goBack();
        await expect(header(k)).toBeVisible();
        await expectCardSettled(page);
        await expect(pinkTile(page, "Player")).toHaveCount(0);
        await page.goForward();
        await expect(header(k)).toHaveCount(0);
      }
    }
    await expect(tidyFooterButton(page, "done")).toBeVisible();
    await finishTidyWalk(page);

    // ── READ BACK: each career holds exactly the stint the walk added, and nothing else ──
    const added = await openPlayer(page, CARDS.added.player);
    await expect(added.filter({ hasText: `${CARDS.added.team} · ${YEAR}` }), "+ Add wrote the prefilled stint").toHaveCount(1);
    await expect(added).toHaveCount(1);
    await expectAccessible(page, { label: "Players admin, a new player's career from the card's prefilled stint" });

    const entered = await openPlayer(page, CARDS.entered.player);
    await expect(entered.filter({ hasText: `${CARDS.entered.team} · 2022–${YEAR}` }), "Enter wrote the edited years").toHaveCount(1);
    await expect(entered).toHaveCount(1);

    const saved = await openPlayer(page, CARDS.saved.player);
    await expect(saved.filter({ hasText: `${CARDS.saved.team} · 2021–2023` }), "Save & next wrote the form as edited").toHaveCount(1);
    await expect(saved).toHaveCount(1);

    for (const k of ["escaped", "teamless"] as const) {
      // openPlayer asserts his detail is up (the positive), so an empty career is a real empty.
      const lines = await openPlayer(page, CARDS[k].player);
      await expect(lines, `${CARDS[k].player}: nothing was added`).toHaveCount(0);
    }
  },
);
