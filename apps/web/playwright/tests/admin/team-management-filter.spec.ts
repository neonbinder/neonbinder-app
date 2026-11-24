// Origin: .maestro/flows/admin/team-management-filter.yaml (Maestro suite retired in NEO-341; see git history)
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { expectTeamsLoaded, teamsCounter } from "../../support/players";

/** A league of the reference catalogue whose list overflows the master scroller, far short of the 2,000-row window. */
const LEAGUE = "MLB";

test(
  "Team Management — filtering to a name nothing matches reports no matches",
  { tag: ["@smoke", "@admin"] },
  async ({ page, signIn }) => {
    await signIn("/admin/teams");
    await expect(page.getByText("Team Management", { exact: true })).toBeVisible({
      timeout: LAUNCH_GATE,
    });
    // NEO-330: the unfiltered "{N} teams" counter belongs to the loaded screen alone.
    await expectTeamsLoaded(page);
    const noSelection = page.getByText("Select a team to see and edit everything we know about it.");
    await expect(noSelection).toBeVisible();

    // NEO-628 (Jason approved): axe reads one league's list, not the 2,000-row window
    // (about 95 s a call on that window, every row the same markup). This spec owns the
    // whole-page check of Team Management; admin-section-navigation and
    // drill-restores-from-url check only the "Admin sections" tabs there. The league's
    // list must still overflow its scroller, or axe's scrollable-region rule would stop
    // being exercised: with its last row scrolled into view, its first row is out of view.
    const league = page.getByRole("combobox", { name: "League" });
    await league.selectOption({ label: LEAGUE });
    // The settled count is announced with its league ("37 teams in MLB"), so this is the
    // league's own answer, never the held All-leagues window.
    await expect(page.getByRole("status").filter({ hasText: new RegExp(`^[\\d,]+ teams in ${LEAGUE}$`) })).toBeVisible();
    const rows = page.getByRole("main").getByRole("listitem").getByRole("button");
    await expect(rows.first()).toBeVisible();
    await rows.last().scrollIntoViewIfNeeded();
    await expect(rows.last()).toBeInViewport();
    await expect(rows.first(), `the ${LEAGUE} list overflows its scroller`).not.toBeInViewport();
    await expectAccessible(page, { label: `Team Management, the ${LEAGUE} list` });

    const filter = page.getByRole("textbox", { name: "Filter teams" });
    await filter.fill("zzzznotateam");
    await expect(filter).toHaveValue("zzzznotateam");

    await expect(page.getByText("No teams match that filter.")).toBeVisible();
    // With a filter typed the counter reads "{N} matches", so "0 matches" can only
    // mean the filter was applied (unfiltered it would read "{N} teams").
    await expect(teamsCounter(page, "0 matches")).toBeVisible();
    await expect(noSelection).toBeVisible();
    await expectAccessible(page, { label: "Team Management, no matches" });
  },
);
