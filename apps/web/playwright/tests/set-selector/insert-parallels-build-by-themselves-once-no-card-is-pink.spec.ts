// ONE FEATURE (R1, NEO-661): after an insert's checklist is saved, its parallels are built by
// themselves, but only once no card of the insert is pink. Jason, 2026-11-24: "if there is
// anything that would cause a pink box we should hold the parallels back" (and "Yes, wait for
// lookups" for a card still waiting on its team lookup). The hold is the client's
// (`CardChecklist`'s held auto-start re-reads the live rows on every change), so nobody presses
// "Build from …": the last answer in the Tidy Up walk is what starts the build.
//
// The operator meets it like this:
//   1. The insert has one parallel. A one-row checklist is saved: "Saved 1 card.", and the walk
//      opens on the card, pink twice over (a name nobody knows, and no team).
//   2. Nothing is built: no "Building parallels of …" line, no ledger.
//   3. The name is answered (Add as new player). The team is still pink: still nothing built.
//   4. "No team on this card": the card is not pink any more, and the build starts with no click.
//   5. The ledger says the one parallel was built, and the parallel holds the card's copy. Back
//      returns to the insert's checklist.
//
// THE LOOKUP HOLD is not shown here: a hand-made set has no marketplace id, so no card ever waits
// on a BSC team lookup. `bowman-insert-grouping-builds-parallels` shows it on a real insert (one
// card's lookup answered 429 by the fake, so it waits; the build starts once it no longer does);
// the server side of it is unit-tested (`parallelBuildHold`).
//
// FIXTURE (SET-REGISTRY.md "Custom sets", the `hps`/`hpt` prefixes; R7a): a per-attempt sport
// `hps<token>` › 2026 › Topps › `hpt<token>` › Insert › `hpi<token>`, with ONE parallel
// `hpv<token>` grouped under it, all hand-made with no marketplace id. The Sync is checklist-only
// (one pasted row, no Match Cards, no BSC), and a hand-made sport has no Wikidata mapping, so
// nothing is looked up. Not fresh-only. Nothing is deleted; the sport, its rows, the one card,
// its copy and the minted player stand.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { usePastedChecklist } from "../../support/published-checklist";
import { editCardButton } from "../../support/cards";
import {
  addCustomEntry,
  columnOption,
  columnSelection,
  drillToCustom,
  escapeRe,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import {
  answerPinkTeamTiles,
  createPlayerOnOpenRow,
  expectCardsLeft,
  needsYouPill,
  pinkTile,
  saveForLater,
  settleWalkAfterCommit,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const YEAR = "2026";

test(
  "An insert's parallels are held while a card of the insert is pink, and build by themselves once the walk answers the last pink (NEO-661)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const T = env.ATTEMPT_TOKEN;
    const SPORT = `hps${T}`;
    const SET = `hpt${T}`;
    const INSERT = `hpi${T}`;
    const PARALLEL = `hpv${T}`;
    const PLAYER = `Rookie Hps${T}`;

    // The build's run lines, any phase (ParallelBuildPanel `panelHeading` / `startText`). By text,
    // not role: while the walk is open the page behind it is hidden from the accessibility tree.
    const runLine = page.getByText(
      new RegExp(`^(Building parallels of ${escapeRe(INSERT)} — |Building [0-9]+ parallels? of ${escapeRe(INSERT)}$|${escapeRe(INSERT)} parallels — )`),
    );

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── FIXTURE: the hand-made insert and its one parallel (R9: drillToCustom) ──
    await drillToCustom(page, { sport: SPORT, year: YEAR, manufacturer: "Topps", set: SET, variantType: "Insert" });
    await addCustomEntry(page, "Inserts", INSERT, { confirm: "required" });
    await addCustomEntry(page, "Inserts", PARALLEL, { confirm: "required" });
    await columnOption(page, "Inserts", INSERT).click();
    await expect(columnSelection(page, "Inserts", INSERT)).toBeVisible();
    // NEO-425: an insert's first parallel comes through Group Parallels.
    const grouping = page.getByRole("dialog", { name: "Group Parallels" });
    await page.getByRole("button", { name: "Group Parallels" }).click();
    await expect(grouping.getByText(/Drag inserts under a parent/)).toBeVisible();
    await grouping.getByRole("checkbox", { name: `Select ${PARALLEL}` }).click();
    await grouping.getByText(`Parallels of "${INSERT}"`).click();
    await expect(grouping.getByText("1 promotion, 0 demotions")).toBeVisible();
    await grouping.getByRole("button", { name: "Save 1 change" }).click();
    await expect(grouping).toBeHidden();
    await expect(columnOption(page, "Parallels", PARALLEL)).toBeVisible();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // One row: a name nobody knows and a BLANK team cell (no claim, so the card is pink for its
    // team; `No Team` would be a claim of none).
    await usePastedChecklist(page, `number,player,team\n1,${PLAYER},\n`, 1);
    await syncChecklistButton(page).click();

    // ── STEP 1: the card is saved, and the walk opens on it, pink ──
    const saved = page.getByText(/Saved 1 card\./).first();
    const opened = await settleWalkAfterCommit(page, saved);
    expect(opened, "the card has a name to answer and no team, so the walk opened").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: YEAR, set: SET, variant: INSERT }));
    await expectCardsLeft(page, 1);
    await expect(pinkTile(page, "Player")).toHaveCount(1);
    await expect(pinkTile(page, "Team")).toHaveCount(1);

    // ── STEP 2: held. The commit landed (positive) and, after the axe passes' seconds, no build
    // has started (R2; read straight after the save it would prove little) ──
    await expect(saved).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk on an insert whose parallels are held" });
    await expect(runLine, "a pink card holds the insert's parallels").toHaveCount(0);

    // ── STEP 3: the name answered; the team is still pink, so still held ──
    await createPlayerOnOpenRow(page);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(pinkTile(page, "Team"), "the card is still pink for its team").toHaveCount(1);
    await expect(runLine, "one pink item left still holds the parallels").toHaveCount(0);

    // ── STEP 4: "No team on this card" clears the last pink, and the build starts by itself ──
    // (the helper waits out the tile's "Looking up teams…" before it answers).
    await answerPinkTeamTiles(page, { noTeam: "noTeamOnCard" });
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    await expect(runLine.first(), "no card is pink, so the parallels build with no click").toBeVisible();

    // ── STEP 5: the ledger, read with the walk shut ──
    await saveForLater(page);
    const ledger = page.getByRole("region", { name: new RegExp(`^${escapeRe(INSERT)} parallels — 1 built$`) });
    await expect(ledger.getByRole("heading", { name: `${INSERT} parallels — 1 built`, exact: true })).toBeVisible();
    await expect(
      ledger.getByRole("listitem").filter({ hasText: new RegExp(`^${escapeRe(PARALLEL)} — Built 1 card`) }),
    ).toBeVisible();
    // Nothing on the insert is pink now: the pill (when a blue item is left) has no "to fix".
    await expect(needsYouPill(page).filter({ hasText: /to fix/ })).toHaveCount(0);
    await expect(editCardButton(page, "1")).toBeVisible();
    await expectAccessible(page, { label: "Insert parallels built by themselves once nothing was pink" });

    // The parallel holds the card's copy.
    await columnOption(page, "Parallels", PARALLEL).click();
    await expect(columnSelection(page, "Parallels", PARALLEL)).toBeVisible();
    await expect(editCardButton(page, "1")).toBeVisible();

    // Back returns to the insert's checklist: the parallel is listed again, not picked.
    await page.goBack();
    await expect(columnOption(page, "Parallels", PARALLEL)).toBeVisible();
    await expect(columnSelection(page, "Parallels", PARALLEL)).toHaveCount(0);
    await expect(columnSelection(page, "Inserts", INSERT)).toBeVisible();
    await expect(editCardButton(page, "1")).toBeVisible();
  },
);
