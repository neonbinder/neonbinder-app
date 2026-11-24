// Origin: checklist-attention-badge-and-filter.spec.ts (NEO-102 / NEO-335 /
// NEO-343), rewritten onto the NEO-645 levels and walk.
//
// R1 - ONE feature: the checklist marks each card that needs a person with ONE
// badge at its level, pink "needs attention" (to fix: the card cannot be listed
// yet) or blue "is worth a check" (a stop that never blocks), and the three
// places that count those cards agree, card for card: the header's "N need you, M to fix"
// pill, the checklist search's "attention" keyword, and the Tidy Up walk the
// pill opens ("N cards left"). Pink and blue read the card's live data
// (NEO-656 J5): a card whose last stop is fixed loses its mark and leaves every
// count at once, and a career gap computed live (B22) marks a card blue.
//
// The cards (a per-attempt hand-made set, so the counts are exact):
//   701 no team                          -> pink: no team on this card yet
//   702 no team, then a team in its drawer -> pink, then no mark (no player
//       is linked, so no career check): counted nowhere
//   703 born linked (quick-add player + team), bare number, and named for its
//       player (the Card name is the player's own name) -> blue: team is
//       missing from the player's career (the new player has no stint, so the
//       live check, B22, raises it on a card no commit made). A card's
//       own name is always in its title (NEO-645), unless it only says the
//       players' names again: then the title is the player card's as before,
//       "2024 Topps cna-<w>-<id> Base [Insert] <player> #703 CNAB<token>
//       [Baseball]", which fits in 80 for every worker and token (computed
//       offline with `assessListingTitle`, workers 0-11, 1-5 digit attempts:
//       74 to 80 characters after the quiet cuts, nothing left out). A name of
//       its own ("AttnCharlie<token>") would push the team out (NEO-609: a
//       whole-team cut, blue) on every worker, so the name IS the fixture: the
//       career check is #703's only reason.
//   704 a 70-character team (no Location) -> blue: listing title was cut short.
//       It has no player; its own name is in the title (NEO-645): "2024 Topps
//       cna-<w>-<id> Base [Insert] AttnDelta<token> #704 <team> [Baseball]".
//       Without the team it is 69 to 80 characters with nothing else left out
//       (offline, as above), and the 70-character team never fits beside it:
//       the Tidy Up cut, every run, never the purple set-name note (no set name
//       was shortened).
// The colour is the badge's look; its LEVEL is also in its accessible name
// ("needs attention" / "is worth a check"), which is what this spec reads
// (colour is never the only carrier, and the name is the perceivable handle).
//
// R2 - each count is an exact full-string read: the pill's name IS its count,
// the search's "N of 4 cards" line, and the walk's "N cards left"; each list of
// rows is matched by number; each badge's name is matched whole, so a card
// carrying a second reason (or none) fails by name. The walk opening on #701
// proves its first card is a flagged one; it is closed with Save for later
// (Esc) and the counts hold. Searching is client-side and writes nothing.
//
// R3 - the walk's moves are `tidy-up-walk-one-card-at-a-time`'s; the search
// control itself is checklist-search-narrows-and-clears'. This spec also keeps
// the quick-add player CREATE path's E2E proof (read back from #703's drawer).
//
// Fresh-only: #703's player is this worker's recorded no-match person
// (support/recorded-names.ts), created once per seed. Re-seed before re-running.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `cna-<w>-<attempt>` under
// the REAL Baseball > 2024 > Topps, `Insert` > `Base`, no marketplace id
// (SET-REGISTRY.md, prefixes `cna-`, `CNAA`, `CNAB`, `CNAL`); every card, team
// and the player are made in the UI. Nothing is deleted.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { setBuilderReady, drillToCustom } from "../../support/set-builder";
import { addCardViaForm, createTeamInCardForm, editCardButton, escapeRe } from "../../support/cards";
import { recordedNoMatchPlayer } from "../../support/recorded-names";
import {
  expectCardsLeft,
  needsYouPill,
  openTidyWalk,
  tidyCardHeader,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

test(
  "Checklist attention — one badge per card, pink to fix or blue to check, and the need-you pill, the attention search and the walk count the same cards",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const id = env.ATTEMPT_ID;
    const token = env.ATTEMPT_TOKEN;
    const n701 = `701-${id}`;
    const n702 = `702-${id}`;
    const n703 = "703";
    const n704 = "704";
    const set = `cna-${env.WORKER_INDEX}-${id}`;
    const pink = (number: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(number)}(, .*)? needs attention: no team on this card yet$`) });
    const blue = (number: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(number)}(, .*)? is worth a check: listing title was cut short$`) });
    /** Blue for the live career check alone (B22). */
    const careerBlue = (number: string) =>
      page.getByRole("img", {
        name: new RegExp(`^Card ${escapeRe(number)}(, .*)? is worth a check: team is missing from the player's career$`),
      });
    /** Any attention mark, at either level. */
    const mark = (number: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(number)}(, .*)? (needs attention|is worth a check): `) });
    /** This attempt's four cards, by number. */
    const ours = `(?:${escapeRe(n701)}|${escapeRe(n702)}|${n703}|${n704})`;
    const rows = page.getByRole("button", { name: new RegExp(`^Edit card ${ours}(, .*)?$`) });
    const marks = page.getByRole("img", { name: new RegExp(`^Card ${ours}(, .*)? (needs attention|is worth a check): `) });
    const teamA = `CNAA${token}`;
    const teamB = `CNAB${token}`;
    // One token, 70 characters (see the arithmetic above).
    const teamLong = `CNAL${token}`.padEnd(70, "x");
    // A REAL person whose Baseball lookup the enrichment recording holds as a
    // no-match: the quick-add create makes no live Wikidata call.
    const player = recordedNoMatchPlayer(env, "checklist-attention-badge-and-filter");

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

    await addCardViaForm(page, { cardNumber: n701, playerName: `AttnAlpha${token}` });
    await addCardViaForm(page, { cardNumber: n702, playerName: `AttnBravo${token}` });
    // Named for its player: the name adds nothing to the title (NEO-645), see the header.
    await addCardViaForm(page, {
      cardNumber: n703,
      playerName: player,
      beforeSubmit: async () => {
        await expectAccessible(page, { label: "Add card form" });
        // The quick-add player picker (NEO-220). Its results popover opens below the
        // field and is fixed to the viewport, so a user lifts the form first.
        await page.getByRole("heading", { name: "Add Card" }).hover();
        await page.mouse.wheel(0, 250);
        await page.getByRole("button", { name: "Add a player to the new card" }).click();
        await page.getByRole("textbox", { name: "Find a player for the new card" }).fill(player);
        // No player of this name is on file yet, so Create is the answer for it.
        await page.getByRole("option", { name: `Create player ${player}` }).click();
        await expect(page.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
        // The popover hangs over the Team picker: leave the picker to close it.
        await page.getByRole("textbox", { name: "Card name", exact: true }).click();
        await expect(page.getByRole("textbox", { name: "Find a player for the new card" })).toBeHidden();
        await createTeamInCardForm(page, teamB);
      },
    });
    await addCardViaForm(page, {
      cardNumber: n704,
      playerName: `AttnDelta${token}`,
      beforeSubmit: () => createTeamInCardForm(page, teamLong),
    });

    // One badge per flagged card, at its level: two pink, and two blue for two
    // different reasons (the live career check on the born-linked card).
    await expect(pink(n701)).toBeVisible();
    await expect(pink(n702)).toBeVisible();
    await expect(careerBlue(n703)).toBeVisible();
    await expect(blue(n704)).toBeVisible();
    // A card has one mark, never both levels.
    await expect(mark(n701)).toHaveCount(1);
    await expect(mark(n703)).toHaveCount(1);
    await expect(mark(n704)).toHaveCount(1);
    // The pill counts pink AND blue, then how many of them are pink ("…, 2 to fix"): its visible
    // text is its name, so the text IS the count.
    await expect(needsYouPill(page)).toHaveText("4 need you, 2 to fix");
    await expectAccessible(page, { label: "Checklist with pink and blue attention badges and the need-you pill" });

    // #703's player was STORED: the drawer's picker chip (off the live query) is the read-back.
    await editCardButton(page, n703).click();
    const born = page.getByRole("dialog", { name: /^Card #/ });
    await expect(born.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
    await born.getByRole("button", { name: "Done editing card" }).click();
    await expect(born).toBeHidden();

    // NEO-343 — the "attention" keyword lists exactly the cards the pill counts.
    const search = page.getByRole("searchbox", { name: "Search cards" });
    await search.fill("attention");
    await expect(page.getByText("4 of 4 cards", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(4);
    await expect(editCardButton(page, n701)).toBeVisible();
    await expect(editCardButton(page, n702)).toBeVisible();
    await expect(editCardButton(page, n703)).toBeVisible();
    await expect(editCardButton(page, n704)).toBeVisible();
    await expect(marks).toHaveCount(4);
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(rows).toHaveCount(4);

    // Give #702 a team through its drawer: its badge goes (no player, so no career
    // check), and every count drops by one.
    await editCardButton(page, n702).click();
    const drawer = page.getByRole("dialog", { name: /^Card #/ });
    await expect(drawer.getByRole("textbox", { name: "Card name", exact: true })).toBeVisible();
    await expectAccessible(page, { within: drawer, label: "Card detail drawer" });
    await createTeamInCardForm(page, teamA);
    await expect(drawer.getByText(/Saved Teams/)).toBeVisible();
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer).toBeHidden();
    await expect(mark(n702)).toHaveCount(0);
    await expect(editCardButton(page, n702)).toBeVisible();
    await expect(pink(n701)).toBeVisible();
    await expect(needsYouPill(page)).toHaveText("3 need you, 1 to fix");
    await search.fill("attention");
    await expect(page.getByText("3 of 4 cards", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(editCardButton(page, n701)).toBeVisible();
    await expect(editCardButton(page, n703)).toBeVisible();
    await expect(editCardButton(page, n704)).toBeVisible();
    await expect(editCardButton(page, n702)).toHaveCount(0);
    await expect(marks).toHaveCount(3);
    // A keyword ANDs with the other terms: flagged AND the fixed #702 is nothing
    // (#702 alone is one card; either term alone is not empty).
    await search.fill(`attention ${n702}`);
    await expect(page.getByText(`No cards match "attention ${n702}".`)).toBeVisible();
    await expect(page.getByText("0 of 4 cards", { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(0);
    await search.fill(n702);
    await expect(page.getByText("1 of 4 cards", { exact: true })).toBeVisible();
    await expect(editCardButton(page, n702)).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(rows).toHaveCount(4);

    // The pill opens the walk on the same cards: three left, the first flagged one first.
    await openTidyWalk(page, { title: tidyUpName({ year: "2024", set }) });
    await expectCardsLeft(page, 3);
    await expect(tidyCardHeader(page, `#${n701} · AttnAlpha${token}`)).toBeVisible();
    // Save for later (Esc) writes nothing: the counts hold.
    await page.keyboard.press("Escape");
    await expect(tidyWalk(page)).toBeHidden();
    await expect(needsYouPill(page)).toHaveText("3 need you, 1 to fix");
    await expect(pink(n701)).toBeVisible();
    await expect(careerBlue(n703)).toBeVisible();
    await expect(blue(n704)).toBeVisible();
  },
);
