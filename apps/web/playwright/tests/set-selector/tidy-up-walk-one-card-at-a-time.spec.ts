// R1 - ONE feature (NEO-645): Tidy Up walks a checklist ONE CARD AT A TIME.
// Each card shows its header ("#<n> · <name>") and its tally ("1 to fix" /
// "1 to check"), and the header says how many cards are left. The footer moves:
//   * Save & next (Enter) is held while anything on the card is pink, and the
//     status line says why ("1 to fix before this card can save. ...");
//   * Save for later (Esc) closes the walk and writes nothing;
//   * Skip: not ready to list moves on and writes nothing; the end screen
//     counts the card ("1 card skipped, not ready to list");
//   * Back, and the browser's Back, step to the card before.
// The position is the address (`?tidy=<card>`): a pasted link opens that card,
// and an id that is none of this checklist's cards opens the first card.
//
// The flow, on three hand-added cards (walk order is the card number):
//   #1 no team -> pink (Team, "To fix"). Skipped, so it stays flagged.
//   #2 no team -> pink. Answered in the walk ("No team on this card"), then
//      Enter saves it.
//   #3 a team too long for the title -> blue (Listing title, "To check": the
//      title had to give up the team). Enter marks it seen, so it leaves the
//      count. That is what Save & next writes and Skip does not.
//
// R2 - every move is proved by the card that lands (`skipCard`/`saveAndNext`
// compare the "#..." lines before and after) and by the count after the walk:
// the pill drops from "3 need you" to "1 needs you" (#1, skipped, the only card
// left flagged). Enter on the pink #1 is held: the Skip right after it lands on
// #2, which it could not if Enter had already moved the walk on. Every
// negative (`toHaveCount(0)`, `toBeHidden`) sits beside a positive.
//
// Keys: the walk puts focus on the card's header as each card opens; after a
// tile answer the spec clicks the header line (a mouse user's way back to the
// card) so Enter and Escape reach the card, not a tile's control.
//
// Fixture arithmetic for #3: a card with no player keeps its name out of the
// title, so the title is "2024 Topps twk<token> Base #3 <team>" once the quiet
// cuts (sport, type name) are gone. ATTEMPT_TOKEN is 1 to 12 characters, so
// everything but the team is 22 to 34 characters: the 70-character team never
// fits beside it (>= 93), and the title without it always does (<= 34). The
// team has no Location, so it can only go whole: the Tidy Up cut (NEO-609),
// "listing title was cut short".
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
import { tidyUpName } from "../../support/wizard";
import {
  expectCardsLeft,
  expectCardSettled,
  mustFixLine,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  skipCard,
  saveAndNext,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
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
    await expect(needsYouPill(page)).toHaveText("3 need you");

    // ── #1, pink: the header, the tally, the count, and Save & next held ──
    await openTidyWalk(page, { title });
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expect(walk.getByText("1 to fix", { exact: true })).toBeVisible();
    await expectCardsLeft(page, 3);
    await expect(tidyTile(page, "Team")).toHaveAccessibleDescription("To fix");
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expect(mustFixLine(page)).toHaveText(
      "1 to fix before this card can save. Skip it and it can't be listed until it's fixed.",
    );
    // The first card of a sitting has nothing before it.
    await expect(tidyFooterButton(page, "back")).toBeDisabled();
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
    const idB = tidyParam(page);
    expect(idB).not.toBe(idA);

    // ── Esc = Save for later: the walk closes and nothing was written ──
    await tidyCardHeader(page, header(cardB)).click();
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]tidy=/);
    await expect(needsYouPill(page)).toHaveText("3 need you");
    await expect(pinkBadge(cardA.number)).toBeVisible();

    // The pill starts a new sitting: the skipped #1 is offered again.
    await openTidyWalk(page, { title });
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expectCardsLeft(page, 3);
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();
    await expect(needsYouPill(page)).toHaveText("3 need you");

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
    await tidyCardHeader(page, header(cardB)).click();
    await page.keyboard.press("Enter");
    await expect(tidyCardHeader(page, header(cardC))).toBeVisible();
    await expectCardSettled(page);
    // #3 is blue: something to check, nothing to fix, so Save & next is not held.
    await expect(walk.getByText("1 to check", { exact: true })).toBeVisible();
    await expect(walk.getByText(/^[0-9]+ to fix$/)).toHaveCount(0);
    await expect(tidyTile(page, "Listing title")).toHaveAccessibleDescription("To check");
    await expect(tidyFooterButton(page, "saveAndNext", { usable: true })).toBeVisible();
    await expect(mustFixLine(page)).toHaveCount(0);
    await expectCardsLeft(page, 1);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on a card to check" });

    // ── Back: the browser's Back, then the footer's ──
    await page.goBack();
    await expect(tidyCardHeader(page, header(cardB))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idB)}(&|$)`));
    await tidyFooterButton(page, "back", { usable: true }).click();
    await expect(tidyCardHeader(page, header(cardA))).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]tidy=${escapeRe(idA)}(&|$)`));
    // #1 is still pink (Back is no answer); skipping it again goes past the answered #2.
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await skipCard(page);
    await expect(tidyCardHeader(page, header(cardC))).toBeVisible();

    // ── Save & next on the blue card reaches the end screen ──
    await saveAndNext(page);
    await expect(walk.getByText("1 card skipped, not ready to list", { exact: true })).toBeVisible();
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toHaveCount(0);
    await expectCardsLeft(page, 0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk end screen with a skipped card" });
    await page.keyboard.press("Escape");
    await expect(walk).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]tidy=/);

    // What was written: #2's answer and #3's "seen". Skipped #1 is the one card left.
    await expect(needsYouPill(page)).toHaveText("1 needs you");
    await expect(pinkBadge(cardA.number)).toBeVisible();
    await expect(anyMark(cardB.number)).toHaveCount(0);
    await expect(anyMark(cardC.number)).toHaveCount(0);
  },
);
