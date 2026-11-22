// NEO-463 on the NEO-645 Tidy Up walk (R1): a ONE-WORD printed player name that is the first
// or last word of a fuller-named player in the same sport is never offered as a plain "Add as
// new player". The Player tile asks "Just <name>? We've got <fuller name>. …", offers the
// fuller player as a "Link to <name>" choice, and its create becomes "Add as a one-name player"
// (the genuine mononym). Both answers are driven on the one row: the link, then Change, then
// the one-name player; each lands at once (J1) and reads back on the row.
//
// FIXTURE (SET-REGISTRY.md, the `twf`/`twg` prefixes; R7a): a per-attempt sport `twf<token>`
// with year 2026, brand Topps and ONE set `twg<token>` with `Insert` › `Base`, all hand-made with
// no marketplace id, so the Sync is checklist-only (a pasted one-row checklist is the one source:
// no Match Cards, no BSC) and nothing is looked up (a hand-made sport has no Wikidata mapping).
// The fuller player `Dee Frg<token>` is added from Player Management first; the checklist prints
// the bare `Frg<token>` on card #1 ("No Team", so the card has nothing else to fix). Minted per
// attempt, so the spec is not fresh-only. Nothing is deleted: the sport, its rows, the card and
// both players (`Dee Frg<token>`, the one-name `Frg<token>`) stand.
// Replaces `checklist-wizard-name-fragment-asks-operator` (the pre-save wizard, on the real
// Fort Worth Fire CHL set): the walk saves the cards before it opens, so a real set can no longer
// be read and left unwritten (NEO-645 decision 10).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton, escapeRe } from "../../support/cards";
import { addPlayerByHand, expectPlayersLoaded, playersCounter, PLAYERS_MATCHES } from "../../support/players";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  needsYouPill,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  tidyFooterButton,
  tidyTile,
  tidyWalk,
} from "../../support/tidy-walk";
import { tidyUpName } from "../../support/wizard";

const YEAR = "2026";

test(
  "Tidy Up — a one-word name that is part of a fuller player's name asks the operator: link the fuller player, or add a one-name player",
  { tag: ["@smoke", "@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `twf${T}`;
    const SET = `twg${T}`;
    const ONE_WORD = `Frg${T}`;
    const FULLER = `Dee ${ONE_WORD}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the sport, then the fuller player in it ──
    await drillToCustom(page, { sport: SPORT });
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, FULLER, SPORT);

    // ── FIXTURE: the hand-made leaf, its one-row checklist printing the bare word ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    await usePastedChecklist(page, `number,player,team\n1,${ONE_WORD},No Team\n`, 1);
    await syncChecklistButton(page).click();

    // ── The commit saves the card, and the walk opens on it ──
    const opened = await settleWalkAfterCommit(page, page.getByText(/Saved 1 cards\./).first());
    expect(opened, "the card's one-word name needs an answer, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));
    await expect(walk.getByText(`#1 · ${ONE_WORD}`, { exact: true })).toBeVisible();

    // ── STEP 1: the question, with the fuller name as a link choice ──
    const row = tidyTile(page, "Player").getByRole("group", { name: `Player ${ONE_WORD}`, exact: true });
    // Settle the row first: it holds its answers until both name lookups have answered.
    await expect(row.getByText("Checking for players by that name…")).toHaveCount(0);
    const question = row.getByRole("group", { name: new RegExp(`^Just ${escapeRe(ONE_WORD)}\\? We've got `) });
    const linkFuller = question.getByRole("button", { name: new RegExp(`^Link to ${escapeRe(FULLER)}(,|$)`) });
    const oneName = row.getByRole("button", { name: "Add as a one-name player", exact: true });
    const change = row.getByRole("button", { name: "Change", exact: true });
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(question).toBeVisible();
    await expect(linkFuller).toBeVisible();
    await expect(oneName).toBeVisible();
    // The plain create is never offered for a fragment.
    await expect(row.getByRole("button", { name: /^Add as new player/ })).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a one-word name that is part of a fuller name" });

    // ── STEP 2: link the fuller player; the row reads answered, naming him ──
    await linkFuller.click();
    await expect(change).toBeVisible();
    await expect(row.getByText(FULLER, { exact: true })).toBeVisible();
    await expect(question).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);

    // ── STEP 3: Change takes the answer back; the question returns, and the one-name answer lands ──
    await change.click();
    await expect(question).toBeVisible();
    await expect(change).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await oneName.click();
    await expect(change).toBeVisible();
    // The card now carries the one-name player, not the fuller one.
    await expect(row.getByText(ONE_WORD, { exact: true })).toBeVisible();
    await expect(row.getByText(FULLER, { exact: true })).toHaveCount(0);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a one-name player added" });

    // ── STEP 4: Save & next ends the walk; Back returns to the card, still answered ──
    await saveAndNext(page);
    await expect(tidyFooterButton(page, "done")).toBeVisible();
    await page.goBack();
    await expect(walk.getByText(`#1 · ${ONE_WORD}`, { exact: true })).toBeVisible();
    await expect(change).toBeVisible();
    await saveForLater(page);
    // Nothing on the checklist needs a person any more (positive first: the card is listed).
    await expect(editCardButton(page, "1")).toBeVisible();
    await expect(needsYouPill(page)).toHaveCount(0);

    // ── STEP 5: both players are on file in the sport, once each ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await page.getByRole("combobox", { name: "Sport", exact: true }).selectOption({ label: SPORT });
    await page.getByRole("textbox", { name: "Filter players" }).fill(ONE_WORD);
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    const listed = (name: string) =>
      page.getByRole("main").getByRole("button", { name: new RegExp(`^${escapeRe(name)}\\s*${escapeRe(SPORT)}`) });
    await expect(listed(FULLER)).toHaveCount(1);
    await expect(listed(ONE_WORD)).toHaveCount(1);
  },
);
