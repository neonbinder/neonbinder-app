/**
 * NEO-645 — the per-card Tidy Up walk ("Tidy up <year> <set> [<variant>]").
 *
 * It replaced the pre-save entity-review wizard and the post-save attention
 * walker (`support/wizard.ts` keeps their old names, mapped onto this file,
 * until every importer is rewritten). The cards are SAVED before the walk opens
 * (Match Cards ends in the commit), and every tile saves the moment it is
 * answered (J1), so nothing here commits and nothing rolls back:
 *
 *   - the walk opens by itself after a commit that left a card needing a
 *     person, or from the checklist's "N need you" pill (`openTidyWalk`);
 *   - one card at a time: a card face, a header line ("#38b · Image Variation
 *     · Mike Trout"), a tally ("3 to fix · 1 to check") and tiles, each a
 *     `group` named by its heading (`tidyTile`): "Sources disagree", "Player",
 *     "Career", "Team", "Autograph", "Listing title", "More about this card";
 *   - a tile's level is in its accessible DESCRIPTION, not its colour: "To fix"
 *     (pink, holds Save & next), "To check" (blue), "Waiting" (a skeleton), none
 *     (plain);
 *   - the footer: "Back", "Save for later (Esc)" (closes the walk, writes
 *     nothing), "Skip: not ready to list" (moves on, writes nothing), "Save &
 *     next (Enter)" (marks the card's blue items seen and moves on; held while
 *     anything is pink), and the status line "N to fix before this card can
 *     save. Skip it and it can't be listed until it's fixed.";
 *   - the header's progress bar ("Wizard progress") reads "N cards left" in its
 *     `aria-valuetext` (`expectCardsLeft`);
 *   - the end screen: "N cards skipped, not ready to list", "Still looking up
 *     teams for N cards…" or "All tidy. Nothing on this checklist needs you.",
 *     and a "Done (Esc)" button.
 *
 * The position is in the URL (`?tidy=<card>|first|done`), so a move is proved by
 * the address changing and the browser's Back walks back through the cards.
 *
 * Every wait here is 7 s (R5): the walk's moves are client-side and its answers
 * are our own single writes. A lookup an answer starts is never waited for.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The walk's dialog name starts with this (NEO-497: it then names the checklist it tidies). */
export const TIDY_WALK_NAME = /^Tidy up /;

/** The footer's words (Jason-approved copy, NEO-645 contracts). */
export const TIDY_FOOTER = {
  back: "Back",
  saveForLater: "Save for later (Esc)",
  skip: "Skip: not ready to list",
  saveAndNext: "Save & next (Enter)",
  done: "Done (Esc)",
} as const;

/** A tile's heading, which is its group's accessible name. */
export type TidyTileName =
  | "Sources disagree"
  | "Player"
  | "Career"
  | "Team"
  | "Autograph"
  | "Listing title"
  | "More about this card";

/** The sr-only level a pink tile is described by. */
const TO_FIX = "To fix";

/** "Not a player (checklist, team card, stadium)", plus " <printed name>" on a multi-player card. */
const NOT_A_PLAYER = /^Not a player \(checklist, team card, stadium\)( .+)?$/;
/** "Not a team", plus " <printed name>" on a card with more than one team name. */
const NOT_A_TEAM = /^Not a team( .+)?$/;
/** An answered player row's Change ("Change player", or "Change player <printed name>" on a multi-name card). */
// Tolerant of the pre-26cea34c "Change" / "Change <printed>" until every Vite serves the rename.
const CHANGE_PLAYER = /^Change( player)?( .+)?$/;
/** An answered team row's Change ("Change team", or "Change team <printed name>" on a multi-name card). */
const CHANGE_TEAM = /^Change( team)?( .+)?$/;

/** The open walk. Contract: a locator, nothing waited for. */
export function tidyWalk(page: Page): Locator {
  return page.getByRole("dialog", { name: TIDY_WALK_NAME });
}

/** The header's progress bar; its `aria-valuetext` is "N cards left". */
export function tidyWalkProgress(page: Page): Locator {
  return tidyWalk(page).getByRole("progressbar", { name: "Wizard progress" });
}

/** One footer button by its words. `usable` drops an aria-disabled one (a held Save & next). */
export function tidyFooterButton(page: Page, name: keyof typeof TIDY_FOOTER, { usable = false } = {}): Locator {
  return tidyWalk(page).getByRole("button", {
    name: TIDY_FOOTER[name],
    exact: true,
    ...(usable ? { disabled: false } : {}),
  });
}

/** One tile of the open card, by its heading. Contract: a locator, nothing waited for. */
export function tidyTile(page: Page, name: TidyTileName): Locator {
  // A `group` since 26cea34c; the `region` alternative keeps a build from before it working
  // (a running snapshot), and goes once every build is past it.
  const walk = tidyWalk(page);
  return walk.getByRole("group", { name, exact: true }).or(walk.getByRole("region", { name, exact: true }));
}

/**
 * The tile named `name` while it is PINK (its description reads "To fix"). A
 * locator: count it on a settled card (`expectCardSettled`) to branch, or
 * assert `toHaveCount(0)` after answering it.
 */
export function pinkTile(page: Page, name: TidyTileName): Locator {
  return tidyTile(page, name).filter({ has: page.getByText(TO_FIX, { exact: true }) });
}

/** The footer status that says why Save & next is held ("N to fix before this card can save. …"). */
export function mustFixLine(page: Page): Locator {
  return tidyWalk(page).getByText(/^[0-9]+ to fix before this card can save\. Skip it and it can't be listed until it's fixed\.$/);
}

/**
 * The open card's header line, whole ("#38b · Image Variation · Mike Trout").
 * Clicking it puts focus on the card outside any control, where Enter is Save
 * & next and Escape is Save for later. Contract: a locator, nothing waited for.
 */
export function tidyCardHeader(page: Page, line: string): Locator {
  return tidyWalk(page).getByText(line, { exact: true });
}

/** The end screen's own control. */
function endScreen(page: Page): Locator {
  return tidyFooterButton(page, "done");
}

/** A card is on screen: its "More about this card" tile is mounted on every card the walk shows. */
function cardOnScreen(page: Page): Locator {
  return tidyTile(page, "More about this card");
}

/** "31 cards left" / "1 card left" / "No cards left" (the walk's own wording). */
export function cardsLeftText(n: number): string {
  if (n <= 0) return "No cards left";
  return `${n} ${n === 1 ? "card" : "cards"} left`;
}

/**
 * The walk shows exactly `n` cards still to walk: the header's subtitle, read
 * off the progress bar's `aria-valuetext` (one node; the subtitle's own live
 * region repeats it). Contract: a 7 s web-first assert.
 */
export async function expectCardsLeft(page: Page, n: number): Promise<void> {
  await expect(tidyWalkProgress(page), `the walk has ${cardsLeftText(n)}`).toHaveAttribute(
    "aria-valuetext",
    cardsLeftText(n),
  );
}

/**
 * The walk is open and holds still: its progress bar is up and it shows a card
 * (its tiles mounted, none still "Looking at this card") or its end screen.
 * `title` pins the dialog's whole name (`tidyUpName` in support/wizard.ts).
 * Contract: 7 s each.
 */
export async function expectTidyWalkOpen(page: Page, { title }: { title?: string } = {}): Promise<void> {
  const walk = tidyWalk(page);
  await expect(walk, "the Tidy Up walk is open").toBeVisible();
  if (title !== undefined) await expect(walk).toHaveAccessibleName(title);
  await expect(tidyWalkProgress(page)).toBeVisible();
  await expect(cardOnScreen(page).or(endScreen(page)).first(), "the walk shows a card or its end screen").toBeVisible();
  if (await cardOnScreen(page).isVisible()) await expectCardSettled(page);
}

/**
 * The open card's tiles have loaded: the card is on screen (positive) and no
 * tile is still the "Looking at this card" skeleton (the card's names, players
 * and teams are read). A tile waiting on a disagreement ("Waiting on the
 * spelling above") stays a skeleton until that is answered, and is not waited
 * for. Contract: 7 s each.
 */
export async function expectCardSettled(page: Page): Promise<void> {
  await expect(cardOnScreen(page), "a card is open in the walk").toBeVisible();
  await expect(tidyWalk(page).getByText("Looking at this card", { exact: true }), "the card's tiles are still loading").toHaveCount(0);
}

/**
 * Open the walk from the checklist's "N need you" pill (the one entry point by
 * hand; a commit that leaves a card needing a person opens it by itself).
 * Contract: ENTRY the checklist is on screen with the pill. EXIT the walk is
 * open and settled (`expectTidyWalkOpen`).
 */
export async function openTidyWalk(page: Page, options: { title?: string } = {}): Promise<void> {
  await needsYouPill(page).click();
  await expectTidyWalkOpen(page, options);
}

/** The checklist's "N need you" / "1 needs you" pill (rendered only while a card needs a person). */
export function needsYouPill(page: Page): Locator {
  return page.getByRole("button", { name: /^[0-9]+ needs? you$/ });
}

/**
 * After a commit's "Saved N cards." line is on screen, settle whether the walk
 * opened. The line, the pill and the walk's trigger are one render's work (the
 * commit sets the line and arms the walk together; the pill counts the same
 * live rows the walk opens on), so the pill read with the line is the settled
 * answer. Returns whether the walk is open.
 *
 * Contract: ENTRY `saved` is visible (the caller asserted it). EXIT either the
 * walk is open and settled, or no card needs a person and the walk is hidden.
 */
export async function settleWalkAfterCommit(page: Page, saved: Locator): Promise<boolean> {
  await expect(saved).toBeVisible();
  if (await needsYouPill(page).isVisible()) {
    await expectTidyWalkOpen(page);
    return true;
  }
  await expect(tidyWalk(page), "no card needs a person, so the walk stays shut").toBeHidden();
  return false;
}

/**
 * "Save for later (Esc)": close the walk. Every tile already saved what it was
 * given, so nothing is written or rolled back here. Contract: EXIT the walk is
 * gone and the address no longer carries its position.
 */
export async function saveForLater(page: Page): Promise<void> {
  await tidyFooterButton(page, "saveForLater").click();
  await expect(tidyWalk(page), "Save for later closed the walk").toBeHidden();
  await expect(page, "Save for later took the walk's position out of the address").not.toHaveURL(/[?&]tidy=/);
}

/**
 * The end screen's "Done (Esc)": close a walk that has run out of cards.
 * Contract: ENTRY the end screen is up. EXIT the walk is gone.
 */
export async function finishTidyWalk(page: Page): Promise<void> {
  await endScreen(page).click();
  await expect(tidyWalk(page), "Done closed the walk").toBeHidden();
  await expect(page).not.toHaveURL(/[?&]tidy=/);
}

/**
 * The open card's identity as a person reads it: every "#<number>…" line on the
 * card (the face's number and the header, "#38b · Image Variation · Mike
 * Trout"). A locator; read it with `allTextContents` before a move.
 */
function cardIdentity(page: Page): Locator {
  return tidyWalk(page).getByText(/^#\S+( · .+)?$/);
}

/**
 * The open card's "#…" lines (`cardIdentity`), for a spec that proves a move by
 * hand, e.g. the browser's Back returning to the card it read: read them with
 * `allTextContents`, then assert `toHaveText(before)`.
 */
export function tidyCardIdentity(page: Page): Locator {
  return cardIdentity(page);
}

/**
 * Wait until a footer move has landed. The address changes BEFORE the next
 * card renders (the router updates history, then React renders), so the
 * address alone would let the old card's tiles be read as the new one's: the
 * move is proved by the address AND by what is on screen, the end screen when
 * the address says `done`, else a card whose "#…" lines differ from `before`.
 */
async function expectMovedFrom(page: Page, from: string, before: string[], what: string): Promise<void> {
  await expect(page, `${what} moved the walk on`).not.toHaveURL(from);
  if (/[?&]tidy=done(&|$)/.test(page.url())) {
    await expect(endScreen(page), `${what} reached the end screen`).toBeVisible();
    return;
  }
  await expect(cardIdentity(page), `${what} put another card on screen`).not.toHaveText(before);
  await expectCardSettled(page);
}

/**
 * "Skip: not ready to list": move on with no write (the card stays flagged and
 * the end screen counts it). Pink never holds Skip. Contract: ENTRY a card is
 * open. EXIT the next card or the end screen is up.
 */
export async function skipCard(page: Page): Promise<void> {
  const from = page.url();
  const before = await cardIdentity(page).allTextContents();
  await tidyFooterButton(page, "skip", { usable: true }).click();
  await expectMovedFrom(page, from, before, "Skip");
}

/**
 * "Save & next (Enter)": mark the open card's blue items seen and move on.
 * Contract: ENTRY a card is open with nothing pink (Save & next is usable,
 * waited for 7 s: a card with pink left fails here, by name). EXIT the next
 * card or the end screen is up.
 */
export async function saveAndNext(page: Page): Promise<void> {
  const from = page.url();
  const save = tidyFooterButton(page, "saveAndNext", { usable: true });
  await expect(save, "Save & next is usable (nothing on the card is pink)").toBeVisible();
  const before = await cardIdentity(page).allTextContents();
  await save.click();
  await expectMovedFrom(page, from, before, "Save & next");
}

/**
 * Skip cards until `target` (a locator on the open card, e.g. `pinkTile(page,
 * "Player")`) is on screen. A walk that runs out first fails by name.
 * `maxCards` is a runaway guard.
 */
export async function skipUntil(page: Page, target: Locator, { maxCards = 50 }: { maxCards?: number } = {}): Promise<void> {
  for (let i = 0; i < maxCards; i++) {
    await expect(cardOnScreen(page).or(endScreen(page)).first()).toBeVisible();
    if (await endScreen(page).isVisible()) break;
    await expectCardSettled(page);
    if ((await target.count()) > 0) break;
    await skipCard(page);
  }
  await expect(target.first(), "the walk reached a card with what the spec is looking for").toBeVisible();
}

// ── answering the Player tile ────────────────────────────────────────────────

/** The Player tile's name rows still waiting for an answer (each offers "Not a player …"). */
function openPlayerRows(page: Page): Locator {
  return tidyTile(page, "Player")
    .getByRole("group", { name: /^Player / })
    .filter({ has: page.getByRole("button", { name: NOT_A_PLAYER }) });
}

/** The answered row named `Player <printed>`: its Change is up and its "Not a player" is gone. */
async function expectPlayerRowAnswered(page: Page, rowName: string): Promise<void> {
  const row = tidyTile(page, "Player").getByRole("group", { name: rowName, exact: true });
  await expect(row.getByRole("button", { name: CHANGE_PLAYER }), `"${rowName}" was answered`).toBeVisible();
  await expect(row.getByRole("button", { name: NOT_A_PLAYER })).toHaveCount(0);
}

/**
 * The button the row PROMOTES when NeonBinder has one player to suggest: a
 * single exact namesake ("Link to <name>") or a one-namesake-in-another-sport
 * preselect ("Link to <name> (<sport>)"). The row can show other "Link to …"
 * buttons at the same time, each inside a list ("Possible player matches",
 * "Fuller names for <name>"), so the promoted one is the "Link to" whose name
 * no list repeats. Names only (accessible names, read off the controls).
 */
async function promotedPlayerLink(row: Locator): Promise<Locator | undefined> {
  const listed = new Set<string>();
  for (const button of await row.getByRole("list").getByRole("button").all()) {
    listed.add(((await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "").trim());
  }
  for (const button of await row.getByRole("button", { name: /^Link to (?!existing)/ }).all()) {
    const name = ((await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "").trim();
    if (!listed.has(name)) return row.getByRole("button", { name, exact: true });
  }
  return undefined;
}

/** The player-create button, plain or one-name, never "… anyway"; `( .+)?` is a multi-name card's suffix. */
const CREATE_PLAYER = /^(Add as new player|Add as a one-name player)(?! anyway)( .+)?$/;
/** The decline of a promoted link ("Add as new player anyway"), which only OPENS the plain create. */
const CREATE_ANYWAY = /^Add as new player anyway( .+)?$/;

/**
 * Answer every pink row of the open card's Player tile the way the old seed's
 * "Add remaining players as new" did (origin/main `decideAllRemaining`):
 *  - a same-name pick step ("Which <name> is this?", two or more players on
 *    file under the name) links its top candidate: the bulk left those rows
 *    alone and the seed linked the first candidate, never minting one more
 *    same-name player (NEO-332);
 *  - every other name is CREATED. A row that promotes one player to link (an
 *    exact namesake, or NEO-424's one namesake in another sport, "Link to
 *    <name> (<sport>)") is declined with "Add as new player anyway", which
 *    opens the plain create, then "Add as new player": the bulk created those
 *    too (its ambiguity test reads the name's own sport only). `promoted:
 *    "link"` takes the promoted link instead.
 * Never "Not a player", never a near match from "Possible player matches".
 *
 * Each row is read only once its lookups have answered: the row says
 * "Checking for players by that name…" and holds its create until both the
 * near-match and the name-fragment reads land, and either can turn "new" into
 * a promoted link, a pick step or the fragment question.
 *
 * Contract: ENTRY a settled card. EXIT no Player row is waiting for an answer
 * and the tile is not pink (a tile still pink after the last row fails here,
 * by name). Returns how many rows were answered (0 when the tile was not
 * pink). `maxRows` is a runaway guard.
 */
export async function answerPinkPlayerTiles(
  page: Page,
  { maxRows = 8, promoted = "create" }: { maxRows?: number; promoted?: "create" | "link" } = {},
): Promise<number> {
  if ((await pinkTile(page, "Player").count()) === 0) return 0;
  let answered = 0;
  for (let i = 0; i < maxRows; i++) {
    const rows = openPlayerRows(page);
    if ((await rows.count()) === 0) break;
    const row = rows.first();
    const rowName = (await row.getAttribute("aria-label")) ?? "";
    // Settle the row into ONE state before reading it: the lookups have answered (the hold
    // line is gone) and a usable answer is up (R2: the positive under the negative).
    await expect(row.getByText("Checking for players by that name…"), `"${rowName}" is still checking`).toHaveCount(0);
    const pick = row
      .getByRole("list", { name: "Players already filed under this name" })
      .getByRole("button", { disabled: false });
    const create = row.getByRole("button", { name: CREATE_PLAYER, disabled: false });
    const anyway = row.getByRole("button", { name: CREATE_ANYWAY, disabled: false });
    await expect(pick.or(create).or(anyway).first(), `"${rowName}" offers an answer`).toBeVisible();
    if ((await pick.count()) > 0) {
      // NEO-332: never mint one more same-name player; the top candidate is the seed's answer.
      await pick.first().click();
    } else if ((await anyway.count()) > 0) {
      const link = promoted === "link" ? await promotedPlayerLink(row) : undefined;
      if (link !== undefined) {
        await link.click();
      } else {
        await anyway.click();
        // "anyway" only opens the plain create (and asks Wikidata about the name); the create
        // is pressed once it is usable.
        await expect(anyway, `"${rowName}" left its promoted link for the plain create`).toHaveCount(0);
        await create.click();
      }
    } else {
      await create.click();
    }
    await expectPlayerRowAnswered(page, rowName);
    answered++;
  }
  await expect(openPlayerRows(page), `Player rows still waiting after ${maxRows} answers`).toHaveCount(0);
  await expect(pinkTile(page, "Player"), "the Player tile is still pink with every row answered").toHaveCount(0);
  return answered;
}

/** The open card's first unanswered Player row that offers a plain create ("Add as new player" / one-name). */
export function creatablePlayerRow(page: Page): Locator {
  return openPlayerRows(page).filter({ has: page.getByRole("button", { name: CREATE_PLAYER }) });
}

/**
 * Answer ONE open Player row as a new player: the first row offering a plain
 * create. A spec whose intent is "this name is new" takes this; one that walks
 * past names takes `answerPinkPlayerTiles`. Contract: ENTRY a settled card with
 * such a row (waited for, 7 s). EXIT that row reads answered (its Change is up).
 * Returns the row's name ("Player <printed>").
 */
export async function createPlayerOnOpenRow(page: Page): Promise<string> {
  const row = creatablePlayerRow(page).first();
  await expect(row, "the card has a Player row offering Add as new player").toBeVisible();
  const rowName = (await row.getAttribute("aria-label")) ?? "";
  await expect(row.getByText("Checking for players by that name…"), "the row is still checking").toHaveCount(0);
  await row.getByRole("button", { name: CREATE_PLAYER, disabled: false }).click();
  await expectPlayerRowAnswered(page, rowName);
  return rowName;
}

// ── answering the Team tile ──────────────────────────────────────────────────

/** The Team tile's printed-name rows still waiting for an answer (each offers "Not a team"). */
function openTeamRows(page: Page): Locator {
  return tidyTile(page, "Team")
    .getByRole("group", { name: /^Team / })
    .filter({ has: page.getByRole("button", { name: NOT_A_TEAM }) });
}

/** Answer one printed team name by creating it in the inline New team form (the row's "+ New team"). */
async function createTeamFromRow(page: Page, open: Locator): Promise<void> {
  // Re-anchor the row by its own name: the open form hides "Not a team", so a row found by
  // that button (`openTeamRows`) stops matching the moment "+ New team" is pressed.
  const rowName = (await open.getAttribute("aria-label")) ?? "";
  const row = tidyTile(page, "Team").getByRole("group", { name: rowName, exact: true });
  await expect(row.getByText("Checking for teams by that name…"), "the team row is still checking").toHaveCount(0);
  await row.getByRole("button", { name: /^\+ New team( .+)?$/, disabled: false }).click();
  const form = row.getByRole("group", { name: /^New team: / });
  await expect(form).toBeVisible();
  const create = form.getByRole("button", { name: /^Create team( .+)?$/, disabled: false });
  // NEO-307/602: a name another team holds as an alias offers "Link to <holder>" and holds Create.
  const holder = form.getByRole("button", { name: /^Link to / });
  await expect(create.or(holder).first()).toBeVisible();
  if (await holder.first().isVisible()) {
    await holder.first().click();
    return;
  }
  await create.click();
  // An era refusal ("… already exists for …. Create again to add this as a second era.") would
  // mint a second era of a team on file; this helper never does that: it fails here, by name.
  await expect(form.getByRole("alert"), "creating the team was refused").toHaveCount(0);
}

/**
 * Answer ONE open printed team name by creating it (the row's "+ New team",
 * then "Create team"). Contract: ENTRY a settled card with an open team row
 * (waited for, 7 s). EXIT that row reads answered. Returns its name ("Team <printed>").
 */
export async function createTeamOnOpenRow(page: Page): Promise<string> {
  const row = openTeamRows(page).first();
  await expect(row, "the card has a team name waiting for an answer").toBeVisible();
  const rowName = (await row.getAttribute("aria-label")) ?? "";
  await createTeamFromRow(page, row);
  const done = tidyTile(page, "Team").getByRole("group", { name: rowName, exact: true });
  await expect(done.getByRole("button", { name: CHANGE_TEAM }), `"${rowName}" was answered`).toBeVisible();
  return rowName;
}

/**
 * Answer every pink part of the open card's Team tile:
 *  - each printed team name: link the one the product offers (the first of
 *    "We've got N teams … Pick the one on this card", or an exact single "Link
 *    to <team>"), else create it in the inline New team form. Never "Not a
 *    team". Each answer reaches every card in the scope that prints the name.
 *  - a card with no team (`noTeam`): `"prefilled"` (default) saves the chips the
 *    product pre-selected ("Save team" / "Save teams", the old wizard's default)
 *    and leaves a card with none pink; `"noTeamOnCard"` answers "No team on
 *    this card".
 *
 * Contract: ENTRY a settled card. EXIT no printed team name is waiting. The
 * tile can stay pink only for a no-team card the `"prefilled"` rule left alone
 * (the caller skips it). Returns how many answers were written.
 */
export async function answerPinkTeamTiles(
  page: Page,
  { noTeam = "prefilled", maxRows = 8 }: { noTeam?: "prefilled" | "noTeamOnCard"; maxRows?: number } = {},
): Promise<number> {
  const tile = tidyTile(page, "Team");
  if ((await pinkTile(page, "Team").count()) === 0) return 0;
  let answered = 0;
  for (let i = 0; i < maxRows; i++) {
    const rows = openTeamRows(page);
    if ((await rows.count()) === 0) break;
    const row = rows.first();
    const rowName = (await row.getAttribute("aria-label")) ?? "";
    const candidates = row.getByRole("list", { name: /^We've got [0-9]+ teams / }).getByRole("button", { disabled: false });
    // Settle first: "+ New team" is held while the row checks for teams by that name (an exact
    // match turns the answer into a link), and the hold line says so.
    await expect(row.getByText("Checking for teams by that name…"), `"${rowName}" is still checking`).toHaveCount(0);
    await expect(
      candidates.or(row.getByRole("button", { name: /^(Link to |\+ New team)/, disabled: false })).first(),
      `"${rowName}" offers an answer`,
    ).toBeVisible();
    if (await row.getByText(/^Which team: /).isVisible()) {
      await expect(candidates.first()).toBeVisible();
      await candidates.first().click();
    } else {
      // Outside the candidate step the row's only "Link to" is the exact single match.
      const exact = row.getByRole("button", { name: /^Link to /, disabled: false });
      if ((await exact.count()) > 0) await exact.first().click();
      else await createTeamFromRow(page, row);
    }
    const done = tile.getByRole("group", { name: rowName, exact: true });
    await expect(done.getByRole("button", { name: CHANGE_TEAM }), `"${rowName}" was answered`).toBeVisible();
    await expect(done.getByRole("button", { name: NOT_A_TEAM })).toHaveCount(0);
    answered++;
  }
  await expect(openTeamRows(page), `Team rows still waiting after ${maxRows} answers`).toHaveCount(0);

  if ((await pinkTile(page, "Team").count()) > 0) {
    // What is left pink is a card with no team: the fill chips.
    const save = tile.getByRole("button", { name: /^Save teams?$/, disabled: false });
    const none = tile.getByRole("button", { name: "No team on this card", exact: true, disabled: false });
    await expect(none, "the Team tile is pink with no name row left, so it is asking for a team").toBeVisible();
    if (noTeam === "noTeamOnCard") {
      await none.click();
    } else if ((await save.count()) > 0) {
      await save.click();
    } else {
      return answered;
    }
    await expect(pinkTile(page, "Team"), "the card's team answer landed").toHaveCount(0);
    answered++;
  }
  return answered;
}

/**
 * NEO-345 on the walk: a pink Autograph tile ("How is this card signed?") gets
 * `choice` (a radio in the "Autograph format" radiogroup) and is proved answered
 * (checked, the tile no longer pink).
 */
export async function answerPinkAutographTile(
  page: Page,
  choice: "On-card auto" | "Sticker auto" = "On-card auto",
): Promise<boolean> {
  if ((await pinkTile(page, "Autograph").count()) === 0) return false;
  const formats = tidyTile(page, "Autograph").getByRole("radiogroup", { name: "Autograph format", exact: true });
  const radio = formats.getByRole("radio", { name: choice, exact: true, disabled: false });
  await radio.click();
  await expect(formats.getByRole("radio", { name: choice, exact: true, checked: true })).toBeVisible();
  await expect(pinkTile(page, "Autograph")).toHaveCount(0);
  return true;
}

export interface WalkTally {
  /** Cards shown. */
  cards: number;
  /** Cards left with Save & next. */
  saved: number;
  /** Cards left with Skip (something pink this walk does not answer). */
  skipped: number;
  /** Player rows answered (link or create). */
  players: number;
  /** Team answers written (rows linked or created, no-team cards answered). */
  teams: number;
  /** Cards that opened with a pink "Sources disagree" tile (never answered here; such a card is skipped). */
  disagreements: number;
  /** Skipped cards per tile still pink when they were skipped (a card counts under each of its pink tiles). */
  skippedFor: Partial<Record<TidyTileName, number>>;
}

/** The tiles that can be pink, in the walk's order. */
const PINKABLE: readonly TidyTileName[] = ["Sources disagree", "Player", "Team", "Autograph", "Listing title"];

/**
 * Walk the open walk to its end screen, answering on each card what a seed or
 * a spec that does not care about the card would: every pink Player row
 * (`answerPinkPlayerTiles`), every pink Team part (`answerPinkTeamTiles`, with
 * `noTeam`), a pink Autograph tile (`autograph`, "On-card auto" by default; the
 * old wizard's required answer). Then Save & next when nothing is pink, else
 * Skip (a sources disagreement, an over-long title: not this helper's to
 * decide). Does NOT press Done: the caller asserts the end screen first, then
 * `finishTidyWalk`.
 *
 * Contract: ENTRY the walk is open. EXIT the end screen is up. Returns the
 * tally. `maxCards` is a runaway guard (the seed's Base is 335 cards).
 */
export async function walkAnsweringEverything(
  page: Page,
  {
    maxCards = 400,
    noTeam = "prefilled",
    autograph = "On-card auto",
  }: { maxCards?: number; noTeam?: "prefilled" | "noTeamOnCard"; autograph?: "On-card auto" | "Sticker auto" | "leave" } = {},
): Promise<WalkTally> {
  const tally: WalkTally = { cards: 0, saved: 0, skipped: 0, players: 0, teams: 0, disagreements: 0, skippedFor: {} };
  await expectTidyWalkOpen(page);
  for (let i = 0; i < maxCards; i++) {
    if (await endScreen(page).isVisible()) break;
    await expectCardSettled(page);
    tally.cards++;
    if ((await pinkTile(page, "Sources disagree").count()) > 0) tally.disagreements++;
    tally.players += await answerPinkPlayerTiles(page);
    tally.teams += await answerPinkTeamTiles(page, { noTeam });
    if (autograph !== "leave") await answerPinkAutographTile(page, autograph);
    // Settled into one state: the status line says what is still pink, or Save & next is usable.
    const save = tidyFooterButton(page, "saveAndNext", { usable: true });
    await expect(save.or(mustFixLine(page)).first()).toBeVisible();
    if (await save.isVisible()) {
      await saveAndNext(page);
      tally.saved++;
    } else {
      for (const name of PINKABLE) {
        if ((await pinkTile(page, name).count()) > 0) tally.skippedFor[name] = (tally.skippedFor[name] ?? 0) + 1;
      }
      await skipCard(page);
      tally.skipped++;
    }
  }
  await expect(endScreen(page), `the walk did not end within ${maxCards} cards`).toBeVisible();
  return tally;
}
