// ONE FEATURE (NEO-284 on the NEO-645 Tidy Up walk): linking a card's printed team name to a
// team NeonBinder already holds, through the Team tile's "Link to existing team" search with
// "Remember “<printed>” as a name for this team" on (its default), saves the printed spelling as
// one of that team's aliases (team data); Team Management lists it, once. The same row's inline
// New team refuses a name another team already answers to as an alias while their years may
// overlap, offering "Link to <holder>" (NEO-307 / NEO-602, the era rule): dated clear of the
// holder, the create is offered again.
//
// NEO-656 (the card is the only record): the link answers THE OPEN CARD only. The printed name
// stops being a row: the card's team is the tile's own line (`Team <team>` with `Edit <team>`),
// with no "Linked for you" note (J1). The next card printing the club still asks (pink), and
// "Apply to all cards printing “<club>”" reaches the cards still waiting on it ("Linked N more
// cards."); the card after that shows the team with nothing to answer.
//
// Renamed from tidy-up-team-link-remembers-the-name (NEO-656: nothing about an answer is
// remembered now; what is kept is the alias, which is the team's own data). Before that,
// checklist-wizard-link-team-saves-alias (NEO-645).
//
// Sole writer of the 1996 New Haven Ravens Rally Raffle set (BSC only, filed under the year's
// Unknown row and reached through the All Brands view; SET-REGISTRY.md); fresh-only: it mints
// the fixture team and commits the set (NEO-645: Match Cards' Confirm saves the cards, then the
// walk opens). Re-seed before re-running. The checklist names ONE club the catalogue lacks
// ("New Haven Ravens", the row under test; its lookup is a recorded no-match, so the New team
// form opens on the whole name) and two unknown players, left unanswered (Skip and Save for
// later write nothing; never Save & next here: a linked catalogue player's career gap would get
// a stint). The raffle card's row says "No Team" (NEO-489), so it asks nothing. Walk order is
// the card number: #12 (unknown player) then #13 (a catalogue player); the club is printed on
// all eight numbered cards, so after #13's link six more wait on it.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { CHECKLISTS } from "../../support/published-checklist";
import { expectPlayersLoaded, expectTeamsLoaded, teamsCounter } from "../../support/players";
import { recordedNoMatchPlayer } from "../../support/recorded-names";
import { escapeRe } from "../../support/set-builder";
import {
  applyNameToAll,
  expectCardSettled,
  expectTidyWalkOpen,
  fetchOneMarketplaceSetChecklistToTidyWalk,
  pinkTile,
  saveForLater,
  skipCard,
  skipUntil,
  tidyCardIdentity,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import type { Page } from "@playwright/test";

const SET = "New Haven Ravens Rally Raffle";
const SET_YEAR = "1996";
/** The checklist's club: the printed team name under test. */
const ROW = "New Haven Ravens";

/** The admin Team Management page, filtered to `query`. */
async function openTeams(page: Page, query: string) {
  await page.goto("/admin/teams");
  // A mid-flow reload, the flow's 30 s.
  await expectTeamsLoaded(page, 30_000);
  await page.getByRole("textbox", { name: "Filter teams" }).fill(query);
  await expect(teamsCounter(page, "1 match")).toBeVisible();
}

test(
  "Tidy Up — linking a card's printed team to an existing team saves the printed spelling as that team's alias; the link is that card's, Apply to all reaches the rest",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const FIXTURE_TEAM = `Loc${T} Ali${T}`;
    const HOLDER = `${FIXTURE_TEAM} · 1990–1996`;

    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);

    // ── PART 1: the fixture team, created through a player's career editor ──
    await page.getByRole("textbox", { name: "Filter players" }).fill("zzzznotaplayer");
    await expect(page.getByText("No players match that filter.")).toBeVisible();
    const sport = page.getByRole("combobox", { name: "Sport" });
    await sport.selectOption("Baseball");
    await expect(sport.getByRole("option", { selected: true })).toHaveText("Baseball");
    await expect(page.getByText("0 matches", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add player" }).click();
    // The career editor's player: a REAL person whose Baseball lookup the enrichment recording
    // holds as a no-match (support/recorded-names.ts; the pool keeps the spec's old name), so the
    // add makes no live Wikidata call. Not on this checklist.
    const scaffold = recordedNoMatchPlayer(env, "checklist-wizard-link-team-saves-alias");
    await page.getByRole("textbox", { name: "New player name" }).fill(scaffold);
    await page.getByRole("button", { name: `Create player ${scaffold}` }).click();
    await expect(page.getByRole("heading", { name: scaffold, exact: true })).toBeVisible();
    await expect(page.getByText(`Added ${scaffold}`)).toBeVisible();

    await page.getByRole("button", { name: "Add team" }).click();
    const teamSearch = page.getByRole("textbox", { name: "Search teams" });
    await teamSearch.fill(`Ali${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await teamSearch.press("Enter");
    const newAli = page.getByRole("dialog", { name: `New team: Ali${T}` });
    await expect(newAli).toBeVisible();
    await newAli.getByRole("textbox", { name: "New team location (optional)" }).fill(`Loc${T}`);
    // The alias holder for the NEO-307 refusal below: inert, no checklist carries it.
    await newAli.getByRole("textbox", { name: "New team aliases (optional)" }).fill(`Pca${T}`);
    // NEO-602: DATED (1990–1996, covering the set's year), so a New team draft dated clear of it
    // is no clash and one left undated may overlap it.
    await newAli.getByLabel("New team active from (optional)").fill("1990");
    await newAli.getByLabel("New team active to").fill(SET_YEAR);
    await newAli.getByRole("button", { name: `Create team ${FIXTURE_TEAM}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${FIXTURE_TEAM}` })).toBeVisible();
    // The editor's own save path, as before NEO-645: one dated stint on the new team.
    await page.getByLabel(/Stint from year/).fill("1994");
    await page.getByLabel(/Stint to year/).fill(SET_YEAR);
    await page.getByRole("button", { name: "Add stint" }).click();
    await expect(page.getByRole("link", { name: new RegExp(`${escapeRe(FIXTURE_TEAM)} · 1994.${SET_YEAR}`) })).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${scaffold}`)).toBeVisible();

    // ── PART 2: the set; BSC plus its checklist, Match Cards confirmed (the cards are saved) ──
    await fetchOneMarketplaceSetChecklistToTidyWalk(page, env, {
      sport: "Baseball",
      year: SET_YEAR,
      set: SET,
      checklist: CHECKLISTS.newHavenRavens,
    });
    await expectTidyWalkOpen(page, { title: tidyUpName({ year: SET_YEAR, set: SET }) });

    // ── PART 3: the card that asks about the club ──
    const teamRow = tidyTile(page, "Team").getByRole("group", { name: `Team ${ROW}`, exact: true });
    const NOT_A_TEAM = /^Not a team( .+)?$/;
    const notATeam = teamRow.getByRole("button", { name: NOT_A_TEAM });
    const unlinked = teamRow.getByText(`“${ROW}” isn't linked to a team yet.`, { exact: true });
    // Once linked, the team is the card's own line on the tile (NEO-656 B11), with its Edit.
    const linkedLine = tidyTile(page, "Team").getByRole("group", { name: `Team ${FIXTURE_TEAM}`, exact: true });
    const change = linkedLine.getByRole("button", { name: `Edit ${FIXTURE_TEAM}`, exact: true });
    const linkedForYou = tidyWalk(page).getByText(/Linked for you/);
    // Eight of the nine cards print the club; Skip writes nothing, so any card before it is left as is.
    // (A `has` locator is relative to the row it filters, so it is rooted at the page.)
    await skipUntil(page, teamRow.filter({ has: page.getByRole("button", { name: NOT_A_TEAM }) }));
    // Settled: the near-match read has answered (it holds + New team and the remember default).
    await expect(teamRow.getByText("Checking for teams by that name…")).toHaveCount(0);
    await expect(unlinked).toBeVisible();
    await expect(pinkTile(page, "Team"), "an unlinked printed team is a must-fix").toHaveCount(1);

    const linkSection = teamRow.getByRole("group", { name: "Link to existing team" });
    const searchAll = linkSection.getByRole("combobox", { name: "Search all teams" });
    await expect(searchAll).toBeVisible();
    // Opens EMPTY (NEO-326): no pre-fill with the row's name.
    await expect(searchAll).toHaveValue("");
    await expect(searchAll).toHaveAttribute("placeholder", "Type a team name");
    const remember = linkSection.getByRole("checkbox", { name: `Remember “${ROW}” as a name for this team` });
    // Held while the near matches load (a printed place starts unticked), then ON by default.
    await expect(remember).toBeEnabled();
    await expect(remember).toBeChecked();
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, Team tile with an unlinked printed team" });

    // ── PART 4 (NEO-307 / NEO-602): New team refuses a name another team holds as an alias ──
    await teamRow.getByRole("button", { name: /^\+ New team( .+)?$/, disabled: false }).click();
    const form = teamRow.getByRole("group", { name: `New team: ${ROW}` });
    await expect(form).toBeVisible();
    // The search (and its remember box) gives way to the form while it is open.
    await expect(searchAll).toBeHidden();
    const teamName = form.getByRole("textbox", { name: "New team name" });
    await expect(teamName).toHaveValue(ROW);
    await teamName.fill(`Pca${T}`);
    // The holder is dated (PART 1) and this draft is not, so the server's clause is "this team has
    // no years on file" and the holder is named with its era.
    const CLASH = `${HOLDER} already answers to this name as an alias, and this team has no years on file, so they may overlap. Remove it there, or give this team years that don't overlap.`;
    await expect(form.getByText(CLASH, { exact: true })).toBeVisible();
    const create = form.getByRole("button", { name: /^Create team/ });
    await expect(create).toBeDisabled();
    const holderLink = form.getByRole("button", { name: `Link to ${HOLDER}`, exact: true });
    await expect(holderLink).toBeVisible();
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, New team name refused as another team's alias" });

    // Dated clear of the holder (1997 on), the clash and its way out are gone and Create is offered.
    await form.getByLabel("New team active from (optional)").fill("1997");
    await expect(create).toBeEnabled();
    await expect(form.getByText(/already answers to this name as an alias, and /)).toHaveCount(0);
    await expect(holderLink).toHaveCount(0);
    // Nothing was created: the form stands in for the row's buttons and the row has no Edit.
    await expect(form).toBeVisible();
    await expect(change).toHaveCount(0);
    // Cancel closes the form (writes nothing): the row is back, still unanswered.
    await form.getByRole("button", { name: "Cancel new team" }).click();
    await expect(form).toBeHidden();
    await expect(notATeam).toBeVisible();
    await expect(change).toHaveCount(0);
    await expect(searchAll).toBeVisible();
    await expect(remember).toBeChecked();

    // ── PART 5: link through the search, the remember box on ──
    const linkedCard = await tidyCardIdentity(page).allTextContents();
    await searchAll.fill(`Ali${T}`);
    await tidyWalk(page)
      .getByRole("option", { name: new RegExp(`^${escapeRe(FIXTURE_TEAM)}`) })
      .click();
    // The answer is saved at once: the printed name stops being a row, the team is the card's
    // line with its Edit, the tile stops being pink, and no "Linked for you" note (J1).
    await expect(change).toBeVisible();
    await expect(linkedLine.getByText(FIXTURE_TEAM, { exact: true })).toBeVisible();
    await expect(teamRow).toHaveCount(0);
    await expect(notATeam).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(tidyTile(page, "Team")).toBeVisible();
    await expect(linkedForYou).toHaveCount(0);
    await expectAccessible(page, { within: tidyWalk(page), label: "Tidy Up walk, printed team linked" });

    // ── PART 6: that answer linked THIS card only; the next card printing the club still asks ──
    await skipCard(page);
    await expect(tidyCardIdentity(page)).not.toHaveText(linkedCard);
    await expectCardSettled(page);
    await expect(unlinked, "the link on the card before did not reach this one").toBeVisible();
    await expect(pinkTile(page, "Team")).toHaveCount(1);
    await expect(change).toHaveCount(0);

    // Link it here too (the alias is already on the team: saving it again adds no second one,
    // PART 7), then Apply to all reaches the six other cards still waiting on the club.
    const appliedCard = await tidyCardIdentity(page).allTextContents();
    await expect(teamRow.getByText("Checking for teams by that name…")).toHaveCount(0);
    await expect(remember).toBeEnabled();
    await searchAll.fill(`Ali${T}`);
    await tidyWalk(page)
      .getByRole("option", { name: new RegExp(`^${escapeRe(FIXTURE_TEAM)}`) })
      .click();
    await expect(change).toBeVisible();
    await expect(teamRow).toHaveCount(0);
    expect(await applyNameToAll(page, "Team", ROW)).toBe("Linked 6 more cards.");

    // The card after it shows the team as its own line, with nothing to answer.
    await skipCard(page);
    await expect(tidyCardIdentity(page)).not.toHaveText(appliedCard);
    await expectCardSettled(page);
    await expect(change, "Apply to all linked the club on the next card").toBeVisible();
    await expect(linkedLine.getByText(FIXTURE_TEAM, { exact: true })).toBeVisible();
    await expect(teamRow).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(linkedForYou).toHaveCount(0);
    // Back returns to the card Apply to all was pressed on, its team on file.
    await page.goBack();
    await expect(tidyCardIdentity(page), "Back returned to the card Apply to all was pressed on").toHaveText(appliedCard);
    await expectCardSettled(page);
    await expect(change).toBeVisible();
    await expect(linkedLine.getByText(FIXTURE_TEAM, { exact: true })).toBeVisible();

    // Save for later closes the walk; every answer is already saved.
    await saveForLater(page);

    // ── PART 7: Team Management shows the alias ──
    await openTeams(page, `Ali${T}`);
    await page.getByRole("button", { name: new RegExp(`Ali${T}`) }).click();
    const aka = page.getByRole("textbox", { name: "Also known as" });
    const currentAliases = page.getByRole("list", { name: "Current aliases" });
    // Every alias: the fixture team's own `Pca<token>` (PART 1) and the printed spelling, once
    // though two links saved it.
    await expect(aka).toHaveValue(`Pca${T}, ${ROW}`);
    await expect(currentAliases.getByText(ROW, { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Team Management, team detail with its remembered alias" });

    // ── PART 8: take them back out (R7), and prove the removal persisted ──
    await aka.clear();
    await expect(currentAliases).toBeHidden();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved ${FIXTURE_TEAM}`)).toBeVisible();
    await openTeams(page, `Ali${T}`);
    await page.getByRole("button", { name: new RegExp(`Ali${T}`) }).click();
    await expect(aka).toHaveValue("");
    await expect(page.getByPlaceholder("LSU, Louisiana State, LSU Tigers baseball")).toBeVisible();
    await expect(currentAliases).toBeHidden();
  },
);
