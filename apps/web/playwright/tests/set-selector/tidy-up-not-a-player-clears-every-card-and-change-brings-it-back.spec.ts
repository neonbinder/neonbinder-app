// ONE FEATURE (R1, NEO-645): in the Tidy Up walk, answering "Not a player (checklist, team card,
// stadium)" for a printed name clears that name on EVERY card that prints it, and pressing Change
// on the answered row brings the name back, pink, on every one of those cards.
//
// Replaces checklist-wizard-skip-not-a-person (a per-row skip in the old entity-review wizard,
// read back off its Save step) and checklist-wizard-skip-commits-and-unskip (the set's "Skipped
// names" panel and its Unskip). The panel is gone (NEO-645 decision 19): Change on the answered
// row is how a skipped name comes back, and it comes back on the cards at once.
//
// The operator meets it like this:
//   1. Card #1 asks about NAME, printed on #1 and #2. Three cards are left (#3 prints OTHER).
//   2. "Not a player" on #1: the row says NAME is not a player, with a Change, and #1 and #2 have
//      nothing left, so one card is left (#3).
//   3. Save & next lands on #3: the walk never shows #2.
//   4. Back returns to #1, still answered. Change clears the answer: the row asks again, pink,
//      and #2 is back in the walk (two left: #2 and #3; #1 was passed by Save & next, so the
//      sitting does not count it again).
//   5. Skip lands on #2, which asks about NAME again, pink.
//   6. Save for later: the checklist's pill counts all three cards.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `tsk`/`tsl` prefixes; R7a): a per-attempt sport
// `tsk<token>` › 2026 › Topps › `tsl<token>` › Insert › Base, all hand-made with no marketplace id,
// so the Sync is checklist-only (a pasted three-row checklist, no Match Cards, no BSC) and nothing
// is looked up (a hand-made sport has no Wikidata mapping). Every team cell is `No Team` (a claim of
// none), so the cards' only problem is the name. Not fresh-only. Nothing is deleted; the sport,
// its rows and its three cards stand, and no player is made.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  expectCardsLeft,
  needsYouPill,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  skipCard,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";
import { tidyUpName } from "../../support/wizard";

const YEAR = "2026";
/** The row's answer; on a multi-name card it carries " <printed>", which these cards are not. */
const NOT_A_PLAYER = "Not a player (checklist, team card, stadium)";
/** An answered row's Change; on a multi-name card it carries " <printed>", which these cards are not. */
const CHANGE = "Change player";

test(
  "Tidy Up — Not a player clears a printed name on every card that prints it, and Change brings it back on every card",
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
    // Any "#<number>…" line of a card, whoever it names: once NAME is answered as not a player the
    // header no longer has to name him.
    const cardLines = (number: string) => walk.getByText(new RegExp(`^#${number}( · .+)?$`));
    const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${NAME}`, exact: true });
    const notAPlayer = row.getByRole("button", { name: NOT_A_PLAYER, exact: true });
    const change = row.getByRole("button", { name: CHANGE, exact: true });
    const answered = row.getByText(`${NAME} is not a player.`);

    // ── STEP 1: #1 asks about the name, printed on #1 and #2 ──
    await expect(header("1", NAME)).toBeVisible();
    await expectCardsLeft(page, 3);
    await expect(row.getByText("Printed on #1, #2", { exact: true })).toBeVisible();
    await expect(notAPlayer).toBeVisible();
    await expect(change).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name printed on two cards" });

    // ── STEP 2: Not a player, saved at once, reaches both cards ──
    await notAPlayer.click();
    await expect(answered).toBeVisible();
    await expect(change).toBeVisible();
    await expect(notAPlayer).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    // #1 and #2 have nothing left; #3 is the one card still flagged. A per-card answer leaves two.
    await expectCardsLeft(page, 1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a name answered as not a player" });

    // ── STEP 3: Save & next passes #2 by: the answer cleared it ──
    await saveAndNext(page);
    await expect(header("3", OTHER)).toBeVisible();
    await expect(walk.getByText(/^#2 · /), "#2 was cleared by the answer, so the walk never shows it").toHaveCount(0);

    // ── STEP 4: Back to #1; Change brings the name back on every card ──
    await page.goBack();
    await expect(cardLines("1").first()).toBeVisible();
    await expect(cardLines("3")).toHaveCount(0);
    await expectCardSettled(page);
    await expect(answered).toBeVisible();
    await change.click();
    await expect(notAPlayer).toBeVisible();
    await expect(answered).toHaveCount(0);
    await expect(change).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    // #2 is flagged again (with #3). #1 is flagged too, but this sitting passed it with Save & next,
    // so "cards left" does not count it twice; the pill below does.
    await expectCardsLeft(page, 2);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, the not-a-player answer changed back" });

    // ── STEP 5: #2 asks about the name again ──
    await skipCard(page);
    await expect(header("2", NAME)).toBeVisible();
    await expect(cardLines("1")).toHaveCount(0);
    await expect(notAPlayer).toBeVisible();
    await expect(row.getByText("Printed on #1, #2", { exact: true })).toBeVisible();
    await expect(pinkTile(page, "Player")).toHaveCount(1);

    // ── STEP 6: the checklist counts all three cards as needing a person ──
    await saveForLater(page);
    await expect(needsYouPill(page)).toHaveAccessibleName("3 need you");
  },
);
