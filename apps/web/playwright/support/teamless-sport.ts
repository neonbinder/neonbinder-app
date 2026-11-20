/**
 * NEO-426 — the sport row's "No teams in this sport" switch, as an operator
 * meets it in the Set Builder: the sport's Attributes panel, a cell labelled
 * "Set feature No teams in this sport" holding an `aria-pressed` button of the
 * same name (sport rows only; aria-disabled while its write flies).
 *
 * One implementation for every spec that turns a worker's custom sport
 * teamless for its own length (`customSport(env)`: never a shared sport, so
 * no parallel spec on another worker meets the flag). Each such spec records
 * that the flag may be on from the press onwards and turns it off in its
 * `afterEach` with `ensureSportHasTeams`.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { drillToCustom, openAttributesPanel } from "./set-builder";

export const TEAMLESS_TOGGLE = "No teams in this sport";
// The toasts are held to their claims, not their full sentences, so the wording can settle.
export const TEAMLESS_MARKED = /^Marked — .*save with No Team/;
export const TEAMLESS_CLEARED = /^Cleared — .*ask for a team again/;

/** The sport row's toggle, scoped to its Attributes cell; `pressed` narrows it to that state. */
export function teamlessToggle(page: Page, pressed?: boolean): Locator {
  return page
    .getByLabel(`Set feature ${TEAMLESS_TOGGLE}`)
    .getByRole("button", { name: TEAMLESS_TOGGLE, exact: true, ...(pressed === undefined ? {} : { pressed }) });
}

/**
 * Drill to `sport` (a custom sport: `drillToCustom` makes it if missing) and
 * open its Attributes panel. Contract: EXIT the panel is open and its heading
 * says it is the sport's.
 */
export async function openSportAttributes(page: Page, sport: string): Promise<void> {
  await drillToCustom(page, { sport });
  await expect(page.getByRole("heading", { name: `Attributes for ${sport} (Sport)` })).toBeVisible();
  await openAttributesPanel(page);
}

/**
 * Press the toggle from `from` to its other state, on the sport's open panel.
 * Contract: ENTRY the toggle reads `from` (asserted: a leftover state fails
 * here, by name). EXIT the toast says what changed and the toggle reads the
 * other state. The caller records "the flag may be on" BEFORE pressing it on.
 */
export async function pressTeamlessToggle(page: Page, from: boolean): Promise<void> {
  await expect(teamlessToggle(page, from)).toBeVisible();
  await teamlessToggle(page, from).click();
  await expect(page.getByText(from ? TEAMLESS_CLEARED : TEAMLESS_MARKED).first()).toBeVisible();
  await expect(teamlessToggle(page, !from)).toBeVisible();
}

/**
 * For an `afterEach`, on a page of its own: the sport asks for teams again,
 * whatever the body left. A fresh page holds no write in flight, so the
 * toggle's `aria-pressed` is the stored flag, and the branch is on app state.
 * Contract: EXIT the toggle reads not pressed.
 */
export async function ensureSportHasTeams(page: Page, sport: string): Promise<void> {
  await openSportAttributes(page, sport);
  await expect(teamlessToggle(page)).toBeVisible();
  if ((await teamlessToggle(page).getAttribute("aria-pressed")) === "true") {
    await pressTeamlessToggle(page, true);
  }
  await expect(teamlessToggle(page, false)).toBeVisible();
}
