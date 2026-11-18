/**
 * NEO-356: what the light and dark themes look like, as a user sees them.
 *
 * A spec proves a mode by what is painted, never by the root attribute: the
 * page colour (the header banner sits on it) and the colour of a heading. The
 * values are the `surface` and `ink` roles of app/theme.css (mirrored in
 * src/theme/tokens.ts); change them together.
 *
 * The suite runs as a dark-OS user (playwright.config.ts pins
 * `colorScheme: "dark"`). Only the theme specs and `expectAccessible` (which
 * checks every screen in both modes, support/a11y.ts) call `page.emulateMedia`
 * or change the saved theme, and each leaves the OS dark again.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export type Look = "light" | "dark";

const LOOKS: Record<Look, { page: string; ink: string }> = {
  dark: { page: "rgb(10, 10, 10)", ink: "rgb(255, 255, 255)" },
  light: { page: "rgb(247, 248, 252)", ink: "rgb(24, 18, 43)" },
};

/** The page is painted in `look`: the colour behind the header banner. */
export async function expectPageLook(page: Page, look: Look): Promise<void> {
  await expect(page.getByRole("banner")).toHaveCSS("background-color", LOOKS[look].page);
}

/** The page colour AND one heading drawn in the primary ink colour are `look`. */
export async function expectLook(page: Page, look: Look, heading: Locator): Promise<void> {
  await expectPageLook(page, look);
  await expect(heading).toHaveCSS("color", LOOKS[look].ink);
}

/**
 * Whether the page has a banner at all. `includeHidden`: a modal dialog marks
 * everything behind it aria-hidden, and the page behind it is still the page.
 * A few pages have none (the public profile and sale pages are a dark
 * standalone design with no header), so the mode cannot be read there.
 */
export async function pageHasBanner(page: Page): Promise<boolean> {
  return (await page.getByRole("banner", { includeHidden: true }).count()) > 0;
}

/**
 * Does the page paint `look` once the browser settles? Resolves true as soon
 * as it does (an instant answer on a page that follows the OS) and false when
 * `timeout` passes without it, meaning the page is pinned to the other mode
 * (a ForceDark route, the demo toggle's override, an explicit saved theme).
 * It never throws; a page with no banner to read answers false.
 *
 * Painted colour, not the root attribute, is the proof, so a page scoped to
 * one mode inside a root that flipped (the public profile) reads as pinned,
 * which is what the user sees.
 */
export async function paintsLook(page: Page, look: Look, timeout = 7_000): Promise<boolean> {
  try {
    await expect(page.getByRole("banner", { includeHidden: true }).first()).toHaveCSS(
      "background-color",
      LOOKS[look].page,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * NEO-606: a field over its length cap is marked as a whole, in the app's
 * error pink: the field's edge, and the note under it that says why. Both are
 * the `neon-pink-text` role (app/theme.css), read in the dark mode the suite
 * is pinned to. The pink IS the feature here, so it is read as painted; the
 * note's words and the field's `aria-invalid` (a blocking title) are the spec's
 * own asserts.
 */
const OVER_CAP_PINK = "rgb(255, 64, 163)";

/** `field` wears the over-cap pink edge, and `note` (what it says about the length) the same pink ink. */
export async function expectOverCapLook(field: Locator, note: Locator): Promise<void> {
  await expect(field).toHaveCSS("border-top-color", OVER_CAP_PINK);
  await expect(note).toHaveCSS("color", OVER_CAP_PINK);
}

/** `field` no longer wears the over-cap pink edge. Pair it with a positive assert (GUIDE R2). */
export async function expectNoOverCapLook(field: Locator): Promise<void> {
  await expect(field).not.toHaveCSS("border-top-color", OVER_CAP_PINK);
}
