/**
 * /admin/players helpers. Origin: .maestro/flows/admin/util-add-player-by-hand.yaml
 * (Maestro suite retired in NEO-341; the YAML is in git history).
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The Players list counter (NEO-330: bare counts). Browsing it reads
 * "2,000 players" / "1 player"; with anything in the filter box "12 matches",
 * "1 match", "10+ matches", "0 matches". One element, so no live-region twin.
 */
export const PLAYERS_BROWSING = /^[\d,]+ players?$/;

/** Any filtered count: "12 matches", "1 match", "10+ matches", "0 matches". */
export const PLAYERS_MATCHES = /^[\d,]+\+? match(es)?$/;

export function playersCounter(page: Page, pattern: RegExp | string): Locator {
  return page.getByText(pattern, typeof pattern === "string" ? { exact: true } : undefined);
}

/** The unfiltered counter is on screen, i.e. the list query has answered. */
export async function expectPlayersLoaded(page: Page, timeout?: number): Promise<void> {
  await expect(playersCounter(page, PLAYERS_BROWSING)).toBeVisible({ timeout });
}

/**
 * The Teams list counter (NEO-330): "2,000 teams" browsing, "12 matches" /
 * "50+ matches" filtering, plus " · K need attention" on the visible line when
 * K > 0 (data, so optional here). The visible line is followed in the DOM by
 * an sr-only role=status twin carrying the same sentence WITHOUT the suffix,
 * so a text match resolves to two elements: `.first()` is the visible one.
 */
export const TEAMS_BROWSING = /^[\d,]+ teams?( · [\d,]+ need attention)?$/;

export function teamsCounter(page: Page, sentence: string): Locator {
  return page.getByText(new RegExp(`^${sentence}( · [\\d,]+ need attention)?$`)).first();
}

/** The unfiltered Teams counter is on screen, i.e. the list query has answered. */
export async function expectTeamsLoaded(page: Page, timeout?: number): Promise<void> {
  await expect(page.getByText(TEAMS_BROWSING).first()).toBeVisible({ timeout });
}

/**
 * Empty the list with a filter nothing can match, then choose the list's
 * sport. Done on the LIST's picker while the add form is closed, so the form
 * opens with this sport already chosen.
 */
export async function emptyListAndPickSport(page: Page, sport: string): Promise<void> {
  await page.getByRole("textbox", { name: "Filter players" }).fill("zzzznotaplayer");
  await expect(page.getByText("No players match that filter.")).toBeVisible();
  await expect(page.getByText("0 matches", { exact: true })).toBeVisible();
  const sportPicker = page.getByRole("combobox", { name: "Sport", exact: true });
  await sportPicker.selectOption({ label: sport });
  await expect(sportPicker.getByRole("option", { selected: true })).toHaveText(sport);
  await expect(page.getByText("0 matches", { exact: true })).toBeVisible();
}

/**
 * util-add-player-by-hand.yaml: on /admin/players (already loaded), add a
 * player under `sport`, ending with the new player's detail panel open.
 */
export async function addPlayerByHand(page: Page, name: string, sport: string): Promise<void> {
  await emptyListAndPickSport(page, sport);
  await page.getByRole("button", { name: "Add player" }).click();
  await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
  await page.getByRole("textbox", { name: "New player name" }).fill(name);
  await page.getByRole("button", { name: `Create player ${name}` }).click();

  // The detail panel replaces the form: heading, the "Added" confirmation and
  // the sport read back (which can also show elsewhere on the page).
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText(`Added ${name}`)).toBeVisible();
  await expect(page.getByText(`Sport: ${sport}`).first()).toBeVisible();
}

/** One team for `createTeamInCareerEditor`. */
export interface CareerEditorTeam {
  /** A single token nothing on file answers to yet; the dialog opens as "New team: <search>". */
  search: string;
  /** The team's NAME when it differs from `search` (the dialog's Name is retyped). */
  name?: string;
  location?: string;
  from?: string;
  to?: string;
  /** Typed into "New team aliases (optional)". */
  aliases?: string;
  /**
   * NEO-602: the label ("<full name> · <era>") of a team that already wears this
   * team's full name as an alias, in an era that does not overlap. The dialog
   * then says so and asks for Create a second time.
   */
  aliasHeldBy?: string;
}

/**
 * In the open player's career editor (/admin/players, a player's detail panel):
 * make a team through "Add team" and the New Team dialog, then take its chip
 * off again, so the team exists and the player has NO stint on it (the chip is
 * a pick; only "Add stint" plus the player's Save writes a stint). Returns the
 * team's full name ("<location> <name>"). Teams are never looked up on
 * creation, so nothing here waits on a lookup.
 *
 * Contract: ENTRY a player's detail panel is open. EXIT the team is made (its
 * chip appeared) and the chip is gone again.
 */
export async function createTeamInCareerEditor(page: Page, team: CareerEditorTeam): Promise<string> {
  const name = team.name ?? team.search;
  const full = team.location ? `${team.location} ${name}` : name;
  await page.getByRole("button", { name: "Add team" }).click();
  const search = page.getByRole("textbox", { name: "Search teams" });
  await search.fill(team.search);
  await expect(page.getByText("No matches.")).toBeVisible();
  await search.press("Enter");
  const dialog = page.getByRole("dialog", { name: `New team: ${team.search}` });
  await expect(dialog).toBeVisible();
  if (team.name !== undefined) await dialog.getByRole("textbox", { name: "New team name" }).fill(team.name);
  if (team.location !== undefined) {
    await dialog.getByRole("textbox", { name: "New team location (optional)" }).fill(team.location);
  }
  if (team.from !== undefined) await dialog.getByLabel("New team active from (optional)").fill(team.from);
  if (team.to !== undefined) await dialog.getByLabel("New team active to").fill(team.to);
  if (team.aliases !== undefined) {
    await dialog.getByRole("textbox", { name: "New team aliases (optional)" }).fill(team.aliases);
  }
  const create = dialog.getByRole("button", { name: `Create team ${full}` });
  await create.click();
  if (team.aliasHeldBy !== undefined) {
    // The name is already answered to, by another era's alias: the dialog says which team, and
    // the second Create makes this one (admin-teams-two-eras proves that step on its own).
    await expect(
      dialog.getByRole("alert").filter({
        hasText: `${team.aliasHeldBy} already answers to this name as an alias. This team's years don't overlap, so Create again to add it as its own team.`,
      }),
    ).toBeVisible();
    await create.click();
  }
  await expect(dialog).toBeHidden();
  const chip = teamChip(page, full);
  await expect(chip, `${full} was made and picked`).toBeVisible();
  await chip.click();
  await expect(chip, `${full}'s chip came off, so the player has no stint on it`).toBeHidden();
  return full;
}

/**
 * A team chip ("Remove team <full name>": the career editor's and the card
 * drawer's). Anchored on the whole name, so `Ath<token>` never matches `Loc<token>
 * Ath<token>`; a decorative glyph either side of the words is allowed (team chips
 * are gaining a check glyph).
 */
export function teamChip(scope: Page | Locator, full: string): Locator {
  const escaped = full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByRole("button", { name: new RegExp(`^[^\\p{L}\\p{N}]*Remove team ${escaped}[^\\p{L}\\p{N}]*$`, "u") });
}

/**
 * In the open player's career editor: one stint on a team already on file, staged by "Add team"
 * (typing `search`, a single token, and picking the option whose name starts `Add <full>` in
 * "Team typeahead results", so two eras sharing the token are told apart by their whole names),
 * then the years and "Add stint". The stint is written only by the player's Save, which the
 * caller presses once every stint is in.
 *
 * Contract: ENTRY a player's detail panel is open and `full` exists. EXIT the career list holds a
 * line `<full> · <from>–<to>` (exactly one).
 */
export async function addCareerStint(
  page: Page,
  stint: { search: string; full: string; from: string; to: string },
): Promise<void> {
  const escaped = stint.full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("button", { name: "Add team" }).click();
  await page.getByRole("textbox", { name: "Search teams" }).fill(stint.search);
  await page
    .getByRole("listbox", { name: "Team typeahead results" })
    .getByRole("option", { name: new RegExp(`^Add ${escaped}`) })
    .click();
  await expect(teamChip(page, stint.full)).toBeVisible();
  await page.getByLabel(/Stint from year/).fill(stint.from);
  await page.getByLabel(/Stint to year/).fill(stint.to);
  await page.getByRole("button", { name: "Add stint" }).click();
  await expect(
    page
      .getByRole("list", { name: "Career history" })
      .getByRole("listitem")
      .filter({ hasText: `${stint.full} · ${stint.from}–${stint.to}` }),
  ).toHaveCount(1);
}
