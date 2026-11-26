// ONE FEATURE (R1, NEO-656 B1/B3c): in the Tidy Up walk, "Not a player (checklist, team card,
// stadium)" clears a printed name from the OPEN card only; "Apply to all cards printing “NAME”"
// clears it from every other card still waiting on it; and Edit on "NAME is not a player." asks
// again, on the open card only, while the walk is on it. Nothing remembers the answer: once the walk
// leaves the card, the card is what it is (Jason, 2026-09-28: "We should not be keeping answers to
// anything"), and the checklist counts each card by its live data (J5).
//
// Replaces checklist-wizard-skip-not-a-person and checklist-wizard-skip-commits-and-unskip (the old
// wizard's per-row skip and the "Skipped names" panel with its Unskip; NEO-645 decision 19).
//
// The operator meets it like this:
//   1. Card #1 asks about NAME, printed on #1 and #2. Three cards are left (#3 prints OTHER).
//   2. "Not a player" on #1: the row says NAME is not a player, with "Edit NAME" and "Apply to all
//      cards printing “NAME”". Only #1 is cleared: two cards are left (#2 still waits on NAME).
//   3. Edit: the row asks again, pink, and #1 is back (three left).
//   4. "Not a player" again, then Apply to all: "Cleared 1 more card.", one card left (#3).
//   5. Save & next lands on #3: the walk never shows #2.
//   6. Back to #1: nothing was remembered. The card no longer prints a name to ask about, so there
//      is no "NAME is not a player.", no Edit and no question.
//   7. Save for later: the pill counts #3 alone, and #2's drawer names no player.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `tsk`/`tsl` prefixes; R7a): a per-attempt sport
// `tsk<token>` › 2026 › Topps › `tsl<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted three-row checklist, no Match Cards, no BSC) and nothing
// is looked up (a hand-made sport has no Wikidata mapping). Every team cell is `No Team` (a claim of
// none), so the cards' only problem is the name. Not fresh-only. Nothing is deleted; the sport,
// its rows and its three cards stand, and no player is made.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { anyPlayerChip, closeCardDrawer, openCardDrawer } from "../../support/also-pictured";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  applyNameToAll,
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
/** The row's answer; on a multi-name card it carries " <printed>", which these cards are not. */
const NOT_A_PLAYER = "Not a player (checklist, team card, stadium)";

test(
  "Tidy Up — Not a player clears a printed name from the open card, Apply to all clears it from every card waiting on it, and Edit asks again only while the card is open",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `tsk${T}`;
    const SET = `tsl${T}`;
    const NAME = `Arena Tsk${T}`;
    const OTHER = `Oth Tsk${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its three-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${NAME},No Team\n2,${NAME},No Team\n3,${OTHER},No Team\n`, 3);
    await syncChecklistButton(page).click();

    // ── The commit saves the three cards, and the walk opens on its own ──
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 3 cards\./).first());
    expect(opened, "three cards with unanswered names, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));

    const header = (number: string, who: string) => walk.getByText(`#${number} · ${who}`, { exact: true });
    // Any "#<number>…" line of a card, whoever it names: once NAME is cleared from a card its header
    // no longer names him.
    const cardLines = (number: string) => walk.getByText(new RegExp(`^#${number}( · .+)?$`));
    const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${NAME}`, exact: true });
    const notAPlayer = row.getByRole("button", { name: NOT_A_PLAYER, exact: true });
    // The answered row's Edit (NEO-645 C1): a not-a-player row is named for its printed name.
    const edit = row.getByRole("button", { name: `Edit ${NAME}`, exact: true });
    const applyToAll = row.getByRole("button", { name: `Apply to all cards printing “${NAME}”`, exact: true });
    const answered = row.getByText(`${NAME} is not a player.`);

    // ── STEP 1: #1 asks about the name, printed on #1 and #2 ──
    await expect(header("1", NAME)).toBeVisible();
    await expectCardsLeft(page, 3);
    await expect(row.getByText("Printed on #1, #2", { exact: true })).toBeVisible();
    await expect(notAPlayer).toBeVisible();
    await expect(edit).toHaveCount(0);
    await expect(applyToAll, "Apply to all comes after an answer, never before").toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name printed on two cards" });

    // ── STEP 2: Not a player clears the open card only (B1) ──
    await notAPlayer.click();
    await expect(answered).toBeVisible();
    await expect(edit).toBeVisible();
    await expect(applyToAll, "#2 still waits on the name, so Apply to all is offered").toBeVisible();
    await expect(notAPlayer).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    // #1 is cleared; #2 and #3 are still flagged. A fan-out on the answer itself would leave one.
    await expectCardsLeft(page, 2);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name answered as not a player" });

    // ── STEP 3: Edit, while the card is open, asks again (B3c) ──
    await edit.click();
    await expect(notAPlayer, "Edit brought the question back").toBeVisible();
    await expect(answered).toHaveCount(0);
    await expect(edit).toHaveCount(0);
    await expect(applyToAll).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expectCardsLeft(page, 3);

    // ── STEP 4: Not a player again, then Apply to all clears #2 ──
    await notAPlayer.click();
    await expect(answered).toBeVisible();
    await expectCardsLeft(page, 2);
    expect(await applyNameToAll(page, "Player", NAME), "Apply to all cleared #2, the one other card printing the name").toBe(
      "Cleared 1 more card.",
    );
    await expectCardsLeft(page, 1);
    // The pressed button stays, held, beside its line: no other card waits on the name now.
    await expect(applyToAll, "Apply to all is done: nothing left to apply to").toBeDisabled();
    await expect(answered).toBeVisible();

    // ── STEP 5: Save & next passes #2 by: Apply to all cleared it ──
    await saveAndNext(page);
    await expect(header("3", OTHER)).toBeVisible();
    await expect(cardLines("2"), "#2 was cleared by Apply to all, so the walk never shows it").toHaveCount(0);

    // ── STEP 6: Back to #1: the answer was not remembered, and the card asks nothing about NAME ──
    await page.goBack();
    await expect(cardLines("1").first()).toBeVisible();
    await expect(cardLines("3")).toHaveCount(0);
    await expectCardSettled(page);
    // R2: the card's tiles are drawn (its Team tile, from the same card read) before the negatives:
    // the Player tile, when it is drawn, comes with them, so a remembered answer would be on screen.
    await expect(tidyTile(page, "Team").getByText("No team on this card.", { exact: true })).toBeVisible();
    await expect(answered, "the walk left the card, so it holds no answer to show").toHaveCount(0);
    await expect(edit).toHaveCount(0);
    await expect(notAPlayer, "the card no longer prints the name, so it is not asked again").toHaveCount(0);
    await expect(tidyTile(page, "Player"), "#1 has no player and no name waiting: no Player tile").toHaveCount(0);
    await expectCardsLeft(page, 1);

    // ── STEP 7: the checklist counts #3 alone, by its live data; #2 names no player ──
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("1 needs you, 1 to fix");
    const cleared = await openCardDrawer(page, "2");
    await expect(anyPlayerChip(cleared), "Apply to all cleared the name from #2").toHaveCount(0);
    await closeCardDrawer(cleared);
  },
);
