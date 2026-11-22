// ONE FEATURE (R1, NEO-645 decision 32): the Tidy Up walk's "Add all N new players" adds, in one
// confirmed press, every printed player name nothing in NeonBinder answers (no player, no near
// spelling, no Wikidata ambiguity: a name Wikidata has no match for is the new-rookie case and is
// offered), links each on every card that prints it (nothing pink is left on them), and never
// offers a name players on file already answer to (that card still stops).
//
// The old wizard's "Add remaining players as new" was this control; without it a set of a hundred
// new rookies is a hundred per-card answers.
//
// The operator meets it like this:
//   1. The walk opens on #1. Above the card, the dashed "Add all 3 new players" (it arrives once
//      the names' lookups have finished and a settled read has asked the server, so it is waited
//      for, never assumed). It is collapsed (`aria-expanded=false`).
//   2. Pressing it opens the inline group "New players to add": the list "Names to add" holds the
//      three new names, each with the cards that print it ("#1, #4"), and not the name players on
//      file answer to. Its buttons are "Add 3 players" and "Cancel adding new players".
//   3. Esc closes only the confirm (the walk stays open, nothing written) and puts focus back on
//      the trigger.
//   4. Reopen, "Add 3 players": the status beside the trigger reads "Added 3 players.". Every
//      card printing those names has its player; #4 (Ulric's second card) leaves the walk, and
//      the card each player was made on (#1, #2, #3) stays BLUE with the new player's Career
//      check, as per-card "Add as new player" leaves it (plan: `newPlayerCareer`, only on the
//      card where the player was created). Four cards left.
//   5. Blue never holds: Save & next on #1, #2, #3 lands on #5; #4 is never shown, and #5's
//      Player tile is still pink.
//   6. Save for later; the checklist's pill counts the one card, pink ("1 needs you, 1 to fix"). Players admin lists each new name
//      once in this sport, and the on-file name twice, as before (no third one was made).
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `anp`/`anq` prefixes; R7a): a per-attempt sport
// `anp<token>` › 2026 › Topps › `anq<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted five-row checklist, no Match Cards, no BSC), and every
// name's lookup finishes with no Wikidata match without a request (a hand-made sport has no
// Wikidata mapping): the tile says "No Wikidata match found.". Every team cell is `No Team`, so a
// card's only question is its player. The two on-file players `Kenji Ank<token>` (the second told
// apart by a birth year) are made first in Players admin: ONE exact namesake is linked at the
// commit and never stops, so the "still stops" proof needs two. The four names share no first
// name and differ in their whole name by more than two letters, so no one is a "Did you mean" of
// another (lib/players/near-spelling.ts). Not fresh-only: every name carries the attempt token.
// Nothing is deleted; the sport, its rows, the five cards and the five players stand.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { addPlayerByHand, expectPlayersLoaded, playersCounter } from "../../support/players";
import { drillToCustom, escapeRe, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  addAllNewPlayersTrigger,
  expectCardSettled,
  expectCardsLeft,
  needsYouPill,
  newPlayersToAdd,
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
  "Tidy Up — Add all N new players adds every name nothing on file answers, in one confirmed press, and the name players on file answer to still stops",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `anp${T}`;
    const SET = `anq${T}`;
    const NEW = [`Ulric Anu${T}`, `Wanda Anw${T}`, `Xavier Anx${T}`] as const;
    /** Two players on file carry this name (FIXTURE 2). */
    const ON_FILE = `Kenji Ank${T}`;
    /** The cards that print each new name, as the confirm lists them. */
    const PRINTED_ON: Record<(typeof NEW)[number], string> = { [NEW[0]]: "#1, #4", [NEW[1]]: "#2", [NEW[2]]: "#3" };

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE 1: the hand-made leaf, empty ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    const empty = page.getByText("No cards in this checklist yet.");
    await expect(empty).toBeVisible();

    // ── FIXTURE 2: the one name players on file answer to (made before the checklist) ──
    // Two of them, told apart by a birth year: one exact namesake is linked at the commit (the
    // card never stops), two are the operator's "which one" question, which must keep stopping.
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, ON_FILE, SPORT);
    await page.getByRole("button", { name: "Add player" }).click();
    await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
    await page.getByRole("textbox", { name: "New player name" }).fill(ON_FILE);
    await page.getByLabel(/^Birth year \(optional\)/).fill("1990");
    await page.getByRole("button", { name: `Create player ${ON_FILE} anyway`, exact: true }).click();
    await expect(page.getByText(`Added ${ON_FILE}`)).toBeVisible();
    // Back: the set builder, on the same empty checklist.
    await page.goBack();
    await expect(setBuilderReady(page)).toBeVisible();
    await expect(empty).toBeVisible();

    // ── FIXTURE 3: the five-row checklist, committed by the Sync ──
    await usePastedChecklist(
      page,
      `number,player,team\n1,${NEW[0]},No Team\n2,${NEW[1]},No Team\n3,${NEW[2]},No Team\n4,${NEW[0]},No Team\n5,${ON_FILE},No Team\n`,
      5,
    );
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 5 cards\./).first());
    expect(opened, "five cards with unanswered player names, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expect(walk.getByText(`#1 · ${NEW[0]}`, { exact: true })).toBeVisible();
    await expectCardsLeft(page, 5);

    // ── STEP 1: the trigger, collapsed, offering exactly the three new names ──
    const trigger = addAllNewPlayersTrigger(page, 3);
    await expect(trigger, "the offer arrives once the names' lookups have finished").toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const confirm = newPlayersToAdd(page);
    await expect(confirm).toHaveCount(0);

    // ── STEP 2: the confirm lists the names and the cards that print them ──
    await trigger.click();
    await expect(confirm).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const names = confirm.getByRole("list", { name: "Names to add", exact: true });
    const items = names.getByRole("listitem");
    await expect(items).toHaveCount(3);
    for (const name of NEW) {
      await expect(items.filter({ hasText: name }), `${name} is offered with its cards`).toContainText(PRINTED_ON[name]);
    }
    await expect(items.filter({ hasText: ON_FILE }), "a name a player on file answers to is never offered").toHaveCount(0);
    const add = confirm.getByRole("button", { name: "Add 3 players", exact: true });
    const cancel = confirm.getByRole("button", { name: "Cancel adding new players", exact: true });
    await expect(add).toBeVisible();
    await expect(cancel).toBeVisible();
    // Focus opens on the list, so a second Enter never writes.
    await expect(names).toBeFocused();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, Add all new players confirm open" });

    // ── STEP 3: Esc closes only the confirm, nothing written, focus back on the trigger ──
    await names.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(walk, "Esc on the confirm is not Save for later").toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expectCardsLeft(page, 5);

    // ── STEP 4: reopen and add; every card printing those names has its player ──
    await trigger.click();
    await expect(confirm).toBeVisible();
    await add.click();
    await expect(walk.getByRole("status").filter({ hasText: /^Added 3 players\.$/ })).toBeVisible();
    await expect(confirm).toHaveCount(0);
    // #4 (Ulric's second card) leaves the walk: linked, nothing to check. #1-#3 stay, each BLUE
    // with the new player's Career check (the card a player is made on, as per-card "Add as new
    // player" does); #5 stays pink.
    await expectCardsLeft(page, 4);
    await expect(walk.getByText(`#1 · ${NEW[0]}`, { exact: true })).toBeVisible();

    // ── STEP 5: each new player's card is blue, never held; Save & next lands on #5 without #4 ──
    for (const [i, name] of NEW.entries()) {
      await expect(walk.getByText(`#${i + 1} · ${name}`, { exact: true })).toBeVisible();
      await expectCardSettled(page);
      await expect(pinkTile(page, "Player"), `#${i + 1}'s player was added`).toHaveCount(0);
      await expect(
        tidyTile(page, "Player").getByRole("group", { name: `Player ${name}`, exact: true }).getByRole("button", { name: /^Change player( .+)?$/ }),
      ).toBeVisible();
      await expect(tidyTile(page, "Career"), `#${i + 1} is where ${name} was made: a Career check`).toHaveAccessibleDescription(/To check/);
      await expect(walk.getByText("1 to check", { exact: true })).toBeVisible();
      await expect(walk.getByText(/^[0-9]+ to fix$/)).toHaveCount(0);
      await expectCardsLeft(page, 4 - i);
      await saveAndNext(page);
    }
    await expect(walk.getByText(`#5 · ${ON_FILE}`, { exact: true })).toBeVisible();
    await expect(walk.getByText(`#4 · ${NEW[0]}`, { exact: true }), "#4 was answered by the add").toHaveCount(0);
    await expectCardSettled(page);
    await expect(pinkTile(page, "Player"), "the name a player on file answers to still stops").toHaveCount(1);
    await expect(
      tidyTile(page, "Player")
        .getByRole("group", { name: `Player ${ON_FILE}`, exact: true })
        .getByRole("button", { name: /^Not a player \(checklist, team card, stadium\)( .+)?$/ }),
    ).toBeVisible();
    await expectCardsLeft(page, 1);

    // ── STEP 6: the pill counts the one card; Players admin holds each name once ──
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you, 1 to fix");
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    const sportPicker = page.getByRole("combobox", { name: "Sport", exact: true });
    await sportPicker.selectOption({ label: SPORT });
    await expect(sportPicker.getByRole("option", { selected: true })).toHaveText(SPORT);
    const filter = page.getByRole("textbox", { name: "Filter players" });
    for (const [name, count] of [...NEW.map((n) => [n, 1] as const), [ON_FILE, 2] as const]) {
      await filter.fill(name);
      await expect(playersCounter(page, count === 1 ? "1 match" : `${count} matches`)).toBeVisible();
      await expect(
        page.getByRole("main").getByRole("button", { name: new RegExp(`^${escapeRe(name)}\\s*${escapeRe(SPORT)}`) }),
        `${name} is on file ${count} time(s) in ${SPORT}: the add made each new name once and no third ${ON_FILE}`,
      ).toHaveCount(count);
    }
  },
);
