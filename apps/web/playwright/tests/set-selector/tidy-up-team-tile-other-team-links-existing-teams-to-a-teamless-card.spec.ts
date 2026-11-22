// R1 - ONE feature (NEO-645, was NEO-102's attention walker): on the Tidy Up walk, a card with no
// team takes EXISTING teams from the Team tile's "Other team…" search. Each pick is a choice, not a
// write: it lands as a pressed chip under "Teams you added", the tile stays pink and Save & next
// stays held until "Save team" / "Save teams" writes exactly the chips still pressed. A chip pressed
// again leaves the list and is not saved.
//
// The flow, on three hand-added cards (walk order is the card number):
//   #1 holds two minted teams, made in the card form, so they exist; it needs nobody (no walk stop).
//   #2 no team -> pink. "Other team…" twice picks both teams; "Save teams" writes both.
//   #3 no team -> pink. Both picked, the second pressed again (it leaves the list); "Save team"
//      writes one.
//
// R2 - every move is proved by what lands: the chip's pressed state, the button's own words
// ("Save team" / "Save teams"), the tile's plain "Team <name>" rows after the save beside the
// negative for the dropped team, the walk's count, and after it the drawer's stored teams (#2 both,
// #3 one) and the badges and pill gone beside each row on screen.
// Back: the browser's Back from the end screen lands on #3 again, showing its saved team.
//
// R3 - not here: Skip, Save for later, Enter/Esc, the pill's sitting and "No team on this card"
// (`tidy-up-walk-one-card-at-a-time`); "+ New team" from the tile (`tidy-up-team-apply-to-all-…`);
// career-chip preselects and "Not a team" (`checklist-prospect-and-place-team-cells-…`).
//
// Desktop and mobile - the walk is full-screen on a phone with the same controls and names; nothing
// branches. axe (light and dark) on a card with two chips chosen and on the end screen.
//
// R7a / data isolation - a PER-ATTEMPT hand-made set `cnw<token>` under the REAL Baseball > 2024 >
// Topps (a real sport is what lets the card form create a team), `Insert` > `Base`, no marketplace
// id anywhere beneath it (SET-REGISTRY.md, prefix `cnw`); three hand-added cards and two minted
// teams `Cnwa<token>t` / `Cnwb<token>t`, single tokens, all made in the UI. Nothing is deleted: the
// set is this attempt's alone and no other spec reads it.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { drillToCustom, setBuilderReady } from "../../support/set-builder";
import { addCardViaForm, createTeamInCardForm, escapeRe } from "../../support/cards";
import { expectDrawerTeams } from "../../support/also-pictured";
import {
  expectCardsLeft,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  saveForLater,
  tidyCardHeader,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

test(
  "Tidy Up Team tile — Other team… links existing teams to a teamless card; only the chips still pressed are saved",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const token = env.ATTEMPT_TOKEN;
    const set = `cnw${token}`;
    // A trailing letter: Convex search reads the last term as a prefix, so a bare token could be the
    // prefix of a longer attempt's team and turn the create's "No matches." into a match.
    const TEAM_A = `Cnwa${token}t`;
    const TEAM_B = `Cnwb${token}t`;
    const holder = { number: "1", name: `CnwOne${token}` };
    const both = { number: "2", name: `CnwTwo${token}` };
    const one = { number: "3", name: `CnwThree${token}` };
    const header = (card: { number: string; name: string }) => `#${card.number} · ${card.name}`;
    const anyMark = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(n)}(, .*)? (needs attention|is worth a check): `) });
    const noTeamMark = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${escapeRe(n)}(, .*)? needs attention: no team on this card yet$`) });
    const walk = tidyWalk(page);
    const team = tidyTile(page, "Team");
    const chosen = team.getByRole("list", { name: "Teams you added" });
    const chip = (name: string, pressed: boolean) => chosen.getByRole("button", { name, exact: true, pressed });
    const savedRow = (name: string) => team.getByRole("group", { name: `Team ${name}`, exact: true });
    const save = (label: "Save team" | "Save teams") => team.getByRole("button", { name: label, exact: true });
    const search = team.getByRole("textbox", { name: "Search existing teams" });

    /** "Other team…", type the team's one token, pick it: a pressed chip, nothing written yet. */
    async function pickOtherTeam(name: string): Promise<void> {
      await team.getByRole("button", { name: "Other team…", exact: true }).click();
      await expect(search).toBeVisible();
      await search.fill(name);
      await team.getByRole("option", { name: `Link to ${name}`, exact: true }).click();
      await expect(search).toBeHidden();
      await expect(chip(name, true)).toBeVisible();
      // A choice is not an answer: the tile is still pink and Save & next still held.
      await expect(team).toHaveAccessibleDescription("To fix");
      await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    }

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

    // The two teams exist before the walk: both made on #1 in the card form's New team dialog.
    await addCardViaForm(page, {
      cardNumber: holder.number,
      playerName: holder.name,
      beforeSubmit: async () => {
        await createTeamInCardForm(page, TEAM_A);
        await createTeamInCardForm(page, TEAM_B);
      },
    });
    await addCardViaForm(page, { cardNumber: both.number, playerName: both.name });
    await addCardViaForm(page, { cardNumber: one.number, playerName: one.name });
    // The precondition: #2 and #3 are flagged for their team; #1 (two teams) is not flagged at all.
    await expect(noTeamMark(both.number)).toBeVisible();
    await expect(noTeamMark(one.number)).toBeVisible();
    await expect(page.getByText(holder.name, { exact: true })).toBeVisible();
    await expect(anyMark(holder.number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveText("2 need you, 2 to fix");

    // ── #2: two teams picked, both saved ──
    await openTidyWalk(page, { title: tidyUpName({ year: "2024", set }) });
    await expect(tidyCardHeader(page, header(both))).toBeVisible();
    await expectCardsLeft(page, 2);
    await expect(team).toHaveAccessibleDescription("To fix");
    // Nothing chosen, nothing to save: no usable save button until the first chip is pressed.
    await expect(team.getByRole("button", { name: /^Save teams?$/, disabled: false })).toHaveCount(0);
    await pickOtherTeam(TEAM_A);
    await expect(save("Save team")).toBeVisible();
    await pickOtherTeam(TEAM_B);
    await expect(save("Save teams")).toBeVisible();
    await expect(chip(TEAM_A, true)).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up Team tile with two teams chosen" });
    await save("Save teams").click();
    // Written: the tile is plain, one row per saved team, and the card can move on.
    await expect(savedRow(TEAM_A)).toBeVisible();
    await expect(savedRow(TEAM_B)).toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(chosen).toHaveCount(0);
    await saveAndNext(page);

    // ── #3: two picked, the second pressed again, so ONE is saved ──
    await expect(tidyCardHeader(page, header(one))).toBeVisible();
    await expectCardsLeft(page, 1);
    await pickOtherTeam(TEAM_A);
    await pickOtherTeam(TEAM_B);
    // A searched-for team has no chip of its own to fall back to: pressed again, it leaves the list.
    await chip(TEAM_B, true).click();
    await expect(chosen.getByRole("button", { name: TEAM_B, exact: true })).toHaveCount(0);
    await expect(chip(TEAM_A, true)).toBeVisible();
    // The button counts what is still pressed.
    await expect(save("Save team")).toBeVisible();
    await expect(save("Save teams")).toHaveCount(0);
    await save("Save team").click();
    await expect(savedRow(TEAM_A)).toBeVisible();
    await expect(savedRow(TEAM_B)).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await saveAndNext(page);

    // ── The end screen: nothing left ──
    await expect(walk.getByText("All tidy. Nothing on this checklist needs you.")).toBeVisible();
    await expectCardsLeft(page, 0);
    await expectAccessible(page, { within: walk, label: "Tidy Up walk end screen after the Team tile answers" });

    // Back: the browser's Back steps to #3, which shows the team it saved (and not the dropped one).
    await page.goBack();
    await expect(tidyCardHeader(page, header(one))).toBeVisible();
    await expect(savedRow(TEAM_A)).toBeVisible();
    await expect(savedRow(TEAM_B)).toHaveCount(0);
    await saveForLater(page);

    // The checklist: both cards lost their mark and the pill is gone (each negative beside its row).
    await expect(page.getByText(both.name, { exact: true })).toBeVisible();
    await expect(anyMark(both.number)).toHaveCount(0);
    await expect(page.getByText(one.name, { exact: true })).toBeVisible();
    await expect(anyMark(one.number)).toHaveCount(0);
    await expect(needsYouPill(page)).toHaveCount(0);

    // A fresh drill reads the stored cards: #2 holds both teams, #3 only the one still pressed.
    await drillToCustom(page, {
      sport: "Baseball",
      year: "2024",
      manufacturer: "Topps",
      set,
      variantType: "Insert",
      variant: "Base",
    });
    await expectDrawerTeams(page, both.number, [TEAM_A, TEAM_B]);
    await expectDrawerTeams(page, one.number, [TEAM_A]);
    await expectDrawerTeams(page, holder.number, [TEAM_A, TEAM_B]);
  },
);
