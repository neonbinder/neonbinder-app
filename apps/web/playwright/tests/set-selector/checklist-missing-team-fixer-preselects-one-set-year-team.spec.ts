// ONE FEATURE (NEO-639, MissingTeamFixer): the needs-attention fixer PRESELECTS a
// player's set-year team only when it is his ONE answer. Two hand-added cards,
// three cases, one rule:
//   - a player with exactly ONE stint covering the set year: that team's chip is
//     pressed when the fixer opens ("Saves 1 team on this card"), Enter accepts it;
//   - a player with TWO teams that season (no set league to rank them): neither
//     chip is pressed, the line says so ("more than one team that season") and
//     focus lands on a tied chip, so the operator's first keypress answers the
//     open question rather than saving;
//   - a set whose own team default is "No Team": the one-team player's chip is
//     offered and NOT pressed ("this set says No Team").
// The Teams step's own tie (NEO-569 league ranking) is a different screen and is
// not reached here; the fixer's copy and precedence are unit-tested
// (MissingTeamFixer.test.tsx).
//
// FIXTURE, built in-flow through the product's own screens (R7a, nothing global
// is read): the worker's custom sport (`customSport(env)`, no Wikidata config, so
// the minted players are never looked up), a per-attempt hand-made set
// `mtp-<worker>-<attempt>` under it (2026 > Topps), and on /admin/players two
// minted players with career stints at three minted teams:
//   SOLO  `Mtps<token>`  one stint, `MTA<token>X` 2025-2027 (covers 2026)
//   TIE   `Mtpt<token>`  `MTB<token>X` 2025-2027 and `MTC<token>X` 2026-2026
// Names are single search tokens ending in a letter, so no attempt's token can be
// a prefix of another's. Per-attempt because the header count and the walker
// queue are exact. Two cards (`961-<attempt>`, `962-<attempt>`, walked in number
// order) are DELETED at the end; the set (left at No Team), its rows, the players
// and the teams stand. Not fresh-only: every name is minted per attempt.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { customSport, drillToCustom, selectOrCreate, setBuilderReady } from "../../support/set-builder";
import { confirmDeleteCardButton, deleteCardButton, editCardButton } from "../../support/cards";
import { emptyListAndPickSport, expectPlayersLoaded } from "../../support/players";
import { TIDY_UP_NAME } from "../../support/wizard";

test(
  "Missing-team fixer — a player's ONE set-year team is preselected; a set-year tie and a No Team set preselect nothing (NEO-639)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env }) => {
    const A = env.ATTEMPT_ID;
    const T = env.ATTEMPT_TOKEN;
    const SPORT = customSport(env);
    const SET = `mtp-${env.WORKER_INDEX}-${A}`;
    const target = { sport: SPORT, year: "2026", manufacturer: "Topps", set: SET };
    const SOLO = `Mtps${T}`;
    const TIE = `Mtpt${T}`;
    const TEAM_A = `MTA${T}X`;
    const TEAM_B = `MTB${T}X`;
    const TEAM_C = `MTC${T}X`;
    const CARDS = { solo: `961-${A}`, tie: `962-${A}` };

    const badge = (n: string) =>
      page.getByRole("img", { name: new RegExp(`^Card ${n}(, .*)? needs attention: no team on this card yet$`) });
    const walker = page.getByRole("dialog", { name: TIDY_UP_NAME });
    // A fixer chip is a toggle button named "<team> · <player> played here"; its
    // pressed state (aria-pressed) is whether the save would write it.
    const chip = (team: string, player: string, pressed?: boolean) =>
      walker.getByRole("button", {
        name: `${team} · ${player} played here`,
        exact: true,
        ...(pressed === undefined ? {} : { pressed }),
      });
    const tieChips = (pressed: boolean) =>
      walker.getByRole("button", { name: new RegExp(`^(${TEAM_B}|${TEAM_C}) · ${TIE} played here$`), pressed });
    const nothingPicked = walker.getByText("Pick at least one team, or record that this card has none.");
    const savesOne = walker.getByText(/^Saves 1 team on this card\. (Ctrl|Cmd)\+Enter saves from anywhere\.$/);

    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // ── STEP 1: the hand-made set's Insert > Base (R9); this also makes the custom sport ──
    await drillToCustom(page, { ...target, variantType: "Insert", variant: "Base" });
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── STEP 2: two players with careers, on the product's admin screen ──
    await page.goto("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);
    await emptyListAndPickSport(page, SPORT);
    const createPlayer = async (name: string, stints: ReadonlyArray<readonly [string, string, string]>) => {
      await page.getByRole("button", { name: "Add player" }).click();
      await expect(page.getByRole("heading", { name: "Add a player" })).toBeVisible();
      await page.getByLabel("New player name").fill(name);
      await page.getByRole("button", { name: `Create player ${name}`, exact: true }).click();
      await expect(page.getByText(`Added ${name}`)).toBeVisible();
      for (const [team, from, to] of stints) {
        // Every team is new: created from the search's "No matches." through the New Team dialog.
        await page.getByRole("button", { name: "Add team" }).click();
        const search = page.getByRole("textbox", { name: "Search teams" });
        await search.fill(team);
        await expect(page.getByText("No matches.")).toBeVisible();
        await search.press("Enter");
        const dialog = page.getByRole("dialog", { name: `New team: ${team}` });
        await expect(dialog).toBeVisible();
        await dialog.getByRole("button", { name: `Create team ${team}` }).click();
        await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
        await page.getByRole("heading", { name: "Career history" }).click(); // closes the typeahead
        await page.getByLabel(/Stint from year/).fill(from);
        await page.getByLabel(/Stint to year/).fill(to);
        await page.getByRole("button", { name: "Add stint" }).click();
        await expect(page.getByRole("link", { name: new RegExp(`${team} · ${from}`) }).first()).toBeVisible();
      }
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.getByText(new RegExp(`Saved ${name}`))).toBeVisible();
    };
    await createPlayer(SOLO, [[TEAM_A, "2025", "2027"]]);
    await createPlayer(TIE, [
      [TEAM_B, "2025", "2027"],
      [TEAM_C, "2026", "2026"],
    ]);

    // Back returns to the set builder with the drill restored (navigation lives in the URL).
    await page.goBack();
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();

    // ── STEP 3: one hand-added card per player, NO team ──
    const addCard = async (num: string, player: string) => {
      await page.getByRole("button", { name: "Open add card form" }).click();
      const cardName = page.getByRole("textbox", { name: "Card name", exact: true });
      await expect(cardName).toBeVisible();
      await page.getByRole("textbox", { name: "Card number", exact: true }).fill(num);
      await cardName.fill(`Fixer${player}`);
      await page.getByRole("button", { name: "Add a player to the new card" }).click();
      const findPlayer = page.getByRole("textbox", { name: "Find a player for the new card" });
      await findPlayer.fill(player);
      await page.getByRole("option", { name: `Add ${player}`, exact: true }).click();
      await expect(page.getByRole("button", { name: `Remove player ${player}` })).toBeVisible();
      await cardName.click(); // closes the player popover
      await expect(findPlayer).toBeHidden();
      await page.getByRole("button", { name: "Submit new card" }).click();
      await expect(cardName).toBeHidden();
      await expect(editCardButton(page, num)).toBeVisible();
    };
    await addCard(CARDS.solo, SOLO);
    await addCard(CARDS.tie, TIE);
    await expect(badge(CARDS.solo)).toBeVisible();
    await expect(badge(CARDS.tie)).toBeVisible();
    const pill = page.getByRole("button", { name: "2 need you", exact: true });
    await expect(pill).toBeVisible();

    // ── STEP 4: ONE set-year team is PRESELECTED (the coverage this spec exists for) ──
    await pill.click();
    await expect(walker).toBeVisible();
    await expect(walker.getByRole("button", { name: `Skip for now, card ${CARDS.solo}` })).toBeVisible();
    await expect(walker.getByText("Suggested from career history — Enter accepts these.")).toBeVisible();
    await expect(chip(TEAM_A, SOLO, true)).toBeVisible();
    await expect(savesOne).toBeVisible();
    await expect(nothingPicked).toBeHidden();
    await expectAccessible(page, { within: walker, label: "Missing-team fixer, one set-year team preselected" });

    // ── STEP 5: a set-year TIE preselects neither and focuses the question ──
    await walker.getByRole("button", { name: `Skip for now, card ${CARDS.solo}` }).click();
    await expect(walker.getByRole("button", { name: `Skip for now, card ${CARDS.tie}` })).toBeVisible();
    await expect(
      walker.getByText("From the career — more than one team that season, so pick the one on the card."),
    ).toBeVisible();
    await expect(tieChips(false)).toHaveCount(2);
    await expect(tieChips(true)).toHaveCount(0);
    await expect(nothingPicked).toBeVisible();
    await expectAccessible(page, { within: walker, label: "Missing-team fixer, a set-year tie with nothing picked" });
    // Focus is on a tied chip: the operator's first key (Space, the chip's own toggle)
    // presses exactly one of the two, and that chip keeps the focus. Focus anywhere else
    // (Save, the picker) would press no chip.
    await page.keyboard.press("Space");
    const pressedTie = tieChips(true);
    await expect(pressedTie).toHaveCount(1);
    await expect(pressedTie).toBeFocused();
    await page.keyboard.press("Space"); // and back: nothing is saved from this card
    await expect(tieChips(false)).toHaveCount(2);
    // Mid-walk there is no Done button (it comes at "All clear"); Escape closes the walker.
    await page.keyboard.press("Escape");
    await expect(walker).toBeHidden();

    // ── STEP 6: the SET says No Team; the one-team player's chip is offered, not pressed ──
    await drillToCustom(page, target);
    const panel = page.getByRole("region", { name: "Set attributes panel" });
    await expect(panel.getByRole("heading", { name: `Attributes for ${SET} (Set)` })).toBeVisible();
    const edit = panel.getByRole("button", { name: "Edit attributes" });
    const hide = panel.getByRole("button", { name: "Hide attributes" });
    await expect(edit.or(hide)).toBeVisible();
    if (await edit.isVisible()) await edit.click();
    await expect(hide).toBeVisible();
    const setToggle = (pressed: boolean) => panel.getByRole("button", { name: "No Team for new cards here", pressed });
    await setToggle(false).click();
    const confirm = page.getByRole("dialog", { name: "Set this set to No Team?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Yes, set No Team" }).click();
    await expect(page.getByText("No Team applied to the checklists under this set")).toBeVisible();
    await expect(setToggle(true)).toBeVisible();
    // The cards already here stay teamless (the mark-existing offer is not taken).
    await selectOrCreate(page, "Variant Types", "Insert", { via: "list" });
    await selectOrCreate(page, "Inserts", "Base", { via: "list" });
    await expect(badge(CARDS.solo)).toBeVisible();
    await pill.click();
    await expect(walker.getByRole("button", { name: `Skip for now, card ${CARDS.solo}` })).toBeVisible();
    await expect(
      walker.getByText(/^From the career — this set says No Team, so pick one only if it.s on the card\.$/),
    ).toBeVisible();
    await expect(chip(TEAM_A, SOLO)).toBeVisible();
    await expect(chip(TEAM_A, SOLO, false)).toBeVisible();
    await expect(nothingPicked).toBeVisible();
    await expect(savesOne).toBeHidden();
    await expectAccessible(page, { within: walker, label: "Missing-team fixer under a No Team set, nothing picked" });
    // Mid-walk there is no Done button (it comes at "All clear"); Escape closes the walker.
    await page.keyboard.press("Escape");
    await expect(walker).toBeHidden();

    // ── CLEANUP (R7): delete this attempt's two cards ──
    for (const num of [CARDS.solo, CARDS.tie]) {
      await deleteCardButton(page, num).click();
      await confirmDeleteCardButton(page, num).click();
      await expect(editCardButton(page, num)).toBeHidden();
    }
    await expect(page.getByText("No cards in this checklist yet.")).toBeVisible();
  },
);
