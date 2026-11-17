// R1 (NEO-569): the Sport-level attributes panel opens with the Years column
// (NEO-38: the panel at the sport level must not break the cascade) and no
// longer carries a League. League moved off the Sport row to the set's own list
// of NB leagues (`set-league-multi-select-and-card-league`); this spec replaces
// the retired `sport-level-league-autopopulates`, which read "Value for League"
// = MLB off the sport's write-once snapshot, and keeps the part of it that is
// still true (the panel mounts at the sport level beside the Years column).
//
// Read-only (R7): it opens the seed's Baseball row and expands a panel, which
// is a view toggle, never a write.
import { test, expect, expectAccessible, LAUNCH_GATE } from "../../support/fixtures";
import { columnHeading, openAttributesPanel, pick, setBuilderReady } from "../../support/set-builder";

test(
  "Sport-level attributes panel — Baseball opens its Years column beside a panel that has no League row",
  { tag: ["@set-selector"] },
  async ({ page, signIn }) => {
    await signIn("/set-selector");
    await expect(setBuilderReady(page)).toBeVisible({ timeout: LAUNCH_GATE });

    await pick(page, "Sports", "Baseball");
    await expect(columnHeading(page, "Years")).toBeVisible();

    const panel = page.getByRole("region", { name: "Set attributes panel" });
    await expect(panel.getByRole("heading", { name: /Attributes for Baseball.*Sport/ })).toBeVisible();
    await openAttributesPanel(page);

    // A sport has no league of its own: neither the old free-text control nor the set's League list is here.
    await expect(panel.getByLabel("Value for League")).toHaveCount(0);
    await expect(panel.getByRole("group", { name: "League", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("combobox", { name: "Add league" })).toHaveCount(0);
    await expectAccessible(page, { label: "Sport-level attributes panel" });
  },
);
