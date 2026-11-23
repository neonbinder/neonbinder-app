// ONE FEATURE (R1, NEO-645, Jason 2026-11-23: "there should always be a name associated with the
// card"): a card with no player and only NB's placeholder name ("Card #3") is a pink "Card name" tile
// on the Tidy Up walk. Save & next is held until it is answered; a blank or placeholder answer is
// refused with the tile's own sentence; a real name ("Checklist") clears the tile, renames the card
// and rebuilds its listing title with the name in it (after the levels, before the number). A
// checklist row whose subject is no person ("Team Card") is STORED as the card's name, so that card
// is never asked (the counter-fixture).
//
// The operator meets it like this:
//   1. A two-row checklist is pasted and synced (checklist-only: no Match Cards). The walk opens by
//      itself with ONE card left, #3 ("#3 · Card #3"): its only pink tile is Card name, the footer
//      says "1 to fix…" and Save & next is held. The pill reads "1 needs you, 1 to fix": #4, the Team
//      Card, needs nothing. The listing title has #3 and no "Checklist".
//   2. "Save name" with the box empty is refused ("Type what this card is, like Checklist or Team
//      Card."), the box marked invalid; typing clears the refusal; "Card #3" + Enter is refused the
//      same way, and Enter saved in place (the walk is still on #3). Axe, light and dark.
//   3. "Checklist" + Save name: the Card name tile is gone, the header reads "#3 · Checklist", nothing
//      is pink, and the Listing title tile shows "…Checklist… #3". Save & next reaches the end screen
//      ("1 card fixed, 0 skipped. Totally rad."). Back returns to #3, still answered; Forward to the
//      end; Done.
//   4. Read back from the stored cards: no pill, #3's drawer holds the name Checklist and a title
//      carrying it, #4's the name Team Card and a title carrying it.
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `cnm`/`cnn` prefixes; R7a): a per-attempt sport
// `cnm<token>` › 2026 › Topps › `cnn<token>` › Insert › Base, all hand-made with no marketplace id, so
// the Sync is checklist-only (a pasted two-row checklist, no Match Cards, no BSC) and no name reaches
// a lookup (no player at all). Both rows say "No Team" (the checklist's claim), so the name is the
// only question either card could raise. Not fresh-only: every name carries the attempt token.
// Nothing is deleted; the sport, its rows and the two cards stand, no player or team is made.
//
// Desktop and mobile: one spec, no branch (role and label locators; click() scrolls).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { closeCardDrawer, openCardDrawer } from "../../support/also-pictured";
import { usePastedChecklist } from "../../support/published-checklist";
import { drillToCustom, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  expectCardSettled,
  expectCardsLeft,
  finishTidyWalk,
  mustFixLine,
  needsYouPill,
  pinkTile,
  saveAndNext,
  settleWalkAfterCommit,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";
/** CardNameTile's refusal, word for word. */
const REFUSAL = "Type what this card is, like Checklist or Team Card.";
/** The name the operator gives #3, and the subject #4's row prints. */
const ANSWER = "Checklist";
const SUBJECT = "Team Card";
/** A listing title with the card's own name ahead of its number. */
const TITLED = (name: string) => new RegExp(`\\b${name}\\b.*#3\\b`);

test(
  "Tidy Up — a card with no player and a placeholder name is a pink Card name tile: Save & next waits, a blank or Card #N answer is refused, a real name clears it and goes into the listing title; a checklist subject is stored as the name",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `cnm${T}`;
    const SET = `cnn${T}`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made leaf and its two-row checklist ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    // #3 prints nothing in its subject (NB names it "Card #3"); #4 prints "Team Card", no person.
    await usePastedChecklist(page, `number,player,team\n3,,No Team\n4,${SUBJECT},No Team\n`, 2);
    await syncChecklistButton(page).click();
    const opened = await settleWalkAfterCommit(page, page.getByText(/^Saved 2 cards\./).first());
    expect(opened, "the nameless card needs a name, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET }));

    const cardName = tidyTile(page, "Card name");
    const nameBox = cardName.getByRole("textbox", { name: "Name for this card", exact: true });
    const saveName = cardName.getByRole("button", { name: "Save name", exact: true });
    const refusal = cardName.getByRole("alert").filter({ hasText: REFUSAL });
    const listingTitle = tidyTile(page, "Listing title");
    const saveUsable = tidyFooterButton(page, "saveAndNext", { usable: true });

    // ── STEP 1: #3 alone, its name the one thing pink; #4's stored subject asks nothing ──
    await expect(tidyCardHeader(page, "#3 · Card #3")).toBeVisible();
    await expectCardSettled(page);
    await expectCardsLeft(page, 1);
    await expect(needsYouPill(page), "only #3 needs you: #4's subject is its name").toHaveAccessibleName("1 needs you, 1 to fix");
    await expect(pinkTile(page, "Card name")).toHaveCount(1);
    await expect(cardName.getByText("No player on this card. What is it? Checklist, Team Card, a stadium…", { exact: true })).toBeVisible();
    await expect(tidyTile(page, "Player"), "no player on the card, so no Player tile").toHaveCount(0);
    await expect(pinkTile(page, "Team"), "the checklist's No Team answered the team").toHaveCount(0);
    await expect(walk.getByText(/^1 to fix before this card can save\./)).toBeVisible();
    await expect(tidyFooterButton(page, "saveAndNext"), "pink holds Save & next").toBeDisabled();
    await expect(saveUsable).toHaveCount(0);
    // The placeholder is no name: the title carries the number and not the answer to come.
    await expect(listingTitle.getByText(/#3\b/)).toBeVisible();
    await expect(listingTitle.getByText(new RegExp(`\\b${ANSWER}\\b`))).toHaveCount(0);

    // ── STEP 2: a blank answer, then the placeholder itself, are refused ──
    await expect(nameBox).toHaveValue("");
    await saveName.click();
    await expect(refusal, "a blank name is refused").toBeVisible();
    await expect(nameBox).toHaveAttribute("aria-invalid", "true");
    await nameBox.fill("Card #3");
    await expect(nameBox).toHaveValue("Card #3");
    await expect(refusal, "typing clears the refusal").toHaveCount(0);
    // Enter in the box is Save name, never Save & next: refused again, and the walk stays on #3.
    await nameBox.press("Enter");
    await expect(refusal, "the placeholder is no name, so it is refused").toBeVisible();
    await expect(nameBox).toHaveAttribute("aria-invalid", "true");
    await expect(tidyCardHeader(page, "#3 · Card #3")).toBeVisible();
    await expect(pinkTile(page, "Card name")).toHaveCount(1);
    await expect(saveUsable).toHaveCount(0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, a pink Card name tile refusing a placeholder name" });

    // ── STEP 3: a real name clears the tile and goes into the listing title ──
    await nameBox.fill(ANSWER);
    await saveName.click();
    await expect(cardName, "the name answered the card, so the tile is gone").toHaveCount(0);
    await expect(tidyCardHeader(page, `#3 · ${ANSWER}`), "the card is called what the operator typed").toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expect(saveUsable, "nothing on the card is pink").toBeVisible();
    // Rebuilt with the name after the levels and before the number (NEO-645 rule 4).
    await expect(listingTitle.getByText(TITLED(ANSWER))).toBeVisible();
    await saveAndNext(page);
    await expect(walk.getByText("1 card fixed, 0 skipped. Totally rad.", { exact: true })).toBeVisible();

    // Back steps through the walk's address to #3, still answered; Forward returns to the end.
    await page.goBack();
    await expect(tidyCardHeader(page, `#3 · ${ANSWER}`), "Back returned to the card").toBeVisible();
    await expectCardSettled(page);
    await expect(cardName).toHaveCount(0);
    await expect(listingTitle.getByText(TITLED(ANSWER))).toBeVisible();
    await page.goForward();
    await expect(tidyFooterButton(page, "done"), "Forward returned to the end screen").toBeVisible();
    await finishTidyWalk(page);

    // ── STEP 4: the stored cards: no card needs you; both carry their names into their titles ──
    await expect(page.getByText("No cards in this checklist yet.")).toHaveCount(0);
    await expect(needsYouPill(page), "no card is left needing a name").toHaveCount(0);
    for (const [number, name] of [["3", ANSWER], ["4", SUBJECT]] as const) {
      const drawer = await openCardDrawer(page, number);
      await expect(drawer.getByRole("textbox", { name: "Card name", exact: true })).toHaveValue(name);
      await expect(drawer.getByRole("textbox", { name: "Card title", exact: true })).toHaveValue(
        new RegExp(`\\b${name}\\b.*#${number}\\b`),
      );
      await closeCardDrawer(drawer);
    }
  },
);
