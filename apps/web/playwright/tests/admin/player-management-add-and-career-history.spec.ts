// Origin: .maestro/flows/admin/player-management-add-and-career-history.yaml (Maestro suite retired in NEO-341; see git history)
// Add a player by hand, create two teams from the career editor, swap the held
// team for the other through "Change team" (NEO-617: a stint holds ONE team),
// record two stints at that team out of order, edit the pending stint with
// Enter, tick Hall of Fame by its label text (NEO-682), save, reload: both
// stints survive in year order and the tick stuck.
//
// The player is a REAL person whose Baseball lookup the enrichment recording
// holds as a no-match (support/recorded-names.ts): the add makes no live
// Wikidata call and leaves the row bare, as the old minted name did. Fresh-only
// (re-seed before re-running): a second run finds the row and adopts it.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { addPlayerByHand, expectPlayersLoaded, PLAYERS_MATCHES, playersCounter } from "../../support/players";
import { recordedNoMatchPlayer } from "../../support/recorded-names";

test(
  "Player Management — add a player by hand and record two stints at one team",
  { tag: ["@admin"] },
  async ({ page, signIn, env }) => {
    const token = env.ATTEMPT_TOKEN;
    const player = recordedNoMatchPlayer(env, "player-management-add-and-career-history");
    // `team` is the one the stints end at; `replaced` is held first and swapped
    // out through "Change team" (SET-REGISTRY.md, PMT/PMU).
    const team = `PMU${token}`;
    const replaced = `PMT${token}`;

    await signIn("/admin/players");
    await expectPlayersLoaded(page, LAUNCH_GATE);

    await addPlayerByHand(page, player, "Baseball");
    await expect(page.getByText("No stints recorded yet.")).toBeVisible();

    const addTeam = page.getByRole("button", { name: "Add team" });
    const changeTeam = page.getByRole("button", { name: "Change team" });
    const search = page.getByRole("textbox", { name: "Search teams" });
    const results = page.getByRole("listbox", { name: "Team typeahead results" });
    const fromYear = page.getByLabel(/Stint from year/);
    const heldChips = page.getByRole("button", { name: /^Remove team / });
    // NEO-617: focus moves to the start year after a pick, so the picker says
    // which team was picked in a polite live region (screen-reader only: asserted
    // by its text, never by visibility).
    const pickedAnnouncement = (name: string) =>
      page.getByRole("status").filter({ hasText: `Team: ${name} selected` });

    // A team nothing matches opens the New Team dialog on Enter. `team` is made
    // first so it exists to be PICKED later, then cleared with its ×.
    await addTeam.click();
    await search.fill(team);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const dialog = page.getByRole("dialog", { name: `New team: ${team}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("New team name")).toHaveValue(team);
    await expectAccessible(page, { within: dialog, label: "New Team dialog" });
    await dialog.getByRole("button", { name: `Create team ${team}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    await expect(fromYear).toBeFocused(); // the dialog's create is a pick too
    await expect(pickedAnnouncement(team)).toHaveText(`Team: ${team} selected`);
    // NEO-617: clearing the one chip brings the "+ Add team" invitation back.
    await page.getByRole("button", { name: `Remove team ${team}` }).click();
    await expect(heldChips).toHaveCount(0);
    await expect(pickedAnnouncement(team)).toHaveCount(0);
    await expect(addTeam).toBeVisible();
    await expect(addTeam).toBeFocused(); // the × left the page, focus did not drop to <body>
    await expect(changeTeam).toBeHidden();

    // The team that will be replaced, made the same way.
    await addTeam.click();
    await search.fill(replaced);
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.press("Enter");
    const replacedDialog = page.getByRole("dialog", { name: `New team: ${replaced}` });
    await replacedDialog.getByRole("button", { name: `Create team ${replaced}` }).click();
    await expect(page.getByRole("button", { name: `Remove team ${replaced}` })).toBeVisible();
    // NEO-617: a stint has one team, so the picker no longer invites a second.
    await expect(changeTeam).toBeVisible();
    await expect(addTeam).toBeHidden();
    await expect(results).toBeHidden(); // the create was the pick, so the popover closed
    // NEO-617: the team is chosen, so focus moves on to the start year.
    await expect(fromYear).toBeFocused();
    await expect(pickedAnnouncement(replaced)).toHaveText(`Team: ${replaced} selected`);
    await expectAccessible(page, { label: "Player Management, stint team held" });

    // NEO-617: "Change team" reopens the same search, and a pick REPLACES the
    // held team, closes the popover and moves focus on to the start year.
    await changeTeam.click();
    await expect(search).toBeVisible();
    await expectAccessible(page, { label: "Player Management, Change team popover" });
    await search.fill(team);
    await expect(results.getByRole("option", { name: new RegExp(`^Add ${team}`) })).toBeVisible();
    await search.press("Enter"); // the keyboard pick: the one filtered match is highlighted
    await expect(results).toBeHidden();
    await expect(fromYear).toBeFocused();
    await expect(pickedAnnouncement(team)).toHaveText(`Team: ${team} selected`);
    await expect(pickedAnnouncement(replaced)).toHaveCount(0);
    await expect(heldChips).toHaveCount(1);
    await expect(page.getByRole("button", { name: `Remove team ${team}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Remove team ${replaced}` })).toBeHidden();
    await expect(changeTeam).toBeVisible();

    // Stint 1, the LATER one, added first so the ordering assert means something.
    await fromYear.fill("2010");
    await page.getByLabel(/Stint to year/).fill("2012");
    await page.getByRole("button", { name: "Add stint" }).click();
    const later = page.getByRole("link", { name: new RegExp(`${team} · 2010–2012`) });
    await expect(later).toBeVisible();
    // The stint went to the team that replaced the first, never the first.
    await expect(page.getByRole("link", { name: new RegExp(replaced) })).toHaveCount(0);

    // Stint 2 at the SAME team: pick it again, then type the years.
    await addTeam.click();
    await search.fill(team);
    await results.getByRole("option", { name: new RegExp(`^Add ${team}`) }).click();
    await expect(results).toBeHidden(); // NEO-617: the pick closes the popover
    await expect(fromYear).toBeFocused();

    const toYear = page.getByLabel(/Stint to year/);
    await toYear.fill("2005");
    await toYear.press("Enter");
    // Enter is "Add stint": the end year is recorded, the picked team is consumed,
    // and the form refuses nothing.
    await expect(toYear).toHaveValue("2005");
    await expect(page.getByRole("button", { name: new RegExp(`^Remove team ${team}`) })).toBeVisible();
    await expect(page.getByText("Pick a team and a whole start year.")).toBeHidden();

    await fromYear.fill("2001");
    await fromYear.press("Enter");
    await expect(toYear).toHaveAttribute("placeholder", "present");
    await expect(toYear).toHaveValue("");
    await expect(page.getByRole("button", { name: new RegExp(`^Remove team ${team}`) })).toBeHidden();
    await expect(page.getByText("Pick a team and a whole start year.")).toBeHidden();
    await expect(page.getByText(/already has a stint starting in/)).toBeHidden();

    // Both stints, in YEAR order (2001 first although 2010 was added first).
    const earlier = page.getByRole("link", { name: new RegExp(`${team} · 2001–2005`) });
    await expect(earlier).toBeVisible();
    const stints = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(stints).toHaveCount(2);

    // NEO-682: Hall of Fame is ticked by clicking its label text, not the 16px
    // box (the whole row is the target). The Save below must keep it, and the
    // axe check covers the form with the box ticked.
    const hallOfFame = page.getByRole("checkbox", { name: "Hall of Fame", exact: true });
    await expect(hallOfFame).not.toBeChecked(); // a hand-added player starts unticked
    await page.getByText("Hall of Fame", { exact: true }).click();
    await expect(hallOfFame).toBeChecked();
    await expectAccessible(page, { label: "Player Management, career history, Hall of Fame ticked" });
    await expect(stints.nth(0)).toContainText(`${team} · 2001–2005`);
    await expect(stints.nth(1)).toContainText(`${team} · 2010–2012`);

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(new RegExp(`Saved ${player}`))).toBeVisible({ timeout: 15_000 });

    // Reload: both stints survive, still in order.
    await page.goto("/admin/players");
    await expectPlayersLoaded(page, 30_000);
    await page.getByLabel("Filter players").fill(player);
    // NEO-330: a filter in the box reads "{N} match(es)", never "of N".
    await expect(playersCounter(page, PLAYERS_MATCHES)).toBeVisible();
    await page.getByRole("button", { name: player }).click();
    const reloaded = page.getByRole("list", { name: "Career history" }).getByRole("listitem");
    await expect(reloaded).toHaveCount(2);
    await expect(reloaded.nth(0)).toContainText(`${team} · 2001–2005`);
    await expect(reloaded.nth(1)).toContainText(`${team} · 2010–2012`);
    // The Hall of Fame tick was saved with the stints.
    await expect(page.getByRole("checkbox", { name: "Hall of Fame", exact: true })).toBeChecked();
  },
);
