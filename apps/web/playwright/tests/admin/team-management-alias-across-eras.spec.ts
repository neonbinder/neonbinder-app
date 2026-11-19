// ONE FEATURE (NEO-602): a team may wear another team's own name as an alias
// when the two teams' years don't overlap, and Team Management refuses the edit
// that would make them overlap, naming the alias and the other team's years.
//
// The shape is the Athletics': `Loc<token> Ath<token>` (1968–2024, the
// Oakland row) and `Ath<token>` (2025–present, the Athletics row), one sport.
// On the newer team the operator types the older team's full name, plus a short
// alias, into "Also known as": it saves and survives a reload. An unrelated
// edit (a colour) saves with that alias in the list. Moving the newer team's
// start to 2020 makes the eras overlap, and the save is refused inline with the
// forward-direction copy; the reload proves nothing was written. The older team
// cannot run on to 2026 (that would overlap the team wearing its name; refused
// inline, nothing written), and still saves its own edits, a years change that
// stays clear included (the reverse check, era aware, finds no overlapping
// holder of its name).
//
// Fixtures through the UI (GUIDE "Fixtures come from the UI"): Team Management
// has no "add a team", so both teams are born in a player's career editor, as
// `admin-teams-two-eras` does. Everything lives in the worker's custom sport
// (`customSport(env)`): a minted player there makes no Wikidata lookup
// (no `sportConfig.wikidata`) and teams are never looked up on creation, so the
// spec re-runs on the same seed (every name carries the attempt token). The
// custom sport exists once something was made under it, so the spec makes sure
// of it first (`drillToCustom` with a sport only adds no row below the sport).
// No league: the alias rule is sport-scoped, and a custom sport has none.
//
// Back (house rule): Players -> Teams is a real navigation, so Back returns to
// Players and Forward to Teams. Selecting a team replaces the URL by design
// (`setSearchParams(..., { replace: true })`), so Back never steps between rows.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addPlayerByHand, expectPlayersLoaded, teamsCounter } from "../../support/players";
import { customSport, drillToCustom, setBuilderReady } from "../../support/set-builder";
import type { Page } from "@playwright/test";

/** The master row of a team in Team Management: its accessible name is the full name and era. */
function teamRow(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

test(
  "Team Management — a team may wear another team's name as an alias while their years don't overlap, and a years edit that makes them overlap is refused",
  { tag: ["@admin"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const sport = customSport(env);
    const player = `Sam Atp${T}`;
    const OLD = `Loc${T} Ath${T}`; // 1968–2024
    const NEW = `Ath${T}`; // 2025–present
    const SHORT = `Aka${T}`;
    const OLD_ROW = `${OLD} · 1968–2024`;
    const NEW_ROW = `${NEW} · 2025–present`;

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    // The worker's custom sport, so the Players sport picker offers it.
    await drillToCustom(page, { sport });

    // ── PART 1: a player, and both teams born in his career editor ──
    await page.getByRole("link", { name: "Players", exact: true }).click();
    await expectPlayersLoaded(page);
    await addPlayerByHand(page, player, sport);
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    const addTeam = page.getByRole("button", { name: "Add team" });
    const search = page.getByRole("textbox", { name: "Search teams" });

    // The older team: Location + Name, 1968–2024.
    await addTeam.click();
    await search.fill(NEW);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const oldDialog = page.getByRole("dialog", { name: `New team: ${NEW}` });
    await expect(oldDialog).toBeVisible();
    await oldDialog.getByRole("textbox", { name: "New team location (optional)" }).fill(`Loc${T}`);
    await oldDialog.getByLabel("New team active from (optional)").fill("1968");
    await oldDialog.getByLabel("New team active to").fill("2024");
    await oldDialog.getByRole("button", { name: `Create team ${OLD}` }).click();
    const oldChip = page.getByRole("button", { name: `Remove team ${OLD}` });
    await expect(oldChip).toBeVisible();
    // The chip is the career editor's pick, not a stint; the team row stands without it.
    await oldChip.click();
    await expect(oldChip).toBeHidden();

    // The newer team: the bare name, 2025 on. The search types a token nothing
    // answers to (the older team now answers to `Ath<token>`), and the dialog's
    // Name is set to the real one, as admin-teams-two-eras does.
    await addTeam.click();
    await search.fill(`Zzz${T}`);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const newDialog = page.getByRole("dialog", { name: `New team: Zzz${T}` });
    await expect(newDialog).toBeVisible();
    await newDialog.getByRole("textbox", { name: "New team name" }).fill(NEW);
    await newDialog.getByLabel("New team active from (optional)").fill("2025");
    await newDialog.getByRole("button", { name: `Create team ${NEW}` }).click();
    const newChip = page.getByRole("button", { name: `Remove team ${NEW}`, exact: true });
    await expect(newChip).toBeVisible();
    await newChip.click();
    await expect(newChip).toBeHidden();

    // ── PART 2: Team Management lists both eras; Back and Forward walk the navigation ──
    await page.getByRole("link", { name: "Teams", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Team Management" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Team Management" })).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Filter players" })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Team Management" })).toBeVisible();

    const filter = page.getByRole("textbox", { name: "Filter teams" });
    await filter.fill(NEW);
    // NEO-330: "2 matches" names the two rows the token reaches: both eras.
    await expect(teamsCounter(page, "2 matches")).toBeVisible();
    await expect(teamRow(page, OLD_ROW)).toBeVisible();
    await expect(teamRow(page, NEW_ROW)).toBeVisible();

    // ── PART 3: on the newer team, the older team's full name as an alias, plus a short one ──
    await teamRow(page, NEW_ROW).click();
    await expect(page.getByRole("heading", { name: NEW, exact: true })).toBeVisible();
    const aka = page.getByRole("textbox", { name: "Also known as" });
    const currentAliases = page.getByRole("list", { name: "Current aliases" });
    const save = page.getByRole("button", { name: "Save", exact: true });
    const saved = (name: string) => page.getByRole("status").filter({ hasText: `Saved ${name}.` });
    await expect(aka).toHaveValue("");
    await aka.fill(`${OLD}, ${SHORT}`);
    await expect(currentAliases.getByText(OLD, { exact: true })).toBeVisible();
    await expect(currentAliases.getByText(SHORT, { exact: true })).toBeVisible();
    await expectAccessible(page, { label: "Team Management, another era's name typed as an alias" });
    await save.click();
    await expect(saved(NEW)).toBeVisible();
    // Nothing refused it (the positive above is the save landing).
    await expect(page.getByRole("alert").filter({ hasText: /alias/ })).toHaveCount(0);

    // It persisted: a reload re-opens the team (the selection is in the URL) and reads the stored list.
    await page.reload();
    // A full reload is a fresh launch of the app (R4's launch gate).
    await expect(page.getByRole("heading", { name: NEW, exact: true })).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(aka).toHaveValue(`${OLD}, ${SHORT}`);
    await expect(currentAliases.getByText(OLD, { exact: true })).toBeVisible();
    // The reload empties the filter; narrow the list again so the page (and the
    // axe pass below) holds two rows, not the catalogue's thousands.
    await filter.fill(NEW);
    await expect(teamsCounter(page, "2 matches")).toBeVisible();
    await expect(page.getByRole("heading", { name: NEW, exact: true })).toBeVisible();

    // ── PART 4: an unrelated edit saves with the alias in the list ──
    const primary = page.getByRole("textbox", { name: "Primary color" });
    await primary.fill("#003831");
    await save.click();
    await expect(saved(NEW)).toBeVisible();

    // ── PART 5: moving the newer team's start to 2020 overlaps the older team: refused inline ──
    const from = page.getByRole("spinbutton", { name: "Active from" });
    await expect(from).toHaveValue("2025");
    await from.fill("2020");
    await save.click();
    const refusal = page.getByRole("alert").filter({
      hasText: `The alias "${OLD}" is another team's name (${OLD_ROW}), and the two teams' years overlap. Remove the alias, or give both teams years that don't overlap.`,
    });
    await expect(refusal).toBeVisible();
    await expect(saved(NEW)).toHaveCount(0);
    await expectAccessible(page, { label: "Team Management, years edit refused by an alias" });

    // Nothing was written: the reload reads the stored era and the stored list.
    await page.reload();
    await expect(page.getByRole("heading", { name: NEW, exact: true })).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(from).toHaveValue("2025");
    await expect(aka).toHaveValue(`${OLD}, ${SHORT}`);
    await expect(primary).toHaveValue("#003831");

    // ── PART 6: the older team still saves its own edits, a years change included ──
    // (The reload emptied the filter again.)
    await filter.fill(NEW);
    await expect(teamsCounter(page, "2 matches")).toBeVisible();
    await teamRow(page, OLD_ROW).click();
    await expect(page.getByRole("heading", { name: OLD, exact: true })).toBeVisible();
    await expect(from).toHaveValue("1968");

    // The reverse direction: running the older team on to 2026 would overlap
    // the newer team, which wears the older team's name as an alias. Refused
    // inline, in the alias-holder sentence naming the newer team and its era:
    // nothing is CALLED the older name, so it is not a name collision. (2026,
    // not later: an end year past next year is refused as out of range before
    // either check.)
    const to = page.getByRole("spinbutton", { name: "to", exact: true });
    await expect(to).toHaveValue("2024");
    await to.fill("2026");
    await save.click();
    const reverse = page.getByRole("alert").filter({ hasText: `${NEW_ROW} already answers to this name as an alias, and the two teams' years overlap. Remove it there, or give this team years that don't overlap.` });
    await expect(reverse).toBeVisible();
    await expect(saved(OLD)).toHaveCount(0);
    await expectAccessible(page, { label: "Team Management, older team's years edit refused" });
    // Nothing was written: the reload reads the stored era.
    await page.reload();
    await expect(page.getByRole("heading", { name: OLD, exact: true })).toBeVisible({ timeout: LAUNCH_GATE });
    await expect(to).toHaveValue("2024");
    await expect(from).toHaveValue("1968");
    await filter.fill(NEW);
    await expect(teamsCounter(page, "2 matches")).toBeVisible();
    await expect(teamRow(page, OLD_ROW)).toBeVisible();

    // Its own edits still save, a years change that stays clear included.
    await primary.fill("#00843d");
    // Still clear of the newer team's 2025 start, so the era-aware reverse check finds no holder.
    await from.fill("1969");
    await save.click();
    await expect(saved(OLD)).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: /alias/ })).toHaveCount(0);
    await expect(teamRow(page, `${OLD} · 1969–2024`)).toBeVisible();
  },
);
