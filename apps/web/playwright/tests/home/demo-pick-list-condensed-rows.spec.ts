// NEO-522 (R1): the Pick List's Row size switch. Spacious (the default) reads
// from across the room; Condensed brings back the Pick List as it was before
// NEO-522, and this device remembers the choice. On the public demo's sheet:
//   - Row size opens on Spacious, and the arrow keys move to Condensed and pick
//     it (a radio group: one Tab stop, the choice in aria-checked);
//   - Condensed is the old screen's content, on one line (NEO-598): the kind
//     chip ("Insert", "Parallel") beside the variant's name in the Set column,
//     the "couldn't match" note beside a sale filed with its set (Nabers), thin
//     dividers only (no heavier rule where the variant changes), a 24px bordered
//     checkbox (32px on a phone) and, on a wide screen, no Variant column, the
//     team beside the name, and every row a single line, a long listing title
//     in "Can't find it" and a slab's cert included;
//   - it uses the same wide page as Spacious at the same width, so more text
//     fits each line;
//   - it passes axe in light and dark;
//   - Back to default resets the list, never the row size;
//   - a reload keeps Condensed; Spacious brings the readable rows back, and a
//     reload keeps that too.
// A phone's one Card cell never carried the team line, before NEO-522 or since,
// so the team is asserted on a wide screen only; everything else holds on both.
// The demo is hard-coded data in the browser (demoPickStore.tsx), never
// Convex, so nothing here writes anywhere (R7). Public: signed out (R4).
import { test, expect, expectAccessible } from "../../support/fixtures";
import { nameCell, pickList, pickRow, pictureButton, pulledToggle, seen, variantTag } from "../../support/pick-list";

// The rows the spec reads, by how each row's name begins (demoPickStore.tsx).
const TROUT = "#27 Mike Trout, 2026 Topps Series 1";
const SKENES = "#150 Paul Skenes, 2026 Topps Series 1";
const SCHLITTLER = "#111 Cam Schlittler, 2026 Topps Series 1 Gold Foil";
const OHTANI_INSERT = "#8B-7 Shohei Ohtani, 2026 Topps Series 1 8 Bit Ballers";
// No NB card, but the listing says set, number and player, so it files with its set (NEO-509).
const NABERS = "2024 Score #302 · Malik Nabers";
const NOTE = "NB couldn't match this line. Check the order's photo.";
// "Can't find it": no set to file by, so the whole listing title is the row's long cell.
const WITT = "2026 Topps Heritage Clubhouse Collection Relic Bobby Witt Jr. #CCR-BW";
// Slabs: the grade and the cert share the line.
const OHTANI_SLAB = "#US1 Shohei Ohtani, 2018 Topps Update";
const SANDERS_SLAB = "#257 Barry Sanders, 1989 Score";

test(
  "Pick List demo: Condensed rows bring back the pre-NEO-522 screen, and this device remembers the choice",
  { tag: ["@home"] },
  async ({ page, isMobile }) => {
    const pick = pickList(page);
    const { region, table, rowSize } = pick;
    // The row's last cell on screen (Order on a desktop, the one cell on a phone) carries its rule.
    const ruleUnder = (row: string) => seen(pickRow(table, row).getByRole("cell")).last();
    const regionWidth = async () => (await region.boundingBox())!.width;
    // How many text lines tall a row stands, by its own line-height; a row on one line is about 1.
    const linesTall = async (row: string) => {
      const tr = pickRow(table, row);
      return (await tr.boundingBox())!.height / (await tr.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight)));
    };
    const viewport = page.viewportSize()!;

    await page.goto("/demo/inventory?tab=pick");
    await expect(pick.heading).toBeVisible();
    // Spacious is the default.
    await expect(rowSize.spacious).toHaveAttribute("aria-checked", "true");
    await expect(rowSize.condensed).toHaveAttribute("aria-checked", "false");
    await expect(ruleUnder(SKENES)).toHaveCSS("border-bottom-width", "3px");

    // The page's width in Spacious at 1920, to hold Condensed's against.
    let spaciousWide = 0;
    let spaciousAtConfig = 0;
    if (!isMobile) {
      spaciousAtConfig = await regionWidth();
      await page.setViewportSize({ width: 1920, height: viewport.height });
      await expect.poll(regionWidth).toBeGreaterThan(spaciousAtConfig);
      spaciousWide = await regionWidth();
      await page.setViewportSize(viewport);
    }

    // From the keyboard: one Tab stop on the checked option; the arrow key moves and picks.
    await rowSize.spacious.focus();
    await page.keyboard.press("ArrowRight");
    await expect(rowSize.condensed).toHaveAttribute("aria-checked", "true");
    await expect(rowSize.condensed).toBeFocused();
    await expect(rowSize.spacious).toHaveAttribute("aria-checked", "false");

    const expectCondensed = async () => {
      // The kind chip and the variant's own name, in the Set column (a phone's one cell).
      await expect(seen(pickRow(table, OHTANI_INSERT).getByText("Insert", { exact: true }))).toBeVisible();
      await expect(seen(pickRow(table, OHTANI_INSERT).getByText("8 Bit Ballers", { exact: true }))).toBeVisible();
      await expect(seen(pickRow(table, SCHLITTLER).getByText("Parallel", { exact: true }))).toBeVisible();
      // The note under a sale filed with its set.
      await expect(seen(pickRow(table, NABERS).getByText(NOTE, { exact: true }))).toBeVisible();
      // The old thin dividers: no heavier rule where the variant changes.
      await expect(ruleUnder(SKENES)).toHaveCSS("border-bottom-width", "1px");
      // The bordered checkbox: the button is the box. 24px (the WCAG 2.2 target floor) on a
      // wide screen, 32px on a phone; never the old 44px.
      const toggle = pulledToggle(table, TROUT);
      await expect(toggle).toHaveCSS("border-top-width", "2px");
      const box = (await toggle.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeLessThan(isMobile ? 36 : 25);
      if (!isMobile) {
        // No Variant column, and the team beside the name on the same line.
        await expect(table.getByRole("columnheader", { name: "Variant", exact: true })).toHaveCount(0);
        await expect(nameCell(pickRow(table, TROUT), "Mike Trout", "#27")).toContainText("Angels");
        // The picture is one box tall, 5:7, never the old 40 x 56.
        const pic = (await pictureButton(table, TROUT).boundingBox())!;
        expect(pic.height).toBeLessThanOrEqual(25);
        expect(pic.width / pic.height).toBeCloseTo(5 / 7, 1);
        // One line per row: the team and chips beside the name, the note beside the set, the
        // slab's grade and cert, a long listing title in Can't find it (clipped, never wrapped).
        for (const row of [TROUT, SKENES, SCHLITTLER, OHTANI_INSERT, NABERS, WITT, OHTANI_SLAB, SANDERS_SLAB]) {
          await expect.poll(() => linesTall(row), { message: row }).toBeLessThanOrEqual(1.5);
        }
        await expect(seen(pickRow(table, SANDERS_SLAB).getByText("Cert 4021337", { exact: true }))).toBeVisible();
      }
    };
    await expectCondensed();

    if (!isMobile) {
      // Condensed takes the same wide page as Spacious: at 1024 and at 1920 the list is as wide
      // as Spacious's, so more text fits each line.
      await expect.poll(regionWidth).toBe(spaciousAtConfig);
      await page.setViewportSize({ width: 1920, height: viewport.height });
      await expect.poll(regionWidth).toBe(spaciousWide);
      await expectCondensed();
      await page.setViewportSize(viewport);
    }

    await expectAccessible(page, { label: "Pick List demo, Condensed rows" });

    // Back to default resets the list, never the row size.
    await pick.quickFilters.getByRole("button", { name: "Only slabs", exact: true }).click();
    await pick.backToDefault.click();
    await expect(pick.backToDefault).toBeDisabled();
    await expect(rowSize.condensed).toHaveAttribute("aria-checked", "true");

    // This device remembers it.
    await page.reload();
    await expect(pick.heading).toBeVisible();
    await expect(rowSize.condensed).toHaveAttribute("aria-checked", "true");
    await expectCondensed();

    // And Spacious brings the readable rows back.
    await rowSize.spacious.click();
    await expect(rowSize.spacious).toHaveAttribute("aria-checked", "true");
    await expect(ruleUnder(SKENES)).toHaveCSS("border-bottom-width", "3px");
    await expect(variantTag(pickRow(table, OHTANI_INSERT), "8 Bit Ballers", "Insert")).toHaveText("Insert: 8 Bit Ballers");
    await expect(pickRow(table, NABERS).getByText(NOTE)).toHaveCount(0);
    if (!isMobile) {
      await expect(table.getByRole("columnheader", { name: "Variant", exact: true })).toBeVisible();
      await expect(nameCell(pickRow(table, TROUT), "Mike Trout", "Base #27")).not.toContainText("Angels");
    }
    await page.reload();
    await expect(pick.heading).toBeVisible();
    await expect(rowSize.spacious).toHaveAttribute("aria-checked", "true");
  },
);
