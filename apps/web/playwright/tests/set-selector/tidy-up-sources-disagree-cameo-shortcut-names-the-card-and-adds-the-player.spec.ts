// NEO-645 T3: the cameo shortcut on the Tidy Up walk's "Sources disagree" tile. When the two
// sources name a card's player differently, one side is exactly one NB player and the other is no
// NB player at all (and not a near spelling of the player's name), the card most likely PICTURES
// the player and is NAMED for something else. One button, "“<other name>”, <Surname> as a cameo",
// settles it: the card is named for the non-player side, that name is answered "not a player", the
// player is added as a cameo, the card has no player of its own, and the title is rebuilt as
// `<year> <set> Base <card name> <cameo> #N <team> <sport>` (Base stays while the title fits: it
// is the first word the cut drops, Jason 2026-11-23; convex/tidyCameo.ts,
// convex/features/generateListing.ts `subjectName`).
//
// The flow, as the operator lives it:
//   1. Paste the set's own checklist (fixtures/checklists/1995-hockey-fort-worth-fire-chl-base.csv)
//      with ONE change: card #17, which BSC calls "Scorch" (the club's mascot, a name no NB player
//      answers to), names the catalogue's Wayne Gretzky instead. The two sources pair #17 by its
//      number with the players disagreeing (the product's own matcher, run offline), so Match
//      Cards opens (not every card is 100%) and its Confirm SAVES the 18 cards; the walk opens.
//   2. Every row prints "Fort Worth Fire", a club NB does not hold, so every card's Team tile is
//      pink (measured: the pill read "18 need you, 18 to fix"). The first card's "+ New team"
//      creates it and links that card only (NEO-656); its "Apply to all cards printing “Fort Worth
//      Fire”" links the other 17 ("Linked 17 more cards."), so #17's only pink is the
//      disagreement. Save for
//      later: the pill reads "18 need you, 16 to fix": two cards' players NB links by itself,
//      and each is blue for a career gap (no stint with the new club; read live, J5/J6), and the
//      other 15 names are unknown to NB (pink). The pill reopens the walk; every card but #17 is skipped
//      (nothing written).
//   3. #17's Sources disagree tile is pink and offers, besides a "Use" per source, the shortcut
//      "“Scorch”, Gretzky as a cameo" (axe on that tile). One click: the tile stops being pink
//      ("Using “Scorch” (BSC)" and Change, shown while #17 is open: the pick removes the card's
//      disagreement entry and the walk keeps only this sitting's pick, NEO-656 J4), the Player
//      tile shows "Scorch is not a player." and a "Cameo Wayne
//      Gretzky" row, and no "Player Wayne Gretzky" row; the Listing title tile shows the rebuilt
//      title. Save & next is usable (nothing is left pink on the card) and moves on; Back returns to
//      #17 with the cameo still on it and no Sources disagree tile (the card keeps only the result).
//   4. Save for later: the pill drops by #17, to "17 need you, 15 to fix" (a cameo is not the
//      card's player, so #17 has no career gap).
//   5. The saved card reads back in its drawer: Card name "Scorch", the rebuilt Card title.
//
// The expected title was computed first with `assessListingTitle` (npx tsx), as the commit's
// inputs give it: year 1995, the set's brand unknown (left out), set "Fort Worth Fire CHL", Base
// (kept: the title fits), subject "Scorch", cameo "Wayne Gretzky", team Fort Worth Fire (left out:
// the set name already says it), sport Hockey: "1995 Fort Worth Fire CHL Base Scorch Wayne Gretzky
// #17 Hockey" (61). No minted token reaches it, so it is the same on every worker and attempt.
// Without the cameo the same card titles "1995 Fort Worth Fire CHL Base Scorch #17 Hockey" (47),
// and as the checklist's player "1995 Fort Worth Fire CHL Base Wayne Gretzky #17 Hockey" (54): the
// exact string below is the proof that the card's name leads and the cameo follows it.
//
// FIXTURE (SET-REGISTRY.md -> "Hockey -> 1995 -> Unknown -> Fort Worth Fire CHL"): SOLE WRITER of
// that set (BSC only, 18 cards, reached through the All Brands view); FRESH-ONLY: it commits the
// checklist, so a re-run on the same seed fails at "No cards in this checklist yet." by name.
// Writes: the 18 cards; the team "Fort Worth Fire" (Hockey, created in the walk: NB holds none,
// so the first card's "+ New team" makes it, and its Apply to all reaches the other 17 cards); on
// #17 "Scorch" off the card's waiting names (not a player, this card only), the picked card name
// and the cameo (the catalogue's Wayne Gretzky, the one Hockey row of that name; no other spec
// counts his cameos). Nothing else is stored (Jason, 2026-09-28: "We should not be keeping
// answers to anything"); every other name is skipped: nothing minted.
//
// Desktop and mobile: one spec, no branch (role and label locators; click() scrolls).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { editCardButton } from "../../support/cards";
import { CHECKLISTS, checklistRows, settleChecklistFetch, usePastedChecklist } from "../../support/published-checklist";
import { openOneMarketplaceSetBase, setBuilderReady, syncChecklistButton } from "../../support/set-builder";
import {
  applyNameToAll,
  createTeamOnOpenRow,
  expectCardSettled,
  needsYouPill,
  openTidyWalk,
  pinkTile,
  saveAndNext,
  saveForLater,
  settleWalkAfterCommit,
  skipUntil,
  tidyCardIdentity,
  tidyFooterButton,
  tidyTile,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";

const SET = "Fort Worth Fire CHL";
const CARD = "17";
/** BSC's name for #17: the mascot, no NB player. */
const MASCOT = "Scorch";
/** The checklist's name for #17: the catalogue's one Hockey player of that name. */
const PLAYER = "Wayne Gretzky";
const SURNAME = "Gretzky";
/** The team every row prints; NB holds no team of that name until the spec creates it. */
const CLUB = "Fort Worth Fire";
/** `assessListingTitle` for the card after the shortcut (see the top comment). */
const TITLE = "1995 Fort Worth Fire CHL Base Scorch Wayne Gretzky #17 Hockey";

/** The pill's whole name for N cards needing you, M of them pink. */
function pillName(needYou: number, toFix: number): string {
  return `${needYou} ${needYou === 1 ? "needs" : "need"} you${toFix > 0 ? `, ${toFix} to fix` : ""}`;
}

test(
  "Tidy Up — the Sources disagree tile's cameo shortcut names the card for the non-player side, rules that name out and adds the player as a cameo (NEO-645)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const rows = checklistRows(CHECKLISTS.fortWorthFire);
    expect(rows, "the captured file holds the set's 18 cards").toHaveLength(18);
    expect(rows.find((r) => r.number === CARD)?.player, "BSC names #17 for the mascot").toBe(MASCOT);
    const csv =
      "number,player,team\n" +
      rows.map((r) => `${r.number},${r.number === CARD ? PLAYER : r.player},${r.team}`).join("\n") +
      "\n";

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });
    await openOneMarketplaceSetBase(page, env, { set: SET });
    // The precondition for a FIRST fetch (fresh-only): a re-run fails here, by name.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── 1. The edited checklist, the fetch, Match Cards' Confirm saves the cards ──
    const facts = await usePastedChecklist(page, csv, rows.length);
    await syncChecklistButton(page).click();
    await settleChecklistFetch(page, env, { facts, what: `the ${SET} fetch` });
    const opened = await settleWalkAfterCommit(page, page.getByText(new RegExp(`^Saved ${rows.length} cards\\.`)).first());
    expect(opened, "#17's sources disagree, so the walk opens").toBe(true);
    const walk = tidyWalk(page);
    await expect(walk).toHaveAccessibleName(tidyUpName({ year: "1995", set: SET }));

    // ── 2. The club, so that #17's only pink is the disagreement; then the pill before ──
    // "Fort Worth Fire" is printed on all 18 cards and NB holds no team of that name, so every
    // card's Team tile is pink. Creating it (the row's "+ New team") links this card; its Apply to
    // all links the 17 others still waiting on the name.
    expect(await createTeamOnOpenRow(page)).toBe(`Team ${CLUB}`);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    expect(await applyNameToAll(page, "Team", CLUB)).toBe(`Linked ${rows.length - 1} more cards.`);
    await saveForLater(page);
    // All 18 need you: 16 pink, #17 among them (their player names are unknown to NB or, on #17,
    // disputed), and 2 blue, whose players NB links by itself and whose careers hold no stint
    // with the new club. Jason (J5): "it should read real data and display pink/blue as
    // appropriate depending on the current state of the data".
    const pill = needsYouPill(page);
    await expect(pill).toHaveAccessibleName(pillName(18, 16));
    await openTidyWalk(page, { title: tidyUpName({ year: "1995", set: SET }) });

    // ── 3. #17: the pink tile offers the shortcut ──
    const disagree = tidyTile(page, "Sources disagree");
    await skipUntil(page, disagree);
    await expect(tidyCardIdentity(page).first()).toHaveText(new RegExp(`^#${CARD}\\b`));
    await expect(disagree).toHaveAccessibleDescription("To fix");
    const says = disagree.getByRole("list", { name: "What each source says: Player name", exact: true });
    await expect(says.getByRole("listitem").filter({ hasText: /^BSC/ })).toContainText(MASCOT);
    await expect(says.getByRole("listitem").filter({ hasText: /^Checklist/ })).toContainText(PLAYER);
    const shortcut = disagree.getByRole("button", { name: `“${MASCOT}”, ${SURNAME} as a cameo`, exact: true });
    await expect(shortcut, "the Sources disagree tile offers the cameo shortcut").toBeVisible();
    // Beside the plain picks, which stay offered.
    await expect(disagree.getByRole("button", { name: `Use “${MASCOT}”`, exact: true })).toBeVisible();
    await expect(disagree.getByRole("button", { name: `Use “${PLAYER}”`, exact: true })).toBeVisible();
    await expect(tidyFooterButton(page, "saveAndNext")).toBeDisabled();
    await expectAccessible(page, { within: disagree, label: "Sources disagree tile with the cameo shortcut" });

    // ── One click ──
    await shortcut.click();
    // The disagreement is settled for the non-player side: not pink, the pick said, the shortcut gone.
    await expect(disagree.getByRole("status").filter({ hasText: `Using “${MASCOT}” (BSC)` })).toBeVisible();
    await expect(disagree.getByRole("button", { name: "Change the player name", exact: true })).toBeVisible();
    await expect(pinkTile(page, "Sources disagree")).toHaveCount(0);
    await expect(disagree).not.toHaveAccessibleDescription("To fix");
    await expect(shortcut).toHaveCount(0);
    // The Player tile: the card's name is ruled out, the player is a cameo, and no player is the card's own.
    const playerTile = tidyTile(page, "Player");
    const mascotRow = playerTile.getByRole("group", { name: `Player ${MASCOT}`, exact: true });
    await expect(mascotRow).toContainText(`${MASCOT} is not a player.`);
    await expect(playerTile.getByRole("group", { name: `Cameo ${PLAYER}`, exact: true })).toBeVisible();
    await expect(playerTile.getByRole("group", { name: `Player ${PLAYER}`, exact: true })).toHaveCount(0);
    await expect(playerTile.getByRole("group", { name: /^Player / })).toHaveCount(1);
    await expect(pinkTile(page, "Player")).toHaveCount(0);
    await expect(pinkTile(page, "Team")).toHaveCount(0);
    // The title is rebuilt: the card's name, then the cameo, Base kept while it fits (61).
    await expect(tidyTile(page, "Listing title").getByText(TITLE, { exact: true })).toBeVisible();
    await expectAccessible(page, { within: walk, label: "Tidy Up walk, the cameo shortcut taken" });

    // Nothing on #17 is pink any more: Save & next takes it and moves on.
    await saveAndNext(page);
    await expect(walk.getByText(/^#17 · /)).toHaveCount(0);
    // Back returns to #17, its cameo still on it.
    await page.goBack();
    await expect(tidyCardIdentity(page).first()).toHaveText(new RegExp(`^#${CARD}\\b`));
    await expectCardSettled(page);
    await expect(playerTile.getByRole("group", { name: `Cameo ${PLAYER}`, exact: true })).toBeVisible();
    // The pick kept only the result: the card carries no disagreement, and "Using" went with the
    // sitting that made it (J4: "Once you pick a source, the card keeps only the result.").
    await expect(tidyTile(page, "Sources disagree")).toHaveCount(0);

    // ── 4. The pill drops by #17 ──
    await saveForLater(page);
    await expect(pill).toHaveAccessibleName(pillName(17, 15));

    // ── 5. The saved card reads back ──
    await openOneMarketplaceSetBase(page, env, { set: SET });
    await page.getByRole("searchbox", { name: "Search cards" }).fill(MASCOT);
    await editCardButton(page, CARD).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("textbox", { name: "Card name" })).toHaveValue(MASCOT);
    await expect(drawer.getByRole("textbox", { name: "Card title", exact: true })).toHaveValue(TITLE);
    await drawer.getByRole("button", { name: "Done editing card" }).click();
    await expect(drawer.getByRole("textbox", { name: "Card name" })).toBeHidden();
  },
);
