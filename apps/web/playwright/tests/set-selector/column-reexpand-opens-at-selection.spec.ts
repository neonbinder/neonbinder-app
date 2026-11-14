// Origin: .maestro/flows/set-selector/column-reexpand-opens-at-selection.yaml (Maestro suite retired in NEO-341; see git history)
// NEO-276: re-expanding a collapsed column opens its list scrolled to the
// selected row, not to the top. Racing sits far down the Sports list, so
// "Racing in view, Baseball (first) not in view" is the proof. Read-only.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { BSC_PATH, bscFault } from "../../support/bscFake";
import {
  expectAfterBscSync,
  columnHeading,
  columnOption,
  columnSearch,
  columnSelection,
  setBuilderReady,
} from "../../support/set-builder";

test(
  "Set Builder cascade — re-expanding a collapsed column opens its list scrolled to the selected row, not to the top (NEO-276)",
  { tag: ["@set-selector"] },
  async ({ page, signIn, env, bscFake }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    // NEO-552: BuySportsCards is the fake, which answers the Years sync at once, so the column would
    // never say it is waiting. Hold the FIRST catalogue-facets answer for 4 s (past the product's
    // 1.5 s announce gate, well under its call timeouts, so it lands rather than fails): when this
    // click is the one that syncs Racing's years, the wait line is up and `expectAfterBscSync`
    // measures it (a `marketplace-wait` annotation says how long). When an earlier spec on the pass
    // already synced them, no call is made and the rule is never used. Either way the assertions are
    // unchanged. This is incidental coverage of the wait line, NOT its proof: the stall spec
    // (checklist-fetch-bounds-a-bsc-stall...) asserts the "Waiting on BuySportsCards" copy. Teardown drops the rule.
    await bscFake.setFaults([bscFault.slow(BSC_PATH.filters, 4_000, { times: 1, ttlS: 300 })]);
    await columnSearch(page, "Sports").fill("Racing");
    await columnOption(page, "Sports", "Racing").click();
    await expect(columnHeading(page, "Years")).toBeVisible();
    // Wait for Years to hold its rows before collapsing Sports. On a phone the
    // cascade row scrolls sideways, and the freshly revealed Years column
    // re-centres itself once its first rows land (EntityColumn's reveal
    // settle). Re-expanding Sports before that lands means the late scroll
    // carries the row back to Years, and Racing sits off screen to the left
    // however well its list was scrolled. The Years heading is up in the first
    // frame, so only a Years row proves the column has settled. Racing's years
    // are not seeded: the column syncs them live from BSC on this very click,
    // so the wait is 7 s plus the seconds "Waiting on BuySportsCards…" is up
    // (NEO-487), never a flat budget.
    await expectAfterBscSync(
      page,
      page.getByRole("listbox", { name: "Years" }).getByRole("option").first(),
      "Racing's Years sync",
    );

    // Collapse the column, then re-expand it.
    await columnSelection(page, "Sports", "Racing").click();
    await expect(columnSearch(page, "Sports")).toBeVisible();

    const racing = columnOption(page, "Sports", "Racing");
    const baseball = columnOption(page, "Sports", "Baseball");
    await expect(columnHeading(page, "Sports")).toBeVisible();
    if (!env.SL_PAUSED) {
      await expect(page.getByRole("button", { name: "Add custom Sports" })).toBeVisible();
    } else {
      // The pause strip adds a wrapped line above the cascade, which pushes the
      // centred row (the list's fold sits past the 629 px viewport) out of
      // view, so a reader dismisses it first. Session-only: nothing is written
      // server-side. The Sports column's own notice is NOT asserted either way:
      // it exists only after some spec forced a Sports sync, which is order.
      await page.getByRole("button", { name: "Dismiss pause notice" }).click();
      await expect(page.getByText("SportLots is on pause.")).toBeHidden();
    }
    // A reader scrolls the page down to the column: how far down the cascade sits
    // depends on the Admin tabs above it (they wrap to a second line at this
    // width), and the proof is the list's own scroll, not the page's. Only the
    // page moves here: the wheel turns over the page's left margin, outside every
    // list, so no list's scroll is touched. (The centred row sits at about 670 px
    // of a 629 px viewport until the page is scrolled. A wheel turn is what a
    // reader does; the former `evaluate(scrollIntoView)` left the page unmoved
    // in the NEO-552 local runs.)
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("the page has no viewport size");
    await page.mouse.move(viewport.width * 0.01, viewport.height * 0.5);
    await page.mouse.wheel(0, 300);
    await expect(racing).toBeInViewport();
    await expect(baseball).not.toBeInViewport();
    await expectAccessible(page, { label: "Sports column re-expanded at its selection" });
  },
);
