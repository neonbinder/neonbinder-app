// NEO-556: "No Team" on a REAL unlicensed set. 2026 Leaf Vivid, Proof, "Animated Autographs
// Pre-Production Proofs Lazer Red" (44 BuySportsCards cards, none of which the marketplace gives a
// team) is fetched once, after the SET answers No Team.
//
// R1: the ONE feature is that a set's No Team reaches the cards a fetch commits beneath it, and
// stops where a card already has a claim:
//   - the cards commit No Team (their rows read "No Team", no row is flagged "no team on this card
//     yet", and the Tidy Up walk, when something else on the cards opens it, asks nothing about a
//     team), and the one card the publisher's checklist gives a team keeps it, never the set's
//     No Team (rule 8: a claim in the data holds the guess back);
//   - the same answer reaches a PARALLEL built from the set's Base: its copies of two teamless
//     Base cards (made before the set answered, so they carry no stamp) read No Team, and BSC's
//     per-card "no team" answer is what settles them (the lookup holds the stamp back until it
//     answers, rule 8; a copy still queued on the shared lane reads no team and is not flagged),
//     never a team.
//
// NEO-645: Match Cards' Confirm IS the commit, and the walk opens after it only when a card needs
// a person. The pre-NEO-645 spec also fetched once BEFORE the set answered, to read the old
// wizard's set-team hint, and cancelled; that hint is gone with the wizard, and a fetch can no
// longer end before it saves, so that phase is gone too. The walk, when it opens, is closed with
// "Save for later (Esc)", which writes nothing.
//
// SOLE WRITER (R7a, SET-REGISTRY.md "Leaf Vivid"): this spec alone writes Leaf Vivid. It commits
// the Proof checklist, so it is FRESH-ONLY (GUIDE "Fresh-only specs"): a second run on the same
// seed finds the cards already there. Re-seed to re-run.
// The checklist is a one-row paste (no capture file exists for this set), so BSC is asked about
// the other cards per card, recorded for the fake (the recorder's list, never a spec change).
// SportLots: the set is BSC-only paused or live (nothing is asked of it for a Proof row).
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import {
  columnHeading,
  columnOption,
  columnSelection,
  drillToBaseVariant,
  drillToSet,
  escapeRe,
  pick,
  setBuilderReady,
  syncChecklistButton,
} from "../../support/set-builder";
import { confirmChecklistMatchCards, matchCardsDialog, usePastedChecklist } from "../../support/published-checklist";
import {
  pinkTile,
  saveForLater,
  settleWalkAfterCommit,
  tidyUpName,
  tidyWalk,
} from "../../support/tidy-walk";
import { expectAfterMarketplace } from "../../support/marketplace-wait";

const PROOF = "Animated Autographs Pre-Production Proofs Lazer Red";
const TARGET = { sport: "Baseball", year: "2026", manufacturer: "Leaf", set: "Leaf Vivid" } as const;
// The publisher's own claim: one card names a team. Pete Incaviglia is a card of the Proof set and
// Texas Rangers an NB team; every other card of the set gets no answer from BSC.
const CLAIMED = { player: "Pete Incaviglia", team: "Texas Rangers" };
const CHECKLIST = `number,player,team\nNNO,${CLAIMED.player},${CLAIMED.team}`;
// Two Base cards made by hand: unnumbered like every card of the Proof family, each a player on the
// first parallel the build reaches (Clear Green, alphabetically), so that parallel pairs both.
const BASE_CARDS = ["Derek Curiel", "Kenedy Corona"];
const FIRST_PARALLEL = "Animated Autographs Pre-Production Proofs Clear Green";

test(
  "Set-level No Team on a real Leaf set — fetched cards commit No Team, the walk asks nothing about their team, and a card the checklist gives a team keeps it (NEO-556)",
  { tag: ["@smoke", "@set-selector"] },
  async ({ page, signIn, env }) => {
    const panel = page.getByRole("region", { name: "Set attributes panel" });
    const edit = panel.getByRole("button", { name: "Edit attributes" });
    const hide = panel.getByRole("button", { name: "Hide attributes" });
    const toggle = (pressed: boolean) => panel.getByRole("button", { name: "No Team for new cards here", pressed });
    const search = page.getByRole("searchbox", { name: "Search cards" });
    // A checklist row is one run of text; the match stops at the next row's "#".
    const rowSays = (name: string, text: string) => page.getByText(new RegExp(`#NNO[^#]*${name}[^#]*${text}`));
    // A row's attention mark names every reason; "no team on this card yet" is the team one.
    const flaggedNoTeam = (name: string) =>
      page.getByRole("img", { name: new RegExp(`^Card NNO, ${escapeRe(name)} needs attention: .*no team on this card yet`) });

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 0: two cards in the set's Base, made while the set has no answer, so they are
    // teamless and carry no stamp. (Opening Base cancels its mapping picker: a one-marketplace set.)
    await drillToBaseVariant(page, env, TARGET);
    // The precondition of a FIRST run on this seed (fresh-only): a re-run fails here, by name.
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
    for (const player of BASE_CARDS) {
      await page.getByRole("button", { name: "Open add card form" }).click();
      const number = page.getByRole("textbox", { name: "Card number", exact: true });
      await number.fill("NNO");
      await page.getByRole("textbox", { name: "Card name", exact: true }).fill(player);
      await page.getByRole("button", { name: "Submit new card" }).click();
      await expect(number).toBeHidden();
      await expect(page.getByText(player, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("Cards (2)")).toBeVisible();

    // ── STEP 1: the SET answers No Team. Rows beneath it (Base, the Proof row) follow.
    // The two Base cards already there stay as they are: the panel only OFFERS to mark them.
    await drillToSet(page, env, TARGET);
    await expect(panel.getByRole("heading", { name: `Attributes for ${TARGET.set} (Set)` })).toBeVisible();
    await expect(edit.or(hide)).toBeVisible();
    if (await edit.isVisible()) await edit.click();
    await expect(toggle(false)).toBeVisible();
    await toggle(false).click();
    const confirm = page.getByRole("dialog", { name: "Set this set to No Team?" });
    await expect(confirm).toBeVisible();
    await expectAccessible(page, { within: confirm, label: "Set No Team on a real set, checklists beneath it" });
    await confirm.getByRole("button", { name: "Yes, set No Team" }).click();
    await expect(toggle(true)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Mark 2 teamless cards No Team" })).toBeVisible();
    await expectAccessible(page, { within: panel, label: "Attributes panel, No Team on, offer to mark teamless cards" });

    // ── STEP 2: the fetch. The Proof row copied the set's answer before any card exists.
    await pick(page, "Variant Types", "Proof", { search: false });
    await columnOption(page, "Proofs", PROOF).click();
    await expect(syncChecklistButton(page)).toBeVisible();
    // Back steps through the drill in the URL: the pick of the Proof row is undone, its column is
    // open and the row's checklist is gone (proved here, on a stretch with no walk in its history).
    await page.goBack();
    await expect(columnHeading(page, "Proofs")).toBeVisible();
    await expect(columnSelection(page, "Variant Types", "Proof")).toBeVisible();
    await expect(syncChecklistButton(page)).toBeHidden();
    await columnOption(page, "Proofs", PROOF).click();
    await expect(syncChecklistButton(page)).toBeVisible();
    // NEO-569: the Proof row's panel starts shut and draws only its title and toggle, so the
    // copied answer is read from the toggle's description, as a screen reader hears it.
    await expect(panel.getByRole("heading", { name: new RegExp(`^Attributes for ${escapeRe(PROOF)} \\(`) })).toBeVisible();
    await expect(edit).toBeVisible();
    await expect(edit).toHaveAccessibleDescription(/^Team: No Team$/);
    await expect(panel.getByText("No Team", { exact: true })).toHaveCount(0);

    const facts = await usePastedChecklist(page, CHECKLIST, 1);
    await syncChecklistButton(page).click();
    // NEO-496: the checklist is a source of its own, so a one-marketplace fetch opens Match Cards
    // (the pasted row pairs with its BSC card; the rest are BSC's alone). One live BSC round trip:
    // 7 s of our own time plus the seconds the screen says it waits on BSC. The card count is
    // read off the dialog once Confirm is usable (the batch has streamed in whole), then the
    // house helper keeps every BSC-only card and confirms, so all of the set's cards are saved.
    const matchCards = matchCardsDialog(page);
    await expectAfterMarketplace(page, matchCards, { platform: "BuySportsCards", what: "Match Cards after the Proof fetch" });
    await expectAfterMarketplace(
      page,
      matchCards.getByRole("button", { name: "Confirm card matches", disabled: false }),
      { platform: "BuySportsCards", what: "Confirm unlocked after the Proof fetch" },
    );
    await expect(matchCards.getByText(`Matched (${facts.rows})`)).toBeVisible();
    const bscOnly = matchCards.getByRole("heading", { name: /^BSC only \([1-9][0-9]*\)$/ });
    await expect(bscOnly).toBeVisible();
    const cards = facts.rows + Number(/\(([0-9]+)\)/.exec((await bscOnly.textContent()) ?? "")?.[1]);
    expect(cards).toBeGreaterThan(8);
    await confirmChecklistMatchCards(page, { facts, what: "the Proof fetch" });

    // ── STEP 3: the save. Confirm IS the commit ("Saved N cards.", our own write, 7 s). Every
    // card is born under the set's answer except the one that has a claim.
    const saved = page.getByText(new RegExp(`Saved ${cards} cards\\.`)).first();
    await expect(saved).toBeVisible();
    await expect(page.getByText(`Cards (${cards})`)).toBeVisible();
    // The walk opens after the save only when a card needs a person for something else (the
    // set's autograph format, a player's career): settled by the "N need you" pill that renders
    // with the saved line. Whichever card it opens on asks nothing about its team: its Team tile
    // is not pink and says what the card holds, the set's No Team or the checklist's team.
    if (await settleWalkAfterCommit(page, saved)) {
      const walk = tidyWalk(page);
      await expect(walk).toHaveAccessibleName(tidyUpName({ year: TARGET.year, set: TARGET.set, variant: PROOF }));
      await expect(pinkTile(page, "Team")).toHaveCount(0);
      // Every card here is #NNO, so the card is told by its face, the one img named "Card #NNO,
      // <who>[, <teams>]" (the "#…" lines read "#NNO" alone). One web-first assert, no read-then-
      // branch: the walk is EITHER on the claimed card with the checklist's team, OR on a card named
      // otherwise with the set's No Team. (Inner locators of a filter are relative to the dialog.)
      const teamTile = page.getByRole("group", { name: "Team", exact: true });
      const claimedFace = page.getByRole("img", { name: new RegExp(`^Card #\\S+, ${escapeRe(CLAIMED.player)}(,|$)`) });
      const holdsClaim = walk
        .filter({ has: claimedFace })
        .filter({ has: teamTile.getByRole("group", { name: `Team ${CLAIMED.team}`, exact: true }) });
      const holdsNoTeam = walk
        .filter({ has: page.getByRole("img", { name: /^Card #\S+, .+/ }) })
        .filter({ hasNot: claimedFace })
        .filter({ has: teamTile.getByText("No team on this card.", { exact: true }) });
      await expect(
        holdsClaim.or(holdsNoTeam),
        "the walk's first card holds its team answer: the checklist's team, else the set's No Team",
      ).toBeVisible();
      await expectAccessible(page, { within: walk, label: "Tidy Up walk on a Leaf Vivid Proof card born under No Team" });
      // NEO-645: "Save for later (Esc)" closes the walk and writes nothing.
      await saveForLater(page);
    }

    // The claimed card keeps the checklist's team; a card with nothing naming a team is No Team.
    // Neither is flagged "no team on this card yet" (each negative beside its row's positive).
    await expect(search).toBeVisible();
    await search.fill("Incaviglia");
    await expect(rowSays("Pete Incaviglia", CLAIMED.team)).toBeVisible();
    await expect(rowSays("Pete Incaviglia", "No Team")).toBeHidden();
    await expect(flaggedNoTeam("Pete Incaviglia")).toHaveCount(0);
    await search.fill("Martinez");
    await expect(rowSays("Edgar Martinez", "No Team")).toBeVisible();
    await expect(flaggedNoTeam("Edgar Martinez")).toHaveCount(0);
    await search.fill("");
    await expectAccessible(page, { label: "Leaf Vivid Proof checklist, cards born No Team" });

    // ── STEP 4: the set's parallels, built from Base (stopped after the first). A copy of a Base
    // card the set's answer never touched is born under the parallel's own No Team once BSC's
    // per-card lookup, which holds the stamp back, answers that it names no team.
    // NEO-645: a copy's title carries the card's name (a real card name always goes in the title),
    // and "2026 Leaf Vivid <the parallel's name>" is already 69 characters, so both Clear Green
    // copies run over 80 and the build stops on the Card titles dialog, which names them. "Not
    // now" closes it and keeps the titles as they are (nothing was edited, so no confirm).
    await drillToSet(page, env, TARGET);
    await pick(page, "Variant Types", "Parallel", { search: false });
    await page.getByRole("button", { name: /^Build [0-9]+ parallels from Base$/ }).click();
    const replace = page.getByRole("button", { name: "Replace and build" });
    await expect(replace.or(page.getByRole("button", { name: "Stop after this one" })).first()).toBeVisible();
    if (await replace.isVisible()) await replace.click();
    await page.getByRole("button", { name: "Stop after this one" }).click();
    // The build fetches each parallel's checklist from BSC before writing it, and the screen shows
    // "Waiting on BuySportsCards…" meanwhile: BSC's time plus 7 s of our own (GUIDE hard rule 3).
    await expectAfterMarketplace(
      page,
      page.getByRole("heading", { name: /^Base parallels — stopped after [1-9][0-9]* of [0-9]+/ }),
      { platform: "BuySportsCards", what: "the parallels build stopping" },
    );
    await expect(
      page.getByText(new RegExp(`^${FIRST_PARALLEL} — Built ${BASE_CARDS.length} cards?`)),
    ).toBeVisible();
    const titles = page.getByRole("dialog", { name: "Card titles" });
    await expect(titles).toBeVisible();
    for (const player of BASE_CARDS) {
      const title = titles.getByRole("textbox", { name: `Title for #NNO ${player}`, exact: true });
      await expect(title).toBeVisible();
      await expect(title).toHaveValue(new RegExp(`^2026 Leaf Vivid .* ${escapeRe(player)}$`));
    }
    await titles.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(titles).toBeHidden();
    await expectAccessible(page, { label: "Base parallels build stopped, set under No Team" });

    await columnOption(page, "Parallels", FIRST_PARALLEL).click();
    // The copies' lookups ride the background BSC team lane (convex/bscTeamPool.ts): ONE slot for
    // the whole deployment, 1.7 s a card, first in first out across every test user. In CI the
    // other shards' commits queue cards ahead of these two (merge-queue run 45273919105: seven
    // items ahead, so the copies were answered 18-21 s after the build, past this step's 7 s; on
    // an idle lane they answer in about 4 s). So a copy is EITHER answered, its row reading No
    // Team, OR still on the lane: its row carries no team at all (the name runs straight into its
    // BSC badge) and is not flagged, which the attention rule allows only while the lookup is owed
    // (`isAwaitingTeamLookup`). Never a team, in either branch. Both copies are on screen (two
    // rows), so a missing mark is a real absence.
    for (const player of BASE_CARDS) {
      const heldBack = page.getByText(new RegExp(`#NNO[^#]*${escapeRe(player)}\\s*BSC`));
      await expect(rowSays(player, "No Team").or(heldBack).first()).toBeVisible();
      await expect(flaggedNoTeam(player)).toHaveCount(0);
      // Which branch ran goes into the report (a read for the record, never an assert's branch).
      const queued = await heldBack.isVisible();
      test.info().annotations.push({ type: "bsc-team-lane", description: `${player}: ${queued ? "still queued" : "answered"}` });
    }
    await expectAccessible(page, { label: "Built parallel, copies No Team" });
  },
);
