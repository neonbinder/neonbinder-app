// R1 - ONE feature (NEO-645): Tidy Up walks a checklist ONE CARD AT A TIME.
// Each card shows its header ("#<n> · <name>") and no tally under it (a pink
// card's "to fix" count is the footer's status line, NEO-645 C2; a blue tile says
// "To check" itself), and the header says how many cards are left. The footer moves:
//   * Save & next (Enter) is held while anything on the card is pink, and the
//     status line says why ("1 to fix before this card can save. ...");
//   * Save for later (Esc) closes the walk and writes nothing;
//   * Skip: not ready to list moves on and writes nothing;
//   * Back, and the browser's Back, step to the card before;
//   * the end screen counts every walked card by what its data says NOW
//     (NEO-656 J5/B20): a pink card is "skipped, not ready to list", a blue one
//     is "still to check" whether it was Skipped or Saved & next'd (nothing
//     records a card as seen), and its button names what it reviews ("Review
//     the skipped card" while one is pink). It reopens the cards still flagged
//     from the first of them ("N cards left" again), and the browser's Back
//     returns to the end screen with its verdict, tally and button unchanged.
// The position is the address (`?tidy=<card>`): a pasted link opens that card,
// and an id that is none of this checklist's cards opens the first card.
//
// The flow, on three hand-added cards (walk order is the card number):
//   #1 no team -> pink (Team, "To fix"). Skipped, so it stays flagged.
//   #2 no team -> pink. Answered in the walk ("No team on this card"), then
//      Enter saves it.
//   #3 a team too long for the title -> blue (Listing title, "To check": the
//      title had to give up the team). Save & next writes nothing for it (no
//      career gap on screen) and nothing records it as seen (J4/J5), so it
//      stays blue: the end screen counts it "still to check" after Save & next
//      and again after Skip, and the checklist keeps its mark.
//
// R2 - every move is proved by the card that lands (`skipCard`/`saveAndNext`
// compare the "#..." lines before and after) and by the count after the walk:
// the pill drops from "3 need you, 2 to fix" to "2 need you, 1 to fix" (#1, skipped and
// still pink; #3, still blue). Enter on the pink #1 is held: the Skip right after it lands on
// #2, which it could not if Enter had already moved the walk on. Every
// negative (`toHaveCount(0)`, `toBeHidden`) sits beside a positive.
//
// Focus (NEO-645, Jason 2026-11-23: "The focus should start with the first Error
// and if there are no errors then focus should be on the green next button."):
// whatever puts a card on screen (opening the walk, Skip, Save & next, Back, a
// pasted link) and after a tile answer, focus is on the first control of the
// first pink tile; with nothing pink, on "Save & next (Enter)". Here the pink
// tile is Team, whose first control on a card with no team and no career is
// "Other team…". After "No team on this card" focus is on Save & next, so Enter
// there saves and moves on. Where the spec needs Enter or Escape to reach the
// card and not the focused control, it clicks the header line first (a mouse
// user's way back to the card).
//
// Fixture arithmetic for #3: a card's own name is always in its title (NEO-645;
// "WalkC<token>" is no player's and no placeholder, and it is never cut, like a
// surname), so the full title is "2024 Topps twk<token> Base Insert WalkC<token>
// #3 <team> Baseball". ATTEMPT_TOKEN is 1 to 12 characters, so the shortest core
// the cut can leave (sport, type name and Base gone) is "2024 Topps twk<token>
// WalkC<token> #3", 24 to 46 characters: the 70-character team never fits beside
// it (>= 95), and the title without the team always does (computed offline with
// `assessListingTitle`: 46 to 68 characters, nothing else dropped). The team has
// no Location, so it can only go whole: the Tidy Up cut (NEO-609), "listing
// title was cut short", never the purple set-name note (no set name was
// shortened).
//
// Desktop and mobile - the walk is full-screen on a phone with the same
// controls and names; nothing branches. axe (light and dark) on a pink card, a
// blue card and the end screen.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `twk<token>` under the
// REAL Baseball > 2024 > Topps, `Insert` > `Base`, no marketplace id anywhere
// beneath it (SET-REGISTRY.md, prefix `twk`); three hand-added cards and one
// minted team, all made in the UI. Nothing is deleted: the set is this
// attempt's alone and no other spec reads it.
import type { Page } from "@playwright/test";
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, setBuilderReady } from "../../support/set-builder";
import { addCardViaForm, createTeamInCardForm, escapeRe } from "../../support/cards";
import {
  expectCardSettled,
  expectCardsLeft,
  expectTidyEndScreen,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  skipCard,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

/** The walk's position in the address (`?tidy=<card>`); read off the URL a person sees. */
function tidyParam(page: Page): string {
  return new URL(page.url()).searchParams.get("tidy") ?? "";
}

/** The current address with the walk's position set to `value`: the link a person would paste. */
function withTidy(page: Page, value: string): string {
  const url = new URL(page.url());
  url.searchParams.set("tidy", value);
  return url.toString();
}

test(
  "Tidy Up walks one card at a time: Save & next held while pink, Esc saves for later, Skip counts at the end, Back, and a pasted link",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const token = env.ATTEMPT_TOKEN;
    const set = `twk${token}`;
    const cardA = { number: "1", name: `WalkA${token}` };
    const cardB = { number: "2", name: `WalkB${token}` };
    const cardC = { number: "3", name: `WalkC${token}` };
    // One token, 70 characters (see the arithmetic above).
    const longTeam = `Twk${token}`.padEnd(70, "x");
    const header = (card: { number: string; name: string }) => `#${card.number} · ${card.name}`;
    const pinkBadge = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(n)}(, .*)? needs attention: no team on this card yet$`) });
    const blueBadge = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(n)}(, .*)? is worth a check: listing title was cut short$`) });
    const anyMark = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(n)}(, .*)? (needs attention|is worth a check): `) });
    const walk = tidyWalk(page);
    const title = tidyUpName({ year: "2024", set });
    // The focus rule's two landings: the pink Team tile's first control, else Save & next.
    const firstPinkControl = tidyTile(page, "Team").getByRole("button", { name: "Other team…", exact: true });
    const saveAndNextButton = tidyFooterButton(page, "saveAndNext");

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    });

    await addCardViaForm(page, { cardNumber: cardA.number, playerName: cardA.name });
    await addCardViaForm(page, { cardNumber: cardB.number, playerName: cardB.name });
    await addCardViaForm(page, {
      cardNumber: cardC.number,
      playerName: cardC.name,
      beforeSubmit: () => createTeamInCardForm(page, longTeam),
    });
    // The precondition: two pink cards and one blue one, all three counted.
    await expect(pinkBadge(cardA.number)).toBeVisible();
    await expect(pinkBadge(cardB.number)).toBeVisible();
    await expect(blueBadge(cardC.number)).toBeVisible();
    await expect(needsYouPill(page)).toHaveText("3 need you, 2 to fix");

    // ── #1, pink: the header, the count, Save & next held, and the footer's line says why ──
    await openTidyWalk(page, { title });
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expectCardsLeft(page, 3);
    await expect(tidyTile(page, "Team")).toHaveAccessibleDescription("To fix");
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toHaveText(
      "1 to fix before this card can save. Skip it and it can't be listed until it's fixed.",
    );
    // The first card of a sitting has nothing before it.
    await expect(tidyFooterButton(page, "back")).toHaveAttribute("aria-disabled", "true");
    // Focus: opening on a pink card lands on the first pink control, not the header or Save & next.
    await expect(firstPinkControl, "the walk opened with focus on the first pink control").toBeFocused();
    const idA = tidyParam(page);
    expect(idA, "the walk's position is in the address").not.toBe("");
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a card with something to fix" });

    // Enter is held while pink: the Skip after it lands on #2, never #3.
    await tidyCardHeader(page, header(cardA)).click();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idA)}(&|$)`));
    await skipCard(page);
    await expect(tidyCardHeader(page, header(cardB))).toBeVisible();
    await expectCardsLeft(page, 2);
    await expect(tidyFooterButton(page, "back", { usable: true })).toBeVisible();
    await expect(firstPinkControl, "Skip landed on a pink card: focus on its first pink control").toBeFocused();
    const idB = tidyParam(page);
    expect(idB).not.toBe(idA);

    // ── Esc = Save for later: the walk closes and nothing was written ──
    await tidyCardHeader(page, header(cardB)).click();
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]tidy=/);
    await expect(needsYouPill(page)).toHaveText("3 need you, 2 to fix");
    await expect(pinkBadge(cardA.number)).toBeVisible();

    // The pill starts a new sitting: the skipped #1 is offered again.
    await openTidyWalk(page, { title });
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expectCardsLeft(page, 3);
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();
    await expect(needsYouPill(page)).toHaveText("3 need you, 2 to fix");

    // ── A pasted link opens that card, not the first ──
    await page.goto(withTidy(page, idB));
    // A full page load is a cold launch, like the sign-in's first page (LAUNCH_GATE, R4).
    await expect(walk).toBeVisible({ timeout: LAUNCH_GATE });
    await expectCardSettled(page);
    await expect(tidyCardHeader(page, header(cardB))).toBeVisible();
    await expect(tidyCardHeader(page, header(cardA))).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idB)}(&|$)`));
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();

    // ── An id that is none of this checklist's cards opens the first card ──
    await page.goto(withTidy(page, `nosuchcard${token}`));
    await expect(walk).toBeVisible({ timeout: LAUNCH_GATE });
    await expectCardSettled(page);
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idA)}(&|$)`));
    await expect(page).not.toHaveURL(/[?&]tidy=nosuchcard/);

    // ── The walk itself: skip #1, answer #2 and Enter, Enter on blue #3 ──
    await skipCard(page);
    await expect(tidyCardHeader(page, header(cardB))).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await tidyTile(page, "Team").getByRole("button", { name: "No team on this card", exact: true }).click();
    await expect(tidyTile(page, "Team").getByText("No team on this card.", { exact: true })).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(mustFixLine(page)).toHaveCount(0);
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    // The answer left nothing pink, so focus went on to Save & next: Enter there saves and moves on.
    await expect(saveAndNextButton, "after the answer, focus is on Save & next").toBeFocused();
    await page.keyboard.press("Enter");
    await expect(tidyCardHeader(page, header(cardC))).toBeVisible();
    await expectCardSettled(page);
    // #3 is blue: something to check, nothing to fix, so Save & next is not held.
    await expect(tidyTile(page, "Listing title")).toHaveAccessibleDescription("To check");
    // No tally under the header (NEO-645): the tile's own "To check" is the only place it is said.
    await expect(tidyCardHeader(page, header(cardC))).toBeVisible();
    await expect(walk.getByText(/^[0-9]+ to check$/)).toHaveCount(0);
    // Focus: a card with nothing pink lands on Save & next.
    await expect(saveAndNextButton, "a card with nothing pink opens with focus on Save & next").toBeFocused();
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expectCardsLeft(page, 1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a card to check" });

    // ── Back: the browser's Back, then the footer's ──
    await page.goBack();
    await expect(tidyCardHeader(page, header(cardB))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idB)}(&|$)`));
    // #2 is answered, nothing pink: the browser's Back lands focus on Save & next.
    await expect(saveAndNextButton, "Back to a card with nothing pink: focus on Save & next").toBeFocused();
    await tidyFooterButton(page, "back", { usable: true }).click();
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idA)}(&|$)`));
    // #1 is still pink (Back is no answer); skipping it again goes past the answered #2.
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(firstPinkControl, "Back to a pink card: focus on its first pink control").toBeFocused();
    await skipCard(page);
    await expect(tidyCardHeader(page, header(cardC))).toBeVisible();

    // ── Save & next on the blue #3: the end screen counts it by its data, still to check ──
    await saveAndNext(page);
    // #1 is pink (skipped), #3 is blue though it was saved (nothing records it as seen), #2 is fixed.
    await expectTidyEndScreen(page, { fixed: 1, skipped: 1, stillToCheck: 1 });
    // The button names what it reviews: with a pink card left, the skipped card.
    const review = walk.getByRole("button", { name: "Review the skipped card", exact: true });
    await expect(review).toBeVisible();
    await expect(walk.getByRole("button", { name: /^(Review the [0-9]+ skipped|Check the )/ })).toHaveCount(0);
    await expectCardsLeft(page, 0);
    const endUrl = page.url();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk end screen with a skipped card and one still to check" });

    // Review lands on the first card still flagged (#1, not the answered #2); #1 and the blue #3
    // both count as left again.
    await review.click();
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expectCardSettled(page);
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idA)}(&|$)`));
    await expectCardsLeft(page, 2);
    await expect(review).toHaveCount(0);

    // The browser's Back returns to the end screen, the verdict, tally and button as they were.
    await page.goBack();
    await expect(page).toHaveURL(endUrl);
    await expectTidyEndScreen(page, { fixed: 1, skipped: 1, stillToCheck: 1 });
    await expect(review).toBeVisible();
    await expect(tidyCardHeader(page, header(cardA))).toHaveCount(0);
    await expectCardsLeft(page, 0);

    // Review again, skip #1 a last time, and SKIP the blue #3 this time.
    await review.click();
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expectCardsLeft(page, 2);
    await skipCard(page);
    await expect(tidyCardHeader(page, header(cardC))).toBeVisible();
    await expect(tidyTile(page, "Listing title"), "#3 is still blue after Save & next").toHaveAccessibleDescription("To check");
    await expectCardsLeft(page, 1);

    // ── Skip on the blue card ends the same as Save & next did: the data decides ──
    await skipCard(page);
    await expectTidyEndScreen(page, { fixed: 1, skipped: 1, stillToCheck: 1 });
    await expect(review).toBeVisible();
    await expectCardsLeft(page, 0);
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]tidy=/);

    // What was written: #2's answer alone. Skipped #1 is still pink and #3 is still blue.
    await expect(needsYouPill(page)).toHaveText("2 need you, 1 to fix");
    await expect(pinkBadge(cardA.number)).toBeVisible();
    await expect(blueBadge(cardC.number)).toBeVisible();
    await expect(anyMark(cardB.number)).toHaveCount(0);
  },
);
